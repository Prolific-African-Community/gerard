import pg from 'pg'

import { isProductionDatabase } from '../../apps/novotralux/scripts/database-target.mjs'
import { createPlatformConfigurationRequest } from '../../lib/platform/configuration-channel'
import { DATABASE_VARIABLES, PRODUCTION_HOSTS, QA_ACCOUNTS, databaseEndpoint, fingerprint, type App, type ProbeFacts } from './lib'

// Runs inside `vercel env run -e production --project <staging project>` (scripts/staging/lib.ts → probe): the Staging
// project's variables exist only in this process. It prints one line of facts for the operator command — variable
// names, booleans, fingerprints, database endpoint ids, HTTP statuses — and never a secret value or a database URL.

const [mode, app] = process.argv.slice(2) as ['facts' | 'credential' | 'full', App]
const baseline = new Set([...(process.env.GERARD_PROBE_BASELINE || '').split(','), 'GERARD_PROBE_BASELINE'])
const projectKeys = Object.keys(process.env).filter((key) => !baseline.has(key) && !/^VERCEL(_|$)/.test(key)).sort()
const value = (key: string) => process.env[key] || null
const SECRETS = ['JWT_SECRET', 'GERARD_PLATFORM_INSTANCE_SHARED_SECRET', 'GERARD_STAGING_SUPERADMIN_INITIAL_PASSWORD']
const CONFIG = ['GERARD_INSTANCE_ENVIRONMENT', 'GERARD_PLATFORM_HOSTNAMES', 'GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_CONFIGURATION_ENDPOINT', 'GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_DOMAIN', 'GOOGLE_ROUTES_MAX_CALLS_PER_OPERATION', 'GERARD_APPLICATION_ID', 'GERARD_INSTANCE_ORGANIZATION_ID', 'NEXT_PUBLIC_GERARD_APPLICATION']

async function database(): Promise<ProbeFacts['database']> {
  const variables = Object.fromEntries(DATABASE_VARIABLES[app].map((key) => { try { return [key, value(key) ? databaseEndpoint(value(key)!) : null] } catch { return [key, 'invalid'] } }))
  const url = value('DATABASE_URL')
  const facts: NonNullable<ProbeFacts['database']> = { variables, productionEndpoint: Boolean(url && isProductionDatabase(url)), reachable: false }
  if (mode === 'facts' || !url || facts.productionEndpoint) return facts
  const client = new pg.Client({ connectionString: url, options: '-c default_transaction_read_only=on', connectionTimeoutMillis: 15000 })
  try {
    await client.connect()
    facts.reachable = true
    facts.migrations = (await client.query(`select count(*) filter (where finished_at is not null and rolled_back_at is null)::int as applied, count(*) filter (where finished_at is null and rolled_back_at is null)::int as failed from public._prisma_migrations`)).rows[0]
    const organizationId = app === 'gerard' ? 'org-gerard-default' : 'org-novotralux'
    const user = (await client.query(`select u."isActive" as active, u."platformRole"::text as "platformRole", (select m.role::text from public."OrganizationUser" m where m."userId" = u.id and m."organizationId" = $2) as "organizationRole" from public."User" u where u.username = $1`, [QA_ACCOUNTS[app], organizationId])).rows[0]
    facts.account = { exists: Boolean(user), active: Boolean(user?.active), platformRole: user?.platformRole ?? null, organizationRole: user?.organizationRole ?? null }
    facts.integrationsEnabled = Number((await client.query(`select count(*)::int as n from public."OrganizationIntegration" where enabled`)).rows[0].n)
  } catch {
    // reported as unreachable / incomplete
  } finally {
    await client.end().catch(() => undefined)
  }
  return facts
}

// Gerard Staging → Novotralux Staging through the existing signed reads, with this project's own endpoint and secret.
async function channel(): Promise<ProbeFacts['channel']> {
  const endpoint = value('GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_CONFIGURATION_ENDPOINT')
  if (app !== 'gerard' || mode !== 'full' || !endpoint || !value('GERARD_PLATFORM_INSTANCE_SHARED_SECRET')) return undefined
  const result: NonNullable<ProbeFacts['channel']> = {}
  for (const action of ['getConfiguration', 'getOrgAdmins'] as const) {
    try {
      const signed = createPlatformConfigurationRequest({ application: 'novotralux', organizationId: 'org-novotralux', action, payload: {} })
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-gerard-platform-signature': signed.signature }, body: JSON.stringify({ request: signed.request }), signal: AbortSignal.timeout(20000) })
      const body = await response.json().catch(() => ({})) as Record<string, any>
      result[action] = { status: response.status, organizationId: body.organizationId ?? null, usernames: Array.isArray(body.admins) ? body.admins.map((admin: { username?: string }) => String(admin.username)) : undefined }
    } catch {
      result[action] = { status: 0 }
    }
  }
  return result
}

async function main() {
  const facts: ProbeFacts = {
    keys: projectKeys,
    environment: value('GERARD_INSTANCE_ENVIRONMENT'),
    routesCap: value('GOOGLE_ROUTES_MAX_CALLS_PER_OPERATION'),
    secrets: Object.fromEntries([...SECRETS, ...DATABASE_VARIABLES[app]].map((key) => [key, { present: Boolean(value(key)), fingerprint: value(key) ? fingerprint(value(key)!) : null }])),
    values: Object.fromEntries(CONFIG.map((key) => [key, value(key)])),
    productionHostKeys: projectKeys.filter((key) => PRODUCTION_HOSTS.some((host) => (process.env[key] || '').toLowerCase().includes(host))),
    database: await database(),
    channel: await channel(),
  }
  console.log(`GERARD_PROBE ${JSON.stringify(facts)}`)
}

main().catch(() => { console.log('GERARD_PROBE_FAILED'); process.exitCode = 1 })
