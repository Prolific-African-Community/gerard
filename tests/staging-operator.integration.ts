import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import pg from 'pg'

import { productionFixture, startMockVercel } from './fixtures/staging/mock-vercel-api.mjs'

// End-to-end test of the Staging operator commands against a mock Vercel API, fake `vercel`/`neonctl` CLIs and a local
// PostgreSQL standing in for the Neon Staging branches. Requires STAGING_OPERATOR_TEST_ADMIN_URL (a superuser URL of a
// disposable local server, e.g. postgresql://postgres@localhost:5433/postgres).

const adminUrl = process.env.STAGING_OPERATOR_TEST_ADMIN_URL
if (!adminUrl) { console.error('STAGING_OPERATOR_TEST_ADMIN_URL is required (disposable local PostgreSQL)'); process.exit(1) }
const local = new URL(adminUrl)
const databaseUrl = (host: string, name: string) => `postgresql://${local.username}${local.password ? `:${local.password}` : ''}@${host}:${local.port || 5432}/${name}`
// Distinct hosts give the two Staging databases distinct endpoint identities, as two Neon branches have.
const urls = { 'gerard-staging': databaseUrl('localhost', 'op_gerard_staging'), 'novotralux-custom-staging': databaseUrl('127.0.0.1', 'op_novotralux_staging') }
const run = promisify(execFile)
const home = mkdtempSync(path.join(tmpdir(), 'gerard-staging-'))
const stateFile = path.join(home, 'state.json')
const fixtures = path.join(process.cwd(), 'tests/fixtures/staging')

