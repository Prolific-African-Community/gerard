// Dedicated synthetic Preview branch (docs/ENVIRONMENT_ARCHITECTURE.md). Anything else is refused.
export const PREVIEW_ENDPOINT = 'ep-mute-poetry-za1swvwu'
const PRODUCTION_ENDPOINTS = ['ep-ancient-surf-zav7xo37', 'ep-ancient-block-za26cw6e']
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
export const PREVIEW_ORGANIZATION_ID = 'org-novotralux'

// Throws unless the URL targets the Novotralux Preview branch (or an explicitly allowed local database for tests).
export function assertPreviewDatabaseUrl(url: string | undefined, options: { allowLocal?: boolean; productionUrl?: string } = {}) {
  if (!url) throw new Error('PREVIEW_DATABASE_URL_MISSING')
  if (options.productionUrl && url === options.productionUrl) throw new Error('PREVIEW_DATABASE_IS_PRODUCTION')
  let host: string
  try { host = new URL(url).hostname } catch { throw new Error('PREVIEW_DATABASE_URL_INVALID') }
  if (PRODUCTION_ENDPOINTS.some((endpoint) => host.includes(endpoint))) throw new Error('PREVIEW_DATABASE_IS_PRODUCTION')
  if (host.startsWith(PREVIEW_ENDPOINT)) return PREVIEW_ENDPOINT
  if (options.allowLocal && LOCAL_HOSTS.has(host)) return 'local'
  throw new Error('PREVIEW_DATABASE_NOT_PREVIEW_BRANCH')
}
