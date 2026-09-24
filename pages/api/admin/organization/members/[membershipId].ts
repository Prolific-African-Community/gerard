import { OrganizationRole, Prisma } from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requireOrganizationAdmin } from '../../../../../lib/auth/organization-admin'
import { runWithCurrentOrganization } from '../../../../../lib/auth/authorization'
import { organizationAdminRoles, setOrganizationMemberActive } from '../../../../../lib/organization/admin'
import { removeOrganizationMember, updateOrganizationMember } from '../../../../../lib/platform/organizations'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireOrganizationAdmin(req, res)
  if (!actor) return
  const membershipId = Array.isArray(req.query.membershipId) ? req.query.membershipId[0] : req.query.membershipId
  if (!membershipId) return res.status(400).json({ error: 'Membre requis' })
  return runWithCurrentOrganization(actor, async () => {
    try {
      if (req.method === 'PATCH') {
        if (req.body?.isActive !== undefined) {
          if (typeof req.body.isActive !== 'boolean') return res.status(400).json({ error: 'Statut invalide' })
          return res.status(200).json({ user: await setOrganizationMemberActive({ actorUserId: actor.id, organizationId: actor.organizationId, membershipId, isActive: req.body.isActive }) })
        }
        const role = req.body?.role
        if (!organizationAdminRoles.includes(role)) return res.status(400).json({ error: 'Rôle invalide' })
        return res.status(200).json({ membership: await updateOrganizationMember({ actorUserId: actor.id, organizationId: actor.organizationId, membershipId, role: role as OrganizationRole }) })
      }
      if (req.method === 'DELETE') {
        await removeOrganizationMember({ actorUserId: actor.id, organizationId: actor.organizationId, membershipId })
        return res.status(200).json({ ok: true })
      }
      res.setHeader('Allow', 'PATCH, DELETE')
      return res.status(405).json({ error: 'Méthode non autorisée' })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return res.status(404).json({ error: 'Membre introuvable' })
      if (error instanceof Error && error.message === 'LAST_ORG_ADMIN') return res.status(409).json({ error: 'Le dernier ORG_ADMIN actif doit être conservé' })
      if (error instanceof Error && ['PLATFORM_ACCOUNT_PROTECTED', 'SHARED_ACCOUNT_PROTECTED'].includes(error.message)) return res.status(403).json({ error: 'Ce compte est protégé et doit être administré par la plateforme' })
      throw error
    }
  })
}
