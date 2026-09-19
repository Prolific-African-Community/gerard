import { ParkVehicleType } from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../lib/auth/authorization'
import { permissions } from '../../../lib/auth/permissions'
import { moveEnsemble, moveVehicle } from '../../../lib/park/service'
import { actorName } from '../../../lib/park/actor'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const user = await requirePermission(req, res, permissions.parkMove)
  if (!user) return

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }

  const body = req.body
  if (
    !isRecord(body) ||
    (body.vehicleType !== ParkVehicleType.TRUCK &&
      body.vehicleType !== ParkVehicleType.TRAILER &&
      body.vehicleType !== 'ENSEMBLE') ||
    typeof body.vehicleId !== 'string' ||
    typeof body.toSpotId !== 'string' ||
    (body.note !== undefined &&
      body.note !== null &&
      typeof body.note !== 'string')
  ) {
    return res.status(400).json({ error: 'Requête invalide.' })
  }

  try {
    const actor = { id: user.id, name: actorName(user) }
    const result = body.vehicleType === 'ENSEMBLE'
      ? await moveEnsemble({
          truckId: body.vehicleId,
          toSpotId: body.toSpotId,
          note: typeof body.note === 'string' ? body.note : null,
          actor,
        })
      : await moveVehicle({
          vehicleType: body.vehicleType,
          vehicleId: body.vehicleId,
          toSpotId: body.toSpotId,
          note: typeof body.note === 'string' ? body.note : null,
          actor,
        })

    if (!result.ok) {
      return res.status(result.code).json({ error: result.error })
    }
    return res.status(200).json({ ok: true, noop: result.noop ?? false })
  } catch (error) {
    console.error('Failed to move vehicle on park', error)
    return res.status(500).json({ error: 'Déplacement impossible.' })
  }
}
