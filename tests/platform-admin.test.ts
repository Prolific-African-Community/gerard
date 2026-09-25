import assert from 'node:assert/strict'
import { OrganizationIntegrationType, OrganizationRole, PlatformAuditAction, UserRole } from '@prisma/client'

import { createSessionToken, sessionCookieName } from '../lib/auth/session'
import { requirePermission } from '../lib/auth/authorization'
import { permissions } from '../lib/auth/permissions'
import { runWithOrganization } from '../lib/auth/organization-context'
import { addOrganizationMember, removeOrganizationMember, updateOrganization, updateOrganizationMember } from '../lib/platform/organizations'
import { hashPassword, verifyPassword } from '../lib/auth/password'
import { prisma } from '../lib/prisma'
import organizationsHandler from '../pages/api/platform/organizations'
import organizationAdminHandler from '../pages/api/admin/organization'
import organizationMembersHandler from '../pages/api/admin/organization/members'
import organizationMemberHandler from '../pages/api/admin/organization/members/[membershipId]'
import resetOrganizationPasswordHandler from '../pages/api/admin/organization/members/[membershipId]/reset-password'
import invalidateOrganizationSessionsHandler from '../pages/api/admin/organization/members/[membershipId]/invalidate-sessions'
import { getServerSideProps as platformAdminPageProps } from '../pages/admin'

const prefix = 'QA_PLATFORM_ADMIN_'

function response() {
  let statusCode = 200
  let payload: any = null
  return {
    status(code: number) { statusCode = code; return this },
    json(value: unknown) { payload = value; return this },
    setHeader() {},
    get statusCode() { return statusCode },
    get payload() { return payload },
  }
}

function request(user: any, method = 'GET', body: any = {}) {
  return { method, body, query: {}, headers: { cookie: `${sessionCookieName}=${createSessionToken(user)}` } } as any
}

