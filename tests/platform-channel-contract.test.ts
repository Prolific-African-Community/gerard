import assert from 'node:assert/strict'
import { OrganizationRole, UserRole } from '@prisma/client'
import { parsePlatformCommand } from '@prolific/gerard-core'

import { createSessionToken, sessionCookieName } from '../lib/auth/session'
import { hashPassword, verifyPassword } from '../lib/auth/password'
import { prisma } from '../lib/prisma'
import customConfigurationHandler from '../pages/api/internal/platform/configuration'
import platformInstanceConfigurationHandler from '../pages/api/platform/instances/[application]/configuration'

// Regression for the live "Custom configuration rejected / Invalid configuration request" on read and recovery actions:
// the Platform route, the signed request and the Custom endpoint must accept exactly the same commands.
const prefix = 'QA_CONTRACT_'
process.env.GERARD_PLATFORM_INSTANCE_SHARED_SECRET = 'qa-contract-channel-secret'
process.env.GERARD_INSTANCE_ENVIRONMENT = 'development'
process.env.GERARD_PLATFORM_INSTANCE_NOVOTRALUX_DEVELOPMENT_CONFIGURATION_ENDPOINT = 'https://novotralux-qa.invalid/api/internal/platform/configuration'
process.env.GERARD_APPLICATION_ID = 'novotralux'
process.env.GERARD_INSTANCE_ORGANIZATION_ID = 'org-novotralux'

function response() {
  let statusCode = 200
  let payload: any = null
  return { status(code: number) { statusCode = code; return this }, json(value: unknown) { payload = value; return this }, setHeader() {}, get statusCode() { return statusCode }, get payload() { return payload } }
}
function request(session: any, method: string, body: any = {}, query: any = {}, headers: Record<string, string> = {}) {
  return { method, body, query, headers: { ...(session ? { cookie: `${sessionCookieName}=${createSessionToken(session)}` } : {}), ...headers } } as any
}
async function call(handler: (req: any, res: any) => unknown, req: any) { const res = response(); await handler(req, res); return res }

// ─── Shared Core parser ──────────────────────────────────────────────────
assert.deepEqual(parsePlatformCommand('getConfiguration', undefined), { ok: true, kind: 'read', action: 'getConfiguration', payload: {} }, 'read without payload')
assert.equal(parsePlatformCommand('getOrgAdmins', {}).ok, true, 'read with empty payload')
assert.deepEqual(parsePlatformCommand('getOrgAdmins', { organizationId: 'other' }), { ok: false, error: 'INVALID_CONFIGURATION_PAYLOAD' }, 'read rejects arbitrary payload')
assert.deepEqual(parsePlatformCommand('resetOrgAdminPassword', {}), { ok: false, error: 'INVALID_CONFIGURATION_PAYLOAD' }, 'recovery requires userId')
assert.deepEqual(parsePlatformCommand('resetOrgAdminPassword', { userId: 'u', role: 'SUPER_ADMIN' }), { ok: false, error: 'INVALID_CONFIGURATION_PAYLOAD' }, 'recovery rejects extra fields')
assert.deepEqual(parsePlatformCommand('reactivateOrgAdmin', { userId: 'u' }), { ok: true, kind: 'recovery', action: 'reactivateOrgAdmin', payload: { userId: 'u' } }, 'recovery exact payload')
assert.equal(parsePlatformCommand('updateModules', { enabledModules: [] }).ok, true, 'write keeps its payload')
assert.deepEqual(parsePlatformCommand('dropDatabase', {}), { ok: false, error: 'UNSUPPORTED_CONFIGURATION_ACTION' }, 'unknown action')

