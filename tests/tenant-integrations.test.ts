import assert from 'node:assert/strict'
import { OrganizationIntegrationType } from '@prisma/client'

import { parseMailIntakeConfig, parseSlAutomotiveConfig } from '../lib/integrations/config'
import { getIntegrationSecret, IntegrationSecretError } from '../lib/integrations/secrets'
import { normalizeInvoicePrefix, paymentTermsLabel, tenantInvoiceBlobPath } from '../lib/tenant/billing-config'

assert.equal(normalizeInvoicePrefix(' ntx! '), 'NTX')
assert.equal(paymentTermsLabel(30), 'Paiement à 30 jours')
assert.match(tenantInvoiceBlobPath('tenant-a', 'invoice-a', '../facture test.pdf', new Date('2026-09-21T00:00:00Z')), /^organizations\/tenant-a\/invoices\/received\/2026\/invoice-a-/)

const mail = parseMailIntakeConfig({ mailboxAddress: 'billing@example.test', host: 'imap.example.test', port: 993, secure: true, folder: 'INBOX' })
assert.equal(mail.host, 'imap.example.test')
const sl = parseSlAutomotiveConfig({ apiBaseUrl: 'https://sl.example.test/', sourceCompany: 'QA', sourceSystem: 'GERARD_QA', webhookEnabled: true })
assert.equal(sl.apiBaseUrl, 'https://sl.example.test')

async function main() {
  const integration = { secretRef: 'QA_SL' }
  assert.equal(await getIntegrationSecret(integration, 'outboundApiKey', { async get(ref, key) { return `${ref}:${key}` } }), 'QA_SL:outboundApiKey')
  await assert.rejects(() => getIntegrationSecret({ secretRef: null }, 'password'), IntegrationSecretError)
  await assert.rejects(() => getIntegrationSecret(integration, 'password', { async get() { return null } }), IntegrationSecretError)
  assert.equal(OrganizationIntegrationType.MAIL_INTAKE, 'MAIL_INTAKE')
  console.log('Tenant billing, Blob path, integration config and replaceable secrets: OK')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
