import pg from 'pg'

import { createPlatformConfigurationRequest } from '../../lib/platform/configuration-channel'
import {
  APPS, DATABASE_VARIABLE, FORBIDDEN_STAGING_VARIABLES, LABEL, QA_ACCOUNTS, appliesTo, authenticate, automationBypass, config, databaseEndpoint, isProductionOrPreviewEndpoint,
  log, main, neon, productionDomain, stagingDatabase, stagingEndpoint, stagingEnvironment, stagingOnly, targetsOf, trustsStaging, vercelClient, type App, type VercelEnv, type VercelProject,
} from './lib'

// npm run staging:check — read-only readiness report of the permanent Staging environments. It only reads Vercel
// metadata, the two Staging databases (read-only transactions) and the existing signed channel reads
// (getConfiguration, getOrgAdmins). It prints PASS/FAIL per item, never a secret, a URL of a database or a token.

type Item = { name: string; problems: string[] }
const items: Item[] = ['Gerard Staging DB', 'Novotralux Staging DB', 'Production DB overlap', 'Custom endpoint', 'Production endpoint leakage', 'Channel', 'QA accounts', 'Integration safety'].map((name) => ({ name, problems: [] }))
const problem = (name: string, message: string) => items.find((item) => item.name === name)!.problems.push(message)
const DB_ITEM: Record<App, string> = { gerard: 'Gerard Staging DB', novotralux: 'Novotralux Staging DB' }

function report() {
  log('')
  for (const item of items) log(`${item.problems.length ? 'FAIL' : 'PASS'}  ${item.name}${item.problems.length ? ` — ${item.problems.join('; ')}` : ''}`)
  const failed = items.filter((item) => item.problems.length).length
  log(`\nSTAGING CHECK: ${failed ? 'FAIL' : 'PASS'} (${items.length - failed}/${items.length})`)
  return failed ? 1 : 0
}

async function readOnlyQuery<T>(url: string, work: (client: pg.Client) => Promise<T>) {
  const client = new pg.Client({ connectionString: url, options: '-c default_transaction_read_only=on', connectionTimeoutMillis: 15000 })
  await client.connect()
  try { return await work(client) } finally { await client.end() }
}

