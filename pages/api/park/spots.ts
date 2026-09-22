import { withTenantApiRoute } from '../../../lib/auth/authorization'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../lib/auth/authorization'
import { permissions } from '../../../lib/auth/permissions'
import { buildParkOverview } from '../../../lib/park/service'

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const user = await requirePermission(req, res, permissions.parkView)
  if (!user) return

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }

  try {
    const overview = await buildParkOverview(user.role)
    return res.status(200).json({ spots: overview.spots })
  } catch (error) {
    console.error('Failed to load park spots', error)
    return res.status(500).json({ error: 'Chargement des emplacements impossible.' })
  }
}

export default withTenantApiRoute(handler)
