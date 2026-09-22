import { OrganizationIntegrationType, Prisma } from '@prisma/client'

import { requireActiveOrganizationId } from '../auth/organization-context'
import { prisma } from '../prisma'

type JsonRecord = Record<string, unknown>
export type MailIntakeConfig = { mailboxAddress: string; host: string; port: number; secure: boolean; folder: string; provider: string; limit: number }
export type SlAutomotiveConfig = { apiBaseUrl: string; sourceCompany: string; sourceSystem: string; providerName: string; webhookEnabled: boolean }

export class IntegrationUnavailableError extends Error {
  statusCode = 409
  constructor(type: OrganizationIntegrationType) {
    super(`Intégration ${type} indisponible pour cette organisation.`)
    this.name = 'IntegrationUnavailableError'
  }
}

function record(value: Prisma.JsonValue): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}
function text(value: unknown) { return typeof value === 'string' && value.trim() ? value.trim() : null }

export function parseMailIntakeConfig(value: Prisma.JsonValue): MailIntakeConfig {
  const config = record(value); const host = text(config.host); const mailboxAddress = text(config.mailboxAddress)
  if (!host || !mailboxAddress) throw new IntegrationUnavailableError(OrganizationIntegrationType.MAIL_INTAKE)
  return { mailboxAddress, host, port: Number.isInteger(config.port) ? Number(config.port) : 993, secure: config.secure !== false, folder: text(config.folder) || 'INBOX', provider: text(config.provider) || 'imap', limit: Number.isInteger(config.limit) ? Number(config.limit) : 50 }
}

export function parseSlAutomotiveConfig(value: Prisma.JsonValue): SlAutomotiveConfig {
  const config = record(value); const apiBaseUrl = text(config.apiBaseUrl); const sourceCompany = text(config.sourceCompany); const sourceSystem = text(config.sourceSystem)
  if (!apiBaseUrl || !sourceCompany || !sourceSystem) throw new IntegrationUnavailableError(OrganizationIntegrationType.SL_AUTOMOTIVE)
  return { apiBaseUrl: apiBaseUrl.replace(/\/+$/, ''), sourceCompany, sourceSystem, providerName: text(config.providerName) || 'SL Automotive', webhookEnabled: config.webhookEnabled === true }
}

export async function getActiveIntegration(type: OrganizationIntegrationType) {
  const integration = await prisma.organizationIntegration.findFirst({ where: { organizationId: requireActiveOrganizationId(), type, enabled: true } })
  if (!integration) throw new IntegrationUnavailableError(type)
  return integration
}

export function sanitizeIntegration(integration: { id: string; organizationId: string; type: OrganizationIntegrationType; enabled: boolean; configJson: Prisma.JsonValue; secretRef: string | null; createdAt: Date; updatedAt: Date }) {
  const { secretRef, ...safe } = integration
  return { ...safe, secretConfigured: Boolean(secretRef) }
}
