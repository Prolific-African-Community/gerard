import assert from 'node:assert/strict'
import { OrganizationRole, TrailerCustodyState, TrailerType } from '@prisma/client'
import { runWithOrganization } from '../lib/auth/organization-context'
import { hardDeleteTrailer } from '../lib/dispatch/trailer-lifecycle'
import { resolveOperatingBase } from '../lib/dispatch/operating-base'
import { prisma } from '../lib/prisma'

const organizationId = 'QA_AUTO_SIMPLIFICATION_DELETE_ORG'
const trailerId = 'QA_AUTO_SIMPLIFICATION_DELETE_TRAILER'
const organizationBId = 'QA_AUTO_SIMPLIFICATION_BASE_B'

async function main() {
  await prisma.organization.upsert({ where: { id: organizationId }, create: { id: organizationId, name: 'QA auto planning delete', slug: 'qa-auto-simplification-delete', operatingBaseAddress: 'Base A', operatingBaseLat: 49.6, operatingBaseLng: 6.1 }, update: { operatingBaseAddress: 'Base A', operatingBaseLat: 49.6, operatingBaseLng: 6.1 } })
  await prisma.organization.upsert({ where: { id: organizationBId }, create: { id: organizationBId, name: 'QA base B', slug: 'qa-auto-simplification-base-b', operatingBaseAddress: 'Base B', operatingBaseLat: 50.1, operatingBaseLng: 5.1 }, update: { operatingBaseAddress: 'Base B', operatingBaseLat: 50.1, operatingBaseLng: 5.1 } })
  try {
    assert.equal((await resolveOperatingBase(organizationId))?.label, 'Base A')
    assert.equal((await resolveOperatingBase(organizationBId))?.label, 'Base B')
    await runWithOrganization({ organizationId, organizationRole: OrganizationRole.ORG_ADMIN, platformRole: null, userId: 'qa' }, async () => {
      await prisma.trailer.create({ data: { id: trailerId, plateNumber: 'QA_AUTO_SIMPLIFICATION_DELETE_1', type: TrailerType.CURTAINSIDER } })
      await prisma.trailerCustodyEvent.create({ data: { trailerId, fromState: TrailerCustodyState.EMPTY, toState: TrailerCustodyState.AT_BASE, location: 'QA base' } })
      await prisma.$transaction((tx) => hardDeleteTrailer(tx, trailerId))
      assert.equal(await prisma.trailer.count({ where: { id: trailerId } }), 0)
      assert.equal(await prisma.trailerCustodyEvent.count({ where: { trailerId } }), 0)
    })
  } finally {
    await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined)
    await prisma.organization.delete({ where: { id: organizationBId } }).catch(() => undefined)
    await prisma.$disconnect()
  }
  console.log('U-W/Y-AA trailer hard delete, custody cleanup and tenant base isolation: OK')
}

main().catch(async (error) => { console.error(error); await prisma.$disconnect(); process.exitCode = 1 })
