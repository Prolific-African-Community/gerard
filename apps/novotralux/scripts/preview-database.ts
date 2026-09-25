import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

// Dedicated synthetic Preview branch (docs/ENVIRONMENT_ARCHITECTURE.md). Anything else is refused.
const PREVIEW_ENDPOINT = 'ep-mute-poetry-za1swvwu'
const PRODUCTION_ENDPOINTS = ['ep-ancient-surf-zav7xo37', 'ep-ancient-block-za26cw6e']
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export const PREVIEW_ORGANIZATION_ID = 'org-novotralux'

// Loads the Preview variables pulled with `vercel env pull .env.preview.local --environment=preview`.
function loadPreviewEnv() {
  const file = path.resolve(process.cwd(), '.env.preview.local')
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env.preview.local')
  for (const candidate of [file, root]) if (existsSync(candidate)) { (process as NodeJS.Process & { loadEnvFile(file: string): void }).loadEnvFile(candidate); return }
}

export function connectPreviewDatabase() {
  loadPreviewEnv()
  const url = process.env.NOVOTRALUX_CUSTOM_PREVIEW_DATABASE_URL
  if (!url) throw new Error('NOVOTRALUX_CUSTOM_PREVIEW_DATABASE_URL missing (run: vercel env pull .env.preview.local --environment=preview)')
  if (process.env.NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL && url === process.env.NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL) throw new Error('Refusing: Preview URL equals the Production URL')
  const host = new URL(url).hostname
  if (PRODUCTION_ENDPOINTS.some((endpoint) => host.includes(endpoint))) throw new Error('Refusing: Production database endpoint')
  const local = LOCAL_HOSTS.has(host) && process.env.NOVOTRALUX_PREVIEW_ALLOW_LOCAL_DATABASE === '1'
  if (!host.startsWith(PREVIEW_ENDPOINT) && !local) throw new Error(`Refusing: database endpoint is not the Novotralux Preview branch (${PREVIEW_ENDPOINT})`)
  // The URL itself is never printed; only the endpoint prefix is reported.
  return { prisma: new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }), endpoint: local ? 'local' : PREVIEW_ENDPOINT }
}
