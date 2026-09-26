import assert from 'node:assert/strict'
import { OrganizationIntegrationType, OrganizationRole, PlatformAuditAction, UserRole } from '@prisma/client'

import { createSessionToken, sessionCookieName } from '../lib/auth/session'
import { hashPassword } from '../lib/auth/password'
import { createPlatformConfigurationRequest } from '../lib/platform/configuration-channel'
import { prisma } from '../lib/prisma'
import customConfigurationHandler from '../pages/api/internal/platform/configuration'
import platformInstanceConfigurationHandler from '../pages/api/platform/instances/[application]/configuration'
import platformOrganizationHandler from '../pages/api/platform/organizations/[id]'
import organizationMemberHandler from '../pages/api/admin/organization/members/[membershipId]'

const prefix = 'QA_ADMIN_CFG_'
const SECRET_REF = 'QA_ADMIN_CFG_SECRET_REF_VALUE'
const SECRET_VALUE = 'qa-admin-cfg-must-not-leak'

process.env.GERARD_PLATFORM_INSTANCE_SHARED_SECRET = 'qa-admin-configuration-channel-secret'
// Local runtime with a non-routable endpoint: the registry must never resolve the Production Custom endpoint here.
process.env.GERARD_INSTANCE_ENVIRONMENT = 'development'
process.env.GERARD_PLATFORM_INSTANCE_NOVOTRALUX_DEVELOPMENT_CONFIGURATION_ENDPOINT = 'https://novotralux-qa.invalid/api/internal/platform/configuration'

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
function request(session: any, method: string, body: any = {}, query: any = {}, headers: Record<string, string> = {}) {
  return { method, body, query, headers: { ...(session ? { cookie: `${sessionCookieName}=${createSessionToken(session)}` } : {}), ...headers } } as any
}
async function call(handler: (req: any, res: any) => unknown, req: any) { const res = response(); await handler(req, res); return res }

