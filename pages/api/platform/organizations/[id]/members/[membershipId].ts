import { OrganizationRole, Prisma } from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requireSuperAdmin } from '../../../../../../lib/auth/platform-authorization'
import { removeOrganizationMember, updateOrganizationMember } from '../../../../../../lib/platform/organizations'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireSuperAdmin(req, res)
  if (!actor) return
  const organizationId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  const membershipId = Array.isArray(req.query.membershipId) ? req.query.membershipId[0] : req.query.membershipId
  if (!organizationId || !membershipId) return res.status(400).json({ error: 'Membre requis' })
  try {
    if (req.method === 'PATCH') {
      const role = req.body?.role
      if (!Object.values(OrganizationRole).includes(role)) return res.status(400).json({ error: 'Rôle invalide' })
      return res.status(200).json({ membership: await updateOrganizationMember({ actorUserId: actor.id, organizationId, membershipId, role }) })
    }
    if (req.method === 'DELETE') {
      await removeOrganizationMember({ actorUserId: actor.id, organizationId, membershipId })
      return res.status(200).json({ ok: true })
    }
    res.setHeader('Allow', 'PATCH, DELETE')
    return res.status(405).json({ error: 'Méthode non autorisée' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return res.status(404).json({ error: 'Membre introuvable' })
    if (error instanceof Error && error.message === 'LAST_ORG_ADMIN') return res.status(409).json({ error: 'Le dernier ORG_ADMIN doit être conservé' })
    console.error('Platform member update failed', error)
    return res.status(500).json({ error: 'Modification impossible' })
  }
}
