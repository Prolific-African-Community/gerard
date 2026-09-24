import {
  OrganizationModule,
  OrganizationRole,
  OrganizationStatus,
  PlatformAuditAction,
  Prisma,
  UserRole,
  OrganizationIntegrationType,
} from '@prisma/client'

import { runWithOrganization } from '../auth/organization-context'
import { hashPassword } from '../auth/password'
import { prisma } from '../prisma'
import { normalizeAccentColor, normalizeBrandAssetUrl } from '../tenant/branding'
import { normalizeHostname, normalizePathPrefix } from '../tenant/request-resolution'
import { normalizeInvoicePrefix } from '../tenant/billing-config'
import { sanitizeIntegration } from '../integrations/config'

export const organizationModules = Object.values(OrganizationModule)
export const organizationRoles = Object.values(OrganizationRole)

export function normalizeSlug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function isOrganizationStatus(value: unknown): value is OrganizationStatus {
  return Object.values(OrganizationStatus).includes(value as OrganizationStatus)
}

export function parseModules(value: unknown) {
  if (!Array.isArray(value)) return null
  const modules = Array.from(new Set(value))
  return modules.every((item) => organizationModules.includes(item as OrganizationModule))
    ? modules as OrganizationModule[]
    : null
}

async function tenantMetrics(organizationId: string) {
  return runWithOrganization(
    { organizationId, organizationRole: OrganizationRole.ORG_ADMIN, platformRole: null, userId: 'platform-metrics' },
    async () => {
      const [missions, drivers, trucks, trailers, invoices] = await Promise.all([
        prisma.mission.count(),
        prisma.driver.count(),
        prisma.truck.count(),
        prisma.trailer.count(),
        prisma.invoice.count(),
      ])
      return { missions, drivers, trucks, trailers, invoices }
    },
  )
}

