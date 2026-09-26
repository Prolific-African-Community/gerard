import { randomBytes } from 'node:crypto'
import { OrganizationRole, PlatformAuditAction, UserRole, type PrismaClient } from '@prisma/client'

import { hashPassword } from '../../lib/auth/password'

// Dedicated synthetic Preview branch (docs/ENVIRONMENT_ARCHITECTURE.md). Anything else is refused.
export const PREVIEW_ENDPOINT = 'ep-mute-poetry-za1swvwu'
const PRODUCTION_ENDPOINTS = ['ep-ancient-surf-zav7xo37', 'ep-ancient-block-za26cw6e']
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
export const PREVIEW_ORGANIZATION_ID = 'org-novotralux'
const ACCOUNT = { id: 'preview-novotralux-admin', username: 'preview.admin', firstName: 'Aline', lastName: 'Aperçu', email: 'aline.apercu@example.invalid' }

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

// Creates or resets the stable synthetic ORG_ADMIN. Touches this one user and its org-novotralux membership only.
export async function resetPreviewAdmin(prisma: PrismaClient, audit: Record<string, string>) {
  const organization = await prisma.organization.findUnique({ where: { id: PREVIEW_ORGANIZATION_ID }, select: { id: true } })
  if (!organization) throw new Error('PREVIEW_ORGANIZATION_NOT_FOUND')
  const password = `Pv-${randomBytes(18).toString('base64url')}`
  const passwordHash = hashPassword(password)
  const userId = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findFirst({ where: { username: ACCOUNT.username }, select: { id: true } })
    const saved = existing
      ? await tx.user.update({ where: { id: existing.id }, data: { passwordHash, isActive: true, mustChangePassword: false, platformRole: null, sessionVersion: { increment: 1 } }, select: { id: true } })
      : await tx.user.create({ data: { id: ACCOUNT.id, username: ACCOUNT.username, firstName: ACCOUNT.firstName, lastName: ACCOUNT.lastName, name: `${ACCOUNT.firstName} ${ACCOUNT.lastName}`, email: ACCOUNT.email, role: UserRole.ADMIN, passwordHash, isActive: true, mustChangePassword: false }, select: { id: true } })
    await tx.organizationUser.upsert({
      where: { organizationId_userId: { organizationId: PREVIEW_ORGANIZATION_ID, userId: saved.id } },
      update: { role: OrganizationRole.ORG_ADMIN },
      create: { organizationId: PREVIEW_ORGANIZATION_ID, userId: saved.id, role: OrganizationRole.ORG_ADMIN },
    })
    await tx.platformAuditLog.create({ data: { actorUserId: saved.id, organizationId: PREVIEW_ORGANIZATION_ID, action: PlatformAuditAction.PASSWORD_RESET, metadata: { userId: saved.id, ...audit } } })
    return saved.id
  })
  return { username: ACCOUNT.username, userId, password }
}
