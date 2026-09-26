import { isProductionDatabase } from '../../apps/novotralux/scripts/database-target.mjs'
import { createPlatformConfigurationRequest } from '../../lib/platform/configuration-channel'
import { inspectDatabase } from './database'
import {
  APPS, CONFIGURATION_PATH, DATABASE_VARIABLES, FORBIDDEN_STAGING_VARIABLES, LABEL, PRODUCTION_HOSTS, QA_ACCOUNTS, SCOPE, STAGING_PROJECTS, authenticate, databaseEndpoint,
  isProductionOrPreviewEndpoint, log, main, neon, neonConfig, resolveProjects, stableHost, stagingDatabase, stagingVariables, type App,
} from './lib'

// npm run staging:check — read-only readiness report of gerard-staging and novotralux-custom-staging.
// - Databases and QA accounts: the canonical Neon Staging child branches, through their official Neon connection
//   strings, in read-only transactions (never a local .env, never `vercel env run`).
// - Vercel configuration: each Staging project's own variables (`vercel env ls --project … --json`), compared with the
//   Neon child branches without printing any value.
// - Deployed runtimes: the stable URLs and the existing signed reads getConfiguration / getOrgAdmins.
// PASS/FAIL only; no secret or database URL is printed.

const ITEMS = ['Gerard Staging reachable', 'Novotralux Staging reachable', 'Gerard Staging DB is not Production', 'Novotralux Staging DB is not Production', 'Platform endpoint targets Novotralux Staging only', 'getConfiguration', 'getOrgAdmins', 'QA accounts', 'Integrations safe', 'No Production host leakage'] as const
type Item = (typeof ITEMS)[number]
const problems = new Map<Item, string[]>(ITEMS.map((item) => [item, []]))
const problem = (item: Item, message: string) => problems.get(item)!.push(message)
const DB_ITEM: Record<App, Item> = { gerard: 'Gerard Staging DB is not Production', novotralux: 'Novotralux Staging DB is not Production' }
const REACH_ITEM: Record<App, Item> = { gerard: 'Gerard Staging reachable', novotralux: 'Novotralux Staging reachable' }

function report() {
  log('')
  for (const item of ITEMS) { const list = problems.get(item)!; log(`${list.length ? 'FAIL' : 'PASS'}  ${item}${list.length ? ` — ${list.join('; ')}` : ''}`) }
  const failed = ITEMS.filter((item) => problems.get(item)!.length).length
  log(`\nSTAGING CHECK: ${failed ? 'FAIL' : 'PASS'} (${ITEMS.length - failed}/${ITEMS.length})`)
  return failed ? 1 : 0
}
const all = (message: string) => { for (const item of ITEMS) problem(item, message) }
const endpointOf = (url: string) => { try { return databaseEndpoint(url) } catch { return undefined } }

