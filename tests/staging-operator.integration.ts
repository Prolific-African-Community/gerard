import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import pg from 'pg'

import { meaningfulChanges } from '../scripts/staging/deploy'
import { CONFIRMING_COMMANDS, nonInteractive, run as runChild, runCli } from '../scripts/staging/lib'

// Staging operator commands (npm run staging:setup / staging:deploy / staging:check) against fake `vercel` and `neonctl`
// CLIs and a disposable local PostgreSQL standing in for the Neon Staging branches. The fakes pin the tooling's contract
// (scope, canonical project names, stdin values, worktree deploys, read-only check); they do not prove real Vercel or
// Neon behaviour. Requires STAGING_OPERATOR_TEST_ADMIN_URL (superuser URL of a disposable local server).

const adminUrl = process.env.STAGING_OPERATOR_TEST_ADMIN_URL
if (!adminUrl) { console.error('STAGING_OPERATOR_TEST_ADMIN_URL is required (disposable local PostgreSQL)'); process.exit(1) }
const local = new URL(adminUrl)
const databaseUrl = (host: string, name: string) => `postgresql://${local.username}${local.password ? `:${local.password}` : ''}@${host}:${local.port || 5432}/${name}`
// Distinct hosts give the two Staging databases distinct endpoint identities, as two Neon branches have.
const urls = { 'gerard-staging': databaseUrl('localhost', 'op_gerard_staging'), 'novotralux-custom-staging': databaseUrl('127.0.0.1', 'op_novotralux_staging') }
const SCOPE = 'jonathans-projects-e6d49b10'
const run = promisify(execFile)
const home = mkdtempSync(path.join(tmpdir(), 'gerard-staging-'))
const stateFile = path.join(home, 'state.json')
const fixtures = path.join(process.cwd(), 'tests/fixtures/staging')
const sentinel = path.join(process.cwd(), '.env')
// The fake Vercel CLI runs from a directory whose path contains spaces, given as a JSON argv override.
const spacedDirectory = path.join(home, 'cli dir with spaces')
mkdirSync(spacedDirectory)
copyFileSync(path.join(fixtures, 'fake-vercel.mjs'), path.join(spacedDirectory, 'fake-vercel.mjs'))
const VERCEL_OVERRIDE = JSON.stringify(['node', path.join(spacedDirectory, 'fake-vercel.mjs')])
const NEON_OVERRIDE = JSON.stringify(['node', path.join(fixtures, 'fake-neonctl.mjs')])

