import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import pg from 'pg'

import { meaningfulChanges } from '../scripts/staging/deploy'

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

type Result = { code: number; output: string }
async function command(script: string, args: string[] = [], extra: Record<string, string> = {}): Promise<Result> {
  try {
    const { stdout, stderr } = await run('npx', ['tsx', `scripts/staging/${script}.ts`, ...args], { env: { PATH: process.env.PATH!, HOME: home, GERARD_STAGING_VERCEL_CLI: `node ${fixtures}/fake-vercel.mjs`, GERARD_STAGING_NEONCTL: `node ${fixtures}/fake-neonctl.mjs`, FAKE_STAGING_STATE: stateFile, ...extra } as unknown as NodeJS.ProcessEnv, maxBuffer: 32 * 1024 * 1024, timeout: 600000 })
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
const writeState = (extra: Record<string, unknown> = {}) => writeFileSync(stateFile, JSON.stringify({
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

async function main() {
  // ─── Dirty-tree rule: generated files never block a deploy, source changes do ────────────────────────
  assert.deepEqual(meaningfulChanges(' M next-env.d.ts\n M tsconfig.tsbuildinfo\n'), [], 'generated files ignored')
  assert.deepEqual(meaningfulChanges(' M next-env.d.ts\n M lib/prisma.ts\n?? scripts/new.ts\n'), ['lib/prisma.ts', 'scripts/new.ts'], 'source changes refused')

  // A local .env with Production-like values must never reach a Staging deployment (deploys build from a worktree).
  const hadEnv = existsSync(sentinel)
  if (!hadEnv) writeFileSync(sentinel, 'GERARD_TEST_SENTINEL=1\n')

  // ─── Refusals before any write ────────────────────────────────────────────────────────────────────────
  for (const [label, extra, expected] of [
    ['Vercel not authenticated', { vercelUnauthenticated: true }, /Vercel CLI is not authenticated: run .*vercel.* login/],
    ['Neon not authenticated', { neonUnauthenticated: true }, /Neon CLI is not authenticated: run .*neonctl.* auth/],
    ['staging branch name on a Production branch', { branches: [{ id: 'br-cool-sea-zaufb5ng', name: 'novotralux-custom-staging' }, { id: 'br-patient-wildflower-zarmyqcq', name: 'production', default: true }] }, /Production branch: refused/],
  ] as const) {
    writeState(extra as Record<string, unknown>)
    const result = await command('setup', ['--no-deploy'])
    assert.notEqual(result.code, 0, `${label}: must fail`)
    assert.match(result.output, expected, label)
    assert.ok(!readState().vercelCalls.some((call: any) => call.args[0] === 'env' && call.args[1] === 'add'), `${label}: no variable written`)
    assertProductionUntouched(label)
  }

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
  assert.equal(gerard.env.GERARD_INSTANCE_ENVIRONMENT, 'staging')
  assert.equal(gerard.env.DATABASE_URL, urls['gerard-staging'], 'Gerard Staging DB')
  assert.equal(gerard.env.GERARD_PLATFORM_HOSTNAMES, 'gerard-staging-jonathan.vercel.app', 'platform host realigned on the host Vercel assigned')
  assert.equal(gerard.env.GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_CONFIGURATION_ENDPOINT, 'https://novotralux-custom-staging.vercel.app/api/internal/platform/configuration')
  assert.equal(gerard.env.GOOGLE_ROUTES_MAX_CALLS_PER_OPERATION, '0')
  assert.equal(novotralux.env.GERARD_INSTANCE_ENVIRONMENT, 'staging')
  assert.equal(novotralux.env.DATABASE_URL, urls['novotralux-custom-staging'], 'Novotralux runtime DB')
  assert.equal(novotralux.env.NOVOTRALUX_CUSTOM_STAGING_DATABASE_URL, urls['novotralux-custom-staging'], 'Novotralux build DB')
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
  assert.ok(readState().neonCalls.some((call: string) => call.includes('branches create') && call.includes('--schema-only')), 'branches created schema-only')
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

  // ─── Second setup: idempotent ─────────────────────────────────────────────────────────────────────────
  rmSync(credentials)
  const callsBefore = readState().vercelCalls.length
  const neonBefore = readState().neonCalls.length
  const hashBefore = await passwordHash()
  const second = await command('setup', ['--no-deploy'])
  assert.equal(second.code, 0, second.output)
  const writes = readState().vercelCalls.slice(callsBefore).filter((call: any) => (call.args[0] === 'env' && call.args[1] === 'add') || (call.args[0] === 'project' && ['add', 'update'].includes(call.args[1])))
  assert.deepEqual(writes, [], 'second run writes nothing')
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
  state.projects.find((item: any) => item.name === 'gerard-staging').env.DATABASE_URL = 'postgresql://u@ep-ancient-block-za26cw6e.eu.aws.neon.tech/neondb'
  writeFileSync(stateFile, JSON.stringify(state))
  const drift = await command('check')
  assert.match(drift.output, /FAIL {2}Gerard Staging DB is not Production — .*(does not point at the Staging branch|Production database)/)
  assert.ok(!drift.output.includes('ep-ancient-block'), 'endpoint not printed')

  // Deploy refuses source changes unless explicitly acknowledged (and then still deploys HEAD only).
  if (meaningfulChanges((await run('git', ['status', '--porcelain'])).stdout).length) assert.match((await command('deploy', ['novotralux'])).output, /Uncommitted changes/)
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
