import { OrganizationIntegrationType, OrganizationModule, Prisma } from '@prisma/client'
import { parseBranding, parseModules, updateOrganization, upsertOrganizationIntegration } from '../platform/organizations'
import { prisma } from '../prisma'
import type { PlatformConfigurationAction } from '@prolific/gerard-core'

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
