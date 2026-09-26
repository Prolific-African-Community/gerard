import { createHash, timingSafeEqual } from 'node:crypto'
import type { NextApiRequest, NextApiResponse } from 'next'

import { PREVIEW_ORGANIZATION_ID, assertPreviewDatabaseUrl, resetPreviewAdmin } from '../../../../apps/novotralux/preview-admin'
import { prisma } from '../../../../lib/prisma'

// TEMPORARY, single-use: resets the synthetic Preview ORG_ADMIN from inside Vercel, where the Preview database URL is
// available but cannot be pulled locally. Remove once used (docs/CUSTOM_PREVIEW_WORKFLOW.md).
// Disabled until the reviewer supplies the SHA-256 of a token they generated themselves (never the token).
const TOKEN_SHA256 = ''

function isNovotraluxPreview() {
  const application = process.env.GERARD_APPLICATION_ID || process.env.NEXT_PUBLIC_GERARD_APPLICATION
  if (application !== 'novotralux') return false
  if (process.env.VERCEL_ENV === 'production' || process.env.GERARD_INSTANCE_ENVIRONMENT === 'production') return false
  return process.env.VERCEL_ENV === 'preview' || process.env.GERARD_INSTANCE_ENVIRONMENT === 'preview'
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Every refusal before authentication looks the same, so the route reveals nothing outside Preview.
  const notFound = () => res.status(404).json({ error: 'Not found' })
  if (!/^[0-9a-f]{64}$/.test(TOKEN_SHA256) || req.method !== 'POST' || !isNovotraluxPreview()) return notFound()
  try {
    assertPreviewDatabaseUrl(process.env.DATABASE_URL, { allowLocal: process.env.NOVOTRALUX_PREVIEW_ALLOW_LOCAL_DATABASE === '1', productionUrl: process.env.NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL })
  } catch { return notFound() }
  if (process.env.NOVOTRALUX_CUSTOM_PREVIEW_DATABASE_URL && process.env.NOVOTRALUX_CUSTOM_PREVIEW_DATABASE_URL !== process.env.DATABASE_URL) return notFound()
  const header = req.headers.authorization || ''
  const provided = createHash('sha256').update(header.startsWith('Bearer ') ? header.slice(7) : '').digest()
  if (!timingSafeEqual(new Uint8Array(provided), new Uint8Array(Buffer.from(TOKEN_SHA256, 'hex')))) return notFound()
  const used = await prisma.platformAuditLog.findFirst({ where: { organizationId: PREVIEW_ORGANIZATION_ID, metadata: { path: ['resetToken'], equals: TOKEN_SHA256 } }, select: { id: true } })
  if (used) return res.status(410).json({ error: 'Reset token already used' })
  const result = await resetPreviewAdmin(prisma as never, { source: 'PREVIEW_QA_RESET_ROUTE', resetToken: TOKEN_SHA256 })
  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json({ username: result.username, password: result.password, organization: PREVIEW_ORGANIZATION_ID })
}
