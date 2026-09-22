import assert from 'node:assert/strict'
import { InvoiceDirection, MaintenanceInterventionType, MaintenanceUrgency, MaintenanceVehicleType, OrganizationIntegrationType, OrganizationRole } from '@prisma/client'

import { runWithOrganization } from '../lib/auth/organization-context'
import { applySlAutomotiveWebhook } from '../lib/integrations/sl-automotive-webhook'
import { prisma } from '../lib/prisma'
import { upsertOrganizationBillingConfig, upsertOrganizationIntegration } from '../lib/platform/organizations'

const suffix = Date.now(); const ids: string[] = []
async function main() {
  const actor = await prisma.user.findFirstOrThrow({ where: { isActive: true }, select: { id: true } })
  const [a, b] = await Promise.all([
    prisma.organization.create({ data: { name: 'QA_INTEGRATIONS', slug: `qa-integrations-${suffix}` } }),
    prisma.organization.create({ data: { name: 'QA_INTEGRATIONS_B', slug: `qa-integrations-b-${suffix}` } }),
  ]); ids.push(a.id, b.id)
  await upsertOrganizationBillingConfig({ actorUserId: actor.id, organizationId: a.id, value: { legalName: 'QA Alpha SARL', invoicePrefix: 'QAA', paymentTermsDays: 30 } })
  await upsertOrganizationBillingConfig({ actorUserId: actor.id, organizationId: b.id, value: { legalName: 'QA Beta SARL', invoicePrefix: 'QAB', paymentTermsDays: 15 } })
  const [billingA, billingB] = await Promise.all([prisma.organizationBillingConfig.findUniqueOrThrow({ where: { organizationId: a.id } }), prisma.organizationBillingConfig.findUniqueOrThrow({ where: { organizationId: b.id } })])
  assert.equal(billingA.invoicePrefix, 'QAA'); assert.equal(billingB.invoicePrefix, 'QAB')

  const mail = await upsertOrganizationIntegration({ actorUserId: actor.id, organizationId: a.id, type: OrganizationIntegrationType.MAIL_INTAKE, enabled: false, configJson: { mailboxAddress: 'qa@example.test', host: 'imap.example.test' }, secretRef: 'QA_MAIL' })
  assert.equal(mail.secretConfigured, true); assert.equal('secretRef' in mail, false)
  const sl = await upsertOrganizationIntegration({ actorUserId: actor.id, organizationId: a.id, type: OrganizationIntegrationType.SL_AUTOMOTIVE, enabled: true, configJson: { apiBaseUrl: 'https://sl.example.test', sourceCompany: 'QA_ALPHA', sourceSystem: 'GERARD_QA', webhookEnabled: true }, secretRef: 'QA_SL' })

  let requestId = ''
  await runWithOrganization({ organizationId: a.id, organizationRole: OrganizationRole.ORG_ADMIN, platformRole: null, userId: actor.id }, async () => {
    const truck = await prisma.truck.create({ data: { plateNumber: 'QA-001' } })
    const request = await prisma.maintenanceRequest.create({ data: { truckId: truck.id, vehicleType: MaintenanceVehicleType.TRUCK, plateNumber: 'QA-001', interventionType: MaintenanceInterventionType.DIAGNOSTIC, urgency: MaintenanceUrgency.NORMAL, issueDescription: 'QA only' } })
    requestId = request.id
    await prisma.invoice.create({ data: { direction: InvoiceDirection.ISSUED, sellerName: 'Historical Alpha', buyerName: 'Client QA', subtotalAmount: 10, vatAmount: 0, totalAmount: 10 } })
  })
  const result = await applySlAutomotiveWebhook(a.id, sl.id, { sourceProvider: 'SL_AUTOMOTIVE', externalRequestId: requestId, providerRequestId: 'provider-qa-1', status: 'INVOICED', invoiceAmount: 123.45, invoicePdfUrl: 'https://files.example.test/qa.pdf', interventionLines: [{ id: 'line-1', label: 'Diagnostic', qty: 1, unitPrice: 123.45, total: 123.45 }] })
  assert.equal(result.idempotent, false)
  const again = await applySlAutomotiveWebhook(a.id, sl.id, { sourceProvider: 'SL_AUTOMOTIVE', externalRequestId: requestId, providerRequestId: 'provider-qa-1', status: 'INVOICED' })
  assert.equal(again.idempotent, true)
  await assert.rejects(() => applySlAutomotiveWebhook(b.id, sl.id, { sourceProvider: 'SL_AUTOMOTIVE', externalRequestId: requestId, providerRequestId: 'provider-qa-1', status: 'PAID' }), /introuvable/)
  const historical = await runWithOrganization({ organizationId: a.id, organizationRole: OrganizationRole.ORG_ADMIN, platformRole: null, userId: actor.id }, async () => await prisma.invoice.findFirstOrThrow({ where: { sellerName: 'Historical Alpha' } }))
  assert.equal(historical.sellerName, 'Historical Alpha')
  console.log('QA_INTEGRATIONS billing, mail, SL idempotence and tenant isolation: OK')
}

main().finally(async () => {
  for (const organizationId of ids) {
    await runWithOrganization({ organizationId, organizationRole: OrganizationRole.ORG_ADMIN, platformRole: null, userId: 'qa-cleanup' }, async () => {
      await prisma.maintenanceStatusHistory.deleteMany(); await prisma.maintenanceInterventionLine.deleteMany(); await prisma.maintenanceRequest.deleteMany(); await prisma.invoiceLine.deleteMany(); await prisma.invoiceMission.deleteMany(); await prisma.invoice.deleteMany(); await prisma.ignoredMailImport.deleteMany(); await prisma.missionSourceEmail.deleteMany(); await prisma.truck.deleteMany()
    })
    await prisma.platformAuditLog.deleteMany({ where: { organizationId } }); await prisma.organization.deleteMany({ where: { id: organizationId } })
  }
  await prisma.$disconnect()
}).catch((error) => { console.error(error); process.exitCode = 1 })
