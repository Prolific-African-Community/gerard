import { withTenantApiRoute } from '../../../../../lib/auth/authorization'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission, runWithCurrentOrganization } from '../../../../../lib/auth/authorization'
import { permissions } from '../../../../../lib/auth/permissions'
import { prisma } from '../../../../../lib/prisma'

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Méthode non autorisée' }) }
  const user = await requirePermission(req, res, permissions.missionsView)
  if (!user) return
  const missionId = typeof req.query.id === 'string' ? req.query.id : ''
  if (!missionId) return res.status(400).json({ error: 'Mission invalide' })
  return runWithCurrentOrganization(user, async () => {
    const mission = await prisma.mission.findFirst({
      where: { id: missionId, organizationId: user.organizationId },
      select: { id: true },
    })
    if (!mission) return res.status(404).json({ error: 'Mission introuvable' })
    const sourceEmail = await prisma.missionSourceEmail.findFirst({
      where: { missionId: mission.id, organizationId: user.organizationId },
    })
    if (!sourceEmail) return res.status(404).json({ error: 'Mail source introuvable' })
    return res.status(200).json({ sourceEmail })
  })
}

export default withTenantApiRoute(handler)
