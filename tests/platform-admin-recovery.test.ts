import assert from 'node:assert/strict'
import { OrganizationRole, UserRole } from '@prisma/client'

import { createSessionToken, sessionCookieName } from '../lib/auth/session'
import { hashPassword, verifyPassword } from '../lib/auth/password'
import { createPlatformConfigurationRequest } from '../lib/platform/configuration-channel'
import { prisma } from '../lib/prisma'
import customConfigurationHandler from '../pages/api/internal/platform/configuration'
import platformInstanceConfigurationHandler from '../pages/api/platform/instances/[application]/configuration'
import standardAdminsHandler from '../pages/api/platform/organizations/[id]/admins'

const prefix = 'QA_RECOVERY_'
const OLD_PASSWORD = 'Qa!OldPassword2026'

process.env.GERARD_PLATFORM_INSTANCE_SHARED_SECRET = 'qa-recovery-channel-secret'
process.env.GERARD_INSTANCE_ENVIRONMENT = 'development'
process.env.GERARD_PLATFORM_INSTANCE_NOVOTRALUX_DEVELOPMENT_CONFIGURATION_ENDPOINT = 'https://novotralux-qa.invalid/api/internal/platform/configuration'

function response() {
  let statusCode = 200
  let payload: any = null
  return { status(code: number) { statusCode = code; return this }, json(value: unknown) { payload = value; return this }, setHeader() {}, get statusCode() { return statusCode }, get payload() { return payload } }
}
function request(session: any, method: string, body: any = {}, query: any = {}, headers: Record<string, string> = {}) {
  return { method, body, query, headers: { ...(session ? { cookie: `${sessionCookieName}=${createSessionToken(session)}` } : {}), ...headers } } as any
}
async function call(handler: (req: any, res: any) => unknown, req: any) { const res = response(); await handler(req, res); return res }

