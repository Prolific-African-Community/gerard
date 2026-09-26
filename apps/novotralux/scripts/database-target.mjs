// Mirror of resolveDeploymentEnvironment (packages/gerard-core/src/deployment-environment.ts): this wrapper runs under
// plain Node before any TypeScript is compiled. Parity is asserted in tests/deployment-environment.test.ts.
const ENVIRONMENTS = ['production', 'development']

export function resolveDeploymentEnvironment(env) {
  const declared = env.GERARD_INSTANCE_ENVIRONMENT?.trim().toLowerCase() || undefined
  if (declared && !ENVIRONMENTS.includes(declared)) throw new Error('DEPLOYMENT_ENVIRONMENT_UNKNOWN')
  const vercel = env.VERCEL_ENV?.trim().toLowerCase() || undefined
  if (vercel === 'production') {
    if (declared && declared !== 'production') throw new Error('DEPLOYMENT_ENVIRONMENT_CONFLICT')
    return 'production'
  }
  if (vercel && vercel !== 'development') throw new Error('DEPLOYMENT_ENVIRONMENT_UNKNOWN')
  return declared ?? 'development'
}

// Database identity is the Neon endpoint id (first host label, pooler suffix removed); no environment name is trusted.
// Production is an allow-list: it opens only a documented Production endpoint (docs/ENVIRONMENT_ARCHITECTURE.md).
// Local development refuses those same endpoints: that is the one environment safety rule Gerard keeps. The Production
// build runs the same check (scripts/check-production-database.ts), so a wrong Production variable fails the
// deployment instead of the running site.
export const PRODUCTION_DATABASE_ENDPOINTS = ['ep-ancient-surf-zav7xo37', 'ep-ancient-block-za26cw6e']

export function databaseEndpointId(url) {
  let host
  try { host = new URL(url).hostname.toLowerCase() } catch { throw new Error('DATABASE_URL_INVALID') }
  return host.split('.')[0].replace(/-pooler$/, '')
}

export function isProductionDatabase(url) {
  return PRODUCTION_DATABASE_ENDPOINTS.includes(databaseEndpointId(url))
}

export function assertDatabaseForEnvironment(environment, url) {
  const production = isProductionDatabase(url)
  if (environment === 'production' ? !production : production) throw new Error('DATABASE_ENVIRONMENT_MISMATCH')
}

export function resolveNovotraluxDatabaseTarget(env) {
  const environment = resolveDeploymentEnvironment(env)
  if (environment === 'development') {
    // Local development uses the local DATABASE_URL, and never a Production endpoint.
    const target = env.NOVOTRALUX_CUSTOM_DATABASE_URL || env.DATABASE_URL
    if (!target) throw new Error('NOVOTRALUX_LOCAL_DATABASE_URL_REQUIRED')
    assertDatabaseForEnvironment(environment, target)
    return { target, instanceEnvironment: 'development' }
  }
  const target = env.NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL
  if (!target) throw new Error('NOVOTRALUX_PRODUCTION_DATABASE_URL_REQUIRED')
  assertDatabaseForEnvironment(environment, target)
  return { target, instanceEnvironment: environment }
}
