import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { runWithOrganization } from '../lib/auth/organization-context'
import { analyzePlanningForSuggestions } from '../lib/dispatch/suggestions/planning-service'
import { buildAutoPlanningSnapshot } from '../lib/dispatch/auto-planning/snapshot'
import { createSessionToken, sessionCookieName } from '../lib/auth/session'
import { requirePermission } from '../lib/auth/authorization'
import { permissions } from '../lib/auth/permissions'

const prefix = 'QA_TENANT_B_'
const weekStart = new Date(2030, 0, 7)
const weekMissionDate = new Date(2030, 0, 8, 8)

async function main() {
  const gerardMembership = await prisma.organizationUser.findFirst({
    where: { organization: { status: 'ACTIVE' } },
    include: { user: true },
  })
  if (!gerardMembership) throw new Error('GERARD_MEMBERSHIP_MISSING')
  const contextA = {
    organizationId: gerardMembership.organizationId,
    organizationRole: gerardMembership.role,
    platformRole: gerardMembership.user.platformRole,
    userId: gerardMembership.userId,
  }
  const organizationB = await prisma.organization.create({ data: { id: `${prefix}ORG`, name: 'QA Tenant B', slug: 'qa-tenant-b' } })
  const userB = await prisma.user.create({ data: { id: `${prefix}USER`, name: 'QA Tenant B User', firstName: 'QA', lastName: 'Tenant B', username: 'qa_tenant_b_user', role: 'ADMIN', isActive: true, mustChangePassword: false } })
  const membershipB = await prisma.organizationUser.create({ data: { id: `${prefix}MEMBERSHIP`, organizationId: organizationB.id, userId: userB.id, role: 'ORG_ADMIN' } })
  const contextB = { organizationId: organizationB.id, organizationRole: membershipB.role, platformRole: null, userId: userB.id }

  try {
    const fixture = await runWithOrganization(contextB, async () => {
      const driver = await prisma.driver.create({ data: { id: `${prefix}DRIVER`, name: 'QA Driver B' } })
      const truck = await prisma.truck.create({ data: { id: `${prefix}TRUCK`, plateNumber: 'QA-B-TRUCK' } })
      const trailer = await prisma.trailer.create({ data: { id: `${prefix}TRAILER`, plateNumber: 'QA-B-TRAILER', type: 'CURTAINSIDER' } })
      const mission = await prisma.mission.create({ data: { id: `${prefix}MISSION`, reference: 'QA-B-MISSION', clientName: 'QA Client B', pickupDate: weekMissionDate, deliveryDate: new Date(2030, 0, 8, 12), status: 'ASSIGNED' } })
      const row = await prisma.planningRow.create({ data: { id: `${prefix}ROW`, weekStartDate: weekStart, driverId: driver.id, truckId: truck.id } })
      const assignment = await prisma.missionAssignment.create({ data: { id: `${prefix}ASSIGNMENT`, missionId: mission.id, planningRowId: row.id, driverId: driver.id, truckId: truck.id, trailerId: trailer.id, day: 'TUESDAY', scheduledDate: weekMissionDate, plannedEndAt: new Date(2030, 0, 8, 12) } })
      const invoice = await prisma.invoice.create({ data: { id: `${prefix}INVOICE`, direction: 'ISSUED', invoiceNumber: 'QA-B-INV', status: 'DRAFT', missionId: mission.id, sellerName: 'QA Tenant B', buyerName: 'QA Client B' } })
      return { driver, truck, trailer, mission, assignment, invoice }
    })

    await runWithOrganization(contextA, async () => {
      assert.equal((await prisma.mission.findMany()).some((item) => item.id === fixture.mission.id), false, 'A')
      assert.equal(await prisma.mission.findUnique({ where: { id: fixture.mission.id } }), null, 'B')
      await assert.rejects(() => prisma.mission.update({ where: { id: fixture.mission.id }, data: { notes: 'cross tenant' } }), (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025', 'C')
      assert.equal(await prisma.mission.deleteMany({ where: { id: fixture.mission.id } }).then((value) => value.count), 0, 'D')
      assert.equal(await prisma.missionAssignment.findUnique({ where: { id: fixture.assignment.id } }), null, 'E')
      assert.equal(await prisma.driver.findUnique({ where: { id: fixture.driver.id } }), null, 'F-driver')
      assert.equal(await prisma.truck.findUnique({ where: { id: fixture.truck.id } }), null, 'F-truck')
      assert.equal(await prisma.trailer.findUnique({ where: { id: fixture.trailer.id } }), null, 'F-trailer')
      assert.equal(await prisma.invoice.findUnique({ where: { id: fixture.invoice.id } }), null, 'G')
      const analysis = await analyzePlanningForSuggestions(weekStart)
      assert.equal(analysis.missionDiagnostics.some((item) => item.missionId === fixture.mission.id), false, 'H')
      const snapshot = await buildAutoPlanningSnapshot({ weekStartDate: weekStart, includeExistingForced: true, now: new Date(2030, 0, 7, 4), prepareCandidateRoutes: false })
      assert.equal(snapshot.input.missions.some((item) => item.id === fixture.mission.id), false, 'I-mission')
      assert.equal(snapshot.input.pairs.some((item) => item.pair.driverId === fixture.driver.id || item.pair.truckId === fixture.truck.id), false, 'I-resources')
      const forced = await prisma.mission.create({ data: { id: `${prefix}FORCED_A`, organizationId: organizationB.id, reference: 'QA-A-FORCED', status: 'PENDING' } })
      assert.equal(forced.organizationId, contextA.organizationId, 'J/K')
      await prisma.mission.delete({ where: { id: forced.id } })
    })

    const orphan = await prisma.user.create({ data: { id: `${prefix}ORPHAN`, name: 'QA Orphan', firstName: 'QA', lastName: 'Orphan', username: 'qa_tenant_orphan', role: 'DISPATCHER', isActive: true, mustChangePassword: false } })
    let status = 200
    const req = { headers: { cookie: `${sessionCookieName}=${createSessionToken(orphan)}` } } as any
    const res = { status(code: number) { status = code; return this }, json() { return this } } as any
    assert.equal(await requirePermission(req, res, permissions.dispatchView), null, 'L')
    assert.equal(status, 401, 'L-status')
    await prisma.user.delete({ where: { id: orphan.id } })
    await assert.rejects(
      () => prisma.mission.count(),
      /ORGANIZATION_CONTEXT_REQUIRED:Mission:count/,
      'unscoped persistence access must fail closed',
    )
    console.log('A-L isolation multi-tenant: OK')
  } finally {
    await runWithOrganization(contextB, async () => {
      await prisma.invoice.deleteMany({ where: { id: { startsWith: prefix } } })
      await prisma.missionAssignment.deleteMany({ where: { id: { startsWith: prefix } } })
      await prisma.planningRow.deleteMany({ where: { id: { startsWith: prefix } } })
      await prisma.mission.deleteMany({ where: { id: { startsWith: prefix } } })
      await prisma.trailer.deleteMany({ where: { id: { startsWith: prefix } } })
      await prisma.truck.deleteMany({ where: { id: { startsWith: prefix } } })
      await prisma.driver.deleteMany({ where: { id: { startsWith: prefix } } })
    })
    await prisma.organizationUser.deleteMany({ where: { organizationId: organizationB.id } })
    await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } })
    await prisma.organization.deleteMany({ where: { id: organizationB.id } })
  }
}

main().finally(() => prisma.$disconnect())