export async function listOrganizations() {
  const organizations = await prisma.organization.findMany({
    include: {
      users: {
        include: { user: { select: { id: true, firstName: true, lastName: true, username: true, isActive: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
  })
  return Promise.all(organizations.map(async (organization) => ({
    ...organization,
    memberCount: organization.users.length,
    primaryAdmin: organization.users.find((membership) => membership.role === OrganizationRole.ORG_ADMIN)?.user ?? null,
    metrics: await tenantMetrics(organization.id),
    users: undefined,
  })))
}

export async function getPlatformDashboard() {
  const organizations = await listOrganizations()
  const totalUsers = await prisma.user.count({ where: { organizationMemberships: { some: {} } } })
  return {
    organizations,
    summary: {
      organizations: organizations.length,
      active: organizations.filter((item) => item.status === OrganizationStatus.ACTIVE).length,
      suspended: organizations.filter((item) => item.status === OrganizationStatus.SUSPENDED).length,
      archived: organizations.filter((item) => item.status === OrganizationStatus.ARCHIVED).length,
      users: totalUsers,
      missions: organizations.reduce((sum, item) => sum + item.metrics.missions, 0),
      drivers: organizations.reduce((sum, item) => sum + item.metrics.drivers, 0),
      vehicles: organizations.reduce((sum, item) => sum + item.metrics.trucks + item.metrics.trailers, 0),
    },
  }
}

export async function getOrganizationDetail(id: string) {
  const organization = await prisma.organization.findUnique({
    where: { id },
    include: {
      users: {
        include: { user: { select: { id: true, firstName: true, lastName: true, email: true, username: true, isActive: true, createdAt: true } } },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      },
      platformAuditLogs: {
        include: { actor: { select: { id: true, firstName: true, lastName: true, username: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      },
      domains: { orderBy: [{ isPrimary: 'desc' }, { hostname: 'asc' }, { pathPrefix: 'asc' }] },
      billingConfig: true,
      integrations: { orderBy: { type: 'asc' } },
    },
  })
  if (!organization) return null
  return { ...organization, integrations: organization.integrations.map(sanitizeIntegration), metrics: await tenantMetrics(organization.id) }
}

function optionalText(value: unknown) { return typeof value === 'string' && value.trim() ? value.trim() : null }

export async function upsertOrganizationBillingConfig(input: { actorUserId: string; organizationId: string; value: Record<string, unknown> }) {
  const legalName = optionalText(input.value.legalName)
  if (!legalName) throw new Error('LEGAL_NAME_REQUIRED')
  const days = input.value.paymentTermsDays === null || input.value.paymentTermsDays === '' ? null : Number(input.value.paymentTermsDays)
  if (days !== null && (!Number.isInteger(days) || days < 0 || days > 365)) throw new Error('PAYMENT_TERMS_INVALID')
  const data = {
    legalName, legalAddress: optionalText(input.value.legalAddress), vatNumber: optionalText(input.value.vatNumber),
    iban: optionalText(input.value.iban), bic: optionalText(input.value.bic), bankName: optionalText(input.value.bankName),
    beneficiary: optionalText(input.value.beneficiary), invoicePrefix: normalizeInvoicePrefix(input.value.invoicePrefix),
    paymentTermsDays: days, billingEmail: optionalText(input.value.billingEmail),
  }
  const config = await prisma.organizationBillingConfig.upsert({ where: { organizationId: input.organizationId }, create: { organizationId: input.organizationId, ...data }, update: data })
  await prisma.platformAuditLog.create({ data: { actorUserId: input.actorUserId, organizationId: input.organizationId, action: PlatformAuditAction.BILLING_CONFIG_CHANGED } })
  return config
}

function cleanIntegrationConfig(type: OrganizationIntegrationType, value: unknown): Prisma.InputJsonValue {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const forbidden = ['password', 'apiKey', 'secret', 'username', 'outboundApiKey', 'inboundWebhookSecret']
  if (forbidden.some((key) => key in raw)) throw new Error('SECRET_IN_CONFIG')
  if (type === OrganizationIntegrationType.MAIL_INTAKE) return { mailboxAddress: optionalText(raw.mailboxAddress), host: optionalText(raw.host), port: Number(raw.port) || 993, secure: raw.secure !== false, folder: optionalText(raw.folder) || 'INBOX', provider: optionalText(raw.provider) || 'imap', limit: Number(raw.limit) || 50 }
  return { apiBaseUrl: optionalText(raw.apiBaseUrl), sourceCompany: optionalText(raw.sourceCompany), sourceSystem: optionalText(raw.sourceSystem), providerName: optionalText(raw.providerName) || 'SL Automotive', webhookEnabled: raw.webhookEnabled === true }
}

export async function upsertOrganizationIntegration(input: { actorUserId: string; organizationId: string; type: OrganizationIntegrationType; enabled: boolean; configJson: unknown; secretRef?: string | null }) {
  const existing = await prisma.organizationIntegration.findUnique({ where: { organizationId_type: { organizationId: input.organizationId, type: input.type } } })
  const secretRef = input.secretRef === undefined ? existing?.secretRef ?? null : optionalText(input.secretRef)
  const integration = await prisma.organizationIntegration.upsert({
    where: { organizationId_type: { organizationId: input.organizationId, type: input.type } },
    create: { organizationId: input.organizationId, type: input.type, enabled: input.enabled, configJson: cleanIntegrationConfig(input.type, input.configJson), secretRef },
    update: { enabled: input.enabled, configJson: cleanIntegrationConfig(input.type, input.configJson), secretRef },
  })
  await prisma.platformAuditLog.create({ data: { actorUserId: input.actorUserId, organizationId: input.organizationId, action: PlatformAuditAction.INTEGRATION_CHANGED, metadata: { type: input.type, enabled: input.enabled, secretConfigured: Boolean(secretRef) } } })
  return sanitizeIntegration(integration)
}

export async function createOrganization(input: {
  actorUserId: string
  name: string
  slug: string
  status: OrganizationStatus
  enabledModules?: OrganizationModule[]
  admin?: { firstName: string; lastName: string; username: string; email?: string | null; password: string } | null
}) {
  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: input.name,
        slug: input.slug,
        status: input.status,
        enabledModules: input.enabledModules ?? organizationModules,
      },
    })
    let admin = null
    if (input.admin) {
      const user = await tx.user.create({
        data: {
          firstName: input.admin.firstName,
          lastName: input.admin.lastName,
          name: `${input.admin.firstName} ${input.admin.lastName}`.trim(),
          username: input.admin.username,
          email: input.admin.email || null,
          passwordHash: hashPassword(input.admin.password),
          role: UserRole.ADMIN,
          isActive: true,
          mustChangePassword: true,
          temporaryPasswordIssuedAt: new Date(),
        },
        select: { id: true, firstName: true, lastName: true, username: true },
      })
      admin = await tx.organizationUser.create({
        data: { organizationId: organization.id, userId: user.id, role: OrganizationRole.ORG_ADMIN },
      })
    }
    await tx.platformAuditLog.create({
      data: {
        actorUserId: input.actorUserId,
        organizationId: organization.id,
        action: PlatformAuditAction.ORGANIZATION_CREATED,
        metadata: { name: organization.name, slug: organization.slug, adminCreated: Boolean(admin) },
      },
    })
    return organization
  })
}

export async function updateOrganization(input: {
  actorUserId: string
  organizationId: string
  name?: string
  slug?: string
  status?: OrganizationStatus
  enabledModules?: OrganizationModule[]
  displayName?: string | null
  logoUrl?: string | null
  accentColor?: string | null
  faviconUrl?: string | null
  applicationTitle?: string | null
}) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.organization.findUniqueOrThrow({ where: { id: input.organizationId } })
    const updated = await tx.organization.update({
      where: { id: input.organizationId },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.slug ? { slug: input.slug } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.enabledModules ? { enabledModules: input.enabledModules } : {}),
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
        ...(input.accentColor !== undefined ? { accentColor: input.accentColor } : {}),
        ...(input.faviconUrl !== undefined ? { faviconUrl: input.faviconUrl } : {}),
        ...(input.applicationTitle !== undefined ? { applicationTitle: input.applicationTitle } : {}),
      },
    })
    const statusChanged = input.status && input.status !== current.status
    const modulesChanged = input.enabledModules && JSON.stringify([...input.enabledModules].sort()) !== JSON.stringify([...current.enabledModules].sort())
    const generalChanged = (input.name && input.name !== current.name) || (input.slug && input.slug !== current.slug)
    const brandingChanged = ['displayName', 'logoUrl', 'accentColor', 'faviconUrl', 'applicationTitle'].some((key) => input[key as keyof typeof input] !== undefined && input[key as keyof typeof input] !== current[key as keyof typeof current])
    const events: Array<{ action: PlatformAuditAction; metadata: Prisma.InputJsonValue }> = []
    if (generalChanged) events.push({ action: PlatformAuditAction.ORGANIZATION_UPDATED, metadata: { before: { name: current.name, slug: current.slug }, after: { name: updated.name, slug: updated.slug } } })
    if (statusChanged) events.push({ action: PlatformAuditAction.ORGANIZATION_STATUS_CHANGED, metadata: { before: current.status, after: updated.status } })
    if (modulesChanged) events.push({ action: PlatformAuditAction.MODULES_CHANGED, metadata: { before: current.enabledModules, after: updated.enabledModules } })
    if (brandingChanged) events.push({ action: PlatformAuditAction.BRANDING_CHANGED, metadata: { fields: ['displayName', 'logoUrl', 'accentColor', 'faviconUrl', 'applicationTitle'].filter((key) => input[key as keyof typeof input] !== undefined) } })
    if (events.length) await tx.platformAuditLog.createMany({ data: events.map((event) => ({ ...event, actorUserId: input.actorUserId, organizationId: input.organizationId })) })
    return updated
  })
}

