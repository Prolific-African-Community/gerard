import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { InvoiceDirection, InvoiceStatus } from '@prisma/client'

import { buildInvoicePdf } from '../lib/dispatch/invoice-pdf'
import { isBillingEmail } from '../lib/platform/organizations'
import { loadBrandAssetBytes, resolveOrganizationLogo } from '../lib/tenant/brand-logo'
import { DEFAULT_BRANDING } from '../lib/tenant/branding'

const root = path.resolve(process.cwd())
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')

// ─── Authorization: the organization is taken from the session, never from the request ──────────────────
const billingRoute = read('pages/api/admin/organization/billing.ts')
const brandingRoute = read('pages/api/admin/organization/branding.ts')
for (const [name, source] of [['billing', billingRoute], ['branding', brandingRoute]] as const) {
  assert.match(source, /requireOrganizationAdmin/, `${name}: restricted to ORG_ADMIN, so any other organization role is denied`)
  assert.match(source, /organizationId: actor\.organizationId/, `${name}: scopes to the authenticated organization`)
  // A body-supplied organizationId must never reach the service: that is what would allow cross-tenant writes.
  assert.doesNotMatch(source, /organizationId:\s*(body|value|req\.body|req\.query)/, `${name}: never takes the organization from the request`)
  assert.doesNotMatch(source, /body\.organizationId|value\.organizationId|query\.organizationId/, `${name}: ignores any organization id sent by the client`)
  assert.match(source, /runWithCurrentOrganization/, `${name}: runs inside the tenant context`)
}
// The billing route only exposes read and update of its own organization.
assert.match(billingRoute, /req\.method === 'GET'/)
assert.match(billingRoute, /req\.method === 'PUT'/)
assert.match(billingRoute, /Allow', 'GET, PUT'/)
// The branding route accepts asset fields only: it cannot rename an organization or touch platform settings.
assert.match(brandingRoute, /\['logoUrl', 'faviconUrl'\] as const/)
for (const forbidden of ['status', 'enabledModules', 'slug', 'name']) {
  assert.doesNotMatch(brandingRoute, new RegExp(`body\\.${forbidden}`), `branding: ${forbidden} is not settable here`)
}

// SUPER_ADMIN keeps its own platform route and the shared service; the organization route reuses it rather
// than implementing a second billing model.
assert.match(billingRoute, /upsertOrganizationBillingConfig/, 'the ORG_ADMIN route reuses the platform service')
const platformService = read('lib/platform/organizations.ts')
assert.match(platformService, /export async function upsertOrganizationBillingConfig/, 'the shared service is still exported for the platform route')
assert.match(platformService, /PlatformAuditAction\.BILLING_CONFIG_CHANGED/, 'the update is audited for both callers')
assert.match(read('pages/api/platform/organizations/[id]/billing.ts'), /upsertOrganizationBillingConfig/, 'SUPER_ADMIN behaviour unchanged')

// ─── Validation ─────────────────────────────────────────────────────────────────────────────────────────
for (const valid of ['facturation@example.com', 'a.b-c@sub.example.lu']) assert.ok(isBillingEmail(valid), `${valid} is a valid billing email`)
for (const invalid of ['not-an-email', 'a@b', 'a b@example.com', '@example.com', `${'x'.repeat(250)}@example.com`]) assert.ok(!isBillingEmail(invalid), `${invalid} is rejected`)

// An omitted payment term means "none": absent, null and empty are all handled, not a validation error.
assert.match(platformService, /rawDays === null \|\| rawDays === undefined \|\| rawDays === ''/, 'an absent payment term is not a validation error')

async function main() {
  // ─── Invoice logo: the organization's own logo, Gerard only as a fallback ───────────────────────────────
  const organizationLogo = await resolveOrganizationLogo('/logo-novotralux5.png')
  assert.equal(organizationLogo?.source, 'organization', 'a configured organization logo is used')
  const gerardLogo = await loadBrandAssetBytes(DEFAULT_BRANDING.logoUrl)
  assert.ok(gerardLogo, 'the Gerard default asset is readable')
  assert.notDeepEqual(organizationLogo?.bytes, gerardLogo, 'the organization logo is not the Gerard logo')

  for (const missing of [null, undefined, '', '   ']) {
    const fallback = await resolveOrganizationLogo(missing)
    assert.equal(fallback?.source, 'default', 'without a logo the Gerard default is used')
    assert.deepEqual(fallback?.bytes, gerardLogo)
  }
  // An unreachable or unusable asset falls back instead of failing the document.
  assert.equal((await resolveOrganizationLogo('/does-not-exist.png'))?.source, 'default')
  assert.equal((await resolveOrganizationLogo('http://insecure.example.com/logo.png'))?.source, 'default', 'plain http is not loaded')
  assert.equal(await loadBrandAssetBytes('/../../secrets.env'), null, 'no path escapes public/')
  assert.equal(await loadBrandAssetBytes('https://cdn.example.com/logo.png', (async () => ({ ok: false })) as unknown as typeof fetch), null, 'a failed fetch yields no bytes')
  const remote = await loadBrandAssetBytes('https://cdn.example.com/logo.png', (async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer })) as unknown as typeof fetch)
  assert.deepEqual(remote, Buffer.from([1, 2, 3]), 'an uploaded https logo is fetched')

  // The generator takes the logo from its caller and no longer reads a Gerard file from disk.
  const pdfSource = read('lib/dispatch/invoice-pdf.ts')
  assert.doesNotMatch(pdfSource, /logo_gerard_texte|logo-gerard/, 'no hardcoded Gerard asset in the PDF generator')
  assert.match(pdfSource, /function drawHeader\(doc: PDFKit\.PDFDocument, invoice: InvoicePdfData, logo: Buffer \| null\)/)
  const pdfRoute = read('pages/api/dispatch/invoices/[id]/pdf.ts')
  assert.match(pdfRoute, /resolveOrganizationLogo/, 'the route resolves the issuing organization logo')
  assert.match(pdfRoute, /invoice\.organizationId/, 'the logo follows the invoice organization, not the session default')

  // ─── Issuer values come from the invoice snapshot, so history is never rewritten ────────────────────────
  const invoice = {
    id: 'invoice-test', invoiceNumber: 'TRX-2026-0001', direction: InvoiceDirection.ISSUED, status: InvoiceStatus.DRAFT,
    issueDate: new Date('2026-01-15'), dueDate: new Date('2026-02-14'),
    sellerName: 'TRANSPORT X S.A.', sellerAddress: '1 rue de la Gare, Luxembourg', sellerVatNumber: 'LU12345678',
    sellerIban: 'LU28 0019 4006 4475 0000', sellerBic: 'BCEELULL', sellerBankName: 'Banque Example', sellerBeneficiary: 'TRANSPORT X S.A.',
    buyerName: 'Client SARL', buyerAddress: null, buyerVatNumber: null, buyerEmail: null,
    missionReference: 'M-1', clientReference: null, cmrNumber: null, deliveryNoteNumber: null, missionDescription: null,
    subtotalAmount: 100, vatAmount: 17, totalAmount: 117, currency: 'EUR', paymentTerms: 'Paiement à 30 jours', notes: null,
    lines: [{ id: 'line-1', label: 'Transport', description: null, quantity: 1, unitPrice: 100, vatRate: 17, position: 0 }],
  }
  // The snapshot on the row is what the document renders: regenerating an old invoice cannot pick up today's
  // organization identity.
  const pdf = await buildInvoicePdf(invoice as never, { logo: organizationLogo?.bytes ?? null })
  assert.ok(pdf.length > 1000, 'the PDF is produced from the invoice snapshot')
  assert.ok(pdf.toString('latin1').includes('%PDF'), 'a valid PDF document is produced')
  const withoutLogo = await buildInvoicePdf(invoice as never, { logo: null })
  assert.ok(withoutLogo.length > 1000, 'the document is still produced when no logo can be loaded')

  // The creation route snapshots the issuer from the organization billing configuration.
  const createRoute = read('pages/api/dispatch/invoices/index.ts')
  assert.match(createRoute, /issuedBilling!\.legalName/, 'the issuer name is snapshotted from the organization billing config')
  assert.match(createRoute, /issuedBilling\?\.iban/, 'the bank details are snapshotted from the organization billing config')
  assert.match(createRoute, /getActiveBillingConfig/, 'the configuration is read for the active organization')

  // ─── No client name anywhere in this flow ───────────────────────────────────────────────────────────────
  for (const file of ['pages/api/admin/organization/billing.ts', 'pages/api/admin/organization/branding.ts', 'lib/tenant/brand-logo.ts', 'lib/dispatch/invoice-pdf.ts', 'pages/admin/organization.tsx']) {
    assert.doesNotMatch(read(file), /novotralux/i, `${file} must not mention a client`)
  }

  console.log('Organization identity, billing authorization and invoice branding: OK')
}

void main()
