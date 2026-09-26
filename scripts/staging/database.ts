import { randomBytes } from 'node:crypto'
import path from 'node:path'
import pg from 'pg'

import { QA_ACCOUNTS, databaseEndpoint, fail, isProductionOrPreviewEndpoint, run, type App, type NeonBranch } from './lib'

// Sanitization and verification of the Neon Staging child branches. A child branch starts as a copy of its Production
// parent; before any Staging project receives its URL, every row is removed except an explicit allow-list, the result is
// marked, and a fail-closed verification runs. Only the Staging branch is ever connected to; the parent is never touched.

// Kept with their rows: Prisma's migration history (schema bookkeeping) and the Organization rows listed below.
export const KEPT_TABLES = ['_prisma_migrations', 'Organization'] as const
// The only Organization row each Staging database keeps (branding/scaffolding; Organization holds no credential).
export const STAGING_ORGANIZATION: Record<App, string> = { gerard: 'org-gerard-default', novotralux: 'org-novotralux' }
// Tables the Staging bootstrap itself fills (QA account, its membership, the Staging platform host).
export const SEEDED_TABLES = ['User', 'OrganizationUser', 'OrganizationDomain'] as const
const MARKER = 'gerard-staging-sanitized'

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`

async function withClient<T>(url: string, work: (client: pg.Client) => Promise<T>) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 20000 })
  await client.connect()
  try { return await work(client) } finally { await client.end().catch(() => undefined) }
}
const publicTables = async (client: pg.Client) => (await client.query(`select tablename from pg_tables where schemaname = 'public' order by tablename`)).rows.map((row) => row.tablename as string)
// User tables outside `public` (anything not created by PostgreSQL or Neon): they cannot be judged, so any row fails closed.
async function foreignRows(client: pg.Client) {
  const tables = (await client.query(`select schemaname, tablename from pg_tables where schemaname not in ('public', 'information_schema') and schemaname not like 'pg\\_%' and schemaname not like 'neon%'`)).rows
  const found: string[] = []
  for (const table of tables) if (Number((await client.query(`select count(*)::int as n from ${quote(table.schemaname)}.${quote(table.tablename)}`)).rows[0].n)) found.push(`${table.schemaname}.${table.tablename}`)
  return found
}

// ─── Credential: the child branch inherits the owner role AND its Production password ───────────────────────────
// `inherited`: the inherited (Production) password still opens the child → it must be rotated before anything else.
// `rotated`: it no longer does → the Staging credential stored in the Staging Vercel project is the valid one.
export async function credentialState(inheritedUrl: string) {
  const client = new pg.Client({ connectionString: inheritedUrl, connectionTimeoutMillis: 20000 })
  try { await client.connect(); return 'inherited' as const } catch (error) {
    if ((error as { code?: string }).code === '28P01') return 'rotated' as const
    throw error
  } finally { await client.end().catch(() => undefined) }
}

// Rotates the owner password on the CHILD branch only (the connection is asserted to be the Staging endpoint, never a
// Production one), then proves the new credential works and the inherited one no longer opens the child.
export async function rotateOwnerPassword(inheritedUrl: string, owner: string, expectedEndpoint: string) {
  if (databaseEndpoint(inheritedUrl) !== expectedEndpoint || isProductionOrPreviewEndpoint(expectedEndpoint)) fail('credential rotation refused: not the Staging endpoint')
  const password = randomBytes(32).toString('base64url')
  await withClient(inheritedUrl, async (client) => {
    const current = (await client.query('select current_user as role')).rows[0].role as string
    if (current !== owner) fail(`credential rotation refused: connected as ${current}, expected ${owner}`)
    await client.query(`alter role ${quote(owner)} password ${client.escapeLiteral(password)}`)
  })
  const url = new URL(inheritedUrl)
  url.password = password
  const stagingUrl = url.toString()
  if (databaseEndpoint(stagingUrl) !== expectedEndpoint) fail('credential rotation refused: endpoint changed')
  await withClient(stagingUrl, (client) => client.query('select 1'))
  if (await credentialState(inheritedUrl) !== 'rotated') fail('credential rotation failed: the inherited password still opens the Staging branch')
  return stagingUrl
}

export type Marker = { branch: string; parent: string; app: App; at: string }
export const readMarker = (url: string) => withClient(url, async (client) => {
  const comment = (await client.query(`select obj_description('public'::regnamespace, 'pg_namespace') as comment`)).rows[0].comment as string | null
  if (!comment?.startsWith(`${MARKER}:`)) return null
  try { return JSON.parse(comment.slice(MARKER.length + 1)) as Marker } catch { return null }
})

// Removes every inherited row except the allow-list, in one transaction, then marks the schema. Tables are emptied with a
// single TRUNCATE (no CASCADE): a foreign key from a kept table to an emptied one makes it fail instead of widening.
export async function sanitize(url: string, app: App, branch: NeonBranch) {
  return withClient(url, async (client) => {
    const foreign = await foreignRows(client)
    if (foreign.length) fail(`${branch.name}: rows outside the public schema (${foreign.join(', ')}): cannot sanitize safely, refused.`)
    const emptied = (await publicTables(client)).filter((table) => !(KEPT_TABLES as readonly string[]).includes(table))
    await client.query('begin')
    try {
      if (emptied.length) await client.query(`truncate table ${emptied.map((table) => `public.${quote(table)}`).join(', ')} restart identity`)
      const organizations = (await client.query('delete from public."Organization" where id <> $1', [STAGING_ORGANIZATION[app]])).rowCount ?? 0
      const marker: Marker = { branch: branch.id, parent: branch.parent_id ?? '', app, at: new Date().toISOString() }
      await client.query(`comment on schema public is ${client.escapeLiteral(`${MARKER}:${JSON.stringify(marker)}`)}`)
      await client.query('commit')
      return { emptied: emptied.length, organizations }
    } catch (error) {
      await client.query('rollback').catch(() => undefined)
      throw error
    }
  })
}

export type DatabaseState = { marker: Marker | null; counts: Record<string, number>; users: string[]; organizations: string[]; domains: string[]; integrations: { enabled: number; withSecret: number }; foreign: string[]; qaActive: boolean }
export const inspectDatabase = (url: string, app: App) => withClient(url, async (client) => {
  const counts: Record<string, number> = {}
  for (const table of await publicTables(client)) counts[table] = Number((await client.query(`select count(*)::int as n from public.${quote(table)}`)).rows[0].n)
  const column = (sql: string) => client.query(sql).then((result) => result.rows.map((row) => String(Object.values(row)[0])))
  const integrations = counts.OrganizationIntegration === undefined ? { enabled: 0, withSecret: 0 } : (await client.query(`select count(*) filter (where enabled)::int as enabled, count(*) filter (where "secretRef" is not null)::int as "withSecret" from public."OrganizationIntegration"`)).rows[0]
  const comment = (await client.query(`select obj_description('public'::regnamespace, 'pg_namespace') as comment`)).rows[0].comment as string | null
  return {
    marker: comment?.startsWith(`${MARKER}:`) ? JSON.parse(comment.slice(MARKER.length + 1)) : null,
    counts,
    users: counts.User === undefined ? [] : await column('select username from public."User" order by username'),
    organizations: counts.Organization === undefined ? [] : await column('select id from public."Organization" order by id'),
    domains: counts.OrganizationDomain === undefined ? [] : await column('select hostname from public."OrganizationDomain" order by hostname'),
    integrations,
    foreign: await foreignRows(client),
    qaActive: counts.User !== undefined && Boolean((await client.query('select 1 from public."User" where username = $1 and "isActive"', [QA_ACCOUNTS[app]])).rowCount),
  } as DatabaseState
})

// Fail-closed verification before the URL is exported to Vercel. `fresh` = sanitized by this run: then nothing but the
// allow-list and the Staging bootstrap rows may exist. An already-marked branch may hold Staging test data, but never an
// enabled integration or an integration secret.
export function verifyDatabase(state: DatabaseState, app: App, branch: NeonBranch, options: { fresh: boolean; hosts: string[] }) {
  const problems: string[] = []
  if (!state.marker || state.marker.branch !== branch.id || state.marker.app !== app) problems.push('sanitization marker missing or from another branch')
  if (state.integrations.enabled) problems.push(`${state.integrations.enabled} enabled integration(s)`)
  if (state.integrations.withSecret) problems.push(`${state.integrations.withSecret} integration secret reference(s)`)
  if (state.foreign.length) problems.push(`rows outside the public schema: ${state.foreign.join(', ')}`)
  if (!state.qaActive) problems.push(`${QA_ACCOUNTS[app]} missing or inactive`)
  if (options.fresh) {
    const allowed = new Set<string>([...KEPT_TABLES, ...SEEDED_TABLES])
    const leftovers = Object.entries(state.counts).filter(([table, count]) => count && !allowed.has(table)).map(([table, count]) => `${table}=${count}`)
    if (leftovers.length) problems.push(`inherited rows remain: ${leftovers.join(', ')}`)
    if (state.users.some((user) => user !== QA_ACCOUNTS[app])) problems.push('accounts other than the Staging QA account')
    if (state.organizations.some((id) => id !== STAGING_ORGANIZATION[app])) problems.push('organizations other than the Staging organization')
    if (state.domains.some((host) => !options.hosts.includes(host))) problems.push('organization domains other than the Staging host')
  }
  return problems
}

// Sanitize (once) → migrations + QA accounts (same step as every Staging build) → fail-closed verification. Runs either
// locally right after the rotation, or inside `vercel env run` with the Staging project's stored credential.
export async function bootstrapDatabase(input: { url: string; app: App; branch: NeonBranch; hosts: string[]; initialPassword?: string }) {
  const { url, app, branch } = input
  const fresh = !(await readMarker(url))
  const sanitized = fresh ? await sanitize(url, app, branch) : undefined
  const prepare = await run('node', [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'scripts/staging-prepare.ts'], { quiet: true, env: {
    VERCEL: '', VERCEL_ENV: '', VERCEL_TARGET_ENV: '', GERARD_INSTANCE_ENVIRONMENT: 'staging', DATABASE_URL: url,
    GERARD_APPLICATION_ID: app === 'novotralux' ? 'novotralux' : '', GERARD_INSTANCE_ORGANIZATION_ID: app === 'novotralux' ? 'org-novotralux' : '',
    GERARD_PLATFORM_HOSTNAMES: app === 'gerard' ? input.hosts[0] : '', GERARD_STAGING_SUPERADMIN_INITIAL_PASSWORD: app === 'gerard' ? input.initialPassword ?? '' : '',
  } })
  if (prepare.code !== 0) return { fresh, sanitized, prepared: false, superadminCreated: false, problems: ['migrations/QA accounts failed'], log: prepare.output }
  const problems = verifyDatabase(await inspectDatabase(url, app), app, branch, { fresh, hosts: input.hosts })
  return { fresh, sanitized, prepared: true, superadminCreated: /gerard\.staging\.superadmin created/.test(prepare.output), problems, log: prepare.output }
}
