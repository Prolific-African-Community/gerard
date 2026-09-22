import assert from 'node:assert/strict'
import type { IncomingMessage } from 'node:http'
import { prisma } from '../lib/prisma'
import { createOrganizationDomain, updateOrganization } from '../lib/platform/organizations'
import { resolveBranding } from '../lib/tenant/branding'
import { assertDomainSessionCoherence, resolveOrganizationFromRequest } from '../lib/tenant/request-resolution'

const slug = `qa-white-label-${Date.now()}`
let organizationId = ''

async function main() {
  const actor = await prisma.user.findFirstOrThrow({ where: { isActive: true }, select: { id: true } })
  const organization = await prisma.organization.create({ data: { name: 'QA_WHITE_LABEL', slug } })
  organizationId = organization.id
  await updateOrganization({ actorUserId: actor.id, organizationId, displayName: 'QA Transport', accentColor: '#2457D6', logoUrl: '/logo-gerard.png' })
  await createOrganizationDomain({ actorUserId: actor.id, organizationId, hostname: 'qa-gerard.local', isPrimary: true })

  const configured = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })
  const branding = resolveBranding(configured)
  assert.equal(branding.displayName, 'QA Transport')
  assert.equal(branding.accentColor, '#2457D6')
  assert.equal(branding.logoUrl, '/logo-gerard.png')

  const request = { headers: { host: 'QA-GERARD.LOCAL:3000' }, url: '/dispatch' } as IncomingMessage
  const resolution = await resolveOrganizationFromRequest(request)
  assert.equal(resolution.organizationId, organizationId)
  assert.equal(resolution.hostname, 'qa-gerard.local')
  assert.doesNotThrow(() => assertDomainSessionCoherence(resolution, organizationId))
  assert.throws(() => assertDomainSessionCoherence(resolution, 'another-organization'), /DOMAIN_ORGANIZATION_MISMATCH/)
  console.log('QA_WHITE_LABEL branding and simulated domain: OK')
}

main().finally(async () => {
  if (organizationId) {
    await prisma.platformAuditLog.deleteMany({ where: { organizationId } })
    await prisma.organizationDomain.deleteMany({ where: { organizationId } })
    await prisma.organization.deleteMany({ where: { id: organizationId } })
  }
  await prisma.$disconnect()
}).catch((error) => { console.error(error); process.exitCode = 1 })