async function main() {
  const passwordHash = hashPassword('Qa!Password2026')
  const superUser = await prisma.user.create({ data: { id: `${prefix}SUPER`, name: 'QA Super', firstName: 'QA', lastName: 'Super', username: 'qa_platform_super', passwordHash, role: UserRole.ADMIN, platformRole: 'SUPER_ADMIN', isActive: true, mustChangePassword: false } })
  const supportUser = await prisma.user.create({ data: { id: `${prefix}SUPPORT`, name: 'QA Support', firstName: 'QA', lastName: 'Support', username: 'qa_platform_support', passwordHash, role: UserRole.DISPATCHER, platformRole: 'PLATFORM_SUPPORT', isActive: true, mustChangePassword: false } })
  let organizationId = ''
  const createdUserIds: string[] = []

  try {
    const normalUser = await prisma.user.create({ data: { id: `${prefix}NORMAL`, name: 'QA Normal', firstName: 'QA', lastName: 'Normal', username: 'qa_platform_normal', passwordHash, role: UserRole.DISPATCHER, isActive: true, mustChangePassword: false } })
    createdUserIds.push(normalUser.id)
    const normalRes = response()
    await organizationsHandler(request(normalUser), normalRes as any)
    assert.equal(normalRes.statusCode, 403, 'A')
    const normalPageRes = { statusCode: 200 }
    assert.deepEqual(await (platformAdminPageProps as any)({ req: request(normalUser), res: normalPageRes }), { props: { accessDenied: true } }, 'A-page')
    assert.equal(normalPageRes.statusCode, 403, 'A-page-status')

    const superRes = response()
    await organizationsHandler(request(superUser), superRes as any)
    assert.equal(superRes.statusCode, 200, 'C')

    const supportRes = response()
    await organizationsHandler(request(supportUser), supportRes as any)
    assert.equal(supportRes.statusCode, 200, 'D-read')
    const supportWriteRes = response()
    await organizationsHandler(request(supportUser, 'POST', { name: 'Forbidden', slug: 'forbidden' }), supportWriteRes as any)
    assert.equal(supportWriteRes.statusCode, 403, 'D-write')

    const createRes = response()
    await organizationsHandler(request(superUser, 'POST', {
      name: 'QA Platform Tenant', slug: 'qa-platform-tenant', status: 'ACTIVE',
      enabledModules: ['PLANNING', 'MAP'],
      admin: { firstName: 'QA', lastName: 'Org Admin', username: 'qa_platform_org_admin', password: 'Qa!Password2026' },
    }), createRes as any)
    assert.equal(createRes.statusCode, 201, 'E')
    organizationId = createRes.payload.organization.id

    const adminMembership = await prisma.organizationUser.findFirstOrThrow({ where: { organizationId, role: OrganizationRole.ORG_ADMIN }, include: { user: true } })
    createdUserIds.push(adminMembership.userId)
    assert.equal(adminMembership.role, OrganizationRole.ORG_ADMIN, 'F')
    await prisma.user.update({ where: { id: adminMembership.userId }, data: { mustChangePassword: false } })
    adminMembership.user.mustChangePassword = false
    const orgAdminSession = { ...adminMembership.user, organizationId, organizationRole: OrganizationRole.ORG_ADMIN }

    const orgAdminRes = response()
    await organizationsHandler(request({ ...adminMembership.user, organizationId, organizationRole: OrganizationRole.ORG_ADMIN }), orgAdminRes as any)
    assert.equal(orgAdminRes.statusCode, 403, 'B')
    const orgAdminPageRes = { statusCode: 200 }
    assert.deepEqual(await (platformAdminPageProps as any)({ req: request({ ...adminMembership.user, organizationId, organizationRole: OrganizationRole.ORG_ADMIN }), res: orgAdminPageRes }), { props: { accessDenied: true } }, 'B-page')
    assert.equal(orgAdminPageRes.statusCode, 403, 'B-page-status')

    await prisma.organizationIntegration.create({ data: { organizationId, type: OrganizationIntegrationType.MAIL_INTAKE, enabled: true, secretRef: 'QA_SECRET_REF', configJson: { mailboxAddress: 'qa@example.invalid', provider: 'imap', password: 'must-not-leak' } } })
    const ownWorkspaceRes = response()
    await organizationAdminHandler(request(orgAdminSession), ownWorkspaceRes as any)
    assert.equal(ownWorkspaceRes.statusCode, 200, 'P-org-admin-own-workspace')
    assert.equal(ownWorkspaceRes.payload.organization.id, organizationId, 'P-org-admin-own-tenant')
    assert.equal(JSON.stringify(ownWorkspaceRes.payload).includes('must-not-leak'), false, 'P-integration-secret-config-redacted')
    assert.equal(JSON.stringify(ownWorkspaceRes.payload).includes('QA_SECRET_REF'), false, 'P-secret-ref-hidden')

    await prisma.organizationUser.create({ data: { organizationId, userId: normalUser.id, role: OrganizationRole.DISPATCHER } })
    const dispatcherSession = { ...normalUser, organizationId, organizationRole: OrganizationRole.DISPATCHER }
    const dispatcherWorkspaceRes = response()
    await organizationAdminHandler(request(dispatcherSession), dispatcherWorkspaceRes as any)
    assert.equal(dispatcherWorkspaceRes.statusCode, 403, 'Q-dispatcher-denied')

    const createdByOrgAdminRes = response()
    await organizationMembersHandler(request(orgAdminSession, 'POST', {
      firstName: 'QA', lastName: 'Created', username: 'qa_org_admin_created', role: 'VIEWER', platformRole: 'SUPER_ADMIN',
    }), createdByOrgAdminRes as any)
    assert.equal(createdByOrgAdminRes.statusCode, 201, 'R-org-admin-create-member')
    assert.equal(typeof createdByOrgAdminRes.payload.temporaryPassword, 'string', 'R-temporary-password-returned-once')
    const createdByOrgAdmin = await prisma.user.findFirstOrThrow({ where: { username: 'qa_org_admin_created' } })
    createdUserIds.push(createdByOrgAdmin.id)
    assert.equal(createdByOrgAdmin.platformRole, null, 'S-platform-role-protected')
    const createdMembership = await prisma.organizationUser.findFirstOrThrow({ where: { organizationId, userId: createdByOrgAdmin.id } })

    const resetRes = response()
    const resetReq = request(orgAdminSession, 'POST')
    resetReq.query = { membershipId: createdMembership.id }
    await resetOrganizationPasswordHandler(resetReq, resetRes as any)
    assert.equal(resetRes.statusCode, 200, 'S-password-reset')
    const afterReset = await prisma.user.findUniqueOrThrow({ where: { id: createdByOrgAdmin.id } })
    assert.equal(afterReset.mustChangePassword, true, 'S-password-change-required')
    assert.ok(afterReset.passwordHash && verifyPassword(resetRes.payload.temporaryPassword, afterReset.passwordHash), 'S-password-hashed')
    assert.equal(JSON.stringify(await prisma.platformAuditLog.findMany({ where: { organizationId } })).includes(resetRes.payload.temporaryPassword), false, 'S-password-not-audited')

    const sessionVersion = afterReset.sessionVersion
    const sessionsRes = response()
    const sessionsReq = request(orgAdminSession, 'POST')
    sessionsReq.query = { membershipId: createdMembership.id }
    await invalidateOrganizationSessionsHandler(sessionsReq, sessionsRes as any)
    assert.equal(sessionsRes.statusCode, 200, 'S-session-invalidation')
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: createdByOrgAdmin.id } })).sessionVersion, sessionVersion + 1, 'S-session-version')

    const demoteLastAdminRes = response()
    const demoteLastAdminReq = request(orgAdminSession, 'PATCH', { role: 'MANAGER' })
    demoteLastAdminReq.query = { membershipId: adminMembership.id }
    await organizationMemberHandler(demoteLastAdminReq, demoteLastAdminRes as any)
    assert.equal(demoteLastAdminRes.statusCode, 409, 'S-last-org-admin-preserved')

    const foreignMembership = await prisma.organizationUser.findFirstOrThrow({ where: { organizationId: { not: organizationId } }, select: { id: true } })
    const crossTenantRes = response()
    const crossTenantReq = request(orgAdminSession, 'PATCH', { role: 'MANAGER' })
    crossTenantReq.query = { membershipId: foreignMembership.id }
    await organizationMemberHandler(crossTenantReq, crossTenantRes as any)
    assert.equal(crossTenantRes.statusCode, 404, 'T-cross-tenant-membership-denied')

    const member = await addOrganizationMember({ actorUserId: superUser.id, organizationId, role: OrganizationRole.VIEWER, newUser: { firstName: 'QA', lastName: 'Member', username: 'qa_platform_member', password: 'Qa!Password2026' } })
    createdUserIds.push(member.userId)
    const changed = await updateOrganizationMember({ actorUserId: superUser.id, organizationId, membershipId: member.id, role: OrganizationRole.MANAGER })
    assert.equal(changed.role, OrganizationRole.MANAGER, 'G')
    await removeOrganizationMember({ actorUserId: superUser.id, organizationId, membershipId: member.id })
    assert.equal(await prisma.organizationUser.count({ where: { id: member.id } }), 0, 'H')

    await updateOrganization({ actorUserId: superUser.id, organizationId, status: 'SUSPENDED' })
    const suspendedRes = response()
    assert.equal(await requirePermission(request(orgAdminSession), suspendedRes as any, permissions.dispatchView), null, 'I')
    assert.ok([401, 403].includes(suspendedRes.statusCode), 'I-status')

    await updateOrganization({ actorUserId: superUser.id, organizationId, status: 'ACTIVE' })
    const activeRes = response()
    assert.ok(await requirePermission(request(orgAdminSession), activeRes as any, permissions.dispatchView), 'J')

    await updateOrganization({ actorUserId: superUser.id, organizationId, enabledModules: ['PLANNING'] })
    const disabledRes = response()
    assert.equal(await requirePermission(request(orgAdminSession), disabledRes as any, permissions.mapView), null, 'K')
    assert.equal(disabledRes.payload.code, 'MODULE_DISABLED', 'K-code')
    await updateOrganization({ actorUserId: superUser.id, organizationId, enabledModules: ['PLANNING', 'MAP'] })
    const enabledRes = response()
    assert.ok(await requirePermission(request(orgAdminSession), enabledRes as any, permissions.mapView), 'L')

    const mission = await runWithOrganization({ organizationId, organizationRole: OrganizationRole.ORG_ADMIN, platformRole: null, userId: adminMembership.userId }, async () => prisma.mission.create({ data: { id: `${prefix}MISSION`, reference: `${prefix}MISSION`, status: 'PENDING' } }))
    const otherOrganization = await prisma.organization.findFirstOrThrow({ where: { id: { not: organizationId }, status: 'ACTIVE' }, select: { id: true } })
    const visibleFromOtherTenant = await runWithOrganization({ organizationId: otherOrganization.id, organizationRole: OrganizationRole.ORG_ADMIN, platformRole: null, userId: superUser.id }, async () => prisma.mission.findUnique({ where: { id: mission.id } }))
    assert.equal(visibleFromOtherTenant, null, 'M')

    const actions = await prisma.platformAuditLog.findMany({ where: { organizationId }, select: { action: true, metadata: true } })
    const actionSet = new Set(actions.map((item) => item.action))
    for (const action of [PlatformAuditAction.ORGANIZATION_CREATED, PlatformAuditAction.MEMBER_ADDED, PlatformAuditAction.MEMBER_ROLE_CHANGED, PlatformAuditAction.MEMBER_REMOVED, PlatformAuditAction.ORGANIZATION_STATUS_CHANGED, PlatformAuditAction.MODULES_CHANGED]) assert.ok(actionSet.has(action), `N-${action}`)
    assert.equal(JSON.stringify({ create: createRes.payload, actions }).includes('Qa!Password2026'), false, 'O-password')
    assert.equal(JSON.stringify({ create: createRes.payload, actions }).includes('passwordHash'), false, 'O-hash')
    console.log('A-O SUPER_ADMIN, support, tenant suspension, modules and audit: OK')
  } finally {
    if (organizationId) {
      await runWithOrganization({ organizationId, organizationRole: OrganizationRole.ORG_ADMIN, platformRole: null, userId: superUser.id }, async () => {
        await prisma.mission.deleteMany({ where: { id: { startsWith: prefix } } })
      })
      await prisma.platformAuditLog.deleteMany({ where: { organizationId } })
      await prisma.organizationUser.deleteMany({ where: { organizationId } })
      await prisma.organization.deleteMany({ where: { id: organizationId } })
    }
    await prisma.user.deleteMany({ where: { id: { in: [...createdUserIds, superUser.id, supportUser.id] } } })
  }
}

main().finally(() => prisma.$disconnect())
