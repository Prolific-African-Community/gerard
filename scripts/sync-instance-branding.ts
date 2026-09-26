import 'dotenv/config'

import { prisma } from '../lib/prisma'
import { resolveRuntimeBranding } from '../lib/runtime/branding-registry'
import { normalizeAccentColor, normalizeBrandAssetUrl } from '../lib/tenant/branding'

/**
 * Writes the branding an instance declares (lib/runtime/branding-registry, i.e. the application's own
 * branding module) into its organization row, so the authenticated UI reads the same identity as the login
 * page instead of falling back to the Gerard default. Generic: the application and organization come from the
 * environment, no client name appears here. Only the branding columns are touched.
 *
 * Usage: GERARD_INSTANCE_ORGANIZATION_ID=<org> npm run branding:sync -- [--apply]
 */
async function main() {
  const organizationId = process.env.GERARD_INSTANCE_ORGANIZATION_ID?.trim()
  if (!organizationId) throw new Error('GERARD_INSTANCE_ORGANIZATION_ID_REQUIRED')
  const branding = resolveRuntimeBranding()
  const apply = process.argv.includes('--apply')

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, displayName: true, applicationTitle: true, accentColor: true, logoUrl: true, faviconUrl: true },
  })
  if (!organization) throw new Error(`ORGANIZATION_NOT_FOUND:${organizationId}`)

  // Only fills what the row is missing: a value an administrator already configured is never overwritten.
  const data: Record<string, string> = {}
  if (!organization.displayName) data.displayName = branding.displayName
  if (!organization.applicationTitle) data.applicationTitle = branding.applicationTitle
  if (!organization.accentColor && normalizeAccentColor(branding.accentColor)) data.accentColor = branding.accentColor
  if (!organization.logoUrl && normalizeBrandAssetUrl(branding.logoUrl)) data.logoUrl = branding.logoUrl
  if (!organization.faviconUrl && normalizeBrandAssetUrl(branding.faviconUrl)) data.faviconUrl = branding.faviconUrl

  if (Object.keys(data).length === 0) {
    console.log(JSON.stringify({ organizationId, status: 'ALREADY_CONFIGURED' }))
    return
  }
  if (!apply) {
    console.log(JSON.stringify({ organizationId, status: 'DRY_RUN', wouldSet: data }, null, 2))
    return
  }
  await prisma.organization.update({ where: { id: organizationId }, data })
  console.log(JSON.stringify({ organizationId, status: 'UPDATED', set: data }, null, 2))
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
