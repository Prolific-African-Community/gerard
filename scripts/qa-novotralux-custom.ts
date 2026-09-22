import { config } from 'dotenv'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

config({ path: '../../.env.production.local', quiet: true })
config({ path: '../../.env.local', quiet: true })
config({ path: '../../.env', quiet: true })

async function main() {
  const target = process.env.LEGACY_TARGET_DATABASE_URL
  const prototype = process.env.DATABASE_URL
  if (!target || target === process.env.LEGACY_SOURCE_DATABASE_URL || target === prototype) throw new Error('ISOLATED_LEGACY_TARGET_REQUIRED')
  process.env.DATABASE_URL = target
  const { createSessionToken, sessionCookieName } = await import('../lib/auth/session')
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target }) })
  try {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: 'org-novotralux' } })
    const membership = await prisma.organizationUser.findFirstOrThrow({ where: { organizationId: org.id, role: 'ORG_ADMIN' }, include: { user: true } })
    const token = createSessionToken({ ...membership.user, organizationId: org.id, organizationRole: membership.role, platformRole: null })
    const headers = { cookie: `${sessionCookieName}=${encodeURIComponent(token)}` }
    const sourceMail = await prisma.missionSourceEmail.findFirstOrThrow({ where: { organizationId: org.id, missionId: { not: null } }, select: { missionId: true } })
    if (!sourceMail.missionId) throw new Error('SOURCE_MAIL_MISSION_REQUIRED')
    const endpoints = [
      '/api/dispatch/overview', '/api/dispatch/client-profiles', '/api/dispatch/mail-imports', '/api/dispatch/invoices',
      '/api/dispatch/maintenance-requests', '/api/dispatch/profitability', '/api/dispatch/drivers', '/api/dispatch/trucks',
      '/api/dispatch/trailers', '/api/park/overview', '/api/park/inspections',
      `/api/dispatch/missions/${encodeURIComponent(sourceMail.missionId)}/source-email`, '/api/tenant/branding',
    ]
    const statuses: Record<string, number> = {}; const failures: Record<string, unknown> = {}
    for (const endpoint of endpoints) {
      const response = await fetch(`http://localhost:3108${endpoint}`, { headers }); statuses[endpoint] = response.status
      if (!response.ok) failures[endpoint] = await response.json().catch(() => null)
    }
    const counts = {
      users: await prisma.organizationUser.count({ where: { organizationId: org.id } }), clients: await prisma.clientProfile.count({ where: { organizationId: org.id } }),
      drivers: await prisma.driver.count({ where: { organizationId: org.id } }), trucks: await prisma.truck.count({ where: { organizationId: org.id } }),
      trailers: await prisma.trailer.count({ where: { organizationId: org.id } }), missions: await prisma.mission.count({ where: { organizationId: org.id } }),
      planningRows: await prisma.planningRow.count({ where: { organizationId: org.id } }), assignments: await prisma.missionAssignment.count({ where: { organizationId: org.id } }),
      invoices: await prisma.invoice.count({ where: { organizationId: org.id } }), maintenance: await prisma.maintenanceRequest.count({ where: { organizationId: org.id } }),
      sourceMails: await prisma.missionSourceEmail.count({ where: { organizationId: org.id } }), ignoredImports: await prisma.ignoredMailImport.count({ where: { organizationId: org.id } }),
      missionEvents: await prisma.missionEvent.count({ where: { organizationId: org.id } }), parkSpots: await prisma.parkSpot.count({ where: { organizationId: org.id } }),
      parkMovements: await prisma.parkMovement.count({ where: { organizationId: org.id } }), parkInspections: await prisma.parkInspection.count({ where: { organizationId: org.id } }),
    }
    const invoiceAggregate = await prisma.invoice.aggregate({ where: { organizationId: org.id }, _sum: { totalAmount: true } })
    const invoiceStatuses = await prisma.invoice.groupBy({ by: ['status'], where: { organizationId: org.id }, _count: true })
    const roleCounts = await prisma.organizationUser.groupBy({ by: ['role'], where: { organizationId: org.id }, _count: true })
    const roleStatuses: Record<string, number> = { ORG_ADMIN: statuses['/api/dispatch/overview'] }
    for (const [role, endpoint] of [['DISPATCHER', '/api/dispatch/overview'], ['DRIVER', '/api/driver/overview']] as const) {
      const roleMembership = await prisma.organizationUser.findFirstOrThrow({ where: { organizationId: org.id, role }, include: { user: true } })
      const roleToken = createSessionToken({ ...roleMembership.user, organizationId: org.id, organizationRole: roleMembership.role, platformRole: null })
      roleStatuses[role] = (await fetch(`http://localhost:3108${endpoint}`, { headers: { cookie: `${sessionCookieName}=${encodeURIComponent(roleToken)}` } })).status
    }
    const integrations = await prisma.organizationIntegration.findMany({ where: { organizationId: org.id }, select: { type: true, enabled: true, secretRef: true } })
    console.log(JSON.stringify({ organization: { id: org.id, displayName: org.displayName, accentColor: org.accentColor }, counts,
      invoiceTotal: invoiceAggregate._sum.totalAmount?.toString() ?? '0', invoiceStatuses, roleCounts, roleStatuses, statuses, failures, integrations }, null, 2))
    if ([...Object.values(statuses), ...Object.values(roleStatuses)].some((status) => status !== 200)) process.exitCode = 1
  } finally { await prisma.$disconnect() }
}
void main()
