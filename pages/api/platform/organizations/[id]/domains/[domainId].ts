import { Prisma } from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'
import { requireSuperAdmin } from '../../../../../../lib/auth/platform-authorization'
import { deleteOrganizationDomain, updateOrganizationDomain } from '../../../../../../lib/platform/organizations'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireSuperAdmin(req, res); if (!actor) return
  const organizationId = String(req.query.id || ''); const domainId = String(req.query.domainId || '')
  try {
    if (req.method === 'PATCH') return res.status(200).json({ domain: await updateOrganizationDomain({ actorUserId: actor.id, organizationId, domainId, pathPrefix: req.body?.pathPrefix, isPrimary: req.body?.isPrimary, isActive: req.body?.isActive }) })
    if (req.method === 'DELETE') { await deleteOrganizationDomain({ actorUserId: actor.id, organizationId, domainId }); return res.status(200).json({ ok: true }) }
    res.setHeader('Allow', 'PATCH, DELETE'); return res.status(405).json({ error: 'Méthode non autorisée' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return res.status(404).json({ error: 'Domaine introuvable' })
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ error: 'Domaine en conflit' })
    if (error instanceof Error && error.message === 'INVALID_DOMAIN') return res.status(400).json({ error: 'Préfixe invalide' })
    return res.status(500).json({ error: 'Modification impossible' })
  }
}
