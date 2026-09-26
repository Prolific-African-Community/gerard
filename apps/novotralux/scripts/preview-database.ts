import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

import { assertPreviewDatabaseUrl } from '../preview-admin'

export { PREVIEW_ORGANIZATION_ID } from '../preview-admin'

// Loads the Preview variables pulled with `vercel env pull .env.preview.local --environment=preview`.
function loadPreviewEnv() {
  const file = path.resolve(process.cwd(), '.env.preview.local')
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env.preview.local')
  for (const candidate of [file, root]) if (existsSync(candidate)) { (process as NodeJS.Process & { loadEnvFile(file: string): void }).loadEnvFile(candidate); return }
}

export function connectPreviewDatabase() {
  loadPreviewEnv()
  const url = process.env.NOVOTRALUX_CUSTOM_PREVIEW_DATABASE_URL
  if (url === '[SENSITIVE]' || url === '') throw new Error('Preview database URL is a Vercel sensitive variable and cannot be pulled locally: use the in-Vercel reset (docs/CUSTOM_PREVIEW_WORKFLOW.md)')
  // The URL itself is never printed; only the endpoint prefix is reported.
  const endpoint = assertPreviewDatabaseUrl(url, { allowLocal: process.env.NOVOTRALUX_PREVIEW_ALLOW_LOCAL_DATABASE === '1', productionUrl: process.env.NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL })
  return { prisma: new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) }), endpoint }
}