export function parseBranding(value: Record<string, unknown>) {
  const optionalText = (field: string) => value[field] === undefined ? undefined : typeof value[field] === 'string' ? value[field].trim() || null : false
  const displayName = optionalText('displayName')
  const applicationTitle = optionalText('applicationTitle')
  const logoUrl = value.logoUrl === undefined ? undefined : normalizeBrandAssetUrl(value.logoUrl)
  const faviconUrl = value.faviconUrl === undefined ? undefined : normalizeBrandAssetUrl(value.faviconUrl)
  const accentColor = value.accentColor === undefined ? undefined : value.accentColor === '' || value.accentColor === null ? null : normalizeAccentColor(value.accentColor)
  if (displayName === false || applicationTitle === false || logoUrl === undefined && value.logoUrl !== undefined || faviconUrl === undefined && value.faviconUrl !== undefined || accentColor === null && value.accentColor !== '' && value.accentColor !== null) return null
  return { displayName, applicationTitle, logoUrl, faviconUrl, accentColor }
}

export async function createOrganizationDomain(input: { actorUserId: string; organizationId: string; hostname: string; pathPrefix?: string; isPrimary?: boolean; isActive?: boolean }) {
  const hostname = normalizeHostname(input.hostname)
  const pathPrefix = normalizePathPrefix(input.pathPrefix)
  if (!hostname || pathPrefix === null || hostname === 'localhost' || hostname.endsWith('.localhost')) throw new Error('INVALID_DOMAIN')
  return prisma.$transaction(async (tx) => {
    if (input.isPrimary) await tx.organizationDomain.updateMany({ where: { organizationId: input.organizationId, isPrimary: true }, data: { isPrimary: false } })
    const domain = await tx.organizationDomain.create({ data: { organizationId: input.organizationId, hostname, pathPrefix, isPrimary: Boolean(input.isPrimary), isActive: input.isActive !== false } })
    await tx.platformAuditLog.create({ data: { actorUserId: input.actorUserId, organizationId: input.organizationId, action: PlatformAuditAction.DOMAIN_CREATED, metadata: { hostname, pathPrefix } } })
    return domain
  })
}

