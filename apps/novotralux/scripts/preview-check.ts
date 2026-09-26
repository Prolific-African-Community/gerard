import { PREVIEW_ORGANIZATION_ID, connectPreviewDatabase } from './preview-database'

// Read-only readiness check of the Novotralux Preview database.
async function main() {
  const { prisma, endpoint } = connectPreviewDatabase()
  try {
    const organization = await prisma.organization.findUnique({ where: { id: PREVIEW_ORGANIZATION_ID }, select: { id: true, status: true, displayName: true } })
    const admin = await prisma.user.findFirst({ where: { username: 'preview.admin' }, select: { isActive: true, mustChangePassword: true, platformRole: true, organizationMemberships: { select: { organizationId: true, role: true } } } })
    const report = {
      database: endpoint,
      organization: organization ? { id: organization.id, status: organization.status, displayName: organization.displayName } : null,
      previewAdmin: admin ? { active: admin.isActive, mustChangePassword: admin.mustChangePassword, platformRole: admin.platformRole, memberships: admin.organizationMemberships } : null,
      users: await prisma.user.count(),
    }
    console.log(JSON.stringify(report, null, 2))
    const ready = organization?.status === 'ACTIVE' && admin?.isActive && !admin.platformRole && admin.organizationMemberships.some((m) => m.organizationId === PREVIEW_ORGANIZATION_ID && m.role === 'ORG_ADMIN')
    console.log(ready ? 'PREVIEW READY' : 'PREVIEW NOT READY: recover preview.admin from the SUPER_ADMIN workspace (docs/CUSTOM_PREVIEW_WORKFLOW.md)')
    if (!ready) process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'PREVIEW_CHECK_FAILED'); process.exitCode = 1 })
