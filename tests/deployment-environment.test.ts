import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { resolveDeploymentEnvironment } from '@prolific/gerard-core'

import { resolveDeploymentEnvironment as wrapperResolve, resolveNovotraluxDatabaseTarget } from '../apps/novotralux/scripts/database-target.mjs'
import { assertRuntimeDatabase } from '../lib/runtime/database-guard'
import { listRegisteredGerardInstances } from '../lib/runtime/instance-registry'

// ─── Two environments only: local development and Production, identical in Core and the build wrapper ───
const cases: [Record<string, string>, string][] = [
  [{}, 'development'],
  [{ VERCEL_ENV: 'production' }, 'production'],
  [{ VERCEL_ENV: 'production', GERARD_INSTANCE_ENVIRONMENT: 'production' }, 'production'],
  [{ VERCEL_ENV: 'development' }, 'development'],
  [{ GERARD_INSTANCE_ENVIRONMENT: 'development' }, 'development'],
  // A local `next build` is development: NODE_ENV never promotes a runtime to Production.
  [{ NODE_ENV: 'production' }, 'development'],
  [{ VERCEL_ENV: 'production', GERARD_INSTANCE_ENVIRONMENT: 'development' }, 'DEPLOYMENT_ENVIRONMENT_CONFLICT'],
  // Staging and Preview no longer exist: they are unknown values and fail closed.
  [{ GERARD_INSTANCE_ENVIRONMENT: 'staging' }, 'DEPLOYMENT_ENVIRONMENT_UNKNOWN'],
  [{ GERARD_INSTANCE_ENVIRONMENT: 'preview' }, 'DEPLOYMENT_ENVIRONMENT_UNKNOWN'],
  [{ VERCEL_ENV: 'preview' }, 'DEPLOYMENT_ENVIRONMENT_UNKNOWN'],
  [{ GERARD_INSTANCE_ENVIRONMENT: 'prod' }, 'DEPLOYMENT_ENVIRONMENT_UNKNOWN'],
  [{ VERCEL_ENV: 'qa' }, 'DEPLOYMENT_ENVIRONMENT_UNKNOWN'],
]
for (const [env, expected] of cases) {
  for (const resolve of [resolveDeploymentEnvironment, wrapperResolve]) {
    let actual: string
    try { actual = resolve(env) } catch (error) { actual = (error as Error).message }
    assert.equal(actual, expected, `${JSON.stringify(env)} -> ${expected}`)
  }
}

// ─── Platform → Custom routing: Production reaches Production, local only a declared local endpoint ─────
const routingKeys = ['VERCEL_ENV', 'GERARD_INSTANCE_ENVIRONMENT', 'GERARD_PLATFORM_INSTANCE_NOVOTRALUX_DEVELOPMENT_CONFIGURATION_ENDPOINT', 'GERARD_PLATFORM_INSTANCE_NOVOTRALUX_DEVELOPMENT_DOMAIN']
const saved = Object.fromEntries(routingKeys.map((key) => [key, process.env[key]]))
function novotralux(env: Record<string, string>) {
  for (const key of routingKeys) delete process.env[key]
  Object.assign(process.env, env)
  try { return listRegisteredGerardInstances().find((item) => item.application === 'novotralux') } finally { for (const key of routingKeys) delete process.env[key] }
}
const PRODUCTION = 'https://novotralux-custom.vercel.app/api/internal/platform/configuration'
const LOCAL = 'http://localhost:3200/api/internal/platform/configuration'
assert.equal(novotralux({ VERCEL_ENV: 'production' })?.configurationEndpoint, PRODUCTION, 'Production reaches the Production Custom instance')
assert.equal(novotralux({})?.configurationEndpoint, undefined, 'local development does not default to Production Custom')
assert.equal(novotralux({ GERARD_PLATFORM_INSTANCE_NOVOTRALUX_DEVELOPMENT_CONFIGURATION_ENDPOINT: LOCAL })?.configurationEndpoint, LOCAL, 'explicit local endpoint')
for (const host of ['www.novotralux.eu', 'novotralux.eu', 'NOVOTRALUX-CUSTOM.vercel.app']) {
  assert.equal(novotralux({ GERARD_PLATFORM_INSTANCE_NOVOTRALUX_DEVELOPMENT_CONFIGURATION_ENDPOINT: `https://${host}/api/internal/platform/configuration` })?.configurationEndpoint, undefined, `local development cannot target Production host ${host}`)
}
for (const [key, value] of Object.entries(saved)) if (value !== undefined) process.env[key] = value

