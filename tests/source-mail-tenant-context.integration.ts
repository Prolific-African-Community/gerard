import assert from 'node:assert/strict'
import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../lib/prisma'
import { runWithOrganization } from '../lib/auth/organization-context'
import { createSessionToken, sessionCookieName } from '../lib/auth/session'
import sourceEmailHandler from '../pages/api/dispatch/missions/[id]/source-email'

const prefix = 'QA_SOURCE_MAIL_'

function response() {
  let statusCode = 200
  let body: unknown
  const res = { status(code: number) { statusCode = code; return this }, json(value: unknown) { body = value; return this }, setHeader() { return this } } as unknown as NextApiResponse
  return { res, read: () => ({ statusCode, body }) }
}

function request(user: { id: string; username: string | null; role: any; driverId?: string | null; sessionVersion: number }, organizationId: string, organizationRole: any, missionId: string) {
  const token = createSessionToken({ ...user, organizationId, organizationRole, platformRole: null })
  return { method: 'GET', query: { id: missionId }, headers: { host: 'localhost:3000', cookie: `${sessionCookieName}=${encodeURIComponent(token)}` } } as unknown as NextApiRequest
}

async function call(req: NextApiRequest) {
  const target = response()
  await sourceEmailHandler(req, target.res)
  return target.read()
}

async function main() {
  const organizationA = await prisma.organization.create({ data: { id: `${prefix}ORG_A`, name: 'QA Source Mail A', slug: 'qa-source-mail-a' } })
  const organizationB = await prisma.organization.create({ data: { id: `${prefix}ORG_B`, name: 'QA Source Mail B', slug: 'qa-source-mail-b' } })
  const adminA = await prisma.user.create({ data: { id: `${prefix}ADMIN_A`, name: 'Admin A', username: 'qa_source_mail_admin_a', role: 'ADMIN', isActive: true, mustChangePassword: false } })
  const adminB = await prisma.user.create({ data: { id: `${prefix}ADMIN_B`, name: 'Admin B', username: 'qa_source_mail_admin_b', role: 'ADMIN', isActive: true, mustChangePassword: false } })
  const driverA = await prisma.user.create({ data: { id: `${prefix}DRIVER_A`, name: 'Driver A', username: 'qa_source_mail_driver_a', role: 'DRIVER', isActive: true, mustChangePassword: false } })
  await prisma.organizationUser.createMany({ data: [
    { id: `${prefix}MEMBER_A`, organizationId: organizationA.id, userId: adminA.id, role: 'ORG_ADMIN' },
    { id: `${prefix}MEMBER_B`, organizationId: organizationB.id, userId: adminB.id, role: 'ORG_ADMIN' },
    { id: `${prefix}MEMBER_DRIVER`, organizationId: organizationA.id, userId: driverA.id, role: 'DRIVER' },
  ] })
  const contextA = { organizationId: organizationA.id, organizationRole: 'ORG_ADMIN' as const, platformRole: null, userId: adminA.id }
  const contextB = { organizationId: organizationB.id, organizationRole: 'ORG_ADMIN' as const, platformRole: null, userId: adminB.id }
  try {
    const missionA = await runWithOrganization(contextA, async () => await prisma.mission.create({ data: { id: `${prefix}MISSION_A`, reference: 'QA-SOURCE-A' } }))
    const missionWithoutMail = await runWithOrganization(contextA, async () => await prisma.mission.create({ data: { id: `${prefix}MISSION_EMPTY`, reference: 'QA-SOURCE-EMPTY' } }))
    await runWithOrganization(contextA, async () => await prisma.missionSourceEmail.create({ data: { id: `${prefix}EMAIL_A`, missionId: missionA.id, source: 'QA', sourceEmailId: 'qa-a', subject: 'Tenant A source' } }))
    const missionB = await runWithOrganization(contextB, async () => await prisma.mission.create({ data: { id: `${prefix}MISSION_B`, reference: 'QA-SOURCE-B' } }))
    const emailB = await runWithOrganization(contextB, async () => await prisma.missionSourceEmail.create({ data: { id: `${prefix}EMAIL_B`, missionId: missionB.id, source: 'QA', sourceEmailId: 'qa-b', subject: 'Tenant B source' } }))

    assert.equal((await call(request(adminA, organizationA.id, 'ORG_ADMIN', missionA.id))).statusCode, 200, 'A')
    assert.equal((await call(request(adminA, organizationA.id, 'ORG_ADMIN', missionB.id))).statusCode, 404, 'B')
    await runWithOrganization(contextA, async () => assert.equal(await prisma.missionSourceEmail.findUnique({ where: { id: emailB.id } }), null, 'C'))
    assert.equal((await call({ method: 'GET', query: { id: missionA.id }, headers: { host: 'localhost:3000' } } as unknown as NextApiRequest)).statusCode, 401, 'D')
    assert.equal((await call(request(driverA, organizationA.id, 'DRIVER', missionA.id))).statusCode, 403, 'E')
    assert.equal((await call(request(adminA, organizationA.id, 'ORG_ADMIN', missionWithoutMail.id))).statusCode, 404, 'F')
    await prisma.organization.update({ where: { id: organizationA.id }, data: { status: 'SUSPENDED' } })
    assert.equal((await call(request(adminA, organizationA.id, 'ORG_ADMIN', missionA.id))).statusCode, 401, 'G')
    await prisma.organization.update({ where: { id: organizationA.id }, data: { status: 'ACTIVE' } })
    console.log('A-G source mail tenant context and permissions: OK')
  } finally {
    await prisma.organization.updateMany({ where: { id: { in: [organizationA.id, organizationB.id] } }, data: { status: 'ACTIVE' } })
    await runWithOrganization(contextA, async () => { await prisma.missionSourceEmail.deleteMany({ where: { id: { startsWith: prefix } } }); await prisma.mission.deleteMany({ where: { id: { startsWith: prefix } } }) })
    await runWithOrganization(contextB, async () => { await prisma.missionSourceEmail.deleteMany({ where: { id: { startsWith: prefix } } }); await prisma.mission.deleteMany({ where: { id: { startsWith: prefix } } }) })
    await prisma.organizationUser.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } })
    await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } })
    await prisma.organization.deleteMany({ where: { id: { in: [organizationA.id, organizationB.id] } } })
  }
}

main().finally(() => prisma.$disconnect())
