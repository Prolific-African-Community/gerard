import {
  APPS, CONFIGURATION_PATH, FORBIDDEN_STAGING_VARIABLES, LABEL, PRODUCTION_HOSTS, QA_ACCOUNTS, SCOPE, STAGING_PROJECTS, authenticate, isProductionOrPreviewEndpoint, log, main, neon,
  neonConfig, resolveProjects, stableHost, stagingDatabase, probe, type App, type ProbeFacts,
} from './lib'

// npm run staging:check — read-only readiness report of gerard-staging and novotralux-custom-staging. It reads CLI
// metadata, runs a probe inside `vercel env run` (read-only database transactions and the existing signed reads
// getConfiguration / getOrgAdmins) and requests the public Staging URLs. PASS/FAIL only; no secret or database URL.

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

main(async () => {
  log(`Gerard Staging check (read-only, scope ${SCOPE})`)
  try { await authenticate({ interactive: Boolean(process.stdin.isTTY) }) } catch (error) { all(`not checked: ${(error as Error).message}`); return report() }
  const { staging } = await resolveProjects()
  const missing = APPS.filter((app) => !staging[app]).map((app) => STAGING_PROJECTS[app])
  if (missing.length) { all(`${missing.join(', ')} missing (run npm run staging:setup)`); return report() }

  const hosts = {} as Record<App, string | undefined>
  const facts = {} as Record<App, ProbeFacts | undefined>
  for (const app of APPS) {
    hosts[app] = await stableHost(STAGING_PROJECTS[app])
    try { facts[app] = await probe(STAGING_PROJECTS[app], 'full', app) } catch (error) { for (const item of ITEMS.slice(2)) problem(item, (error as Error).message) }
  }

  // 1–2. Reachability of the stable URLs.
  for (const app of APPS) {
    if (!hosts[app]) { problem(REACH_ITEM[app], `${STAGING_PROJECTS[app]} has no stable production domain yet (deploy it)`); continue }
    try {
      const response = await fetch(`https://${hosts[app]}/login`, { redirect: 'manual', signal: AbortSignal.timeout(20000) })
      if (response.status >= 400) problem(REACH_ITEM[app], `https://${hosts[app]}/login answered ${response.status}`)
    } catch { problem(REACH_ITEM[app], `https://${hosts[app]} unreachable`) }
  }

  // 3–4. Databases: the Staging Neon branch, never Production, never shared between the two apps; migrations applied.
  const branches = await neon.branches()
  const endpoints = {} as Record<App, string | undefined>
  for (const app of APPS) {
    const item = DB_ITEM[app]
    try {
      const database = await stagingDatabase(app, branches)
      if (!database) { problem(item, `Neon branch ${neonConfig.branches[app]} missing`); continue }
      endpoints[app] = database.endpoint
      if (isProductionOrPreviewEndpoint(database.endpoint)) problem(item, 'Neon Staging branch served by a Production/Preview endpoint')
      const probed = facts[app]?.database
      if (!probed) continue
      for (const [key, endpoint] of Object.entries(probed.variables)) if (endpoint !== database.endpoint) problem(item, `${key} does not point at the Staging branch`)
      if (probed.productionEndpoint) problem(item, 'DATABASE_URL is a Production database')
      if (!probed.reachable) problem(item, 'database unreachable')
      else if (!probed.migrations?.applied || probed.migrations.failed) problem(item, 'migrations not applied')
    } catch (error) { problem(item, (error as Error).message) }
  }
  if (endpoints.gerard && endpoints.gerard === endpoints.novotralux) { problem(DB_ITEM.gerard, 'shared with Novotralux Staging'); problem(DB_ITEM.novotralux, 'shared with Gerard Staging') }

  // 5. Channel target and environment identity.
  const gerard = facts.gerard
  const expected = hosts.novotralux ? `https://${hosts.novotralux}${CONFIGURATION_PATH}` : undefined
  const endpoint = gerard?.values.GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_CONFIGURATION_ENDPOINT
  if (!endpoint) problem('Platform endpoint targets Novotralux Staging only', 'Gerard Staging has no Novotralux endpoint')
  else if (endpoint !== expected) problem('Platform endpoint targets Novotralux Staging only', `endpoint is not ${expected ?? 'the Novotralux Staging stable URL'}`)
  for (const app of APPS) if (facts[app] && facts[app]!.environment !== 'staging') problem('Platform endpoint targets Novotralux Staging only', `${STAGING_PROJECTS[app]} is not declared staging`)
  if (gerard && gerard.values.GERARD_PLATFORM_HOSTNAMES !== hosts.gerard) problem('Platform endpoint targets Novotralux Staging only', 'GERARD_PLATFORM_HOSTNAMES is not the Gerard Staging host')
  const secrets = APPS.map((app) => facts[app]?.secrets.GERARD_PLATFORM_INSTANCE_SHARED_SECRET?.fingerprint)
  if (!secrets[0] || secrets[0] !== secrets[1]) problem('Platform endpoint targets Novotralux Staging only', 'Staging shared secret missing or different on the two projects')

  // 6–7. The existing signed reads, from Gerard Staging's own configuration to Novotralux Staging.
  const configuration = gerard?.channel?.getConfiguration
  if (!configuration || configuration.status !== 200 || configuration.organizationId !== 'org-novotralux') problem('getConfiguration', `Novotralux Staging answered ${configuration?.status ?? 'nothing'}`)
  const admins = gerard?.channel?.getOrgAdmins
  if (!admins || admins.status !== 200) problem('getOrgAdmins', `Novotralux Staging answered ${admins?.status ?? 'nothing'}`)
  else if (!admins.usernames?.includes(QA_ACCOUNTS.novotralux)) problem('getOrgAdmins', `${QA_ACCOUNTS.novotralux} not listed`)

  // 8. QA accounts.
  for (const app of APPS) {
    const account = facts[app]?.database?.account
    if (!account?.exists) problem('QA accounts', `${QA_ACCOUNTS[app]} missing`)
    else if (!account.active) problem('QA accounts', `${QA_ACCOUNTS[app]} inactive`)
    else if (app === 'gerard' && (account.platformRole !== 'SUPER_ADMIN' || !account.organizationRole)) problem('QA accounts', `${QA_ACCOUNTS.gerard} is not a SUPER_ADMIN with a Standard membership`)
    else if (app === 'novotralux' && account.organizationRole !== 'ORG_ADMIN') problem('QA accounts', `${QA_ACCOUNTS.novotralux} is not ORG_ADMIN of org-novotralux`)
  }

  // 9. Integrations: none enabled, no integration/Production credential, Google Routes capped.
  for (const app of APPS) {
    const probed = facts[app]
    if (!probed) continue
    if (probed.database?.integrationsEnabled) problem('Integrations safe', `${LABEL[app]}: ${probed.database.integrationsEnabled} integration(s) enabled`)
    const forbidden = probed.keys.filter((key) => FORBIDDEN_STAGING_VARIABLES.test(key))
    if (forbidden.length) problem('Integrations safe', `${STAGING_PROJECTS[app]} holds ${forbidden.join(', ')}`)
    if (probed.routesCap !== '0') problem('Integrations safe', `${STAGING_PROJECTS[app]}: Google Routes not capped to 0`)
  }

  // 10. No Staging value or host points at Production.
  for (const app of APPS) {
    if (hosts[app] && PRODUCTION_HOSTS.includes(hosts[app]!)) problem('No Production host leakage', `${STAGING_PROJECTS[app]} serves a Production host`)
    if (facts[app]?.productionHostKeys.length) problem('No Production host leakage', `${STAGING_PROJECTS[app]}: ${facts[app]!.productionHostKeys.join(', ')} reference a Production host`)
  }
  return report()
})