type Result = { code: number; output: string }
async function command(script: string, env: Record<string, string>, args: string[] = []): Promise<Result> {
  try {
    const { stdout, stderr } = await run('npx', ['tsx', `scripts/staging/${script}.ts`, ...args], { env: { PATH: process.env.PATH!, HOME: home, VERCEL_TOKEN: 'test-vercel-token', GERARD_STAGING_VERCEL_CLI: `node ${fixtures}/fake-vercel.mjs`, GERARD_STAGING_NEONCTL: `node ${fixtures}/fake-neonctl.mjs`, FAKE_STAGING_STATE: stateFile, ...env } as unknown as NodeJS.ProcessEnv, maxBuffer: 32 * 1024 * 1024, timeout: 600000 })
    return { code: 0, output: stdout + stderr }
  } catch (error: any) {
    return { code: error.code ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}
const neonState = (extra: Record<string, unknown> = {}) => writeFileSync(stateFile, JSON.stringify({ neonProject: 'lucky-wildflower-15424624', adminUrl, urls, branches: [{ id: 'br-patient-wildflower-zarmyqcq', name: 'production', default: true }, { id: 'br-cool-sea-zaufb5ng', name: 'novotralux-custom-production' }, { id: 'br-still-field-za5dh59a', name: 'novotralux-custom-preview' }], neonCalls: [], deploys: [], ...extra }))
const readState = () => JSON.parse(readFileSync(stateFile, 'utf8'))

// Only the canonical projects are ever addressed: never a Production hostname, never the legacy project.
const FORBIDDEN_PROJECT_PATHS = /\/projects\/(gerard-dispatch|prj_decoy_hostname|novotralux|prj_legacy_novotralux)(\/|$)/
const assertCanonicalProjects = (api: { calls: string[] }, name: string) => {
  const wrong = api.calls.filter((call) => FORBIDDEN_PROJECT_PATHS.test(call.split(' ')[1]))
  assert.deepEqual(wrong, [], `${name}: only projects gerard and novotralux-custom are addressed`)
}

async function main() {
  // ─── Refusals: nothing is written when a target is, or looks like, Production ───────────────────────────
  const refusal = async (name: string, mutate: (fixture: any) => void, expected: RegExp, env: Record<string, string> = {}, extraNeon: Record<string, unknown> = {}) => {
    const fixture = productionFixture(); mutate(fixture)
    const api = await startMockVercel(fixture)
    neonState(extraNeon)
    const result = await command('setup', { GERARD_STAGING_VERCEL_API: api.url, ...env }, ['--no-deploy'])
    await api.close()
    assertCanonicalProjects(api, name)
    assert.notEqual(result.code, 0, `${name}: must fail`)
    assert.match(result.output, expected, name)
    assert.ok(!api.writes.some((write: any) => write.path.endsWith('/env') || write.path.endsWith('/domains')), `${name}: no variable or domain written`)
  }
  await refusal('staging environment typed production', (fixture) => { fixture.projects[0].customEnvironments.push({ id: 'env_bad', slug: 'staging', type: 'production' }) }, /Production environment: refused/)
  await refusal('staging domain is a Production host', () => undefined, /Production host: refused/, { GERARD_STAGING_DOMAIN_GERARD: 'gerard-dispatch.vercel.app' })
  await refusal('staging branch name on a Production branch', () => undefined, /Production branch: refused/, {}, { branches: [{ id: 'br-cool-sea-zaufb5ng', name: 'novotralux-custom-staging' }, { id: 'br-patient-wildflower-zarmyqcq', name: 'production', default: true }] })
  await refusal('Neon not authenticated', () => undefined, /Neon CLI is not authenticated: run .*neonctl.* auth/, {}, { neonUnauthenticated: true })
  await refusal('custom environments not in the plan', (fixture) => { fixture.customEnvironmentLimit = 0 }, /allows 0 custom environment\(s\).*Pro\/Enterprise/)
  await refusal('unknown Vercel scope', () => undefined, /Vercel project gerard not found in scope other-team/, { GERARD_STAGING_VERCEL_TEAM: 'other-team' })
  await refusal('Vercel not authenticated', () => undefined, /Vercel CLI is not authenticated: run .*vercel.* login/, {}, { vercelUnauthenticated: true })

  // ─── First setup: creates everything in Staging only, deploys to the staging target, returns the credential once ──
  const fixture = productionFixture()
  const api = await startMockVercel(fixture)
  neonState()
  // The former hostname-derived overrides must have no effect.
  const env = { GERARD_STAGING_VERCEL_API: api.url, GERARD_STAGING_VERCEL_PROJECT_GERARD: 'gerard-dispatch', GERARD_STAGING_VERCEL_PROJECT_NOVOTRALUX: 'novotralux' }
  const first = await command('setup', env, ['--allow-dirty'])
  assert.equal(first.code, 0, first.output)
  assert.ok(!api.calls.some((call: string) => call.includes('/v2/teams')), 'teams are never enumerated')
  assertCanonicalProjects(api, 'first setup')
  assert.ok(api.calls.includes('GET /v9/projects/gerard') && api.calls.includes('GET /v9/projects/novotralux-custom'), 'projects looked up by canonical name')
  for (const decoy of fixture.projects.slice(2)) assert.equal(decoy.customEnvironments.length + decoy.envs.length, 0, `${decoy.name}: untouched`)
  const trust = fixture.projects[1].trustedSources as any
  assert.equal(trust.enableVercelCiSameRepository, true, 'Trusted Sources settings preserved')
  assert.deepEqual(trust.projects.prj_gerard.customAllow, [{ from: { slugs: ['preview'] }, to: { slugs: ['preview'] } }, { from: { slugs: ['staging'] }, to: { slugs: ['staging'] } }], 'Gerard staging → Novotralux staging added, Preview rule kept')
  assert.ok(api.writes.filter((write: any) => write.method === 'PATCH' && /^\/v9\/projects\/[^/]+$/.test(write.path)).every((write: any) => write.path === '/v9/projects/prj_novotralux' && Object.keys(write.body).join() === 'trustedSources'), 'only the Novotralux Trusted Sources is updated')
  const stagingIds = fixture.projects.slice(0, 2).map((project: any) => project.customEnvironments.find((item: any) => item.slug === 'staging')?.id)
  assert.ok(stagingIds.every(Boolean), 'staging environment created in both projects')
  const envWrites = api.writes.filter((write: any) => write.method === 'POST' && write.path.endsWith('/env'))
  assert.ok(envWrites.length >= 14, 'Staging variables created')
  for (const write of envWrites) {
    assert.equal(write.body.target, undefined, `${write.body.key}: no Production/Preview target`)
    assert.deepEqual(write.body.customEnvironmentIds, [stagingIds[write.path.includes('prj_gerard') ? 0 : 1]], `${write.body.key}: staging only`)
    assert.notEqual(write.body.type, 'plain', `${write.body.key}: encrypted`)
  }
  assert.ok(!api.writes.some((write: any) => write.method === 'PATCH' && /env_(g|n)\d/.test(write.path)), 'no Production variable modified')
  for (const write of api.writes.filter((item: any) => item.path.endsWith('/domains'))) assert.ok(write.body.customEnvironmentId && stagingIds.includes(write.body.customEnvironmentId), 'domain attached to staging only')
  const created = (project: number, key: string) => fixture.projects[project].envs.find((item: any) => item.key === key && item.customEnvironmentIds?.includes(stagingIds[project]))?.value
  assert.equal(created(0, 'DATABASE_URL'), urls['gerard-staging'], 'Gerard Staging DATABASE_URL = Gerard Staging branch')
  assert.equal(created(1, 'NOVOTRALUX_CUSTOM_STAGING_DATABASE_URL'), urls['novotralux-custom-staging'], 'Novotralux Staging DB variable = Novotralux Staging branch')
  assert.equal(created(0, 'GERARD_PLATFORM_INSTANCE_SHARED_SECRET'), created(1, 'GERARD_PLATFORM_INSTANCE_SHARED_SECRET'), 'one Staging shared secret on both sides')
  assert.notEqual(created(0, 'JWT_SECRET'), created(1, 'JWT_SECRET'), 'independent Staging JWT secrets')
  assert.equal(created(0, 'GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_CONFIGURATION_ENDPOINT'), 'https://novotralux-custom-staging.vercel.app/api/internal/platform/configuration')
  const secrets = fixture.projects.flatMap((project: any) => project.envs.filter((item: any) => /SECRET|PASSWORD|DATABASE_URL/.test(item.key)).map((item: any) => item.value))
  for (const secretValue of secrets) assert.ok(!first.output.includes(secretValue), 'no secret or database URL printed')
  assert.ok(!/postgres(ql)?:\/\//.test(first.output), 'no database URL printed')
  assert.ok(readState().neonCalls.some((call: string) => call.includes('branches create') && call.includes('--schema-only')), 'branches created schema-only')
  const deploys = readState().deploys
  assert.deepEqual(deploys.map((item: any) => item.projectId), ['prj_gerard', 'prj_novotralux'], 'both apps deployed')
  for (const deploy of deploys) { assert.ok(deploy.args.includes('--target=staging') && !deploy.args.includes('--prod'), 'staging target only'); assert.equal(deploy.orgId, 'team_gerard') }
  const credentials = path.join(home, '.gerard-staging-credentials.txt')
  assert.ok(existsSync(credentials), 'first-run credential returned once (private file when not interactive)')
  if (process.platform !== 'win32') assert.equal(statSync(credentials).mode & 0o077, 0, 'credential file is owner-only')
  const initialPassword = /initial password: (\S+)/.exec(readFileSync(credentials, 'utf8'))![1]
  assert.ok(!first.output.includes(initialPassword), 'initial password not in the output')
  for (const [branch, url] of Object.entries(urls)) {
    const client = new pg.Client({ connectionString: url }); await client.connect()
    const migrations = Number((await client.query('select count(*)::int as n from public._prisma_migrations where finished_at is not null')).rows[0].n)
    const qa = (await client.query('select u.username, u."platformRole"::text as p, m.role::text as r from public."User" u left join public."OrganizationUser" m on m."userId" = u.id')).rows
    await client.end()
    assert.ok(migrations > 10, `${branch}: migrations applied`)
    if (branch === 'gerard-staging') assert.deepEqual(qa.map((row) => [row.username, row.p, row.r]), [['gerard.staging.superadmin', 'SUPER_ADMIN', 'VIEWER']], 'Gerard QA SUPER_ADMIN')
    else assert.deepEqual(qa.map((row) => [row.username, row.r]), [['novotralux.staging.admin', 'ORG_ADMIN']], 'Novotralux QA ORG_ADMIN')
  }

  // ─── Second setup: idempotent (no new resource, no account reset, credential not re-issued) ─────────────
  rmSync(credentials)
  const writesBefore = api.writes.length
  const hashBefore = await passwordHash()
  const neonCallsBefore = readState().neonCalls.length
  const second = await command('setup', env, ['--no-deploy'])
  assert.equal(second.code, 0, second.output)
  assert.equal(api.writes.length, writesBefore, 'second run writes nothing')
  assert.ok(!existsSync(credentials), 'credential not re-issued')
  assert.equal(await passwordHash(), hashBefore, 'existing account never reset')
  assert.ok(!readState().neonCalls.slice(neonCallsBefore).some((call: string) => call.includes('branches create')), 'no branch recreated')

  // ─── Check: read-only; database/config items pass, runtime unreachable here so Channel fails honestly ───────
  const check = await command('check', env)
  assert.equal(api.writes.length, writesBefore, 'check writes nothing')
  assert.notEqual(check.code, 0, 'check fails while the runtimes are unreachable')
  for (const item of ['Gerard Staging DB', 'Novotralux Staging DB', 'Production DB overlap', 'Custom endpoint', 'Production endpoint leakage', 'QA accounts', 'Integration safety']) assert.match(check.output, new RegExp(`PASS  ${item}`), item)
  assert.match(check.output, /FAIL {2}Channel — .*unreachable/)
  assert.ok(!/postgres(ql)?:\/\//.test(check.output) && !check.output.includes(String(created(0, 'GERARD_PLATFORM_INSTANCE_SHARED_SECRET'))), 'check prints no secret or URL')

  // Trusted Sources losing the staging rule is reported.
  const rules = trust.projects.prj_gerard.customAllow
  trust.projects.prj_gerard.customAllow = rules.slice(0, 1)
  assert.match((await command('check', env)).output, /FAIL {2}Channel — .*Trusted Sources does not admit gerard staging → staging/)
  trust.projects.prj_gerard.customAllow = rules

  // A Staging variable drifting to the Production database is reported.
  fixture.projects[0].envs.find((item: any) => item.key === 'DATABASE_URL' && item.customEnvironmentIds)!.value = 'postgresql://u@ep-ancient-block-za26cw6e.eu.aws.neon.tech/neondb'
  const drift = await command('check', env)
  assert.match(drift.output, /FAIL {2}Gerard Staging DB/)
  assert.match(drift.output, /FAIL {2}Production DB overlap/)
  assert.ok(!drift.output.includes('ep-ancient-block'), 'endpoint not printed')
  assertCanonicalProjects(api, 'second setup and checks')
  if (process.env.STAGING_OPERATOR_TEST_VERBOSE) console.log(`${first.output}\n${second.output}\n${check.output}\n${drift.output}`)
  await api.close()
  console.log('Staging operator commands (setup idempotency, Production refusals, staging-only writes, read-only check, no secret output): OK')
}

async function passwordHash() {
  const client = new pg.Client({ connectionString: urls['gerard-staging'] }); await client.connect()
  try { return (await client.query(`select "passwordHash" from public."User" where username = 'gerard.staging.superadmin'`)).rows[0]?.passwordHash } finally { await client.end() }
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => { rmSync(home, { recursive: true, force: true }); process.exit() })
