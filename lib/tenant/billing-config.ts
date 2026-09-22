import type { OrganizationBillingConfig } from '@prisma/client'

import { requireActiveOrganizationId } from '../auth/organization-context'
import { prisma } from '../prisma'

export class BillingConfigurationError extends Error {
  statusCode = 409
  constructor(message = 'Configuration légale de facturation incomplète.') {
    super(message)
    this.name = 'BillingConfigurationError'
  }
}

export function normalizeInvoicePrefix(value: unknown) {
  if (typeof value !== 'string') return null
  const prefix = value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '')
  return prefix.length ? prefix.slice(0, 24) : null
}

export function paymentTermsLabel(days: number | null) {
  return days === null ? null : `Paiement à ${days} jour${days === 1 ? '' : 's'}`
}

export async function getActiveBillingConfig() {
  return prisma.organizationBillingConfig.findUnique({ where: { organizationId: requireActiveOrganizationId() } })
}

export function requireIssuedInvoiceBillingConfig(config: OrganizationBillingConfig | null) {
  if (!config?.legalName.trim()) throw new BillingConfigurationError()
  return config
}

export function tenantInvoiceBlobPath(organizationId: string, invoiceId: string, filename: string, date = new Date()) {
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-180)
  return `organizations/${organizationId}/invoices/received/${date.getUTCFullYear()}/${invoiceId}-${date.getTime()}-${safeFilename}`
}