async function main() {
  const passwordHash = hashPassword(OLD_PASSWORD)
  const user = (key: string, extra: Record<string, unknown> = {}) => prisma.user.create({ data: { id: `${prefix}${key}`, name: `QA ${key}`, firstName: 'QA', lastName: key, username: `qa_recovery_${key.toLowerCase()}`, email: `${key.toLowerCase()}@recovery.invalid`, passwordHash, role: UserRole.DISPATCHER, isActive: true, mustChangePassword: false, ...extra } })
  const orgA = await prisma.organization.create({ data: { id: `${prefix}ORG_A`, name: 'QA Recovery A', slug: 'qa-recovery-a' } })
  const orgB = await prisma.organization.create({ data: { id: `${prefix}ORG_B`, name: 'QA Recovery B', slug: 'qa-recovery-b' } })
  try {
    const superUser = await user('SUPER', { platformRole: 'SUPER_ADMIN', role: UserRole.ADMIN })
    const supportUser = await user('SUPPORT', { platformRole: 'PLATFORM_SUPPORT' })
    const admin = await user('ADMIN')
    const disabledAdmin = await user('DISABLED_ADMIN', { isActive: false })
    const dispatcher = await user('DISPATCHER')
    const shared = await user('SHARED')
    const platformAdmin = await user('PLATFORM_ADMIN', { platformRole: 'PLATFORM_SUPPORT' })
    const outsider = await user('OUTSIDER')
    const member = (userId: string, organizationId: string, role: OrganizationRole) => prisma.organizationUser.create({ data: { userId, organizationId, role } })
    await member(admin.id, orgA.id, OrganizationRole.ORG_ADMIN)
    await member(disabledAdmin.id, orgA.id, OrganizationRole.ORG_ADMIN)
    await member(dispatcher.id, orgA.id, OrganizationRole.DISPATCHER)
    await member(shared.id, orgA.id, OrganizationRole.ORG_ADMIN)
    await member(shared.id, orgB.id, OrganizationRole.VIEWER)
    await member(platformAdmin.id, orgA.id, OrganizationRole.ORG_ADMIN)
    await member(outsider.id, orgB.id, OrganizationRole.ORG_ADMIN)
    const adminSession = { ...admin, organizationId: orgA.id, organizationRole: OrganizationRole.ORG_ADMIN }
    const dispatcherSession = { ...dispatcher, organizationId: orgA.id, organizationRole: OrganizationRole.DISPATCHER }
    const state = (id: string) => prisma.user.findUniqueOrThrow({ where: { id }, select: { passwordHash: true, mustChangePassword: true, sessionVersion: true, isActive: true, platformRole: true } })

    // ─── Standard: local recovery through the platform API ───────────────
    const standard = (session: any, method: string, body: any = {}) => call(standardAdminsHandler, request(session, method, body, { id: orgA.id }))
    const listed = await standard(superUser, 'GET')
    assert.equal(listed.statusCode, 200, 'SUPER_ADMIN lists ORG_ADMIN')
    assert.deepEqual(listed.payload.admins.map((item: any) => item.userId).sort(), [admin.id, disabledAdmin.id, platformAdmin.id, shared.id].sort(), 'only ORG_ADMIN members of this organization')
    assert.deepEqual(Object.keys(listed.payload.admins[0]).sort(), ['email', 'firstName', 'isActive', 'lastLoginAt', 'lastName', 'mustChangePassword', 'protection', 'role', 'userId', 'username'], 'safe fields only')
    assert.ok(!/passwordHash|sessionVersion|scrypt:/.test(JSON.stringify(listed.payload)), 'no password hash or session data')
    assert.equal(listed.payload.admins.find((item: any) => item.userId === platformAdmin.id).protection, 'PLATFORM_ACCOUNT', 'platform account flagged')
    assert.equal(listed.payload.admins.find((item: any) => item.userId === shared.id).protection, 'SHARED_ACCOUNT', 'shared account flagged')
    assert.equal((await standard(supportUser, 'GET')).statusCode, 200, 'PLATFORM_SUPPORT may read')
    assert.equal((await standard(supportUser, 'POST', { action: 'resetOrgAdminPassword', userId: admin.id })).statusCode, 403, 'PLATFORM_SUPPORT cannot mutate')
    assert.equal((await standard(adminSession, 'GET')).statusCode, 403, 'ORG_ADMIN cannot use platform recovery')
    assert.equal((await standard(adminSession, 'POST', { action: 'resetOrgAdminPassword', userId: admin.id })).statusCode, 403, 'ORG_ADMIN cannot invoke recovery')
    assert.equal((await standard(dispatcherSession, 'POST', { action: 'resetOrgAdminPassword', userId: admin.id })).statusCode, 403, 'DISPATCHER denied')

    const before = await state(admin.id)
    const reset = await standard(superUser, 'POST', { action: 'resetOrgAdminPassword', userId: admin.id })
    assert.equal(reset.statusCode, 200, 'SUPER_ADMIN resets Standard ORG_ADMIN')
    const temporaryPassword = reset.payload.temporaryPassword as string
    const after = await state(admin.id)
    assert.ok(verifyPassword(temporaryPassword, after.passwordHash!), 'temporary password works')
    assert.ok(!verifyPassword(OLD_PASSWORD, after.passwordHash!), 'old password stops working')
    assert.equal(after.mustChangePassword, true, 'mustChangePassword set')
    assert.equal(after.sessionVersion, before.sessionVersion + 1, 'sessionVersion incremented')
    assert.equal(after.isActive, true, 'active state unchanged')
    const invalidated = await standard(superUser, 'POST', { action: 'invalidateOrgAdminSessions', userId: admin.id })
    assert.equal(invalidated.statusCode, 200, 'sessions invalidated')
    assert.equal((await state(admin.id)).sessionVersion, after.sessionVersion + 1, 'session invalidation increments sessionVersion')
    const disabledBefore = await state(disabledAdmin.id)
    assert.equal((await standard(superUser, 'POST', { action: 'reactivateOrgAdmin', userId: disabledAdmin.id })).statusCode, 200, 'reactivation')
    const reactivated = await state(disabledAdmin.id)
    assert.equal(reactivated.isActive, true, 'reactivated')
    assert.equal(reactivated.passwordHash, disabledBefore.passwordHash, 'reactivation does not reset password')
    assert.equal(reactivated.platformRole, null, 'reactivation does not touch platformRole')
    assert.equal((await standard(superUser, 'POST', { action: 'resetOrgAdminPassword', userId: dispatcher.id })).statusCode, 404, 'non-ORG_ADMIN target rejected')
    assert.equal((await standard(superUser, 'POST', { action: 'resetOrgAdminPassword', userId: outsider.id })).statusCode, 404, 'cross-tenant target rejected')
    assert.equal((await standard(superUser, 'POST', { action: 'resetOrgAdminPassword', userId: platformAdmin.id })).statusCode, 403, 'platform account protected')
    assert.equal((await standard(superUser, 'POST', { action: 'reactivateOrgAdmin', userId: shared.id })).statusCode, 403, 'shared account protected')
    assert.equal((await standard(superUser, 'POST', { action: 'deleteUser', userId: admin.id })).statusCode, 400, 'no generic account operation')
    const audits = await prisma.platformAuditLog.findMany({ where: { organizationId: orgA.id } })
    assert.equal(audits.filter((item) => (item.metadata as any)?.source === 'PLATFORM_RECOVERY').length, 3, 'each recovery audited once, refusals not audited')
    assert.ok(audits.every((item) => item.actorUserId === superUser.id), 'Standard audit actor is the SUPER_ADMIN')
    assert.ok(!JSON.stringify(audits).includes(temporaryPassword) && !/scrypt:/.test(JSON.stringify(audits)), 'audit contains no password')

    // ─── Custom: signed recovery on the instance's own organization ──────
    process.env.GERARD_APPLICATION_ID = 'qa-custom'
    process.env.GERARD_INSTANCE_ORGANIZATION_ID = orgA.id
    const signed = (action: any, payload: Record<string, unknown>, overrides: Record<string, unknown> = {}) => createPlatformConfigurationRequest({ application: 'qa-custom', organizationId: orgA.id, action, payload, ...overrides })
    const custom = (value: ReturnType<typeof signed>) => call(customConfigurationHandler, request(null, 'POST', { request: value.request }, {}, { 'x-gerard-platform-signature': value.signature, 'x-gerard-platform-actor': superUser.id }))
    const customList = await custom(signed('getOrgAdmins', {}))
    assert.equal(customList.statusCode, 200, 'Custom lists ORG_ADMIN')
    assert.equal(customList.payload.admins.length, 4, 'Custom lists only its ORG_ADMIN')
    const customBefore = await state(admin.id)
    const customReset = await custom(signed('resetOrgAdminPassword', { userId: admin.id }))
    assert.equal(customReset.statusCode, 200, 'SUPER_ADMIN resets Custom ORG_ADMIN')
    const customAfter = await state(admin.id)
    assert.ok(verifyPassword(customReset.payload.temporaryPassword, customAfter.passwordHash!), 'Custom temporary password works')
    assert.ok(!verifyPassword(temporaryPassword, customAfter.passwordHash!), 'previous password stops working')
    assert.equal(customAfter.sessionVersion, customBefore.sessionVersion + 1, 'Custom reset increments sessionVersion')
    assert.equal((await custom(signed('resetOrgAdminPassword', { userId: outsider.id }))).statusCode, 404, 'Custom cross-tenant rejected')
    assert.equal((await custom(signed('resetOrgAdminPassword', { userId: dispatcher.id }))).statusCode, 404, 'Custom non-ORG_ADMIN rejected')
    assert.equal((await custom(signed('invalidateOrgAdminSessions', { userId: shared.id }))).statusCode, 403, 'Custom shared account protected')
    assert.equal((await custom(signed('resetOrgAdminPassword', { userId: admin.id, isActive: true }))).statusCode, 400, 'Custom rejects extra fields')
    assert.equal((await custom(signed('resetOrgAdminPassword', { userId: admin.id }, { application: 'other-instance' }))).statusCode, 401, 'wrong instance denied')
    const tampered = signed('invalidateOrgAdminSessions', { userId: admin.id })
    assert.equal((await call(customConfigurationHandler, request(null, 'POST', { request: { ...tampered.request, action: 'resetOrgAdminPassword' } }, {}, { 'x-gerard-platform-signature': tampered.signature }))).statusCode, 401, 'signature binds the recovery action')
    const customAudit = await prisma.platformAuditLog.findFirst({ where: { organizationId: orgA.id, metadata: { path: ['platformActorId'], equals: superUser.id }, actorUserId: admin.id }, orderBy: { createdAt: 'desc' } })
    assert.equal((customAudit?.metadata as any)?.source, 'PLATFORM_RECOVERY', 'Custom audit records platform recovery')
    assert.ok(!JSON.stringify(await prisma.platformAuditLog.findMany({ where: { organizationId: orgA.id } })).includes(customReset.payload.temporaryPassword), 'Custom audit contains no password')

    // ─── Platform route: authorization and platform-side audit ───────────
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, temporaryPassword: 'returned-once-not-audited' }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
    try {
      const platform = (session: any, body: Record<string, unknown>) => call(platformInstanceConfigurationHandler, request(session, 'POST', body, { application: 'novotralux' }))
      assert.equal((await platform(supportUser, { action: 'getOrgAdmins' })).statusCode, 200, 'PLATFORM_SUPPORT reads Custom ORG_ADMIN')
      assert.equal((await platform(supportUser, { action: 'resetOrgAdminPassword', payload: { userId: 'x' } })).statusCode, 403, 'PLATFORM_SUPPORT cannot recover Custom')
      assert.equal((await platform(adminSession, { action: 'getOrgAdmins' })).statusCode, 403, 'ORG_ADMIN cannot read platform recovery')
      assert.equal((await platform(dispatcherSession, { action: 'resetOrgAdminPassword', payload: { userId: 'x' } })).statusCode, 403, 'DISPATCHER denied')
      assert.equal((await platform(superUser, { action: 'resetOrgAdminPassword', payload: { userId: 'x', role: 'SUPER_ADMIN' } })).statusCode, 400, 'platform rejects extra recovery fields')
      const platformReset = await platform(superUser, { action: 'resetOrgAdminPassword', payload: { userId: 'target-user' } })
      assert.equal(platformReset.statusCode, 200, 'SUPER_ADMIN Custom recovery through Platform')
      assert.equal(platformReset.payload.temporaryPassword, 'returned-once-not-audited', 'password returned to the caller')
      const platformAudit = await prisma.platformAuditLog.findFirst({ where: { actorUserId: superUser.id, metadata: { path: ['action'], equals: 'resetOrgAdminPassword' } } })
      assert.equal((platformAudit?.metadata as any)?.targetUserId, 'target-user', 'platform audit names the target ORG_ADMIN')
      assert.ok(!JSON.stringify(platformAudit).includes('returned-once-not-audited'), 'platform audit contains no password')
      assert.equal(await prisma.platformAuditLog.count({ where: { actorUserId: superUser.id, metadata: { path: ['action'], equals: 'getOrgAdmins' } } }), 0, 'reads not audited')
    } finally {
      globalThis.fetch = realFetch
    }
    console.log('SUPER_ADMIN ORG_ADMIN recovery (Standard + signed Custom), safeguards and audit: OK')
  } finally {
    await prisma.platformAuditLog.deleteMany({ where: { OR: [{ organizationId: { in: [orgA.id, orgB.id] } }, { actorUserId: { startsWith: prefix } }] } })
    await prisma.organizationUser.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } })
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } })
    await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } })
  }
}

main().finally(() => prisma.$disconnect())
