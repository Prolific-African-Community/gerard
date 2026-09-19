import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../../../lib/auth/authorization'
import { permissions } from '../../../../../lib/auth/permissions'
import {
  createMaintenanceFromAnomaly,
  ParkInspectionError,
} from '../../../../../lib/park/inspections'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requirePermission(req, res, permissions.parkInspectionManage)
  if (!user) return
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Méthode non autorisée.' })
  }
  const id = typeof req.query.id === 'string' ? req.query.id.trim() : ''
  const resultId =
    req.body && typeof req.body === 'object' && typeof req.body.resultId === 'string'
      ? req.body.resultId.trim()
      : ''
  if (!id || !resultId) return res.status(400).json({ error: 'Anomalie invalide.' })
  try {
    return res.status(201).json({
      maintenanceRequest: await createMaintenanceFromAnomaly(id, resultId),
    })
  } catch (error) {
    if (error instanceof ParkInspectionError) {
      return res.status(error.statusCode).json({ error: error.message })
    }
    console.error('Failed to create maintenance from inspection', { id, error })
    return res.status(500).json({ error: 'Création de la maintenance impossible.' })
  }
}
