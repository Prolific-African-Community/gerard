import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { resolveDeploymentEnvironment } from '@prolific/gerard-core'

import { resolveDeploymentEnvironment as wrapperResolve, resolveNovotraluxDatabaseTarget } from '../apps/novotralux/scripts/database-target.mjs'
import { assertRuntimeDatabase } from '../lib/runtime/database-guard'
import { listRegisteredGerardInstances } from '../lib/runtime/instance-registry'

// ─── Environment resolution: explicit, identical in Core and the build wrapper, fail-closed ─────────────
const cases: [Record<string, string>, string][] = [
  [{}, 'development'],
  [{ GERARD_INSTANCE_ENVIRONMENT: 'staging' }, 'staging'],
  [{ VERCEL_ENV: 'production' }, 'production'],
  [{ VERCEL_ENV: 'production', GERARD_INSTANCE_ENVIRONMENT: 'production' }, 'production'],
  [{ VERCEL_ENV: 'preview' }, 'preview'],
  [{ VERCEL_ENV: 'preview', GERARD_INSTANCE_ENVIRONMENT: 'staging' }, 'staging'],
  [{ VERCEL_ENV: 'preview', VERCEL_TARGET_ENV: 'staging' }, 'staging'],
  [{ VERCEL_ENV: 'development' }, 'development'],
  [{ VERCEL_ENV: 'production', GERARD_INSTANCE_ENVIRONMENT: 'staging' }, 'DEPLOYMENT_ENVIRONMENT_CONFLICT'],
  [{ VERCEL_ENV: 'preview', GERARD_INSTANCE_ENVIRONMENT: 'production' }, 'DEPLOYMENT_ENVIRONMENT_CONFLICT'],
  [{ VERCEL_ENV: 'preview', VERCEL_TARGET_ENV: 'staging', GERARD_INSTANCE_ENVIRONMENT: 'preview' }, 'DEPLOYMENT_ENVIRONMENT_CONFLICT'],
  [{ GERARD_INSTANCE_ENVIRONMENT: 'prod' }, 'DEPLOYMENT_ENVIRONMENT_UNKNOWN'],
  [{ VERCEL_ENV: 'qa' }, 'DEPLOYMENT_ENVIRONMENT_UNKNOWN'],
]
for (const [env, expected] of cases) {
  for (const resolve of [resolveDeploymentEnvironment, wrapperResolve]) {
    let actual: string
    try { actual = resolve(env) } catch (error) { actual = (error as Error).message }
    assert.equal(actual, expected, `${JSON.stringify(env)} → ${expected}`)
  }
}

