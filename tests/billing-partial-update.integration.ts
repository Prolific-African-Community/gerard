import assert from 'node:assert/strict'

import { upsertOrganizationBillingConfig } from '../lib/platform/organizations'
import { prisma } from '../lib/prisma'

// A partial update must never wipe the rest of the billing configuration: an omitted field keeps its stored
// value, an explicit null or empty string clears it. Runs on a throwaway organization, never on real data.
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const organizationId = `org-qa-billing-${suffix}`

const populated = {
  legalName: 'QA TRANSPORT S.A.',
  legalAddress: '1 rue de la Gare, Luxembourg',
  vatNumber: 'LU11111111',
  iban: 'LU00 1111 2222 3333 4444',
  bic: 'QATRLULL',
  bankName: 'Banque QA',
  beneficiary: 'QA TRANSPORT S.A.',
  invoicePrefix: 'QAT',
  paymentTermsDays: 45,
  billingEmail: 'facturation@qa.example',
}
const optionalKeys = ['legalAddress', 'vatNumber', 'iban', 'bic', 'bankName', 'beneficiary', 'invoicePrefix', 'paymentTermsDays', 'billingEmail'] as const

async function main() {
  const actor = await prisma.user.findFirstOrThrow({ where: { isActive: true }, select: { id: true } })
  await prisma.organization.create({ data: { id: organizationId, name: 'QA_BILLING_PARTIAL', slug: `qa-billing-${suffix}` } })
  try {
    // 1. An existing configuration with several populated fields.
    const created = await upsertOrganizationBillingConfig({ actorUserId: actor.id, organizationId, value: { ...populated } })
    for (const [key, value] of Object.entries(populated)) {
      assert.equal((created as Record<string, unknown>)[key], value, `${key} is stored on creation`)
    }

    // 2. An update that sends a single field.
    const partial = await upsertOrganizationBillingConfig({ actorUserId: actor.id, organizationId, value: { vatNumber: 'LU99999999' } })

    // 3. That field changed.
    assert.equal(partial.vatNumber, 'LU99999999', 'the field sent is updated')

    // 4. Every omitted field is unchanged, including the required legal name.
    assert.equal(partial.legalName, populated.legalName, 'an omitted legal name is preserved')
    for (const key of optionalKeys) {
      if (key === 'vatNumber') continue
      assert.equal((partial as Record<string, unknown>)[key], populated[key], `an omitted ${key} is preserved`)
    }

    // An explicit null or empty string still clears a nullable field.
    const cleared = await upsertOrganizationBillingConfig({ actorUserId: actor.id, organizationId, value: { iban: null, bic: '', paymentTermsDays: null, invoicePrefix: '' } })
    assert.equal(cleared.iban, null, 'an explicit null clears the field')
    assert.equal(cleared.bic, null, 'an explicit empty string clears the field')
    assert.equal(cleared.paymentTermsDays, null, 'an explicit null clears the payment term')
    assert.equal(cleared.invoicePrefix, null, 'an explicit empty string clears the prefix')
    assert.equal(cleared.bankName, populated.bankName, 'clearing some fields leaves the others untouched')
    assert.equal(cleared.vatNumber, 'LU99999999', 'the earlier update survives')

    // The legal name may be changed but not cleared, and validation still applies to what is sent.
    const renamed = await upsertOrganizationBillingConfig({ actorUserId: actor.id, organizationId, value: { legalName: 'QA TRANSPORT II S.A.' } })
    assert.equal(renamed.legalName, 'QA TRANSPORT II S.A.')
    assert.equal(renamed.bankName, populated.bankName, 'renaming preserves the rest')
    await assert.rejects(() => upsertOrganizationBillingConfig({ actorUserId: actor.id, organizationId, value: { legalName: '' } }), /LEGAL_NAME_REQUIRED/)
    await assert.rejects(() => upsertOrganizationBillingConfig({ actorUserId: actor.id, organizationId, value: { paymentTermsDays: 9999 } }), /PAYMENT_TERMS_INVALID/)
    await assert.rejects(() => upsertOrganizationBillingConfig({ actorUserId: actor.id, organizationId, value: { billingEmail: 'not-an-email' } }), /BILLING_EMAIL_INVALID/)
    const afterRejections = await prisma.organizationBillingConfig.findUniqueOrThrow({ where: { organizationId } })
    assert.equal(afterRejections.legalName, 'QA TRANSPORT II S.A.', 'a rejected request changes nothing')
    assert.equal(afterRejections.billingEmail, populated.billingEmail, 'a rejected request changes nothing')

    // A first configuration still requires the legal name.
    const emptyOrganizationId = `${organizationId}-2`
    await prisma.organization.create({ data: { id: emptyOrganizationId, name: 'QA_BILLING_EMPTY', slug: `qa-billing-empty-${suffix}` } })
    try {
      await assert.rejects(() => upsertOrganizationBillingConfig({ actorUserId: actor.id, organizationId: emptyOrganizationId, value: { vatNumber: 'LU22222222' } }), /LEGAL_NAME_REQUIRED/)
      assert.equal(await prisma.organizationBillingConfig.count({ where: { organizationId: emptyOrganizationId } }), 0)
    } finally {
      await prisma.organization.delete({ where: { id: emptyOrganizationId } })
    }
  } finally {
    await prisma.platformAuditLog.deleteMany({ where: { organizationId } })
    await prisma.organizationBillingConfig.deleteMany({ where: { organizationId } })
    await prisma.organization.deleteMany({ where: { id: organizationId } })
  }
  console.log('Billing partial update: omitted fields preserved, explicit null clears: OK')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
