import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { getWeekStartDate, parseWeekStartParam } from '../lib/dispatch/date-utils'

/**
 * The weekly grid, the mission pool and the auto-planning snapshot all key off
 * PlanningRow.weekStartDate. They agree only as long as every route turns a
 * client "YYYY-MM-DD" into a Date the same way. A route that builds its own
 * Date (for instance `new Date("2026-10-05")`, which is UTC midnight) targets a
 * second, parallel set of planning rows for the same operational week: the
 * assignments are written but the grid cells stay empty.
 */

function typescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name)
    return entry.isDirectory()
      ? typescriptFiles(fullPath)
      : entry.isFile() && entry.name.endsWith('.ts')
      ? [fullPath]
      : []
  })
}

// A. The parser is local-midnight based, and that is the single convention.
const parsed = parseWeekStartParam('2026-10-05')
assert.ok(parsed, 'parseWeekStartParam must accept a valid ISO day')
assert.equal(parsed!.getFullYear(), 2026)
assert.equal(parsed!.getMonth(), 9)
assert.equal(parsed!.getDate(), 5)
assert.equal(parsed!.getHours(), 0)
assert.equal(parsed!.getMinutes(), 0)

// B. It agrees with the "current week" helper the UI uses for today.
const monday = getWeekStartDate(new Date(2026, 9, 7))
assert.equal(monday.getTime(), parsed!.getTime(), 'both helpers must land on the same Monday instant')

// C. No dispatch route may parse a client-supplied weekStart by itself.
const routes = typescriptFiles(path.join('pages', 'api', 'dispatch')).sort()
const clientWeekRoutes = routes.filter((route) => {
  const source = readFileSync(route, 'utf8')
  return /req\.(query|body)[^\n]*weekStart|weekStart[^\n]*req\.(query|body)/.test(source)
})
assert.ok(clientWeekRoutes.length > 0, 'the audit must cover at least one route')
for (const route of clientWeekRoutes) {
  const source = readFileSync(route, 'utf8')
  assert.match(
    source,
    /parseWeekStartParam|getRequestedWeekStartDate/,
    `${route} must resolve weekStart through the shared parser`
  )
}

// D. Nobody may rebuild a week start from a raw date string.
for (const route of routes) {
  const source = readFileSync(route, 'utf8')
  assert.doesNotMatch(
    source,
    /new Date\(\s*(req\.(query|body)[^)]*weekStart|[`'"]\d{4}-\d{2}-\d{2}[`'"])\s*\)/,
    `${route} must not build a week start from a raw date string`
  )
}

console.log(
  `Dispatch weekStart convention: ${clientWeekRoutes.length} client-facing routes share the parser`
)