// ─── Platform → Custom routing: each environment reaches only its own instance ─────────────────────────
const routingKeys = ['VERCEL_ENV', 'VERCEL_TARGET_ENV', 'GERARD_INSTANCE_ENVIRONMENT', 'GERARD_PLATFORM_INSTANCE_NOVOTRALUX_PREVIEW_CONFIGURATION_ENDPOINT', 'GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_CONFIGURATION_ENDPOINT', 'GERARD_PLATFORM_INSTANCE_NOVOTRALUX_DEVELOPMENT_CONFIGURATION_ENDPOINT', 'GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_DOMAIN']
const saved = Object.fromEntries(routingKeys.map((key) => [key, process.env[key]]))
function novotralux(env: Record<string, string>) {
  for (const key of routingKeys) delete process.env[key]
  Object.assign(process.env, env)
  try { return listRegisteredGerardInstances().find((item) => item.application === 'novotralux') } finally { for (const key of routingKeys) delete process.env[key] }
}
const STAGING = 'https://novotralux-staging.example.com/api/internal/platform/configuration'
const PREVIEW = 'https://novotralux-preview.example.com/api/internal/platform/configuration'
const PRODUCTION = 'https://novotralux-custom.vercel.app/api/internal/platform/configuration'
const all = { GERARD_PLATFORM_INSTANCE_NOVOTRALUX_PREVIEW_CONFIGURATION_ENDPOINT: PREVIEW, GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_CONFIGURATION_ENDPOINT: STAGING }
assert.equal(novotralux({ VERCEL_ENV: 'production', ...all })?.configurationEndpoint, PRODUCTION, 'Production → Production Custom only')
const staging = novotralux({ VERCEL_ENV: 'preview', VERCEL_TARGET_ENV: 'staging', ...all, GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_DOMAIN: 'novotralux-staging.example.com' })
assert.equal(staging?.configurationEndpoint, STAGING, 'Staging → Staging Custom')
assert.equal(staging?.environment, 'staging', 'Staging instance labelled Staging')
assert.equal(staging?.adminUrl, 'https://novotralux-staging.example.com/admin/organization', 'Staging links to Staging Custom')
assert.equal(novotralux({ VERCEL_ENV: 'preview', ...all })?.configurationEndpoint, PREVIEW, 'Preview → Preview Custom')
assert.equal(novotralux({ VERCEL_ENV: 'preview', VERCEL_TARGET_ENV: 'staging', GERARD_PLATFORM_INSTANCE_NOVOTRALUX_PREVIEW_CONFIGURATION_ENDPOINT: PREVIEW })?.configurationEndpoint, undefined, 'Staging never falls back to Preview')
assert.equal(novotralux({ VERCEL_ENV: 'preview', VERCEL_TARGET_ENV: 'staging', GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_CONFIGURATION_ENDPOINT: PRODUCTION })?.configurationEndpoint, undefined, 'Staging cannot target Production Custom')
for (const host of ['www.novotralux.eu', 'novotralux.eu', 'NOVOTRALUX-CUSTOM.vercel.app']) assert.equal(novotralux({ GERARD_INSTANCE_ENVIRONMENT: 'staging', GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_CONFIGURATION_ENDPOINT: `https://${host}/api/internal/platform/configuration` })?.configurationEndpoint, undefined, `Staging cannot target Production host ${host}`)
assert.equal(novotralux({ GERARD_INSTANCE_ENVIRONMENT: 'staging', GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_CONFIGURATION_ENDPOINT: 'http://novotralux-staging.example.com/api/internal/platform/configuration' })?.configurationEndpoint, undefined, 'Staging requires HTTPS')
assert.equal(novotralux({})?.configurationEndpoint, undefined, 'local development no longer defaults to Production Custom')
assert.equal(novotralux({ GERARD_PLATFORM_INSTANCE_NOVOTRALUX_DEVELOPMENT_CONFIGURATION_ENDPOINT: 'http://localhost:3200/api/internal/platform/configuration' })?.configurationEndpoint, 'http://localhost:3200/api/internal/platform/configuration', 'explicit local endpoint')
assert.throws(() => novotralux({ VERCEL_ENV: 'production', GERARD_INSTANCE_ENVIRONMENT: 'staging', ...all }), /DEPLOYMENT_ENVIRONMENT_CONFLICT/, 'ambiguous runtime fails closed')
for (const [key, value] of Object.entries(saved)) if (value !== undefined) process.env[key] = value

