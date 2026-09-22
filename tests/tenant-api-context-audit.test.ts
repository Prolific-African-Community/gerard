import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const roots = ['pages/api/dispatch', 'pages/api/park', 'pages/api/driver']

function typescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name)
    return entry.isDirectory() ? typescriptFiles(fullPath) : entry.isFile() && entry.name.endsWith('.ts') ? [fullPath] : []
  })
}

const routes = roots.flatMap(typescriptFiles).sort()
assert.equal(routes.length, 76, 'Update the tenant API audit when a métier route is added or removed')

for (const route of routes) {
  const source = readFileSync(route, 'utf8')
  assert.match(source, /export default withTenantApiRoute\(handler\)/, `${route} must execute inside the active organization context`)
  assert.match(source, /import \{ withTenantApiRoute \} from /, `${route} must use the shared tenant route wrapper`)
}

console.log(`Tenant API context audit: ${routes.length}/76 métier routes wrapped`)
