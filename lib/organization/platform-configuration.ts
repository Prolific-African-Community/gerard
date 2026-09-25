import { OrganizationIntegrationType, OrganizationModule, Prisma } from '@prisma/client'
import { parseBranding, parseModules, updateOrganization, upsertOrganizationIntegration } from '../platform/organizations'
import { prisma } from '../prisma'
import type { PlatformConfigurationAction, PlatformConfigurationSnapshot } from '@prolific/gerard-core'

export async function applyPlatformConfiguration(input: { organizationId: string; action: PlatformConfigurationAction; payload: Record<string, unknown>; platformActorId: string }) {
  const organization = await prisma.organization.findUnique({ where: { id: input.organizationId }, select: { id: true } })
  if (!organization) throw new Error('ORGANIZATION_NOT_FOUND')
  const actor = await prisma.organizationUser.findFirst({ where: { organizationId: input.organizationId, role: 'ORG_ADMIN', user: { isActive: true } }, select: { userId: true } })
  if (!actor) throw new Error('LOCAL_AUDIT_ACTOR_NOT_FOUND')
  if (input.action === 'updateIdentity') {
    const allowed = ['displayName', 'applicationTitle']
    if (Object.keys(input.payload).some((key) => !allowed.includes(key))) throw new Error('FORBIDDEN_CONFIGURATION_FIELD')
    const result = await updateOrganization({ actorUserId: actor.userId, organizationId: input.organizationId, ...(typeof input.payload.displayName === 'string' || input.payload.displayName === null ? { displayName: input.payload.displayName as string | null } : {}), ...(typeof input.payload.applicationTitle === 'string' || input.payload.applicationTitle === null ? { applicationTitle: input.payload.applicationTitle as string | null } : {}) })
    await recordPlatformAudit(actor.userId, input.organizationId, input)
    return result
  }
  if (input.action === 'updateBranding') {
    const branding = parseBranding(input.payload)
    if (!branding || Object.keys(input.payload).some((key) => !['accentColor', 'logoUrl', 'faviconUrl'].includes(key))) throw new Error('INVALID_BRANDING')
    const result = await updateOrganization({ actorUserId: actor.userId, organizationId: input.organizationId, ...branding })
    await recordPlatformAudit(actor.userId, input.organizationId, input)
    return result
  }
  if (input.action === 'updateModules') {
    if (Object.keys(input.payload).length !== 1 || !Array.isArray(input.payload.enabledModules)) throw new Error('INVALID_MODULES')
    const modules = parseModules(input.payload.enabledModules)
    if (!modules) throw new Error('INVALID_MODULES')
    const result = await updateOrganization({ actorUserId: actor.userId, organizationId: input.organizationId, enabledModules: modules as OrganizationModule[] })
    await recordPlatformAudit(actor.userId, input.organizationId, input)
    return result
  }
  const type = input.payload.type
  if (!Object.values(OrganizationIntegrationType).includes(type as OrganizationIntegrationType)) throw new Error('INVALID_INTEGRATION')
  const integrationKeys = input.action === 'updateIntegrationEnabled' ? ['type', 'enabled'] : ['type', 'configJson']
  if (Object.keys(input.payload).some((key) => !integrationKeys.includes(key))) throw new Error('FORBIDDEN_CONFIGURATION_FIELD')
  if (Object.keys(input.payload).some((key) => ['password', 'apiKey', 'secret', 'username', 'outboundApiKey', 'inboundWebhookSecret', 'secretRef'].includes(key))) throw new Error('SECRET_FIELD_FORBIDDEN')
  const current = await prisma.organizationIntegration.findUnique({ where: { organizationId_type: { organizationId: input.organizationId, type: type as OrganizationIntegrationType } } })
  if (input.action === 'updateIntegrationEnabled') {
    const result = await upsertOrganizationIntegration({ actorUserId: actor.userId, organizationId: input.organizationId, type: type as OrganizationIntegrationType, enabled: input.payload.enabled === true, configJson: current?.configJson ?? {} })
    await recordPlatformAudit(actor.userId, input.organizationId, input)
    return result
  }
  if (input.action === 'updateIntegrationConfig') {
    const result = await upsertOrganizationIntegration({ actorUserId: actor.userId, organizationId: input.organizationId, type: type as OrganizationIntegrationType, enabled: current?.enabled ?? false, configJson: input.payload.configJson ?? {} })
    await recordPlatformAudit(actor.userId, input.organizationId, input)
    return result
  }
  throw new Error('UNSUPPORTED_CONFIGURATION_ACTION')
}

async function recordPlatformAudit(actorUserId: string, organizationId: string, input: { action: PlatformConfigurationAction; platformActorId: string }) {
  await prisma.platformAuditLog.create({ data: { actorUserId, organizationId, action: 'ORGANIZATION_UPDATED', metadata: { source: 'GERARD_PLATFORM', platformActorId: input.platformActorId, action: input.action } } })
}

// Non-secret integration settings the platform may read. Anything else stored in configJson is never returned.
const readableIntegrationFields: Record<OrganizationIntegrationType, readonly string[]> = {
  MAIL_INTAKE: ['mailboxAddress', 'host', 'port', 'secure', 'folder', 'provider', 'limit'],
  SL_AUTOMOTIVE: ['apiBaseUrl', 'sourceCompany', 'sourceSystem', 'providerName', 'webhookEnabled'],
}

function readableValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null
}

// Builds the configuration snapshot from explicitly selected columns; no model is serialised whole.
export async function readPlatformConfiguration(organizationId: string): Promise<PlatformConfigurationSnapshot> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, status: true, name: true, displayName: true, applicationTitle: true, accentColor: true, logoUrl: true, faviconUrl: true, enabledModules: true, updatedAt: true },
  })
  if (!organization) throw new Error('ORGANIZATION_NOT_FOUND')
  const integrations = await prisma.organizationIntegration.findMany({
    where: { organizationId },
    orderBy: { type: 'asc' },
    select: { type: true, enabled: true, configJson: true, secretRef: true, updatedAt: true },
  })
  return {
    organizationId: organization.id,
    status: organization.status,
    identity: { name: organization.name, displayName: organization.displayName, applicationTitle: organization.applicationTitle },
    branding: { accentColor: organization.accentColor, logoUrl: organization.logoUrl, faviconUrl: organization.faviconUrl },
    enabledModules: [...organization.enabledModules],
    integrations: integrations.map((integration) => {
      const stored = integration.configJson && typeof integration.configJson === 'object' && !Array.isArray(integration.configJson) ? integration.configJson as Record<string, unknown> : {}
      return {
        type: integration.type,
        enabled: integration.enabled,
        configJson: Object.fromEntries(readableIntegrationFields[integration.type].map((key) => [key, readableValue(stored[key])])),
        secretConfigured: Boolean(integration.secretRef),
        updatedAt: integration.updatedAt.toISOString(),
      }
    }),
    updatedAt: organization.updatedAt.toISOString(),
  }
}
