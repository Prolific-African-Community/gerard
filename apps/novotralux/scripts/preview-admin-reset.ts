import { randomBytes } from 'node:crypto'
import { OrganizationRole, PlatformAuditAction, UserRole } from '@prisma/client'

import { hashPassword } from '../../../lib/auth/password'
import { PREVIEW_ORGANIZATION_ID, connectPreviewDatabase } from './preview-database'

// Stable synthetic ORG_ADMIN for Preview reviews. Touches this one user (and its membership) only.
const ACCOUNT = { id: 'preview-novotralux-admin', username: 'preview.admin', firstName: 'Aline', lastName: 'Aperçu', email: 'aline.apercu@example.invalid' }

async function main() {
  const { prisma, endpoint } = connectPreviewDatabase()
  try {
    const organization = await prisma.organization.findUnique({ where: { id: PREVIEW_ORGANIZATION_ID }, select: { id: true, status: true } })
    if (!organization) throw new Error(`${PREVIEW_ORGANIZATION_ID} not found in the Preview database`)
    const password = `Pv-${randomBytes(18).toString('base64url')}`
    const user = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findFirst({ where: { username: ACCOUNT.username }, select: { id: true } })
      const data = { passwordHash: hashPassword(password), isActive: true, mustChangePassword: false, platformRole: null, sessionVersion: { increment: 1 } }
      const saved = existing
        ? await tx.user.update({ where: { id: existing.id }, data, select: { id: true } })
        : await tx.user.create({ data: { id: ACCOUNT.id, username: ACCOUNT.username, firstName: ACCOUNT.firstName, lastName: ACCOUNT.lastName, name: `${ACCOUNT.firstName} ${ACCOUNT.lastName}`, email: ACCOUNT.email, role: UserRole.ADMIN, passwordHash: data.passwordHash, isActive: true, mustChangePassword: false }, select: { id: true } })
      await tx.organizationUser.upsert({
        where: { organizationId_userId: { organizationId: PREVIEW_ORGANIZATION_ID, userId: saved.id } },
        update: { role: OrganizationRole.ORG_ADMIN },
        create: { organizationId: PREVIEW_ORGANIZATION_ID, userId: saved.id, role: OrganizationRole.ORG_ADMIN },
      })
      await tx.platformAuditLog.create({ data: { actorUserId: saved.id, organizationId: PREVIEW_ORGANIZATION_ID, action: PlatformAuditAction.PASSWORD_RESET, metadata: { userId: saved.id, source: 'PREVIEW_QA_RESET' } } })
      return saved
    })
    console.log(JSON.stringify({ database: endpoint, organization: organization.id, organizationStatus: organization.status, user: ACCOUNT.username, userId: user.id, role: 'ORG_ADMIN' }))
    // Printed once for the reviewer; only the hash is stored.
    console.log(`Temporary password (shown once): ${password}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'PREVIEW_ADMIN_RESET_FAILED'); process.exitCode = 1 })
