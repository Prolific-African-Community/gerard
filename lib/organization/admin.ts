import { randomBytes } from 'node:crypto'
import { OrganizationRole, PlatformAuditAction, Prisma } from '@prisma/client'

import { hashPassword } from '../auth/password'
import { prisma } from '../prisma'

export const organizationAdminRoles = Object.values(OrganizationRole)

export async function getOrganizationAdminWorkspace(organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true, name: true, status: true, displayName: true, logoUrl: true,
      users: {
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true, role: true, createdAt: true,
          user: { select: { id: true, firstName: true, lastName: true, username: true, email: true, isActive: true, mustChangePassword: true, lastLoginAt: true, createdAt: true, sessionVersion: true } },
        },
      },
      platformAuditLogs: {
        orderBy: { createdAt: 'desc' }, take: 100,
        select: { id: true, action: true, metadata: true, createdAt: true, actor: { select: { id: true, firstName: true, lastName: true, username: true } } },
      },
    },
  })
  if (!organization) return null
  return organization
}

export function generateTemporaryPassword() {
  return `G!${randomBytes(18).toString('base64url')}9a`
}

async function getMutableMembership(tx: Prisma.TransactionClient, organizationId: string, membershipId: string) {
  const membership = await tx.organizationUser.findFirstOrThrow({
    where: { id: membershipId, organizationId },
    include: { user: { select: { id: true, platformRole: true, isActive: true, passwordHash: true, _count: { select: { organizationMemberships: true } } } } },
  })
  if (membership.user.platformRole) throw new Error('PLATFORM_ACCOUNT_PROTECTED')
  if (membership.user._count.organizationMemberships > 1) throw new Error('SHARED_ACCOUNT_PROTECTED')
  return membership
}

export async function updateOrganizationMemberIdentity(input: {
  actorUserId: string
  organizationId: string
  membershipId: string
  firstName: string
  lastName: string
  username: string
  email: string | null
}) {
  return prisma.$transaction(async (tx) => {
    const membership = await getMutableMembership(tx, input.organizationId, input.membershipId)
    const user = await tx.user.update({
      where: { id: membership.userId },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        name: `${input.firstName} ${input.lastName}`.trim(),
        username: input.username,
        email: input.email,
      },
      select: { id: true, firstName: true, lastName: true, username: true, email: true },
    })
    await tx.platformAuditLog.create({
      data: {
        actorUserId: input.actorUserId,
        organizationId: input.organizationId,
        action: PlatformAuditAction.ORGANIZATION_UPDATED,
        metadata: { kind: 'USER_IDENTITY_UPDATED', userId: user.id, fields: ['firstName', 'lastName', 'username', 'email'] },
      },
    })
    return user
  })
}

// ORG_ADMIN role change: same protection as the other member operations (platform and multi-organization accounts are
// administered by the platform), plus the final active ORG_ADMIN rule.
export async function changeOrganizationMemberRole(input: { actorUserId: string; organizationId: string; membershipId: string; role: OrganizationRole }) {
  return prisma.$transaction(async (tx) => {
    const membership = await getMutableMembership(tx, input.organizationId, input.membershipId)
    if (membership.role === input.role) return membership
    if (membership.role === OrganizationRole.ORG_ADMIN && membership.user.isActive) {
      const activeAdmins = await tx.organizationUser.count({ where: { organizationId: input.organizationId, role: OrganizationRole.ORG_ADMIN, user: { isActive: true } } })
      if (activeAdmins <= 1) throw new Error('LAST_ORG_ADMIN')
    }
    const updated = await tx.organizationUser.update({ where: { id: membership.id }, data: { role: input.role } })
    await tx.platformAuditLog.create({ data: { actorUserId: input.actorUserId, organizationId: input.organizationId, action: PlatformAuditAction.MEMBER_ROLE_CHANGED, metadata: { userId: membership.userId, before: membership.role, after: input.role } } })
    return updated
  })
}

export async function setOrganizationMemberActive(input: { actorUserId: string; organizationId: string; membershipId: string; isActive: boolean }) {
  return prisma.$transaction(async (tx) => {
    const membership = await getMutableMembership(tx, input.organizationId, input.membershipId)
    if (!input.isActive && membership.role === OrganizationRole.ORG_ADMIN) {
      const activeAdmins = await tx.organizationUser.count({ where: { organizationId: input.organizationId, role: OrganizationRole.ORG_ADMIN, user: { isActive: true } } })
      if (activeAdmins <= 1) throw new Error('LAST_ORG_ADMIN')
    }
    const user = await tx.user.update({ where: { id: membership.userId }, data: { isActive: input.isActive, sessionVersion: { increment: 1 } }, select: { id: true, isActive: true, sessionVersion: true } })
    await tx.platformAuditLog.create({ data: { actorUserId: input.actorUserId, organizationId: input.organizationId, action: PlatformAuditAction.MEMBER_STATUS_CHANGED, metadata: { userId: user.id, isActive: user.isActive } } })
    return user
  })
}

export async function resetOrganizationMemberPassword(input: { actorUserId: string; organizationId: string; membershipId: string }) {
  const temporaryPassword = generateTemporaryPassword()
  const user = await prisma.$transaction(async (tx) => {
    const membership = await getMutableMembership(tx, input.organizationId, input.membershipId)
    if (!membership.user.passwordHash) throw new Error('PASSWORD_AUTH_UNAVAILABLE')
    const updated = await tx.user.update({ where: { id: membership.userId }, data: { passwordHash: hashPassword(temporaryPassword), mustChangePassword: true, temporaryPasswordIssuedAt: new Date(), sessionVersion: { increment: 1 } }, select: { id: true, mustChangePassword: true, sessionVersion: true } })
    await tx.platformAuditLog.create({ data: { actorUserId: input.actorUserId, organizationId: input.organizationId, action: PlatformAuditAction.PASSWORD_RESET, metadata: { userId: updated.id } } })
    return updated
  })
  return { user, temporaryPassword }
}

export async function invalidateOrganizationMemberSessions(input: { actorUserId: string; organizationId: string; membershipId: string }) {
  return prisma.$transaction(async (tx) => {
    const membership = await getMutableMembership(tx, input.organizationId, input.membershipId)
    const user = await tx.user.update({ where: { id: membership.userId }, data: { sessionVersion: { increment: 1 } }, select: { id: true, sessionVersion: true } })
    await tx.platformAuditLog.create({ data: { actorUserId: input.actorUserId, organizationId: input.organizationId, action: PlatformAuditAction.SESSION_INVALIDATED, metadata: { userId: user.id } } })
    return user
  })
}
