export function resolveNovotraluxDatabaseTarget(env) {
  const vercelEnvironment = env.VERCEL_ENV
  const instanceEnvironment = env.GERARD_INSTANCE_ENVIRONMENT
  const isProduction = vercelEnvironment === 'production' || (!vercelEnvironment && instanceEnvironment === 'production')
  const isPreview = vercelEnvironment === 'preview' || instanceEnvironment === 'preview' || instanceEnvironment === 'staging'

  if (isProduction) {
    const target = env.NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL
    if (!target) throw new Error('NOVOTRALUX_PRODUCTION_DATABASE_URL_REQUIRED')
    return { target, instanceEnvironment: 'production' }
  }

  if (isPreview) {
    const target = env.NOVOTRALUX_CUSTOM_PREVIEW_DATABASE_URL
    if (!target) throw new Error('NOVOTRALUX_PREVIEW_DATABASE_URL_REQUIRED')
    if (env.NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL && target === env.NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL) {
      throw new Error('NOVOTRALUX_PREVIEW_DATABASE_MUST_DIFFER_FROM_PRODUCTION')
    }
    return { target, instanceEnvironment: 'preview' }
  }

  const target = env.DATABASE_URL || env.NOVOTRALUX_CUSTOM_PREVIEW_DATABASE_URL
  if (!target) throw new Error('NOVOTRALUX_LOCAL_DATABASE_URL_REQUIRED')
  if (env.NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL && target === env.NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL) {
    throw new Error('NOVOTRALUX_LOCAL_DATABASE_MUST_DIFFER_FROM_PRODUCTION')
  }
  return { target, instanceEnvironment: instanceEnvironment || 'development' }
}
