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

// ─── Databases: each Production deployment resolves to its own application database ────────────────────
const urls = {
  gerardProduction: 'postgresql://u:p@ep-ancient-block-za26cw6e.eu.aws.neon.tech/neondb',
  gerardProductionPooled: 'postgresql://u:p@ep-ancient-block-za26cw6e-pooler.c-2.eu-central-1.aws.neon.tech/neondb',
  novotraluxProduction: 'postgresql://u:p@ep-ancient-surf-zav7xo37.eu.aws.neon.tech/neondb',
  undocumented: 'postgresql://u:p@ep-somewhere-else-za00000.eu.aws.neon.tech/neondb',
}

// Novotralux Custom: Production reads its own variable; local development requires the explicit application-specific
// variable and never falls back to the Gerard Standard DATABASE_URL.
assert.deepEqual(resolveNovotraluxDatabaseTarget({ VERCEL_ENV: 'production', NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL: urls.novotraluxProduction }), { target: urls.novotraluxProduction, instanceEnvironment: 'production' }, 'Production Custom reads its Production database')
assert.throws(() => resolveNovotraluxDatabaseTarget({ VERCEL_ENV: 'production', NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL: urls.gerardProduction }), /PRODUCTION_DATABASE_MISMATCH/, 'Production Custom cannot open the Standard database')
assert.throws(() => resolveNovotraluxDatabaseTarget({ VERCEL_ENV: 'production' }), /NOVOTRALUX_PRODUCTION_DATABASE_URL_REQUIRED/, 'Production needs its documented variable')
assert.deepEqual(resolveNovotraluxDatabaseTarget({ NOVOTRALUX_CUSTOM_DATABASE_URL: urls.novotraluxProduction }), { target: urls.novotraluxProduction, instanceEnvironment: 'development' }, 'local Custom uses the Custom application database')
assert.throws(() => resolveNovotraluxDatabaseTarget({ DATABASE_URL: urls.gerardProduction }), /NOVOTRALUX_CUSTOM_DATABASE_URL_REQUIRED/, 'local Custom never falls back to the Gerard Standard DATABASE_URL')
assert.throws(() => resolveNovotraluxDatabaseTarget({ NOVOTRALUX_CUSTOM_DATABASE_URL: 'not a url' }), /DATABASE_URL_INVALID/, 'local Custom still requires a usable URL')

// Runtime guard, the single connection point: local development is unrestricted, Production is per application.
assert.doesNotThrow(() => assertRuntimeDatabase(urls.gerardProduction, {} as never), 'local development may open the Gerard application database')
assert.doesNotThrow(() => assertRuntimeDatabase(urls.novotraluxProduction, { GERARD_APPLICATION_ID: 'novotralux' } as never), 'local development may open the Novotralux application database')
assert.doesNotThrow(() => assertRuntimeDatabase(urls.gerardProduction, { VERCEL_ENV: 'production' } as never), 'Gerard Production opens the Gerard database')
assert.doesNotThrow(() => assertRuntimeDatabase(urls.gerardProductionPooled, { VERCEL_ENV: 'production' } as never), 'pooled host is the same identity')
assert.doesNotThrow(() => assertRuntimeDatabase(urls.novotraluxProduction, { VERCEL_ENV: 'production', GERARD_APPLICATION_ID: 'novotralux' } as never), 'Novotralux Production opens the Novotralux database')
assert.throws(() => assertRuntimeDatabase(urls.novotraluxProduction, { VERCEL_ENV: 'production' } as never), /PRODUCTION_DATABASE_MISMATCH/, 'Gerard Production cannot open the Novotralux database')
assert.throws(() => assertRuntimeDatabase(urls.gerardProduction, { VERCEL_ENV: 'production', GERARD_APPLICATION_ID: 'novotralux' } as never), /PRODUCTION_DATABASE_MISMATCH/, 'Novotralux Production cannot open the Gerard database')
assert.throws(() => assertRuntimeDatabase(urls.undocumented, { VERCEL_ENV: 'production' } as never), /PRODUCTION_DATABASE_MISMATCH/, 'Production refuses an undocumented endpoint')
assert.throws(() => assertRuntimeDatabase('postgresql://u:p@ep-ancient-surf-zav7xo37x.eu.aws.neon.tech/neondb', { VERCEL_ENV: 'production', GERARD_APPLICATION_ID: 'novotralux' } as never), /PRODUCTION_DATABASE_MISMATCH/, 'Production refuses a look-alike endpoint')
assert.throws(() => assertRuntimeDatabase(urls.gerardProduction, { VERCEL_ENV: 'production', GERARD_APPLICATION_ID: 'unknown-app' } as never), /PRODUCTION_DATABASE_UNDECLARED/, 'an application without a documented database fails closed')
assert.throws(() => assertRuntimeDatabase('not a url', { VERCEL_ENV: 'production' } as never), /DATABASE_URL_INVALID/, 'invalid URL fails closed in Production')

// ─── Production build check: inert locally, refuses a wrong Production database ─────────────────────────
const check = (env: Record<string, string>) => {
  // The parent environment is inherited so the child can run at all, minus every variable that decides the
  // environment or the database.
  const inherited = { ...process.env }
  for (const key of ['VERCEL_ENV', 'GERARD_INSTANCE_ENVIRONMENT', 'GERARD_APPLICATION_ID', 'DATABASE_URL']) delete inherited[key]
  // This Node binary runs the tsx CLI directly: no shell, and no dependency on how npx resolves on the platform.
  const tsxCli = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
  try { return execFileSync(process.execPath, [tsxCli, 'scripts/check-production-database.ts'], { env: { ...inherited, ...env } as NodeJS.ProcessEnv, encoding: 'utf8', stdio: 'pipe', shell: false }) } catch (error: any) { return `${error.stdout ?? ''}${error.stderr ?? ''}${error.message ?? ''}` }
}
assert.match(check({ VERCEL_ENV: 'production', DATABASE_URL: urls.gerardProduction }), /gerard-standard production database identity verified/, 'the Standard Production build verifies its database')
assert.match(check({ VERCEL_ENV: 'production', GERARD_APPLICATION_ID: 'novotralux', DATABASE_URL: urls.novotraluxProduction }), /novotralux production database identity verified/, 'the Custom Production build verifies its own database')
assert.match(check({ VERCEL_ENV: 'production', DATABASE_URL: urls.undocumented }), /PRODUCTION_DATABASE_MISMATCH/, 'Production build fails on an undocumented database')
assert.match(check({ VERCEL_ENV: 'production' }), /PRODUCTION_DATABASE_URL_REQUIRED/, 'Production build fails without a database')
assert.match(check({ DATABASE_URL: urls.gerardProduction }), /skipped \(development\)/, 'the check is a no-op for a local build')

console.log('Deployment environments (development / production), routing and per-application Production database guard: OK')
