import { randomBytes, scryptSync } from 'node:crypto'
import { PrismaPg } from '@prisma/adapter-pg'
import { OrganizationIntegrationType, OrganizationRole, PlatformAuditAction, PrismaClient, UserRole } from '@prisma/client'

function hashPreviewPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

const previewUrl = process.env.NOVOTRALUX_CUSTOM_PREVIEW_DATABASE_URL
if (!previewUrl || process.env.DATABASE_URL !== previewUrl) throw new Error('NOVOTRALUX_PREVIEW_DATABASE_URL_REQUIRED')
if (process.env.GERARD_INSTANCE_ENVIRONMENT !== 'preview') throw new Error('NOVOTRALUX_PREVIEW_ENVIRONMENT_REQUIRED')
if (process.env.NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL === previewUrl) throw new Error('NOVOTRALUX_PREVIEW_DATABASE_MUST_DIFFER_FROM_PRODUCTION')

const adminPassword = process.env.NOVOTRALUX_PREVIEW_ADMIN_TEMP_PASSWORD
if (!adminPassword || adminPassword.length < 20) throw new Error('NOVOTRALUX_PREVIEW_ADMIN_TEMP_PASSWORD_REQUIRED')
const validatedAdminPassword = adminPassword

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: previewUrl }) })
const organizationId = 'org-novotralux'
const memberSpecs = [
  { id: 'preview-novotralux-admin', firstName: 'Aline', lastName: 'Aperçu', username: 'preview.admin', email: 'aline.apercu@example.invalid', role: OrganizationRole.ORG_ADMIN, userRole: UserRole.ADMIN, isActive: true, mustChangePassword: false, lastLoginAt: new Date('2026-09-24T08:30:00Z') },
  { id: 'preview-novotralux-dispatcher', firstName: 'Didier', lastName: 'Démo', username: 'preview.dispatcher', email: 'didier.demo@example.invalid', role: OrganizationRole.DISPATCHER, userRole: UserRole.DISPATCHER, isActive: true, mustChangePassword: false, lastLoginAt: new Date('2026-09-23T14:15:00Z') },
  { id: 'preview-novotralux-manager', firstName: 'Mina', lastName: 'Maquette', username: 'preview.manager', email: 'mina.maquette@example.invalid', role: OrganizationRole.MANAGER, userRole: UserRole.DISPATCHER, isActive: true, mustChangePassword: true, lastLoginAt: null },
  { id: 'preview-novotralux-driver', firstName: 'Dorian', lastName: 'Fictif', username: 'preview.driver', email: 'dorian.fictif@example.invalid', role: OrganizationRole.DRIVER, userRole: UserRole.DRIVER, isActive: true, mustChangePassword: false, lastLoginAt: new Date('2026-09-20T06:45:00Z') },
  { id: 'preview-novotralux-disabled', firstName: 'Diane', lastName: 'Désactivée', username: 'preview.disabled', email: 'diane.disabled@example.invalid', role: OrganizationRole.VIEWER, userRole: UserRole.DISPATCHER, isActive: false, mustChangePassword: false, lastLoginAt: new Date('2026-08-12T10:00:00Z') },
  { id: 'preview-novotralux-secretary', firstName: 'Sophie', lastName: 'Synthétique', username: 'preview.secretary', email: 'sophie.synthetic@example.invalid', role: OrganizationRole.SECRETARY, userRole: UserRole.SECRETARY, isActive: true, mustChangePassword: false, lastLoginAt: new Date('2026-09-22T09:10:00Z') },
] as const