async function main() {
  const passwordHash = hashPassword('Qa!Password2026')
  const user = (key: string, extra: Record<string, unknown> = {}) => prisma.user.create({ data: { id: `${prefix}${key}`, name: `QA ${key}`, firstName: 'QA', lastName: key, username: `qa_admin_cfg_${key.toLowerCase()}`, passwordHash, role: UserRole.DISPATCHER, isActive: true, mustChangePassword: false, ...extra } })
  const orgA = await prisma.organization.create({ data: { id: `${prefix}ORG_A`, name: 'QA Config A', slug: 'qa-admin-cfg-a', displayName: 'QA A', applicationTitle: 'QA A Dispatch', accentColor: '#123456' } })
  const orgB = await prisma.organization.create({ data: { id: `${prefix}ORG_B`, name: 'QA Config B', slug: 'qa-admin-cfg-b' } })
  try {
    const superUser = await user('SUPER', { platformRole: 'SUPER_ADMIN', role: UserRole.ADMIN })
    const supportUser = await user('SUPPORT', { platformRole: 'PLATFORM_SUPPORT' })
    const admin = await user('ADMIN')
    const inactiveAdmin = await user('INACTIVE_ADMIN', { isActive: false })
    const member = await user('MEMBER')
    const shared = await user('SHARED')
    const dispatcher = await user('DISPATCHER')
    const outsider = await user('OUTSIDER')
    const membership = (userId: string, organizationId: string, role: OrganizationRole) => prisma.organizationUser.create({ data: { userId, organizationId, role } })
    const adminMembership = await membership(admin.id, orgA.id, OrganizationRole.ORG_ADMIN)
    await membership(inactiveAdmin.id, orgA.id, OrganizationRole.ORG_ADMIN)
    const memberMembership = await membership(member.id, orgA.id, OrganizationRole.DISPATCHER)
    const sharedMembership = await membership(shared.id, orgA.id, OrganizationRole.VIEWER)
    await membership(shared.id, orgB.id, OrganizationRole.VIEWER)
    const platformMembership = await membership(superUser.id, orgA.id, OrganizationRole.VIEWER)
    await membership(dispatcher.id, orgA.id, OrganizationRole.DISPATCHER)
    const outsiderMembership = await membership(outsider.id, orgB.id, OrganizationRole.DISPATCHER)
    await prisma.organizationIntegration.create({ data: { organizationId: orgA.id, type: OrganizationIntegrationType.MAIL_INTAKE, enabled: true, secretRef: SECRET_REF, configJson: { mailboxAddress: 'qa@example.invalid', host: 'imap.example.invalid', port: 993, password: SECRET_VALUE, apiKey: SECRET_VALUE } } })

    const adminSession = { ...admin, organizationId: orgA.id, organizationRole: OrganizationRole.ORG_ADMIN }
    const dispatcherSession = { ...dispatcher, organizationId: orgA.id, organizationRole: OrganizationRole.DISPATCHER }
    const roleChange = (membershipId: string, body: Record<string, unknown>) => call(organizationMemberHandler, request(adminSession, 'PATCH', body, { membershipId }))
    const roleOf = async (id: string) => (await prisma.organizationUser.findUniqueOrThrow({ where: { id } })).role

    // ─── N. ORG_ADMIN role-change safeguard ────────────────────────────────
    const normal = await roleChange(memberMembership.id, { role: 'MANAGER' })
    assert.equal(normal.statusCode, 200, 'N1 normal own-org role change')
    assert.equal(await roleOf(memberMembership.id), OrganizationRole.MANAGER, 'N1 persisted')
    const audit = await prisma.platformAuditLog.findFirst({ where: { organizationId: orgA.id, action: PlatformAuditAction.MEMBER_ROLE_CHANGED }, orderBy: { createdAt: 'desc' } })
    assert.deepEqual(audit?.metadata, { userId: member.id, before: 'DISPATCHER', after: 'MANAGER' }, 'N7 role change audited')
    assert.equal(audit?.actorUserId, admin.id, 'N7 audit actor')
    // An inactive ORG_ADMIN must not count: demoting the only active one would lock the organization out.
    assert.equal((await roleChange(adminMembership.id, { role: 'VIEWER' })).statusCode, 409, 'N2 final active ORG_ADMIN cannot be demoted')
    assert.equal(await roleOf(adminMembership.id), OrganizationRole.ORG_ADMIN, 'N2 unchanged')
    assert.equal((await roleChange(platformMembership.id, { role: 'MANAGER' })).statusCode, 403, 'N3 platform account rejected')
    assert.equal(await roleOf(platformMembership.id), OrganizationRole.VIEWER, 'N3 unchanged')
    assert.equal((await roleChange(sharedMembership.id, { role: 'MANAGER' })).statusCode, 403, 'N4 shared account rejected')
    assert.equal(await roleOf(sharedMembership.id), OrganizationRole.VIEWER, 'N4 unchanged')
    assert.equal((await roleChange(outsiderMembership.id, { role: 'MANAGER' })).statusCode, 404, 'N5 cross-tenant rejected')
    assert.equal(await roleOf(outsiderMembership.id), OrganizationRole.DISPATCHER, 'N5 unchanged')
    const escalation = await roleChange(memberMembership.id, { role: 'VIEWER', platformRole: 'SUPER_ADMIN' })
    assert.equal(escalation.statusCode, 200, 'N6 extra fields ignored')
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).platformRole, null, 'N6 platformRole not mutable')
    assert.equal(await prisma.platformAuditLog.count({ where: { organizationId: orgA.id, action: PlatformAuditAction.MEMBER_ROLE_CHANGED } }), 2, 'N7 rejected changes not audited')

    // ─── O. Custom endpoint: signed read on its own organization ──────────
    process.env.GERARD_APPLICATION_ID = 'qa-custom'
    process.env.GERARD_INSTANCE_ORGANIZATION_ID = orgA.id
    const signedRead = (overrides: Record<string, unknown> = {}) => createPlatformConfigurationRequest({ application: 'qa-custom', organizationId: orgA.id, action: 'getConfiguration', payload: {}, ...overrides })
    const custom = async (signed: ReturnType<typeof signedRead>, request_ = signed.request) => call(customConfigurationHandler, request(null, 'POST', { request: request_ }, {}, { 'x-gerard-platform-signature': signed.signature }))
    const read = await custom(signedRead())
    assert.equal(read.statusCode, 200, 'O1 signed read succeeds')
    const configuration = read.payload.configuration
    assert.deepEqual(Object.keys(configuration).sort(), ['branding', 'enabledModules', 'identity', 'integrations', 'organizationId', 'status', 'updatedAt'], 'O16 only allow-listed top-level keys')
    assert.deepEqual(configuration.identity, { name: 'QA Config A', displayName: 'QA A', applicationTitle: 'QA A Dispatch' }, 'O9 identity')
    assert.deepEqual(configuration.branding, { accentColor: '#123456', logoUrl: null, faviconUrl: null }, 'O10 branding')
    assert.ok(Array.isArray(configuration.enabledModules) && configuration.enabledModules.includes('PLANNING'), 'O11 modules')
    assert.equal(configuration.integrations.length, 1, 'O12 integrations')
    assert.deepEqual(Object.keys(configuration.integrations[0]).sort(), ['configJson', 'enabled', 'secretConfigured', 'type', 'updatedAt'], 'O12 integration keys')
    assert.equal(configuration.integrations[0].secretConfigured, true, 'O12 secret status only')
    assert.equal(configuration.integrations[0].configJson.mailboxAddress, 'qa@example.invalid', 'O12 safe config returned')
    const serialized = JSON.stringify(read.payload)
    assert.ok(!serialized.includes(SECRET_REF) && !serialized.includes('secretRef'), 'O13 secretRef excluded')
    assert.ok(!serialized.includes(SECRET_VALUE) && !/"(password|apiKey)"/.test(serialized), 'O14 secret values excluded')
    assert.ok(!/postgres(ql)?:\/\//.test(serialized) && !(process.env.DATABASE_URL && serialized.includes(process.env.DATABASE_URL)), 'O15 no database URL')
    assert.ok(!serialized.includes(member.id) && !serialized.includes('qa_admin_cfg_'), 'O16 no user data')
    const tampered = signedRead()
    assert.equal((await custom({ ...tampered, signature: `${tampered.signature.slice(0, -2)}00` })).statusCode, 401, 'O5 invalid HMAC denied')
    assert.equal((await custom(signedRead({ timestamp: Math.floor(Date.now() / 1000) - 301, nonce: 'qa-admin-cfg-expired-nonce' }))).statusCode, 401, 'O6 expired request denied')
    const replayed = signedRead({ nonce: 'qa-admin-cfg-replay-nonce-1' })
    assert.equal((await custom(replayed)).statusCode, 200, 'O7 first use accepted')
    assert.equal((await custom(replayed)).statusCode, 401, 'O7 replay denied')
    assert.equal((await custom(signedRead({ application: 'other-instance' }))).statusCode, 401, 'O8 wrong instance denied')
    const readAsWrite = signedRead()
    assert.equal((await custom(readAsWrite, { ...readAsWrite.request, action: 'updateIdentity', payload: { displayName: 'x' } })).statusCode, 401, 'O read signature cannot be reused as a write')

    // ─── O. Platform route: authorization and the single signed path ──────
    const outgoing: any[] = []
    let reachable = true
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (url: string, init: any) => {
      if (!reachable) throw new Error('getaddrinfo ENOTFOUND novotralux-qa.invalid')
      outgoing.push({ url, headers: init.headers, body: JSON.parse(init.body) })
      return new Response(JSON.stringify({ ok: true, configuration: { organizationId: 'org-novotralux' } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    try {
      const platform = (session: any, body: Record<string, unknown>) => call(platformInstanceConfigurationHandler, request(session, 'POST', body, { application: 'novotralux' }))
      assert.equal((await platform(superUser, { action: 'getConfiguration' })).statusCode, 200, 'O1 SUPER_ADMIN read through Platform')
      assert.equal(outgoing[0].url, 'https://novotralux-qa.invalid/api/internal/platform/configuration', 'declared local endpoint used, never Production')
      assert.equal(outgoing[0].body.request.action, 'getConfiguration', 'read action signed')
      assert.ok(/^[0-9a-f]{64}$/.test(outgoing[0].headers['x-gerard-platform-signature']), 'HMAC signature attached')
      assert.equal((await platform(supportUser, { action: 'getConfiguration' })).statusCode, 200, 'O2 PLATFORM_SUPPORT may read')
      assert.equal((await platform(supportUser, { action: 'updateIdentity', payload: { displayName: 'x' } })).statusCode, 403, 'O2 PLATFORM_SUPPORT cannot write')
      assert.equal((await platform(adminSession, { action: 'getConfiguration' })).statusCode, 403, 'O3 ORG_ADMIN denied')
      assert.equal((await platform(dispatcherSession, { action: 'getConfiguration' })).statusCode, 403, 'O4 DISPATCHER denied')
      assert.equal(outgoing.length, 2, 'denied callers never reach the instance')
      const auditsBefore = await prisma.platformAuditLog.count({ where: { actorUserId: superUser.id } })
      assert.equal(auditsBefore, 0, 'reads are not audited')
      assert.equal((await platform(superUser, { action: 'updateIdentity', payload: { displayName: 'QA' } })).statusCode, 200, 'SUPER_ADMIN write')
      reachable = false
      assert.equal((await platform(superUser, { action: 'updateIdentity', payload: { displayName: 'QA' } })).statusCode, 502, 'unreachable instance reported')
      const writes = await prisma.platformAuditLog.findMany({ where: { actorUserId: superUser.id }, orderBy: { createdAt: 'asc' } })
      assert.deepEqual(writes.map((item) => (item.metadata as any).success), [true, false], 'writes audited, including unreachable instance')
      assert.equal((writes[1].metadata as any).code, 'INSTANCE_UNREACHABLE', 'failure code audited')
      assert.ok(!JSON.stringify(writes).includes(process.env.GERARD_PLATFORM_INSTANCE_SHARED_SECRET!), 'no channel secret in audit')
    } finally {
      globalThis.fetch = realFetch
    }

    // ─── O17. Standard: same normalised snapshot from the local database ──
    const standard = await call(platformOrganizationHandler, request(superUser, 'GET', {}, { id: orgA.id }))
    assert.equal(standard.statusCode, 200, 'O17 Standard read')
    assert.deepEqual(standard.payload.configuration, configuration, 'O17 Standard and Custom snapshots identical')
    assert.ok(!JSON.stringify(standard.payload.configuration).includes(SECRET_REF), 'O17 no secretRef')
    console.log('Admin getConfiguration (Standard + signed Custom) and ORG_ADMIN role safeguards: OK')
  } finally {
    await prisma.platformAuditLog.deleteMany({ where: { OR: [{ organizationId: { in: [orgA.id, orgB.id] } }, { actorUserId: { startsWith: prefix } }] } })
    await prisma.organizationIntegration.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } })
    await prisma.organizationUser.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } })
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } })
    await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } })
  }
}

main().finally(() => prisma.$disconnect())
