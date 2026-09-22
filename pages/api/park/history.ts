import { withTenantApiRoute } from '../../../lib/auth/authorization'
import { ParkMovementAction } from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../lib/auth/authorization'
import { permissions } from '../../../lib/auth/permissions'
import { queryParkHistory } from '../../../lib/park/service'

function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const user = await requirePermission(req, res, permissions.parkHistoryView)
  if (!user) return

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }

  const actionParam = firstValue(req.query.action as string | string[] | undefined)
  const action =
    actionParam && actionParam in ParkMovementAction
      ? (actionParam as ParkMovementAction)
      : undefined

  try {
    const history = await queryParkHistory({
      vehicleId: firstValue(req.query.vehicleId as string | string[] | undefined),
      spotId: firstValue(req.query.spotId as string | string[] | undefined),
      actorId: firstValue(req.query.actorId as string | string[] | undefined),
      action,
      limit: Number(firstValue(req.query.limit as string | string[] | undefined)) || undefined,
    })
    return res.status(200).json({ history })
  } catch (error) {
    console.error('Failed to load park history', error)
    return res.status(500).json({ error: 'Chargement de l’historique impossible.' })
  }
}

export default withTenantApiRoute(handler)