// ─── The one safety rule: local development never opens a Production database ───────────────────────────
const urls = {
  gerardProduction: 'postgresql://u:p@ep-ancient-block-za26cw6e.eu.aws.neon.tech/neondb',
  novotraluxProduction: 'postgresql://u:p@ep-ancient-surf-zav7xo37.eu.aws.neon.tech/neondb',
  local: 'postgresql://u:p@ep-local-dev-za00000.eu.aws.neon.tech/neondb',
}
// Novotralux Custom: Production reads its own variable, local development the local DATABASE_URL.
assert.deepEqual(resolveNovotraluxDatabaseTarget({ VERCEL_ENV: 'production', NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL: urls.novotraluxProduction }), { target: urls.novotraluxProduction, instanceEnvironment: 'production' }, 'Production Custom reads its Production database')
assert.deepEqual(resolveNovotraluxDatabaseTarget({ DATABASE_URL: urls.local }), { target: urls.local, instanceEnvironment: 'development' }, 'local Custom uses the local database')
assert.throws(() => resolveNovotraluxDatabaseTarget({ VERCEL_ENV: 'production', NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL: urls.local }), /DATABASE_ENVIRONMENT_MISMATCH/, 'Production cannot use a non-Production database')
assert.throws(() => resolveNovotraluxDatabaseTarget({ VERCEL_ENV: 'production' }), /NOVOTRALUX_PRODUCTION_DATABASE_URL_REQUIRED/, 'Production needs its documented variable')
assert.throws(() => resolveNovotraluxDatabaseTarget({ DATABASE_URL: urls.novotraluxProduction }), /DATABASE_ENVIRONMENT_MISMATCH/, 'local Custom refuses the Novotralux Production database')
assert.throws(() => resolveNovotraluxDatabaseTarget({ DATABASE_URL: urls.gerardProduction }), /DATABASE_ENVIRONMENT_MISMATCH/, 'local Custom refuses the Gerard Production database')

// Runtime guard, the single connection point for both applications.
assert.throws(() => assertRuntimeDatabase(urls.gerardProduction, {} as never), /DATABASE_ENVIRONMENT_MISMATCH/, 'local development refuses the Gerard Production database')
assert.throws(() => assertRuntimeDatabase(urls.novotraluxProduction, {} as never), /DATABASE_ENVIRONMENT_MISMATCH/, 'local development refuses the Novotralux Production database')
assert.doesNotThrow(() => assertRuntimeDatabase(urls.local, {} as never), 'local development opens the local database')
assert.doesNotThrow(() => assertRuntimeDatabase(urls.novotraluxProduction, { VERCEL_ENV: 'production' } as never), 'Production opens its Production database')
assert.throws(() => assertRuntimeDatabase(urls.local, { VERCEL_ENV: 'production' } as never), /DATABASE_ENVIRONMENT_MISMATCH/, 'Production refuses an undocumented endpoint')
assert.throws(() => assertRuntimeDatabase('postgresql://u:p@ep-ancient-surf-zav7xo37x.eu.aws.neon.tech/neondb', { VERCEL_ENV: 'production' } as never), /DATABASE_ENVIRONMENT_MISMATCH/, 'Production refuses a look-alike endpoint')
// Pooled hosts are the same database identity, in both directions.
assert.doesNotThrow(() => assertRuntimeDatabase('postgresql://u:p@ep-ancient-block-za26cw6e-pooler.c-2.eu-central-1.aws.neon.tech/neondb', { VERCEL_ENV: 'production' } as never), 'Production opens the pooled Production host')
assert.throws(() => assertRuntimeDatabase('postgresql://u:p@ep-ancient-block-za26cw6e-pooler.c-2.eu-central-1.aws.neon.tech/neondb', {} as never), /DATABASE_ENVIRONMENT_MISMATCH/, 'local development refuses the pooled Production host')
assert.throws(() => assertRuntimeDatabase('not a url', {} as never), /DATABASE_URL_INVALID/, 'invalid URL fails closed')

// ─── Production build check: inert locally, refuses a wrong Production database ─────────────────────────
const check = (env: Record<string, string>) => {
  // The parent environment is inherited so the child can run at all, minus every variable that decides the
  // environment or the database.
  const inherited = { ...process.env }
  for (const key of ['VERCEL_ENV', 'GERARD_INSTANCE_ENVIRONMENT', 'DATABASE_URL']) delete inherited[key]
  // This Node binary runs the tsx CLI directly: no shell, and no dependency on how npx resolves on the platform.
  const tsxCli = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
  try { return execFileSync(process.execPath, [tsxCli, 'scripts/check-production-database.ts'], { env: { ...inherited, ...env } as NodeJS.ProcessEnv, encoding: 'utf8', stdio: 'pipe', shell: false }) } catch (error: any) { return `${error.stdout ?? ''}${error.stderr ?? ''}${error.message ?? ''}` }
}
assert.match(check({ VERCEL_ENV: 'production', DATABASE_URL: urls.gerardProduction }), /production database identity verified/, 'Production build verifies its database')
assert.match(check({ VERCEL_ENV: 'production', DATABASE_URL: urls.local }), /DATABASE_ENVIRONMENT_MISMATCH/, 'Production build fails on a non-Production database')
assert.match(check({ VERCEL_ENV: 'production' }), /PRODUCTION_DATABASE_URL_REQUIRED/, 'Production build fails without a database')
assert.match(check({ DATABASE_URL: urls.local }), /skipped \(development\)/, 'the check is a no-op for a local build')

console.log('Deployment environments (development / production), routing and Production database guard: OK')
