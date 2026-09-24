import { Prisma } from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'
import { requireOrganizationAdmin } from '../../../../../../lib/auth/organization-admin'
import { runWithCurrentOrganization } from '../../../../../../lib/auth/authorization'
import { resetOrganizationMemberPassword } from '../../../../../../lib/organization/admin'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Méthode non autorisée' }) }
  const actor = await requireOrganizationAdmin(req, res)
  if (!actor) return
  const membershipId = Array.isArray(req.query.membershipId) ? req.query.membershipId[0] : req.query.membershipId
  if (!membershipId) return res.status(400).json({ error: 'Membre requis' })
  return runWithCurrentOrganization(actor, async () => {
    try {
      const result = await resetOrganizationMemberPassword({ actorUserId: actor.id, organizationId: actor.organizationId, membershipId })
      return res.status(200).json({ temporaryPassword: result.temporaryPassword, mustChangePassword: true })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return res.status(404).json({ error: 'Membre introuvable' })
      if (error instanceof Error && error.message === 'PASSWORD_AUTH_UNAVAILABLE') return res.status(409).json({ error: 'Ce compte n’utilise pas l’authentification par mot de passe' })
      if (error instanceof Error && ['PLATFORM_ACCOUNT_PROTECTED', 'SHARED_ACCOUNT_PROTECTED'].includes(error.message)) return res.status(403).json({ error: 'Ce compte est protégé et doit être administré par la plateforme' })
      throw error
    }
  })
}