export async function updateOrganizationDomain(input: { actorUserId: string; organizationId: string; domainId: string; pathPrefix?: string; isPrimary?: boolean; isActive?: boolean }) {
  const pathPrefix = input.pathPrefix === undefined ? undefined : normalizePathPrefix(input.pathPrefix)
  if (pathPrefix === null) throw new Error('INVALID_DOMAIN')
  return prisma.$transaction(async (tx) => {
    const current = await tx.organizationDomain.findFirstOrThrow({ where: { id: input.domainId, organizationId: input.organizationId } })
    if (input.isPrimary) await tx.organizationDomain.updateMany({ where: { organizationId: input.organizationId, isPrimary: true, NOT: { id: current.id } }, data: { isPrimary: false } })
    const domain = await tx.organizationDomain.update({ where: { id: current.id }, data: { ...(pathPrefix !== undefined ? { pathPrefix } : {}), ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) } })
    await tx.platformAuditLog.create({ data: { actorUserId: input.actorUserId, organizationId: input.organizationId, action: PlatformAuditAction.DOMAIN_UPDATED, metadata: { domainId: current.id } } })
    return domain
  })
}

export async function deleteOrganizationDomain(input: { actorUserId: string; organizationId: string; domainId: string }) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.organizationDomain.findFirstOrThrow({ where: { id: input.domainId, organizationId: input.organizationId } })
    await tx.organizationDomain.delete({ where: { id: current.id } })
    await tx.platformAuditLog.create({ data: { actorUserId: input.actorUserId, organizationId: input.organizationId, action: PlatformAuditAction.DOMAIN_DELETED, metadata: { hostname: current.hostname, pathPrefix: current.pathPrefix } } })
    return current
  })
}

export async function addOrganizationMember(input: {
  actorUserId: string
  organizationId: string
  role: OrganizationRole
  existingUserId?: string
  newUser?: { firstName: string; lastName: string; username: string; email?: string | null; password: string }
}) {
  return prisma.$transaction(async (tx) => {
    let userId = input.existingUserId
    if (!userId && input.newUser) {
      const created = await tx.user.create({
        data: {
          firstName: input.newUser.firstName,
          lastName: input.newUser.lastName,
          name: `${input.newUser.firstName} ${input.newUser.lastName}`.trim(),
          username: input.newUser.username,
          email: input.newUser.email || null,
          passwordHash: hashPassword(input.newUser.password),
          role: input.role === OrganizationRole.DRIVER ? UserRole.DRIVER : UserRole.DISPATCHER,
          isActive: true,
          mustChangePassword: true,
          temporaryPasswordIssuedAt: new Date(),
        },
      })
      userId = created.id
    }
    if (!userId) throw new Error('USER_REQUIRED')
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!user) throw new Error('USER_NOT_FOUND')
    const membership = await tx.organizationUser.create({ data: { organizationId: input.organizationId, userId, role: input.role } })
    await tx.platformAuditLog.create({ data: { actorUserId: input.actorUserId, organizationId: input.organizationId, action: PlatformAuditAction.MEMBER_ADDED, metadata: { userId, role: input.role } } })
    return membership
  })
}

export async function updateOrganizationMember(input: {
  actorUserId: string
  organizationId: string
  membershipId: string
  role: OrganizationRole
}) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.organizationUser.findFirstOrThrow({ where: { id: input.membershipId, organizationId: input.organizationId } })
    if (current.role === OrganizationRole.ORG_ADMIN && input.role !== OrganizationRole.ORG_ADMIN) {
      const adminCount = await tx.organizationUser.count({ where: { organizationId: input.organizationId, role: OrganizationRole.ORG_ADMIN } })
      if (adminCount <= 1) throw new Error('LAST_ORG_ADMIN')
    }
    const membership = await tx.organizationUser.update({ where: { id: current.id }, data: { role: input.role } })
    await tx.platformAuditLog.create({ data: { actorUserId: input.actorUserId, organizationId: input.organizationId, action: PlatformAuditAction.MEMBER_ROLE_CHANGED, metadata: { userId: current.userId, before: current.role, after: input.role } } })
    return membership
  })
}

export async function removeOrganizationMember(input: {
  actorUserId: string
  organizationId: string
  membershipId: string
}) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.organizationUser.findFirstOrThrow({ where: { id: input.membershipId, organizationId: input.organizationId } })
    if (current.role === OrganizationRole.ORG_ADMIN) {
      const adminCount = await tx.organizationUser.count({ where: { organizationId: input.organizationId, role: OrganizationRole.ORG_ADMIN } })
      if (adminCount <= 1) throw new Error('LAST_ORG_ADMIN')
    }
    await tx.organizationUser.delete({ where: { id: current.id } })
    await tx.platformAuditLog.create({ data: { actorUserId: input.actorUserId, organizationId: input.organizationId, action: PlatformAuditAction.MEMBER_REMOVED, metadata: { userId: current.userId, role: current.role } } })
    return current
  })
}

export async function listAvailableUsers(organizationId: string) {
  return prisma.user.findMany({
    where: { organizationMemberships: { none: { organizationId } } },
    select: { id: true, firstName: true, lastName: true, username: true, email: true, isActive: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  })
}
