import { OrganizationRole, PlatformAuditAction } from '@prisma/client'
import type { PlatformOrgAdminSnapshot, PlatformRecoveryAction } from '@prolific/gerard-core'

import { hashPassword } from '../auth/password'
import { prisma } from '../prisma'
import { generateTemporaryPassword } from './admin'

// Platform recovery of an organization's ORG_ADMIN accounts. Used locally by Standard and, behind the signed
// Platform-to-Custom channel, by each Custom instance on its own database. It never manages other members.

const auditAction: Record<PlatformRecoveryAction, PlatformAuditAction> = {
  resetOrgAdminPassword: PlatformAuditAction.PASSWORD_RESET,
  invalidateOrgAdminSessions: PlatformAuditAction.SESSION_INVALIDATED,
  reactivateOrgAdmin: PlatformAuditAction.MEMBER_STATUS_CHANGED,
}

export async function listOrganizationAdmins(organizationId: string): Promise<PlatformOrgAdminSnapshot[]> {
  const memberships = await prisma.organizationUser.findMany({
    where: { organizationId, role: OrganizationRole.ORG_ADMIN },
    orderBy: { createdAt: 'asc' },
    select: { user: { select: { id: true, firstName: true, lastName: true, username: true, email: true, isActive: true, mustChangePassword: true, lastLoginAt: true, platformRole: true, _count: { select: { organizationMemberships: true } } } } },
  })
  return memberships.map(({ user }) => ({
    userId: user.id, firstName: user.firstName, lastName: user.lastName, username: user.username, email: user.email,
    role: 'ORG_ADMIN', isActive: user.isActive, mustChangePassword: user.mustChangePassword, lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    protection: user.platformRole ? 'PLATFORM_ACCOUNT' : user._count.organizationMemberships > 1 ? 'SHARED_ACCOUNT' : null,
  }))
}

// `auditActorUserId` must exist in this database: the SUPER_ADMIN on Standard, the target itself on a Custom instance
// (the platform actor is recorded as `platformActorId`).
export async function recoverOrganizationAdmin(input: { organizationId: string; userId: string; action: PlatformRecoveryAction; platformActorId: string; auditActorUserId: string }) {
  const temporaryPassword = input.action === 'resetOrgAdminPassword' ? generateTemporaryPassword() : null
  await prisma.$transaction(async (tx) => {
    const membership = await tx.organizationUser.findFirst({
      where: { organizationId: input.organizationId, userId: input.userId, role: OrganizationRole.ORG_ADMIN },
      select: { user: { select: { id: true, platformRole: true, passwordHash: true, _count: { select: { organizationMemberships: true } } } } },
    })
    if (!membership) throw new Error('ORG_ADMIN_NOT_FOUND')
    // Account-wide changes on platform or multi-organization accounts would reach beyond this organization: fail closed.
    if (membership.user.platformRole) throw new Error('PLATFORM_ACCOUNT_PROTECTED')
    if (membership.user._count.organizationMemberships > 1) throw new Error('SHARED_ACCOUNT_PROTECTED')
    if (input.action === 'resetOrgAdminPassword') {
      if (!membership.user.passwordHash) throw new Error('PASSWORD_AUTH_UNAVAILABLE')
      await tx.user.update({ where: { id: input.userId }, data: { passwordHash: hashPassword(temporaryPassword!), mustChangePassword: true, temporaryPasswordIssuedAt: new Date(), sessionVersion: { increment: 1 } } })
    } else if (input.action === 'invalidateOrgAdminSessions') {
      await tx.user.update({ where: { id: input.userId }, data: { sessionVersion: { increment: 1 } } })
    } else {
      await tx.user.update({ where: { id: input.userId }, data: { isActive: true } })
    }
    await tx.platformAuditLog.create({ data: {
      actorUserId: input.auditActorUserId, organizationId: input.organizationId, action: auditAction[input.action],
      metadata: { userId: input.userId, source: 'PLATFORM_RECOVERY', recoveryAction: input.action, platformActorId: input.platformActorId, ...(input.action === 'reactivateOrgAdmin' ? { isActive: true } : {}) },
    } })
  })
  return temporaryPassword ? { temporaryPassword } : {}
}

export const recoveryErrorStatus: Record<string, number> = { ORG_ADMIN_NOT_FOUND: 404, PLATFORM_ACCOUNT_PROTECTED: 403, SHARED_ACCOUNT_PROTECTED: 403, PASSWORD_AUTH_UNAVAILABLE: 409 }
