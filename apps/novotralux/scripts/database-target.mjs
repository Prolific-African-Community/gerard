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

// Gerard has two application databases and each Production deployment must resolve to its own. Database identity is the
// Neon endpoint id (first host label, pooler suffix removed); no environment or variable name is trusted.
// Local development works against these same two databases, so nothing is restricted on the development side: the check
// below only constrains what a Production deployment may open. docs/ENVIRONMENT_ARCHITECTURE.md documents both.
export const STANDARD_APPLICATION_ID = 'gerard-standard'
export const PRODUCTION_DATABASE_ENDPOINTS = {
  [STANDARD_APPLICATION_ID]: 'ep-ancient-block-za26cw6e',
  novotralux: 'ep-ancient-surf-zav7xo37',
}

export function databaseEndpointId(url) {
  let host
  try { host = new URL(url).hostname.toLowerCase() } catch { throw new Error('DATABASE_URL_INVALID') }
  return host.split('.')[0].replace(/-pooler$/, '')
}

export function resolveApplicationId(env) {
  return env.GERARD_APPLICATION_ID?.trim() || STANDARD_APPLICATION_ID
}

// A Production deployment opens only the database documented for its application: the Standard project cannot open the
// Custom database, the Custom project cannot open the Standard one, and neither can open an undocumented endpoint.
// The Production build runs this too (scripts/check-production-database.ts), so a wrong Production variable fails the
// deployment instead of the running site.
export function assertProductionDatabase(application, url) {
  const expected = PRODUCTION_DATABASE_ENDPOINTS[application]
  if (!expected) throw new Error(`PRODUCTION_DATABASE_UNDECLARED:${application}`)
  if (databaseEndpointId(url) !== expected) throw new Error('PRODUCTION_DATABASE_MISMATCH')
}

export function resolveNovotraluxDatabaseTarget(env) {
  const environment = resolveDeploymentEnvironment(env)
  if (environment === 'development') {
    // Explicit and application-specific: Novotralux Custom never falls back to the Gerard Standard DATABASE_URL.
    const target = env.NOVOTRALUX_CUSTOM_DATABASE_URL
    if (!target) throw new Error('NOVOTRALUX_CUSTOM_DATABASE_URL_REQUIRED')
    databaseEndpointId(target)
    return { target, instanceEnvironment: 'development' }
  }
  const target = env.NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL
  if (!target) throw new Error('NOVOTRALUX_PRODUCTION_DATABASE_URL_REQUIRED')
  assertProductionDatabase('novotralux', target)
  return { target, instanceEnvironment: environment }
}
