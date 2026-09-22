import { config } from 'dotenv'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { novotraluxBranding } from '../branding'

config({ path: '../../.env' })
config({ path: '../../.env.local', override: true })

async function main() {
  const target = process.env.LEGACY_TARGET_DATABASE_URL
  if (!target) throw new Error('LEGACY_TARGET_DATABASE_URL_REQUIRED')
  if (target === process.env.DATABASE_URL) throw new Error('TARGET_MUST_DIFFER_FROM_GERARD_PROTOTYPE')
  if (target === process.env.LEGACY_SOURCE_DATABASE_URL) throw new Error('TARGET_MUST_DIFFER_FROM_LEGACY_SOURCE')
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target }) })
  try {
  const [organization, missions, assignments] = await Promise.all([
    prisma.organization.findUnique({ where: { id: 'org-novotralux' }, select: { id: true, slug: true } }),
    prisma.mission.count({ where: { organizationId: 'org-novotralux' } }),
    prisma.missionAssignment.count({ where: { organizationId: 'org-novotralux' } }),
  ])
  if (organization?.slug !== 'novotralux' || missions !== 328 || assignments !== 162) {
    throw new Error('UNEXPECTED_NOVOTRALUX_STAGING_TARGET')
  }
  await prisma.organization.update({ where: { id: organization.id }, data: novotraluxBranding })
  console.log(JSON.stringify({ organizationId: organization.id, missions, assignments, branding: 'CONFIGURED' }))
  } finally {
    await prisma.$disconnect()
  }
}

void main()