type Result = { code: number; output: string }
async function command(script: string, args: string[] = [], extra: Record<string, string> = {}): Promise<Result> {
  try {
    const { stdout, stderr } = await run('npx', ['tsx', `scripts/staging/${script}.ts`, ...args], { env: { PATH: process.env.PATH!, HOME: home, GERARD_STAGING_VERCEL_CLI: VERCEL_OVERRIDE, GERARD_STAGING_NEONCTL: NEON_OVERRIDE, FAKE_STAGING_STATE: stateFile, FAKE_PG_MODULE: path.join(process.cwd(), 'node_modules', 'pg', 'lib', 'index.js'), ...extra } as unknown as NodeJS.ProcessEnv, maxBuffer: 32 * 1024 * 1024, timeout: 600000 })
    return { code: 0, output: stdout + stderr }
  } catch (error: any) {
    return { code: error.code ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

const productionProjects = () => [
  { id: 'prj_gerard', name: 'gerard', accountId: 'team_jonathan', settings: { framework: 'nextjs', buildCommand: 'npm run build', installCommand: null, outputDirectory: null, rootDirectory: null, nodeVersion: '22.x' }, env: { DATABASE_URL: 'postgresql://u:p@ep-ancient-block-za26cw6e.eu.aws.neon.tech/neondb', JWT_SECRET: 'production-jwt' }, domains: ['gerard-dispatch.vercel.app'] },
  { id: 'prj_novotralux_custom', name: 'novotralux-custom', accountId: 'team_jonathan', settings: { framework: 'nextjs', buildCommand: 'npm run novotralux:build', installCommand: null, outputDirectory: '.next-novotralux', rootDirectory: null, nodeVersion: '22.x' }, env: { NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL: 'postgresql://u:p@ep-ancient-surf-zav7xo37.eu.aws.neon.tech/neondb' }, domains: ['novotralux-custom.vercel.app', 'www.novotralux.eu'] },
  { id: 'prj_legacy', name: 'novotralux', accountId: 'team_jonathan', settings: { framework: 'nextjs', buildCommand: null, installCommand: null, outputDirectory: null, rootDirectory: null, nodeVersion: '20.x' }, env: {}, domains: ['novotralux-legacy.vercel.app'] },
]
const PARENTS = { gerard: 'br-patient-wildflower-zarmyqcq', novotralux: 'br-cool-sea-zaufb5ng' }
const PRODUCTION_DATABASES = { [PARENTS.gerard]: 'op_prod_gerard', [PARENTS.novotralux]: 'op_prod_novotralux' }
// A child branch inherits its parent's owner role with the Production password; setup must rotate it on the child only.
const PRODUCTION_PASSWORD = 'production-password'
const OWNERS = { [PARENTS.gerard]: 'owner_prod_gerard', [PARENTS.novotralux]: 'owner_prod_novotralux' }
const withPassword = (url: string, user: string, password: string) => { const value = new URL(url); value.username = user; value.password = password; return value.toString() }
async function opens(url: string) { const client = new pg.Client({ connectionString: url }); try { await client.connect(); return true } catch { return false } finally { await client.end().catch(() => undefined) } }
const writeState = (extra: Record<string, unknown> = {}) => writeFileSync(stateFile, JSON.stringify({
  parentDatabases: PRODUCTION_DATABASES, owners: { ...OWNERS }, productionPassword: PRODUCTION_PASSWORD,
  // Distinct hosts give each fake branch its own endpoint identity, as on Neon.
  parentUrls: { production: databaseUrl(hostname(), 'op_prod_gerard'), 'novotralux-custom-production': databaseUrl('0.0.0.0', 'op_prod_novotralux') },
  scope: SCOPE, teamId: 'team_jonathan', projects: productionProjects(), vercelCalls: [], deploys: [],
  neonProject: 'lucky-wildflower-15424624', adminUrl, urls, neonCalls: [],
  branches: [{ id: 'br-patient-wildflower-zarmyqcq', name: 'production', default: true }, { id: 'br-cool-sea-zaufb5ng', name: 'novotralux-custom-production' }, { id: 'br-still-field-za5dh59a', name: 'novotralux-custom-preview' }],
  ...extra,
}))
const readState = () => JSON.parse(readFileSync(stateFile, 'utf8'))
const project = (name: string) => readState().projects.find((item: any) => item.name === name)

// Production (gerard, novotralux-custom) and legacy (novotralux) projects: never written, deployed, or env-run.
const PROTECTED = new Set(['gerard', 'novotralux-custom', 'novotralux', 'prj_gerard', 'prj_novotralux_custom', 'prj_legacy', 'gerard-dispatch'])
function assertProductionUntouched(label: string) {
  const state = readState()
  for (const call of state.vercelCalls as { args: string[]; scope: string | null; projectEnv: string | null }[]) {
    if (!['whoami', 'login'].includes(call.args[0])) assert.equal(call.scope, SCOPE, `${label}: every Vercel call names the scope (${call.args.join(' ')})`)
    const [group, sub, name] = call.args
    const target = group === 'project' && ['add', 'update'].includes(sub) ? name : group === 'env' ? call.args[call.args.indexOf('--project') + 1] : group === 'deploy' ? call.projectEnv : undefined
    if (target) assert.ok(!PROTECTED.has(target), `${label}: ${call.args.join(' ')} must not address ${target}`)
    if (group === 'api') assert.ok(!/\/v9\/projects\/(gerard|novotralux-custom|novotralux|gerard-dispatch)(\/|\?|$)/.test(sub), `${label}: api reads Staging projects only`)
  }
  assert.deepEqual(state.projects.slice(0, 3), productionProjects(), `${label}: Production and legacy projects unchanged`)
}

// "Production" parents: migrated databases holding business rows a child branch inherits.
async function createProductionParents() {
  for (const [app, database] of [['gerard', 'op_prod_gerard'], ['novotralux', 'op_prod_novotralux']] as const) {
    const admin = new pg.Client({ connectionString: adminUrl }); await admin.connect()
    const owner = OWNERS[app === 'gerard' ? PARENTS.gerard : PARENTS.novotralux]
    await admin.query(`drop database if exists "${database}" with (force)`); await admin.query(`create database "${database}"`)
    if ((await admin.query('select 1 from pg_roles where rolname = $1', [owner])).rowCount) await admin.query(`alter role "${owner}" password '${PRODUCTION_PASSWORD}'`)
    else await admin.query(`create role "${owner}" login password '${PRODUCTION_PASSWORD}'`)
    await admin.end()
    const url = databaseUrl('localhost', database)
    const grant = new pg.Client({ connectionString: url }); await grant.connect(); await grant.query(`grant usage, create on schema public to "${owner}"`); await grant.end()
    await run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: withPassword(url, owner, PRODUCTION_PASSWORD) } })
    const client = new pg.Client({ connectionString: url }); await client.connect()
    const org = app === 'gerard' ? 'org-gerard-default' : 'org-novotralux'
    await client.query(`insert into "Organization" (id, name, slug, "updatedAt") values ($1, $1, $1, now()) on conflict (id) do nothing`, [org])
    await client.query(`insert into "Organization" (id, name, slug, "updatedAt") values ('org-client-acme', 'ACME Transport', 'acme', now())`)
    await client.query(`insert into "User" (id, name, username, "passwordHash", "updatedAt") values ('u-real', 'Real Dispatcher', 'real.dispatcher', 'production-hash', now())`)
    await client.query(`insert into "OrganizationUser" (id, "organizationId", "userId", role, "updatedAt") values ('ou-real', $1, 'u-real', 'ORG_ADMIN', now())`, [org])
    await client.query(`insert into "OrganizationIntegration" (id, "organizationId", type, enabled, "secretRef", "updatedAt") values ('oi-real', $1, 'MAIL_INTAKE', true, 'PRODUCTION_MAIL_SECRET', now())`, [org])
    await client.query(`insert into "OrganizationDomain" (id, "organizationId", hostname, "updatedAt") values ('od-real', $1, 'www.novotralux.eu', now())`, [org])
    await client.end()
  }
}
async function productionSnapshot() {
  const snapshot: Record<string, unknown> = {}
  for (const database of Object.values(PRODUCTION_DATABASES)) {
    const client = new pg.Client({ connectionString: databaseUrl('localhost', database) }); await client.connect()
    snapshot[database] = (await client.query(`select (select count(*) from "User")::int as users, (select count(*) from "Organization")::int as organizations, (select count(*) from "OrganizationIntegration" where enabled)::int as integrations, (select string_agg(username, ',' order by username) from "User") as usernames, obj_description('public'::regnamespace, 'pg_namespace') as marker`)).rows[0]
    await client.end()
  }
  return snapshot
}

