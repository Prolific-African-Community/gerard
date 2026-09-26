// Mirror of resolveDeploymentEnvironment (packages/gerard-core/src/deployment-environment.ts): this wrapper runs under
// plain Node before any TypeScript is compiled. Parity is asserted in tests/deployment-environment.test.ts.
const ENVIRONMENTS = ['production', 'staging', 'preview', 'development']

export function resolveDeploymentEnvironment(env) {
  const declared = env.GERARD_INSTANCE_ENVIRONMENT?.trim().toLowerCase() || undefined
  if (declared && !ENVIRONMENTS.includes(declared)) throw new Error('DEPLOYMENT_ENVIRONMENT_UNKNOWN')
  const vercel = env.VERCEL_ENV?.trim().toLowerCase() || undefined
  const target = env.VERCEL_TARGET_ENV?.trim().toLowerCase() || undefined
  if (vercel === 'production') {
    if (declared === 'staging') return 'staging'
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

// Database identity is the Neon endpoint id (first host label, pooler suffix removed); no environment name is trusted.
// Production is an allow-list: it opens only a documented Production endpoint (docs/ENVIRONMENT_ARCHITECTURE.md), so any
// new Staging or Preview branch is refused there without editing this file. Every other environment refuses the
// Production endpoints, and Staging also stays off the Preview branch. The Production build runs the same check
// (scripts/staging-prepare.ts), so a wrong Production variable fails the deployment instead of the running site.
export const PRODUCTION_DATABASE_ENDPOINTS = ['ep-ancient-surf-zav7xo37', 'ep-ancient-block-za26cw6e']
export const PREVIEW_DATABASE_ENDPOINTS = ['ep-mute-poetry-za1swvwu']

export function databaseEndpointId(url) {
  let host
  try { host = new URL(url).hostname.toLowerCase() } catch { throw new Error('DATABASE_URL_INVALID') }
  return host.split('.')[0].replace(/-pooler$/, '')
}

export function isProductionDatabase(url) {
  return PRODUCTION_DATABASE_ENDPOINTS.includes(databaseEndpointId(url))
}

export function assertDatabaseForEnvironment(environment, url) {
  const endpoint = databaseEndpointId(url)
  const production = PRODUCTION_DATABASE_ENDPOINTS.includes(endpoint)
  if (environment === 'production' ? !production : production) throw new Error('DATABASE_ENVIRONMENT_MISMATCH')
  if (environment === 'staging' && PREVIEW_DATABASE_ENDPOINTS.includes(endpoint)) throw new Error('DATABASE_ENVIRONMENT_MISMATCH')
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