main(async () => {
  log(`Gerard Staging check (read-only, scope ${SCOPE})`)
  try { await authenticate({ interactive: Boolean(process.stdin.isTTY) }) } catch (error) { all(`not checked: ${(error as Error).message}`); return report() }
  const { staging } = await resolveProjects()
  const missing = APPS.filter((app) => !staging[app]).map((app) => STAGING_PROJECTS[app])
  if (missing.length) { all(`${missing.join(', ')} missing (run npm run staging:setup)`); return report() }

  const hosts = {} as Record<App, string | undefined>
  const variables = {} as Record<App, Record<string, string | undefined>>
  for (const app of APPS) {
    hosts[app] = await stableHost(STAGING_PROJECTS[app])
    variables[app] = await stagingVariables(STAGING_PROJECTS[app])
  }

  // 1–2. The deployed runtimes on their stable URLs.
  for (const app of APPS) {
    if (!hosts[app]) { problem(REACH_ITEM[app], `${STAGING_PROJECTS[app]} has no stable production domain yet (deploy it)`); continue }
    try {
      const response = await fetch(`https://${hosts[app]}/login`, { redirect: 'manual', signal: AbortSignal.timeout(20000) })
      if (response.status >= 400) problem(REACH_ITEM[app], `https://${hosts[app]}/login answered ${response.status}`)
    } catch { problem(REACH_ITEM[app], `https://${hosts[app]} unreachable`) }
  }

  // 3–4, 8, 9 (database part). Each canonical Neon child branch, read directly and read-only with its official
  // credential; then the Staging project's database variables must be that exact credential.
  const branches = await neon.branches()
  const endpoints = {} as Record<App, string | undefined>
  for (const app of APPS) {
    const item = DB_ITEM[app]
    let database: Awaited<ReturnType<typeof stagingDatabase>>
    try { database = await stagingDatabase(app, branches) } catch (error) { problem(item, (error as Error).message); problem('QA accounts', `${LABEL[app]}: database not checked`); continue }
    if (!database) { problem(item, `Neon branch ${neonConfig.branches[app]} missing`); problem('QA accounts', `${LABEL[app]}: database missing`); continue }
    endpoints[app] = database.endpoint
    if (isProductionOrPreviewEndpoint(database.endpoint)) { problem(item, 'Neon Staging branch served by a Production/Preview endpoint'); continue }
    try {
      const state = await inspectDatabase(database.url, app, { readOnly: true })
      if (!state.migrations.applied || state.migrations.failed) problem(item, `migrations: ${state.migrations.applied} applied, ${state.migrations.failed} failed`)
      if (!state.marker || state.marker.branch !== database.branch.id || state.marker.app !== app) problem(item, 'sanitization marker missing or from another branch')
      if (!state.qaActive) problem('QA accounts', `${QA_ACCOUNTS[app]} missing or inactive`)
      else if (app === 'gerard' && (state.qa.platformRole !== 'SUPER_ADMIN' || !state.qa.organizationRole)) problem('QA accounts', `${QA_ACCOUNTS.gerard} is not a SUPER_ADMIN with a Standard membership`)
      else if (app === 'novotralux' && state.qa.organizationRole !== 'ORG_ADMIN') problem('QA accounts', `${QA_ACCOUNTS.novotralux} is not ORG_ADMIN of org-novotralux`)
      if (state.integrations.enabled || state.integrations.withSecret) problem('Integrations safe', `${LABEL[app]}: ${state.integrations.enabled} enabled integration(s), ${state.integrations.withSecret} secret reference(s)`)
    } catch { problem(item, 'Staging database unreachable with its Neon credential'); problem('QA accounts', `${LABEL[app]}: database unreachable`) }
    for (const key of DATABASE_VARIABLES[app]) {
      const value = variables[app][key]
      if (!value) { problem(item, `${key} missing in ${STAGING_PROJECTS[app]}`); continue }
      const endpoint = endpointOf(value)
      if (!endpoint) problem(item, `${key} in ${STAGING_PROJECTS[app]} is not a database URL`)
      else if (isProductionDatabase(value) || isProductionOrPreviewEndpoint(endpoint)) problem(item, `${key} in ${STAGING_PROJECTS[app]} is a Production database`)
      else if (endpoint !== database.endpoint) problem(item, `${key} in ${STAGING_PROJECTS[app]} does not point at the Staging branch`)
      else if (value !== database.url) problem(item, `${key} in ${STAGING_PROJECTS[app]} is not the current Neon credential of the Staging branch`)
    }
  }
  if (endpoints.gerard && endpoints.gerard === endpoints.novotralux) { problem(DB_ITEM.gerard, 'shared with Novotralux Staging'); problem(DB_ITEM.novotralux, 'shared with Gerard Staging') }

  // 5. Channel target and environment identity (from the Staging projects' own variables).
  const expected = hosts.novotralux ? `https://${hosts.novotralux}${CONFIGURATION_PATH}` : undefined
  const endpoint = variables.gerard.GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_CONFIGURATION_ENDPOINT
  if (!endpoint) problem('Platform endpoint targets Novotralux Staging only', 'Gerard Staging has no Novotralux endpoint')
  else if (endpoint !== expected) problem('Platform endpoint targets Novotralux Staging only', `endpoint is not ${expected ?? 'the Novotralux Staging stable URL'}`)
  for (const app of APPS) if (variables[app].GERARD_INSTANCE_ENVIRONMENT !== 'staging') problem('Platform endpoint targets Novotralux Staging only', `${STAGING_PROJECTS[app]} is not declared staging`)
  if (variables.gerard.GERARD_PLATFORM_HOSTNAMES !== hosts.gerard) problem('Platform endpoint targets Novotralux Staging only', 'GERARD_PLATFORM_HOSTNAMES is not the Gerard Staging host')
  const shared = variables.gerard.GERARD_PLATFORM_INSTANCE_SHARED_SECRET
  if (!shared || shared !== variables.novotralux.GERARD_PLATFORM_INSTANCE_SHARED_SECRET) problem('Platform endpoint targets Novotralux Staging only', 'Staging shared secret missing or different on the two projects')

  // 6–7. The existing signed reads against the deployed Novotralux Staging, signed with the Staging secret (in memory).
  if (!endpoint || endpoint !== expected || !shared) { problem('getConfiguration', 'not called (channel configuration invalid)'); problem('getOrgAdmins', 'not called (channel configuration invalid)') }
  else {
    process.env.GERARD_PLATFORM_INSTANCE_SHARED_SECRET = shared
    for (const action of ['getConfiguration', 'getOrgAdmins'] as const) {
      try {
        const signed = createPlatformConfigurationRequest({ application: 'novotralux', organizationId: 'org-novotralux', action, payload: {} })
        const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-gerard-platform-signature': signed.signature }, body: JSON.stringify({ request: signed.request }), signal: AbortSignal.timeout(20000) })
        const body = await response.json().catch(() => ({})) as Record<string, any>
        if (response.status !== 200 || body.organizationId !== 'org-novotralux') problem(action, `Novotralux Staging answered ${response.status}`)
        else if (action === 'getOrgAdmins' && !(body.admins ?? []).some((admin: { username?: string }) => admin.username === QA_ACCOUNTS.novotralux)) problem(action, `${QA_ACCOUNTS.novotralux} not listed`)
      } catch { problem(action, 'Novotralux Staging unreachable') }
    }
    delete process.env.GERARD_PLATFORM_INSTANCE_SHARED_SECRET
  }

  // 9. Integrations: no forbidden variable in either Staging project, Google Routes capped.
  for (const app of APPS) {
    const forbidden = Object.keys(variables[app]).filter((key) => FORBIDDEN_STAGING_VARIABLES.test(key))
    if (forbidden.length) problem('Integrations safe', `${STAGING_PROJECTS[app]} holds ${forbidden.join(', ')} (run npm run staging:setup)`)
    if (variables[app].GOOGLE_ROUTES_MAX_CALLS_PER_OPERATION !== '0') problem('Integrations safe', `${STAGING_PROJECTS[app]}: Google Routes not capped to 0`)
  }

  // 10. No Staging host or value points at Production.
  for (const app of APPS) {
    if (hosts[app] && PRODUCTION_HOSTS.includes(hosts[app]!)) problem('No Production host leakage', `${STAGING_PROJECTS[app]} serves a Production host`)
    const leaking = Object.entries(variables[app]).filter(([, value]) => PRODUCTION_HOSTS.some((host) => (value ?? '').toLowerCase().includes(host))).map(([key]) => key)
    if (leaking.length) problem('No Production host leakage', `${STAGING_PROJECTS[app]}: ${leaking.join(', ')} reference a Production host`)
  }
  return report()
})