async function main() {
  const createdOrganization = !(await prisma.organization.findUnique({ where: { id: 'org-novotralux' }, select: { id: true } }))
  if (createdOrganization) await prisma.organization.create({ data: { id: 'org-novotralux', name: 'QA Contract Novotralux', slug: 'qa-contract-novotralux' } })
  const passwordHash = hashPassword('Qa!OldPassword2026')
  const user = (key: string, extra: Record<string, unknown> = {}) => prisma.user.create({ data: { id: `${prefix}${key}`, name: `QA ${key}`, firstName: 'QA', lastName: key, username: `qa_contract_${key.toLowerCase()}`, passwordHash, role: UserRole.DISPATCHER, isActive: true, mustChangePassword: false, ...extra } })
  const realFetch = globalThis.fetch
  try {
    const superUser = await user('SUPER', { platformRole: 'SUPER_ADMIN', role: UserRole.ADMIN })
    const supportUser = await user('SUPPORT', { platformRole: 'PLATFORM_SUPPORT' })
    const orgAdmin = await user('ORG_ADMIN')
    await prisma.organizationUser.create({ data: { organizationId: 'org-novotralux', userId: orgAdmin.id, role: OrganizationRole.ORG_ADMIN } })
    const orgAdminSession = { ...orgAdmin, organizationId: 'org-novotralux', organizationRole: OrganizationRole.ORG_ADMIN }

    // The signed request produced by the Platform is delivered to the current Custom endpoint, unchanged.
    const delivered: any[] = []
    globalThis.fetch = (async (_url: string, init: any) => {
      const custom = response()
      delivered.push(JSON.parse(init.body).request)
      await customConfigurationHandler(request(null, 'POST', JSON.parse(init.body), {}, init.headers), custom as any)
      return new Response(JSON.stringify(custom.payload), { status: custom.statusCode, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    // Exactly what pages/admin.tsx sends.
    const platform = (session: any, body: Record<string, unknown>) => call(platformInstanceConfigurationHandler, request(session, 'POST', body, { application: 'novotralux' }))
    const notGeneric = (res: any) => !JSON.stringify(res.payload).includes('Invalid configuration request')

    const configuration = await platform(superUser, { action: 'getConfiguration' })
    assert.equal(configuration.statusCode, 200, '1 getConfiguration SUPER_ADMIN')
    assert.ok(notGeneric(configuration) && configuration.payload.configuration.organizationId === 'org-novotralux', '1 no generic rejection, real snapshot')
    const admins = await platform(superUser, { action: 'getOrgAdmins' })
    assert.equal(admins.statusCode, 200, '2 getOrgAdmins SUPER_ADMIN')
    assert.ok(notGeneric(admins) && admins.payload.admins.some((item: any) => item.userId === orgAdmin.id), '2 lists ORG_ADMIN')
    assert.equal((await platform(supportUser, { action: 'getConfiguration' })).statusCode, 200, '3 getConfiguration PLATFORM_SUPPORT')
    assert.equal((await platform(supportUser, { action: 'getOrgAdmins' })).statusCode, 200, '4 getOrgAdmins PLATFORM_SUPPORT')
    assert.equal((await platform(supportUser, { action: 'resetOrgAdminPassword', payload: { userId: orgAdmin.id } })).statusCode, 403, '5 PLATFORM_SUPPORT recovery denied')
    assert.equal((await platform(orgAdminSession, { action: 'getOrgAdmins' })).statusCode, 403, '6 ORG_ADMIN denied read')
    assert.equal((await platform(orgAdminSession, { action: 'resetOrgAdminPassword', payload: { userId: orgAdmin.id } })).statusCode, 403, '6 ORG_ADMIN denied recovery')
    assert.equal((await platform(superUser, { action: 'getOrgAdmins', payload: {} })).statusCode, 200, '7 empty read payload accepted')
    const missing = await platform(superUser, { action: 'resetOrgAdminPassword', payload: {} })
    assert.deepEqual([missing.statusCode, missing.payload.code], [400, 'INVALID_CONFIGURATION_PAYLOAD'], '8 missing userId rejected at the Platform')
    const extra = await platform(superUser, { action: 'getConfiguration', payload: { organizationId: 'other' } })
    assert.deepEqual([extra.statusCode, extra.payload.code], [400, 'INVALID_CONFIGURATION_PAYLOAD'], '9 extra fields rejected')
    assert.equal((await platform(superUser, { action: 'invalidateOrgAdminSessions', payload: { userId: orgAdmin.id, isActive: false } })).statusCode, 400, '9 extra recovery fields rejected')
    const deliveredBefore = delivered.length
    const reset = await platform(superUser, { action: 'resetOrgAdminPassword', payload: { userId: orgAdmin.id } })
    assert.equal(reset.statusCode, 200, '10 Custom accepts the canonical recovery request')
    assert.deepEqual(Object.keys(delivered[deliveredBefore].payload), ['userId'], '10 signed payload is exactly { userId }')
    const after = await prisma.user.findUniqueOrThrow({ where: { id: orgAdmin.id } })
    assert.ok(verifyPassword(reset.payload.temporaryPassword, after.passwordHash!) && after.mustChangePassword, '10 recovery applied on the instance')
    assert.ok(delivered.every((item) => item.organizationId === 'org-novotralux' && item.application === 'novotralux'), 'instance binding carried in every request')
    assert.ok(delivered.every((item) => item.action !== 'getOrgAdmins' || Object.keys(item.payload).length === 0), 'reads signed with an empty payload')

    // An instance built before an action existed is reported as version skew, never as a bad request.
    for (const legacy of [{ error: 'Invalid configuration request' }, { error: 'UNSUPPORTED_CONFIGURATION_ACTION', coreVersion: '1.0.0' }]) {
      globalThis.fetch = (async () => new Response(JSON.stringify(legacy), { status: 400, headers: { 'content-type': 'application/json' } })) as typeof fetch
      const outdated = await platform(superUser, { action: 'getConfiguration' })
      assert.equal(outdated.statusCode, 409, 'outdated instance → 409')
      assert.equal(outdated.payload.code, 'CUSTOM_INSTANCE_OUTDATED', 'outdated instance named')
      assert.equal(outdated.payload.endpointHost, 'novotralux-qa.invalid', 'endpoint host reported for diagnosis')
    }
    console.log('Platform-to-Custom command contract (shared parser, reads, recovery, roles, version skew): OK')
  } finally {
    globalThis.fetch = realFetch
    await prisma.platformAuditLog.deleteMany({ where: { OR: [{ actorUserId: { startsWith: prefix } }, { metadata: { path: ['userId'], string_starts_with: prefix } }] } })
    await prisma.organizationUser.deleteMany({ where: { userId: { startsWith: prefix } } })
    await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } })
    if (createdOrganization) await prisma.organization.deleteMany({ where: { id: 'org-novotralux' } })
  }
}

main().finally(() => prisma.$disconnect())