main(async () => {
  log('Gerard Staging check (read-only)')
  let token: string
  try { token = await authenticate({ interactive: Boolean(process.stdin.isTTY) }) } catch (error) {
    for (const item of items) item.problems.push(`not checked: ${(error as Error).message}`)
    return report()
  }
  const vercel = vercelClient(token, { readOnly: true })
  const projects = await vercel.resolveProjects()
  const staging = {} as Record<App, string>
  const envs = {} as Record<App, VercelEnv[]>
  for (const app of APPS) {
    const found = await stagingEnvironment(vercel, projects[app])
    if (!found) { for (const item of items) item.problems.push(`${projects[app].name} has no staging environment (run npm run staging:setup)`); return report() }
    staging[app] = found.id
    envs[app] = await vercel.envs(projects[app].id)
  }
  const variable = async (app: App, key: string) => {
    const matches = envs[app].filter((item) => item.key === key && appliesTo(item, staging[app]))
    if (matches.length !== 1) return { missing: true as const }
    return { missing: false as const, stagingOnly: stagingOnly(matches[0], staging[app]), value: await vercel.decrypt(projects[app].id, matches[0].id) }
  }

  // ── Databases ──
  const branches = await neon.branches()
  const databases = {} as Partial<Record<App, Awaited<ReturnType<typeof stagingDatabase>>>>
  for (const app of APPS) {
    try { databases[app] = await stagingDatabase(app, branches) } catch (error) { problem(DB_ITEM[app], (error as Error).message); problem('Production DB overlap', (error as Error).message); continue }
    const database = databases[app]
    if (!database) { problem(DB_ITEM[app], `Neon branch ${config.neon.branches[app]} missing`); continue }
    if (isProductionOrPreviewEndpoint(database.endpoint)) problem('Production DB overlap', `${LABEL[app]} branch served by a Production/Preview endpoint`)
    const configured = await variable(app, DATABASE_VARIABLE[app])
    if (configured.missing) problem(DB_ITEM[app], `${DATABASE_VARIABLE[app]} missing in Vercel staging`)
    else {
      if (!configured.stagingOnly) problem('Production DB overlap', `${DATABASE_VARIABLE[app]} is shared with another environment`)
      let endpoint = ''
      try { endpoint = databaseEndpoint(configured.value) } catch { problem(DB_ITEM[app], `${DATABASE_VARIABLE[app]} is not a valid URL`) }
      if (endpoint && endpoint !== database.endpoint) problem(DB_ITEM[app], `${DATABASE_VARIABLE[app]} does not point at branch ${config.neon.branches[app]}`)
      if (endpoint && isProductionOrPreviewEndpoint(endpoint)) problem('Production DB overlap', `${LABEL[app]} variable points at a Production/Preview database`)
    }
    try {
      const migrations = await readOnlyQuery(database.direct, async (client) => (await client.query(`select count(*) filter (where finished_at is not null and rolled_back_at is null)::int as applied, count(*) filter (where finished_at is null and rolled_back_at is null)::int as failed from public._prisma_migrations`)).rows[0])
      if (!migrations.applied || migrations.failed) problem(DB_ITEM[app], `migrations: ${migrations.applied} applied, ${migrations.failed} failed`)
    } catch { problem(DB_ITEM[app], 'database unreachable or not migrated') }
  }
  if (databases.gerard && databases.novotralux && databases.gerard.endpoint === databases.novotralux.endpoint) problem('Production DB overlap', 'Gerard and Novotralux Staging share one database endpoint')

  // ── Endpoints and domains ──
  const endpointVar = await variable('gerard', 'GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_CONFIGURATION_ENDPOINT')
  const domains = { gerard: await vercel.domains(projects.gerard.id), novotralux: await vercel.domains(projects.novotralux.id) }
  if (endpointVar.missing) problem('Custom endpoint', 'Gerard staging has no Novotralux configuration endpoint')
  else if (endpointVar.value !== stagingEndpoint()) problem('Custom endpoint', `Gerard staging endpoint is not https://${config.domains.novotralux}/api/internal/platform/configuration`)
  for (const app of APPS) if (!domains[app].some((item) => item.name.toLowerCase() === config.domains[app].toLowerCase() && item.customEnvironmentId === staging[app])) problem('Custom endpoint', `${config.domains[app]} not attached to ${projects[app].name} staging`)
  const productionHosts = new Set([...config.productionHosts, ...APPS.flatMap((app) => domains[app].filter(productionDomain).map((item) => item.name.toLowerCase()))])
  if (!endpointVar.missing) { try { if (productionHosts.has(new URL(endpointVar.value).host.toLowerCase())) problem('Production endpoint leakage', 'Staging endpoint targets a Production host') } catch { problem('Custom endpoint', 'endpoint is not a URL') } }
  for (const app of APPS) {
    if (productionHosts.has(config.domains[app].toLowerCase())) problem('Production endpoint leakage', `${config.domains[app]} is a Production domain`)
    const environment = await variable(app, 'GERARD_INSTANCE_ENVIRONMENT')
    if (environment.missing || environment.value !== 'staging' || !environment.stagingOnly) problem('Production endpoint leakage', `${projects[app].name}: GERARD_INSTANCE_ENVIRONMENT=staging not set for staging only`)
    const leaked = envs[app].filter((item) => /_STAGING_|^GERARD_STAGING_/.test(item.key) && (targetsOf(item).includes('production') || targetsOf(item).includes('preview'))).map((item) => item.key)
    if (leaked.length) problem('Production endpoint leakage', `${projects[app].name}: Staging variables in Production/Preview: ${leaked.join(', ')}`)
  }
  const hostnames = await variable('gerard', 'GERARD_PLATFORM_HOSTNAMES')
  if (hostnames.missing || hostnames.value !== config.domains.gerard) problem('Custom endpoint', 'Gerard staging GERARD_PLATFORM_HOSTNAMES is not its Staging domain')

  // ── Channel: same Staging secret on both sides, then the existing signed reads against Novotralux Staging ──
  const secrets = { gerard: await variable('gerard', 'GERARD_PLATFORM_INSTANCE_SHARED_SECRET'), novotralux: await variable('novotralux', 'GERARD_PLATFORM_INSTANCE_SHARED_SECRET') }
  let admins: { username?: string; isActive?: boolean }[] | undefined
  if (secrets.gerard.missing || secrets.novotralux.missing) problem('Channel', 'shared secret missing in a staging environment')
  else if (!secrets.gerard.stagingOnly || !secrets.novotralux.stagingOnly) problem('Channel', 'shared secret is shared with another environment')
  else if (secrets.gerard.value !== secrets.novotralux.value || secrets.gerard.value.length < 32) problem('Channel', 'Gerard and Novotralux Staging secrets differ or are too short')
  else {
    process.env.GERARD_PLATFORM_INSTANCE_SHARED_SECRET = secrets.gerard.value
    const call = async (action: 'getConfiguration' | 'getOrgAdmins') => {
      const signed = createPlatformConfigurationRequest({ application: 'novotralux', organizationId: 'org-novotralux', action, payload: {} })
      const bypass = automationBypass(projects.novotralux as VercelProject)
      const response = await fetch(stagingEndpoint(), { method: 'POST', headers: { 'content-type': 'application/json', 'x-gerard-platform-signature': signed.signature, ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}) }, body: JSON.stringify({ request: signed.request }), signal: AbortSignal.timeout(20000) })
      return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> }
    }
    try {
      const configuration = await call('getConfiguration')
      if (configuration.status !== 200 || configuration.body.organizationId !== 'org-novotralux') problem('Channel', `Novotralux Staging answered ${configuration.status}${configuration.body.error ? ` ${configuration.body.error}` : ''}`)
      const listed = await call('getOrgAdmins')
      if (listed.status === 200) admins = listed.body.admins as typeof admins
    } catch { problem('Channel', 'Novotralux Staging unreachable') }
    delete process.env.GERARD_PLATFORM_INSTANCE_SHARED_SECRET
  }
  if (!trustsStaging(projects.novotralux.trustedSources?.projects?.[projects.gerard.id])) problem('Channel', `${projects.novotralux.name} Trusted Sources does not admit ${projects.gerard.name} staging → staging (run npm run staging:setup)`)
  try {
    const bypass = automationBypass(projects.gerard)
    const response = await fetch(`https://${config.domains.gerard}/login`, { headers: bypass ? { 'x-vercel-protection-bypass': bypass } : {}, redirect: 'manual', signal: AbortSignal.timeout(20000) })
    if (response.status >= 400) problem('Channel', `Gerard Staging answered ${response.status} on /login`)
  } catch { problem('Channel', 'Gerard Staging unreachable') }

  // ── QA accounts and integrations (read-only database reads) ──
  for (const app of APPS) {
    const database = databases[app]
    if (!database) { problem('QA accounts', `${LABEL[app]} database unavailable`); problem('Integration safety', `${LABEL[app]} database unavailable`); continue }
    try {
      await readOnlyQuery(database.direct, async (client) => {
        const user = (await client.query(`select u."isActive", u."platformRole"::text as "platformRole", (select m.role::text from public."OrganizationUser" m where m."userId" = u.id and m."organizationId" = $2) as "organizationRole" from public."User" u where u.username = $1`, [QA_ACCOUNTS[app], app === 'gerard' ? 'org-gerard-default' : 'org-novotralux'])).rows[0]
        if (!user) problem('QA accounts', `${QA_ACCOUNTS[app]} missing`)
        else if (!user.isActive) problem('QA accounts', `${QA_ACCOUNTS[app]} inactive`)
        else if (app === 'gerard' && (user.platformRole !== 'SUPER_ADMIN' || !user.organizationRole)) problem('QA accounts', `${QA_ACCOUNTS[app]} is not a SUPER_ADMIN with a Standard membership`)
        else if (app === 'novotralux' && user.organizationRole !== 'ORG_ADMIN') problem('QA accounts', `${QA_ACCOUNTS[app]} is not ORG_ADMIN of org-novotralux`)
        const enabled = Number((await client.query(`select count(*)::int as n from public."OrganizationIntegration" where enabled`)).rows[0].n)
        if (enabled) problem('Integration safety', `${LABEL[app]}: ${enabled} integration(s) enabled`)
      })
    } catch { problem('QA accounts', `${LABEL[app]} database unreadable`) }
    const forbidden = envs[app].filter((item) => appliesTo(item, staging[app]) && FORBIDDEN_STAGING_VARIABLES.test(item.key)).map((item) => item.key)
    if (forbidden.length) problem('Integration safety', `${projects[app].name} staging holds ${forbidden.join(', ')}`)
    const routes = await variable(app, 'GOOGLE_ROUTES_MAX_CALLS_PER_OPERATION')
    if (routes.missing || routes.value !== '0') problem('Integration safety', `${projects[app].name}: Google Routes not capped to 0`)
  }
  if (admins && !admins.some((admin) => admin.username === QA_ACCOUNTS.novotralux)) problem('QA accounts', `${QA_ACCOUNTS.novotralux} not listed by Novotralux Staging`)
  return report()
})