async function main() {
  await createProductionParents()
  const parentsBefore = await productionSnapshot()
  // ─── Dirty-tree rule: generated files never block a deploy, source changes do ────────────────────────
  assert.deepEqual(meaningfulChanges(' M next-env.d.ts\n M tsconfig.tsbuildinfo\n'), [], 'generated files ignored')
  assert.deepEqual(meaningfulChanges(' M next-env.d.ts\n M lib/prisma.ts\n?? scripts/new.ts\n'), ['lib/prisma.ts', 'scripts/new.ts'], 'source changes refused')

  // ─── Process runner: no shell, every argument is exactly one argv item (the Windows failure: values re-split) ───
  const tricky = ['npm run build', 'npm run novotralux:build', 'C:\\Users\\Jon Doe\\My Projects\\gerard', '/tmp/path with spaces/x', 'https://novotralux-custom-staging.vercel.app/api/internal/platform/configuration?a=1&b=2', '', '"quoted"', "it's", 'a;b|c&d>e', '%PATH%', '$HOME']
  const echoed = await runChild('node', [path.join(fixtures, 'echo-argv.mjs'), ...tricky], { quiet: true })
  assert.deepEqual(JSON.parse(echoed.stdout), tricky, 'runner passes each value as one argv item')
  const echoDirectory = path.join(home, 'echo dir with spaces')
  mkdirSync(echoDirectory)
  copyFileSync(path.join(fixtures, 'echo-argv.mjs'), path.join(echoDirectory, 'echo-argv.mjs'))
  const viaCli = await runCli({ command: 'node', prefix: [path.join(echoDirectory, 'echo-argv.mjs')] }, ['project', 'update', 'gerard-staging', '--build-command', 'npm run build', '--output-directory', ''], { quiet: true })
  assert.deepEqual(JSON.parse(viaCli.stdout), ['project', 'update', 'gerard-staging', '--build-command', 'npm run build', '--output-directory', ''], 'CLI path with spaces, values intact')
  const stdinEcho = await runChild('node', ['-e', 'let v="";process.stdin.on("data",(c)=>v+=c).on("end",()=>process.stdout.write(JSON.stringify(v)))'], { quiet: true, input: 'value with spaces & symbols' })
  assert.equal(JSON.parse(stdinEcho.stdout), 'value with spaces & symbols', 'stdin preserved')
  for (const file of [...readdirSync('scripts/staging').map((name) => `scripts/staging/${name}`), 'scripts/staging-prepare.ts']) {
    assert.ok(!/shell:\s*(true|windows|process\.platform)/.test(readFileSync(file, 'utf8')), `${file}: no shell for argv execution`)
    const source = readFileSync(file, 'utf8')
    assert.ok(!/\bgrant\b|neondb_owner\s+to|createRole|roles', 'create/i.test(source), `${file}: no GRANT / role-membership logic`)
    assert.ok(!/alter\s+role[^;\n]*password/i.test(source), `${file}: no ALTER ROLE … PASSWORD`)
  }

  assert.match(readFileSync('scripts/staging/lib.ts', 'utf8'), /\/branches\/\$\{branch\.id\}\/roles\/\$\{encodeURIComponent\(role\)\}\/reset_password`, '-X', 'POST'/, 'official Neon branch-scoped reset is the credential mechanism')

  // Non-interactive: every confirming Vercel command carries --yes (the fake CLI fails like Vercel CLI 60 otherwise).
  assert.deepEqual(CONFIRMING_COMMANDS, ['project update', 'project inspect', 'env add', 'deploy'])
  assert.deepEqual(nonInteractive(['project', 'update', 'gerard-staging', '--framework', 'nextjs']), ['project', 'update', 'gerard-staging', '--framework', 'nextjs', '--yes'])
  assert.deepEqual(nonInteractive(['project', 'add', 'gerard-staging']), ['project', 'add', 'gerard-staging'], 'no --yes where the command has no such option')

  // A local .env with Production-like values must never reach a Staging deployment (deploys build from a worktree).
  const hadEnv = existsSync(sentinel)
  if (!hadEnv) writeFileSync(sentinel, 'GERARD_TEST_SENTINEL=1\n')

  // ─── Refusals before any write ────────────────────────────────────────────────────────────────────────
  for (const [label, extra, expected] of [
    ['Vercel not authenticated', { vercelUnauthenticated: true }, /Vercel CLI is not authenticated: run .*vercel.* login/],
    ['Neon not authenticated', { neonUnauthenticated: true }, /Neon CLI is not authenticated: run .*neonctl.* auth/],
    ['staging branch name on a Production branch', { branches: [{ id: 'br-cool-sea-zaufb5ng', name: 'novotralux-custom-staging' }, { id: 'br-patient-wildflower-zarmyqcq', name: 'production', default: true }] }, /Production\/Preview branch: refused/],
    ['existing Staging branch with the wrong parent', { branches: [{ id: 'br-patient-wildflower-zarmyqcq', name: 'production', default: true }, { id: 'br-cool-sea-zaufb5ng', name: 'novotralux-custom-production' }, { id: 'br-gerard-staging-old', name: 'gerard-staging', parent_id: 'br-cool-sea-zaufb5ng' }] }, /gerard-staging is not a child of br-patient-wildflower-zarmyqcq.*refused/],
  ] as const) {
    writeState(extra as Record<string, unknown>)
    const result = await command('setup', ['--no-deploy'])
    assert.notEqual(result.code, 0, `${label}: must fail`)
    assert.match(result.output, expected, label)
    assert.ok(!readState().vercelCalls.some((call: any) => call.args[0] === 'env' && call.args[1] === 'add'), `${label}: no variable written`)
    assertProductionUntouched(label)
  }

  // ─── Partial earlier run: both Staging projects exist (bare settings, no variables) → reused, never recreated ──
  writeState()
  const partial = readState()
  partial.projects = [...productionProjects(), ...['gerard-staging', 'novotralux-custom-staging'].map((name) => ({ id: `prj_${name.replace(/-/g, '_')}`, name, accountId: 'team_jonathan', settings: { framework: null, buildCommand: null, installCommand: null, outputDirectory: null, rootDirectory: null, nodeVersion: '22.x' }, env: {}, domains: [] }))]
  partial.vercelCalls = []
  writeFileSync(stateFile, JSON.stringify(partial))
  const resumed = await command('setup', ['--no-deploy'])
  assert.equal(resumed.code, 0, resumed.output)
  assert.ok(!readState().vercelCalls.some((call: any) => call.args[0] === 'project' && call.args[1] === 'add'), 'existing Staging projects reused')
  assert.equal(project('gerard-staging').settings.buildCommand, 'npm run build', 'settings aligned on the reused project (project update --yes)')
  assertProductionUntouched('resumed setup')
  for (const url of Object.values(urls)) { const admin = new pg.Client({ connectionString: adminUrl }); await admin.connect(); await admin.query(`drop database if exists "${new URL(url).pathname.slice(1)}" with (force)`); await admin.end() }

  // ─── First setup: creates both Staging projects, configures them, deploys HEAD, returns the credential once ─────
  // Vercel gives gerard-staging a suffixed host on first deploy: setup must realign Gerard's variables and redeploy it.
  writeState({ stagingDomains: { 'gerard-staging': 'gerard-staging-jonathan.vercel.app' } })
  const first = await command('setup', ['--allow-dirty'])
  assert.equal(first.code, 0, first.output)
  assertProductionUntouched('first setup')
  const gerard = project('gerard-staging')
  const novotralux = project('novotralux-custom-staging')
  assert.ok(gerard && novotralux, 'Staging projects created')
  assert.deepEqual(gerard.settings, { ...productionProjects()[0].settings }, 'gerard-staging builds like gerard')
  assert.deepEqual(novotralux.settings, { ...productionProjects()[1].settings }, 'novotralux-custom-staging builds like novotralux-custom')
  const updates = readState().updates as string[][]
  assert.ok(updates.some((item) => item[item.indexOf('--build-command') + 1] === 'npm run novotralux:build'), 'build command received as one argv item')
  assert.equal(gerard.env.GERARD_INSTANCE_ENVIRONMENT, 'staging')
  for (const [project, branch] of [[gerard, 'gerard-staging'], [novotralux, 'novotralux-custom-staging']] as const) {
    const url = new URL(project.env.DATABASE_URL)
    const expected = new URL(urls[branch])
    assert.deepEqual([url.hostname, url.pathname, url.username], [expected.hostname, expected.pathname, `owner_${branch.replace(/-/g, '_')}`], `${branch}: child endpoint, inherited owner role`)
    assert.ok(url.password && url.password !== PRODUCTION_PASSWORD, `${branch}: Staging-only password`)
    const childId = readState().branches.find((item: any) => item.name === branch).id
    assert.equal(url.password, readState().passwords[childId], `${branch}: the password Neon issued (official connection string), not a locally invented one`)
    assert.ok(await opens(project.env.DATABASE_URL), `${branch}: rotated credential opens the child`)
    assert.ok(!(await opens(withPassword(urls[branch], `owner_${branch.replace(/-/g, '_')}`, PRODUCTION_PASSWORD))), `${branch}: the inherited Production password no longer opens the child`)
  }
  for (const [parent, database] of Object.entries(PRODUCTION_DATABASES)) assert.ok(await opens(withPassword(databaseUrl('localhost', database), OWNERS[parent], PRODUCTION_PASSWORD)), `${database}: Production credential unchanged`)
  assert.equal(gerard.env.GERARD_PLATFORM_HOSTNAMES, 'gerard-staging-jonathan.vercel.app', 'platform host realigned on the host Vercel assigned')
  assert.equal(gerard.env.GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_CONFIGURATION_ENDPOINT, 'https://novotralux-custom-staging.vercel.app/api/internal/platform/configuration')
  assert.equal(gerard.env.GOOGLE_ROUTES_MAX_CALLS_PER_OPERATION, '0')
  assert.equal(novotralux.env.GERARD_INSTANCE_ENVIRONMENT, 'staging')
  assert.equal(novotralux.env.NOVOTRALUX_CUSTOM_STAGING_DATABASE_URL, novotralux.env.DATABASE_URL, 'Novotralux build DB = runtime DB')
  assert.deepEqual([novotralux.env.GERARD_APPLICATION_ID, novotralux.env.GERARD_INSTANCE_ORGANIZATION_ID, novotralux.env.NEXT_PUBLIC_GERARD_APPLICATION], ['novotralux', 'org-novotralux', 'novotralux'])
  assert.equal(gerard.env.GERARD_PLATFORM_INSTANCE_SHARED_SECRET, novotralux.env.GERARD_PLATFORM_INSTANCE_SHARED_SECRET, 'one Staging shared secret')
  assert.ok(gerard.env.GERARD_PLATFORM_INSTANCE_SHARED_SECRET.length >= 48)
  assert.notEqual(gerard.env.JWT_SECRET, novotralux.env.JWT_SECRET, 'independent Staging JWT secrets')
  assert.ok(![gerard.env.JWT_SECRET, novotralux.env.JWT_SECRET].includes('production-jwt'), 'no Production secret reused')
  assert.deepEqual(readState().deploys.map((item: any) => item.project), ['novotralux-custom-staging', 'gerard-staging', 'gerard-staging'], 'Novotralux, Gerard, then Gerard realigned')
  for (const deploy of readState().deploys) assert.notEqual(path.resolve(deploy.cwd), process.cwd(), 'deployed from a temporary worktree')
  assert.ok(!existsSync(readState().deploys[0].cwd), 'temporary worktree removed')
  const secrets = [gerard.env.JWT_SECRET, novotralux.env.JWT_SECRET, gerard.env.GERARD_PLATFORM_INSTANCE_SHARED_SECRET, gerard.env.GERARD_STAGING_SUPERADMIN_INITIAL_PASSWORD, ...Object.values(urls)]
  for (const value of secrets) assert.ok(!first.output.includes(value), 'no secret or database URL printed')
  const creates = readState().neonCalls.filter((call: string) => call.includes('branches create'))
  assert.ok(creates.every((call: string) => !call.includes('--schema-only')), 'no root (schema-only) branch requested')
  assert.ok(creates.some((call: string) => call.includes('--name gerard-staging') && call.includes(`--parent ${PARENTS.gerard}`)), 'gerard-staging is a child of Gerard Production')
  assert.ok(creates.some((call: string) => call.includes('--name novotralux-custom-staging') && call.includes(`--parent ${PARENTS.novotralux}`)), 'novotralux-custom-staging is a child of Novotralux Production')
  for (const [name, parent] of [['gerard-staging', PARENTS.gerard], ['novotralux-custom-staging', PARENTS.novotralux]]) assert.equal(readState().branches.find((item: any) => item.name === name).parent_id, parent)
  assert.ok(!readState().neonCalls.some((call: string) => call.startsWith('roles')), 'no Neon role created or managed')
  const resets = readState().neonCalls.filter((call: string) => call.includes('reset_password'))
  assert.deepEqual(resets, [`api /projects/lucky-wildflower-15424624/branches/br-gerard-staging/roles/owner_gerard_staging/reset_password -X POST`, `api /projects/lucky-wildflower-15424624/branches/br-novotralux-custom-staging/roles/owner_novotralux_custom_staging/reset_password -X POST`], 'official branch-scoped reset, on the two child branches only')
  assert.ok(!resets.some((call: string) => Object.values(PARENTS).some((parent) => call.includes(parent))), 'never on a Production parent')
  assert.ok(readState().sanitizedBeforeWiring >= 3, 'every database URL was sanitized and verified before Vercel received it')
  const credentials = path.join(home, '.gerard-staging-credentials.txt')
  assert.ok(existsSync(credentials), 'first-run credential returned once (private file when not interactive)')
  if (process.platform !== 'win32') assert.equal(statSync(credentials).mode & 0o077, 0, 'credential file is owner-only')
  for (const [branch, url] of Object.entries(urls)) {
    const client = new pg.Client({ connectionString: url }); await client.connect()
    const migrations = Number((await client.query('select count(*)::int as n from public._prisma_migrations where finished_at is not null')).rows[0].n)
    const qa = (await client.query('select u.username, u."platformRole"::text as p, m.role::text as r from public."User" u left join public."OrganizationUser" m on m."userId" = u.id')).rows
    await client.end()
    assert.ok(migrations > 10, `${branch}: migrations applied`)
    if (branch === 'gerard-staging') assert.deepEqual(qa.map((row) => [row.username, row.p, row.r]), [['gerard.staging.superadmin', 'SUPER_ADMIN', 'VIEWER']], 'Gerard QA SUPER_ADMIN')
    else assert.deepEqual(qa.map((row) => [row.username, row.r]), [['novotralux.staging.admin', 'ORG_ADMIN']], 'Novotralux QA ORG_ADMIN')
  }

  for (const [branch, app] of [['gerard-staging', 'gerard'], ['novotralux-custom-staging', 'novotralux']] as const) {
    const client = new pg.Client({ connectionString: urls[branch] }); await client.connect()
    const row = (await client.query(`select (select string_agg(id, ',') from "Organization") as orgs, (select count(*) from "OrganizationIntegration")::int as integrations, (select string_agg(hostname, ',') from "OrganizationDomain") as domains, obj_description('public'::regnamespace, 'pg_namespace') as marker`)).rows[0]
    await client.end()
    assert.equal(row.orgs, app === 'gerard' ? 'org-gerard-default' : 'org-novotralux', `${branch}: only the Staging organization kept`)
    assert.equal(row.integrations, 0, `${branch}: inherited integration (and its secret reference) removed`)
    assert.ok(!String(row.domains ?? '').includes('novotralux.eu'), `${branch}: Production domain removed`)
    assert.match(row.marker, /^gerard-staging-sanitized:/, `${branch}: sanitization marker`)
  }
  assert.deepEqual(await productionSnapshot(), parentsBefore, 'Production parents unchanged (read only)')

  // ─── Second setup: idempotent ─────────────────────────────────────────────────────────────────────────
  rmSync(credentials)
  const callsBefore = readState().vercelCalls.length
  const neonBefore = readState().neonCalls.length
  const hashBefore = await passwordHash()
  const urlsBefore = [project('gerard-staging').env.DATABASE_URL, project('novotralux-custom-staging').env.DATABASE_URL]
  const second = await command('setup', ['--no-deploy'])
  assert.equal(second.code, 0, second.output)
  const writes = readState().vercelCalls.slice(callsBefore).filter((call: any) => (call.args[0] === 'env' && call.args[1] === 'add') || (call.args[0] === 'project' && ['add', 'update'].includes(call.args[1])))
  assert.deepEqual(writes, [], 'second run writes nothing')
  assert.deepEqual([project('gerard-staging').env.DATABASE_URL, project('novotralux-custom-staging').env.DATABASE_URL], urlsBefore, 'credential not rotated again; the stored one is reused')
  assert.match(second.output, /Staging credential already distinct from Production — reused/)
  assert.ok(!readState().neonCalls.slice(neonBefore).some((call: string) => call.includes('reset_password')), 'no password reset on rerun')
  assert.ok(!existsSync(credentials), 'credential not re-issued')
  assert.equal(await passwordHash(), hashBefore, 'existing account never reset')
  assert.ok(!readState().neonCalls.slice(neonBefore).some((call: string) => call.includes('branches create')), 'no branch recreated')

  // ─── Check: read-only; configuration items pass; the fake hosts are not served here, so reachability fails ─────
  const callsBeforeCheck = readState().vercelCalls.length
  const check = await command('check')
  const checkWrites = readState().vercelCalls.slice(callsBeforeCheck).filter((call: any) => (call.args[0] === 'env' && call.args[1] === 'add') || ['deploy'].includes(call.args[0]) || (call.args[0] === 'project' && ['add', 'update'].includes(call.args[1])))
  assert.deepEqual(checkWrites, [], 'check writes nothing')
  assert.notEqual(check.code, 0)
  for (const item of ['Gerard Staging DB is not Production', 'Novotralux Staging DB is not Production', 'QA accounts', 'Integrations safe', 'No Production host leakage']) assert.match(check.output, new RegExp(`PASS  ${item}`), item)
  assert.match(check.output, /FAIL {2}Gerard Staging reachable/)
  for (const value of secrets) assert.ok(!check.output.includes(value), 'check prints no secret or URL')

  // Drift: a Staging variable pointing at the Production database is reported.
  const state = readState()
  const driftBackup = state.projects.find((item: any) => item.name === 'gerard-staging').env.DATABASE_URL
  state.projects.find((item: any) => item.name === 'gerard-staging').env.DATABASE_URL = 'postgresql://u@ep-ancient-block-za26cw6e.eu.aws.neon.tech/neondb'
  writeFileSync(stateFile, JSON.stringify(state))
  const drift = await command('check')
  assert.match(drift.output, /FAIL {2}Gerard Staging DB is not Production — .*(does not point at the Staging branch|Production database)/)
  assert.ok(!drift.output.includes('ep-ancient-block'), 'endpoint not printed')
  // setup repairs a drifted Staging DATABASE_URL with the verified official Staging credential (never the drifted value).
  const repaired = await command('setup', ['--no-deploy'])
  assert.equal(repaired.code, 0, repaired.output)
  assert.equal(project('gerard-staging').env.DATABASE_URL, driftBackup, 'Staging DATABASE_URL realigned on the verified Staging credential')

  // Deploy refuses source changes unless explicitly acknowledged (and then still deploys HEAD only).
  if (meaningfulChanges((await run('git', ['status', '--porcelain'])).stdout).length) assert.match((await command('deploy', ['novotralux'])).output, /Uncommitted changes/)
  // Unsafe data on an existing Staging branch (an enabled integration with a secret) fails closed: no URL exported.
  const unsafe = new pg.Client({ connectionString: urls['gerard-staging'] }); await unsafe.connect()
  await unsafe.query(`insert into "OrganizationIntegration" (id, "organizationId", type, enabled, "secretRef", "updatedAt") values ('oi-unsafe', 'org-gerard-default', 'MAIL_INTAKE', true, 'SOME_SECRET', now())`)
  const envAddsBefore = readState().vercelCalls.filter((call: any) => call.args[0] === 'env' && call.args[1] === 'add').length
  const refused = await command('setup', ['--no-deploy'])
  assert.notEqual(refused.code, 0, 'unsafe data makes setup fail')
  assert.match(refused.output, /gerard-staging failed verification \(.*enabled integration.*\): its URL is NOT exported to Vercel/)
  assert.equal(readState().vercelCalls.filter((call: any) => call.args[0] === 'env' && call.args[1] === 'add').length, envAddsBefore, 'nothing written to Vercel')
  await unsafe.query(`delete from "OrganizationIntegration" where id = 'oi-unsafe'`); await unsafe.end()
  assert.deepEqual(await productionSnapshot(), parentsBefore, 'Production parents unchanged after all runs')
  assertProductionUntouched('all commands')
  if (process.env.STAGING_OPERATOR_TEST_VERBOSE) console.log(`${first.output}\n${second.output}\n${check.output}`)
  if (!hadEnv) rmSync(sentinel)
  console.log('Staging operator commands (Staging projects only, Production untouched, idempotent setup, worktree deploys, read-only check, no secret output): OK')
}

async function passwordHash() {
  const client = new pg.Client({ connectionString: urls['gerard-staging'] }); await client.connect()
  try { return (await client.query(`select "passwordHash" from public."User" where username = 'gerard.staging.superadmin'`)).rows[0]?.passwordHash } finally { await client.end() }
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => { if (existsSync(sentinel) && readFileSync(sentinel, 'utf8') === 'GERARD_TEST_SENTINEL=1\n') rmSync(sentinel); rmSync(home, { recursive: true, force: true }); process.exit() })
