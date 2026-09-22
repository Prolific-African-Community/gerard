import { Prisma } from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'
import { requireSuperAdmin } from '../../../../../../lib/auth/platform-authorization'
import { createOrganizationDomain } from '../../../../../../lib/platform/organizations'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Méthode non autorisée' }) }
  const actor = await requireSuperAdmin(req, res); if (!actor) return
  const organizationId = String(req.query.id || '')
  try {
    const domain = await createOrganizationDomain({ actorUserId: actor.id, organizationId, hostname: req.body?.hostname, pathPrefix: req.body?.pathPrefix, isPrimary: req.body?.isPrimary, isActive: req.body?.isActive })
    return res.status(201).json({ domain })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ error: 'Ce domaine et ce préfixe existent déjà.' })
    if (error instanceof Error && error.message === 'INVALID_DOMAIN') return res.status(400).json({ error: 'Domaine invalide' })
    return res.status(500).json({ error: 'Ajout impossible' })
  }
}
