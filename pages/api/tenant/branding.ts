import type { NextApiRequest, NextApiResponse } from 'next'
import { getSessionUser } from '../../../lib/auth/session'
import { DEFAULT_BRANDING, resolveBranding } from '../../../lib/tenant/branding'
import { resolveOrganizationFromRequest } from '../../../lib/tenant/request-resolution'
import { prisma } from '../../../lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Méthode non autorisée' }) }
  const resolution = await resolveOrganizationFromRequest(req)
  const session = getSessionUser(req)
  const organizationId = resolution.status === 'resolved'
    ? resolution.organizationId
    : resolution.status === 'local'
      ? session?.organizationId
      : null
  if (!organizationId) return res.status(200).json({ branding: DEFAULT_BRANDING, resolvedDomainOrganizationId: null })
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { displayName: true, logoUrl: true, accentColor: true, faviconUrl: true, applicationTitle: true } })
  return res.status(200).json({ branding: resolveBranding(organization), resolvedDomainOrganizationId: resolution.organizationId })
}
