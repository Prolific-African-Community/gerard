import assert from 'node:assert/strict'
import { prisma } from '../lib/prisma'
import { applyPlatformConfiguration } from '../lib/organization/platform-configuration'

async function main() {
  const organization = await prisma.organization.findUnique({ where: { id: 'org-novotralux' }, select: { id: true, displayName: true, applicationTitle: true, accentColor: true, enabledModules: true } })
  if (!organization) { console.log('Platform-to-Custom Preview integration: skipped (Preview organization unavailable)'); return }
  const actor = await prisma.organizationUser.findFirstOrThrow({ where: { organizationId: organization.id, role: 'ORG_ADMIN' }, select: { userId: true } })
  await applyPlatformConfiguration({ organizationId: organization.id, action: 'updateIdentity', payload: { displayName: 'QA Preview Platform Name', applicationTitle: 'QA Preview' }, platformActorId: 'qa-platform' })
  await applyPlatformConfiguration({ organizationId: organization.id, action: 'updateBranding', payload: { accentColor: '#123456' }, platformActorId: 'qa-platform' })
  const changed = await prisma.organization.findUniqueOrThrow({ where: { id: organization.id }, select: { displayName: true, applicationTitle: true, accentColor: true } })
  assert.equal(changed.displayName, 'QA Preview Platform Name')
  assert.equal(changed.accentColor, '#123456')
  await prisma.organization.update({ where: { id: organization.id }, data: { displayName: organization.displayName, applicationTitle: organization.applicationTitle, accentColor: organization.accentColor, enabledModules: organization.enabledModules } })
  await assert.rejects(() => applyPlatformConfiguration({ organizationId: organization.id, action: 'updateIntegrationConfig', payload: { type: 'MAIL_INTAKE', configJson: { password: 'forbidden' } }, platformActorId: 'qa-platform' }), /SECRET_(FIELD_FORBIDDEN|IN_CONFIG)/)
  assert.ok(actor.userId)
  console.log('Novotralux Preview Custom configuration, restoration and secret rejection: OK')
}

main().finally(() => prisma.$disconnect())
