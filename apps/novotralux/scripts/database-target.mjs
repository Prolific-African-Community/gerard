// Mirror of resolveDeploymentEnvironment (packages/gerard-core/src/deployment-environment.ts): this wrapper runs under
// plain Node before any TypeScript is compiled. Parity is asserted in tests/deployment-environment.test.ts.
const ENVIRONMENTS = ['production', 'staging', 'preview', 'development']

export function resolveDeploymentEnvironment(env) {
  const declared = env.GERARD_INSTANCE_ENVIRONMENT?.trim().toLowerCase() || undefined
  if (declared && !ENVIRONMENTS.includes(declared)) throw new Error('DEPLOYMENT_ENVIRONMENT_UNKNOWN')
  const vercel = env.VERCEL_ENV?.trim().toLowerCase() || undefined
  const target = env.VERCEL_TARGET_ENV?.trim().toLowerCase() || undefined
  if (vercel === 'production') {
    if (declared && declared !== 'production') throw new Error('DEPLOYMENT_ENVIRONMENT_CONFLICT')
    return 'production'
  }
  if (vercel === 'preview' || vercel === 'staging') {
    if (declared === 'production' || declared === 'development') throw new Error('DEPLOYMENT_ENVIRONMENT_CONFLICT')
    const staging = declared === 'staging' || target === 'staging' || vercel === 'staging'
    if (staging && declared === 'preview') throw new Error('DEPLOYMENT_ENVIRONMENT_CONFLICT')
    return staging ? 'staging' : 'preview'
  }
  if (vercel && vercel !== 'development') throw new Error('DEPLOYMENT_ENVIRONMENT_UNKNOWN')
  return declared ?? 'development'
}

// Documented Neon endpoints (docs/ENVIRONMENT_ARCHITECTURE.md). Production endpoints are refused outside Production and
// non-production endpoints are refused in Production, whatever the variable names say.
// Staging must also stay off the Preview branch. Add the Staging endpoints to NON_PRODUCTION once created.
export const PRODUCTION_DATABASE_ENDPOINTS = ['ep-ancient-surf-zav7xo37', 'ep-ancient-block-za26cw6e']
export const PREVIEW_DATABASE_ENDPOINTS = ['ep-mute-poetry-za1swvwu']
export const NON_PRODUCTION_DATABASE_ENDPOINTS = [...PREVIEW_DATABASE_ENDPOINTS]

function endpointOf(url) {
  try { return new URL(url).hostname } catch { throw new Error('DATABASE_URL_INVALID') }
}

export function assertDatabaseForEnvironment(environment, url) {
  const host = endpointOf(url)
  if (environment !== 'production' && PRODUCTION_DATABASE_ENDPOINTS.some((endpoint) => host.includes(endpoint))) throw new Error('DATABASE_ENVIRONMENT_MISMATCH')
  if (environment === 'production' && NON_PRODUCTION_DATABASE_ENDPOINTS.some((endpoint) => host.includes(endpoint))) throw new Error('DATABASE_ENVIRONMENT_MISMATCH')
  if (environment === 'staging' && PREVIEW_DATABASE_ENDPOINTS.some((endpoint) => host.includes(endpoint))) throw new Error('DATABASE_ENVIRONMENT_MISMATCH')
}

const VARIABLE = { production: 'NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL', staging: 'NOVOTRALUX_CUSTOM_STAGING_DATABASE_URL', preview: 'NOVOTRALUX_CUSTOM_PREVIEW_DATABASE_URL' }
const LABEL = { production: 'PRODUCTION', staging: 'STAGING', preview: 'PREVIEW' }

export function resolveNovotraluxDatabaseTarget(env) {
  const environment = resolveDeploymentEnvironment(env)
  const production = env.NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL
  if (environment === 'development') {
    const target = env.DATABASE_URL || env.NOVOTRALUX_CUSTOM_PREVIEW_DATABASE_URL
    if (!target) throw new Error('NOVOTRALUX_LOCAL_DATABASE_URL_REQUIRED')
    if (production && target === production) throw new Error('NOVOTRALUX_LOCAL_DATABASE_MUST_DIFFER_FROM_PRODUCTION')
    assertDatabaseForEnvironment(environment, target)
    return { target, instanceEnvironment: 'development' }
  }
  // Each environment reads only its own variable: no fallback between Production, Staging and Preview.
  const target = env[VARIABLE[environment]]
  if (!target) throw new Error(`NOVOTRALUX_${LABEL[environment]}_DATABASE_URL_REQUIRED`)
  for (const other of Object.keys(VARIABLE).filter((name) => name !== environment)) {
    if (env[VARIABLE[other]] && env[VARIABLE[other]] === target) throw new Error(`NOVOTRALUX_${LABEL[environment]}_DATABASE_MUST_DIFFER_FROM_${LABEL[other]}`)
  }
  assertDatabaseForEnvironment(environment, target)
  return { target, instanceEnvironment: environment }
}