// ─── Databases: each environment reads its own, never another's ─────────────────────────────────────────
const urls = { production: 'postgresql://u:p@ep-ancient-surf-zav7xo37.eu.aws.neon.tech/neondb', preview: 'postgresql://u:p@ep-mute-poetry-za1swvwu.eu.aws.neon.tech/neondb', staging: 'postgresql://u:p@ep-staging-example.eu.aws.neon.tech/neondb' }
const custom = { NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL: urls.production, NOVOTRALUX_CUSTOM_PREVIEW_DATABASE_URL: urls.preview, NOVOTRALUX_CUSTOM_STAGING_DATABASE_URL: urls.staging }
assert.deepEqual(resolveNovotraluxDatabaseTarget({ VERCEL_ENV: 'preview', VERCEL_TARGET_ENV: 'staging', ...custom }), { target: urls.staging, instanceEnvironment: 'staging' }, 'Staging Custom → Staging DB')
assert.deepEqual(resolveNovotraluxDatabaseTarget({ VERCEL_ENV: 'production', ...custom }), { target: urls.production, instanceEnvironment: 'production' }, 'Production Custom → Production DB')
assert.throws(() => resolveNovotraluxDatabaseTarget({ VERCEL_ENV: 'preview', VERCEL_TARGET_ENV: 'staging', NOVOTRALUX_CUSTOM_PREVIEW_DATABASE_URL: urls.preview }), /NOVOTRALUX_STAGING_DATABASE_URL_REQUIRED/, 'Staging never falls back to Preview DB')
assert.throws(() => resolveNovotraluxDatabaseTarget({ GERARD_INSTANCE_ENVIRONMENT: 'staging', ...custom, NOVOTRALUX_CUSTOM_STAGING_DATABASE_URL: urls.production }), /MUST_DIFFER_FROM_PRODUCTION/, 'Staging DB ≠ Production DB')
assert.throws(() => resolveNovotraluxDatabaseTarget({ GERARD_INSTANCE_ENVIRONMENT: 'staging', ...custom, NOVOTRALUX_CUSTOM_STAGING_DATABASE_URL: urls.preview }), /MUST_DIFFER_FROM_PREVIEW/, 'Staging DB ≠ Preview DB')
assert.throws(() => resolveNovotraluxDatabaseTarget({ GERARD_INSTANCE_ENVIRONMENT: 'staging', NOVOTRALUX_CUSTOM_STAGING_DATABASE_URL: urls.production }), /DATABASE_ENVIRONMENT_MISMATCH/, 'Production endpoint refused even under a Staging name')
assert.throws(() => resolveNovotraluxDatabaseTarget({ VERCEL_ENV: 'production', NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL: urls.preview }), /DATABASE_ENVIRONMENT_MISMATCH/, 'Production cannot use a non-production DB')
assert.throws(() => assertRuntimeDatabase(urls.production, { GERARD_INSTANCE_ENVIRONMENT: 'staging' } as never), /DATABASE_ENVIRONMENT_MISMATCH/, 'runtime: Staging cannot open Production DB')
assert.throws(() => assertRuntimeDatabase(urls.preview, { VERCEL_ENV: 'production' } as never), /DATABASE_ENVIRONMENT_MISMATCH/, 'runtime: Production cannot open Preview DB')
assert.throws(() => assertRuntimeDatabase(urls.production, {} as never), /DATABASE_ENVIRONMENT_MISMATCH/, 'runtime: undeclared local run cannot open Production DB')
assert.doesNotThrow(() => assertRuntimeDatabase(urls.production, { VERCEL_ENV: 'production' } as never), 'runtime: Production opens Production DB')
assert.doesNotThrow(() => assertRuntimeDatabase(urls.staging, { GERARD_INSTANCE_ENVIRONMENT: 'staging' } as never), 'runtime: Staging opens Staging DB')
// Production is an allow-list: a new Staging branch is refused there without any code change; pooled hosts are the same identity.
assert.throws(() => assertRuntimeDatabase(urls.staging, { VERCEL_ENV: 'production' } as never), /DATABASE_ENVIRONMENT_MISMATCH/, 'runtime: Production refuses an unlisted (Staging) endpoint')
assert.throws(() => assertRuntimeDatabase('postgresql://u:p@ep-ancient-surf-zav7xo37x.eu.aws.neon.tech/neondb', { VERCEL_ENV: 'production' } as never), /DATABASE_ENVIRONMENT_MISMATCH/, 'runtime: Production refuses a look-alike endpoint')
assert.doesNotThrow(() => assertRuntimeDatabase('postgresql://u:p@ep-ancient-block-za26cw6e-pooler.c-2.eu-central-1.aws.neon.tech/neondb', { VERCEL_ENV: 'production' } as never), 'runtime: pooled Production host')
assert.throws(() => assertRuntimeDatabase('postgresql://u:p@ep-ancient-block-za26cw6e-pooler.c-2.eu-central-1.aws.neon.tech/neondb', { GERARD_INSTANCE_ENVIRONMENT: 'staging' } as never), /DATABASE_ENVIRONMENT_MISMATCH/, 'runtime: Staging refuses the pooled Production host')
assert.throws(() => assertRuntimeDatabase('not a url', { GERARD_INSTANCE_ENVIRONMENT: 'staging' } as never), /DATABASE_URL_INVALID/, 'runtime: invalid URL fails closed')

// ─── Staging preparation: inert elsewhere, refuses foreign databases ────────────────────────────────────
const prepare = (env: Record<string, string>) => {
  try { return execFileSync('npx', ['tsx', 'scripts/staging-prepare.ts'], { env: { PATH: process.env.PATH!, HOME: process.env.HOME!, ...env } as unknown as NodeJS.ProcessEnv, encoding: 'utf8', stdio: 'pipe' }) } catch (error: any) { return `${error.stdout}${error.stderr}` }
}
assert.match(prepare({ VERCEL_ENV: 'production', DATABASE_URL: urls.production }), /skipped \(production\)/, 'prepare is a no-op in Production')
assert.match(prepare({ VERCEL_ENV: 'production', DATABASE_URL: urls.staging }), /DATABASE_ENVIRONMENT_MISMATCH/, 'Production build fails on a non-Production database')
assert.match(prepare({ VERCEL_ENV: 'production' }), /PRODUCTION_DATABASE_URL_REQUIRED/, 'Production build fails without a database')
assert.match(prepare({ VERCEL_ENV: 'preview', DATABASE_URL: urls.preview }), /skipped \(preview\)/, 'prepare is a no-op in Preview')
assert.match(prepare({ GERARD_INSTANCE_ENVIRONMENT: 'staging', DATABASE_URL: urls.production }), /DATABASE_ENVIRONMENT_MISMATCH/, 'prepare refuses Production DB')
assert.match(prepare({ GERARD_INSTANCE_ENVIRONMENT: 'staging', DATABASE_URL: urls.preview }), /DATABASE_ENVIRONMENT_MISMATCH/, 'prepare refuses Preview DB')
console.log('Deployment environments (Production / Staging / Preview / development), routing and database isolation: OK')