async function main() {
  const existingBusinessRows = await Promise.all([
    prisma.mission.count(), prisma.invoice.count(), prisma.missionSourceEmail.count(), prisma.maintenanceRequest.count(),
  ])
  if (existingBusinessRows.some(Boolean)) throw new Error('NOVOTRALUX_PREVIEW_DATABASE_NOT_EMPTY')
  const existingUsers = await prisma.user.findMany({ select: { id: true, email: true } })
  const allowedIds = new Set<string>(memberSpecs.map((member) => member.id))
  if (existingUsers.some((user) => !allowedIds.has(user.id))) throw new Error('NOVOTRALUX_PREVIEW_CONTAINS_UNEXPECTED_USERS')

  await prisma.$transaction(async (tx) => {
    await tx.organization.upsert({
      where: { id: organizationId },
      update: { name: 'Novotralux Preview', status: 'ACTIVE', displayName: 'Novotralux Preview', applicationTitle: 'Novotralux — Preview', accentColor: '#C8FF00' },
      create: { id: organizationId, slug: 'novotralux', name: 'Novotralux Preview', status: 'ACTIVE', displayName: 'Novotralux Preview', applicationTitle: 'Novotralux — Preview', accentColor: '#C8FF00' },
    })
    for (const member of memberSpecs) {
      const passwordHash = hashPreviewPassword(member.id === 'preview-novotralux-admin' ? validatedAdminPassword : randomBytes(32).toString('base64url'))
      await tx.user.upsert({
        where: { id: member.id },
        update: { firstName: member.firstName, lastName: member.lastName, name: `${member.firstName} ${member.lastName}`, username: member.username, email: member.email, role: member.userRole, platformRole: null, isActive: member.isActive, mustChangePassword: member.mustChangePassword, lastLoginAt: member.lastLoginAt, passwordHash },
        create: { id: member.id, firstName: member.firstName, lastName: member.lastName, name: `${member.firstName} ${member.lastName}`, username: member.username, email: member.email, role: member.userRole, platformRole: null, isActive: member.isActive, mustChangePassword: member.mustChangePassword, lastLoginAt: member.lastLoginAt, passwordHash },
      })
      await tx.organizationUser.upsert({
        where: { organizationId_userId: { organizationId, userId: member.id } },
        update: { role: member.role },
        create: { id: `membership-${member.id}`, organizationId, userId: member.id, role: member.role },
      })
    }
    await tx.organizationIntegration.upsert({ where: { organizationId_type: { organizationId, type: OrganizationIntegrationType.MAIL_INTAKE } }, update: { enabled: false, secretRef: null, configJson: { provider: 'disabled', mailboxAddress: 'preview-mailbox@example.invalid' } }, create: { id: 'preview-integration-mail', organizationId, type: OrganizationIntegrationType.MAIL_INTAKE, enabled: false, configJson: { provider: 'disabled', mailboxAddress: 'preview-mailbox@example.invalid' } } })
    await tx.organizationIntegration.upsert({ where: { organizationId_type: { organizationId, type: OrganizationIntegrationType.SL_AUTOMOTIVE } }, update: { enabled: false, secretRef: null, configJson: { providerName: 'SL Automotive', preview: true } }, create: { id: 'preview-integration-sl', organizationId, type: OrganizationIntegrationType.SL_AUTOMOTIVE, enabled: false, configJson: { providerName: 'SL Automotive', preview: true } } })
    await tx.platformAuditLog.deleteMany({ where: { organizationId, id: { startsWith: 'preview-audit-' } } })
    await tx.platformAuditLog.createMany({ data: [
      { id: 'preview-audit-1', actorUserId: memberSpecs[0].id, organizationId, action: PlatformAuditAction.MEMBER_ADDED, metadata: { targetUserId: memberSpecs[1].id, previewFixture: true }, createdAt: new Date('2026-09-20T08:00:00Z') },
      { id: 'preview-audit-2', actorUserId: memberSpecs[0].id, organizationId, action: PlatformAuditAction.MEMBER_ROLE_CHANGED, metadata: { targetUserId: memberSpecs[2].id, previewFixture: true }, createdAt: new Date('2026-09-22T11:30:00Z') },
      { id: 'preview-audit-3', actorUserId: memberSpecs[0].id, organizationId, action: PlatformAuditAction.SESSION_INVALIDATED, metadata: { targetUserId: memberSpecs[4].id, previewFixture: true }, createdAt: new Date('2026-09-24T07:45:00Z') },
    ] })
  })

  const counts = {
    organizations: await prisma.organization.count(), users: await prisma.user.count(), memberships: await prisma.organizationUser.count(),
    missions: await prisma.mission.count(), invoices: await prisma.invoice.count(), sourceEmails: await prisma.missionSourceEmail.count(),
    integrations: await prisma.organizationIntegration.count(), auditEvents: await prisma.platformAuditLog.count(),
  }
  console.info(JSON.stringify(counts))
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'PREVIEW_SEED_FAILED'); process.exitCode = 1 }).finally(() => prisma.$disconnect())
