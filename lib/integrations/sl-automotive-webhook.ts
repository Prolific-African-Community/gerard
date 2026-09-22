import { MaintenanceRequestStatus, OrganizationRole } from '@prisma/client'

import { runWithOrganization } from '../auth/organization-context'
import { prisma } from '../prisma'

const statusMap: Record<string, MaintenanceRequestStatus> = {
  RECEIVED: 'RECEIVED', UNDER_REVIEW: 'UNDER_REVIEW', MORE_INFO_REQUESTED: 'UNDER_REVIEW', QUOTE_PREPARING: 'UNDER_REVIEW',
  QUOTE_SENT: 'QUOTE_RECEIVED', QUOTE_APPROVED: 'QUOTE_APPROVED', QUOTE_REJECTED: 'QUOTE_REJECTED', SCHEDULED: 'SCHEDULED',
  IN_PROGRESS: 'IN_PROGRESS', COMPLETED: 'COMPLETED', INVOICED: 'INVOICED', PAID: 'PAID', CLOSED: 'CLOSED', CANCELLED: 'CANCELLED',
}
type RecordValue = Record<string, unknown>
function record(value: unknown): RecordValue { return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {} }
function string(value: unknown) { return typeof value === 'string' && value.trim() ? value.trim() : null }
function number(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : null }

export class SlWebhookError extends Error {
  constructor(message: string, public statusCode = 400) { super(message); this.name = 'SlWebhookError' }
}

export async function applySlAutomotiveWebhook(organizationId: string, integrationId: string, bodyValue: unknown) {
  const body = record(bodyValue)
  if (body.sourceProvider !== 'SL_AUTOMOTIVE') throw new SlWebhookError('Provider invalide.')
  const externalRequestId = string(body.externalRequestId)
  const providerRequestId = string(body.providerRequestId)
  const status = string(body.status) ? statusMap[string(body.status)!] : null
  if (!externalRequestId || !providerRequestId || !status) throw new SlWebhookError('Payload SL Automotive invalide.')
  const rawLines = body.interventionLines
  if (rawLines !== undefined && !Array.isArray(rawLines)) throw new SlWebhookError('Lignes d’intervention invalides.')
  const lines = (Array.isArray(rawLines) ? rawLines : []).map((item) => {
    const line = record(item); const label = string(line.label); const qty = number(line.qty); const unitPrice = number(line.unitPrice); const total = number(line.total)
    if (!label || qty === null || unitPrice === null || total === null) throw new SlWebhookError('Ligne d’intervention invalide.')
    return { providerLineId: string(line.id), code: string(line.code), label, description: string(line.description), qty, unitPrice, total, isCustom: line.isCustom === true }
  })

  return runWithOrganization({ organizationId, organizationRole: OrganizationRole.ORG_ADMIN, platformRole: null, userId: `integration:${integrationId}` }, async () => {
    const current = await prisma.maintenanceRequest.findFirst({ where: { id: externalRequestId, organizationId } })
    if (!current) throw new SlWebhookError('Demande de maintenance introuvable.', 404)
    if (current.providerRequestId && current.providerRequestId !== providerRequestId) throw new SlWebhookError('providerRequestId incohérent.', 409)
    const statusChanged = current.status !== status
    const lineTotal = lines.length ? lines.reduce((sum, line) => sum + line.total, 0) : null
    const updated = await prisma.$transaction(async (tx) => {
      const request = await tx.maintenanceRequest.update({
        where: { id: current.id, organizationId },
        data: {
          providerRequestId, externalProvider: 'SL_AUTOMOTIVE', status,
          quoteAmount: number(body.quoteAmount) ?? current.quoteAmount,
          invoiceAmount: number(body.invoiceAmount) ?? lineTotal ?? current.invoiceAmount,
          slInvoiceReference: string(body.invoiceReference) ?? string(body.slInvoiceReference) ?? current.slInvoiceReference,
          quotePdfUrl: string(body.quotePdfUrl) ?? current.quotePdfUrl,
          invoicePdfUrl: string(body.invoicePdfUrl) ?? current.invoicePdfUrl,
        },
      })
      if (Array.isArray(rawLines)) {
        await tx.maintenanceInterventionLine.deleteMany({ where: { maintenanceRequestId: current.id, organizationId } })
        if (lines.length) await tx.maintenanceInterventionLine.createMany({ data: lines.map((line) => ({ ...line, organizationId, maintenanceRequestId: current.id })) })
      }
      if (statusChanged) await tx.maintenanceStatusHistory.create({ data: { organizationId, maintenanceRequestId: current.id, oldStatus: current.status, newStatus: status, comment: string(body.comment) } })
      return request
    })
    return { maintenanceRequest: updated, idempotent: !statusChanged }
  })
}
