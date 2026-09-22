import { withTenantApiRoute } from '../../../../../lib/auth/authorization'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../../../lib/auth/authorization'
import { permissions } from '../../../../../lib/auth/permissions'
import {
  getInspection,
  parseInspectionInput,
  ParkInspectionError,
  updateInspectionDraft,
} from '../../../../../lib/park/inspections'

function getId(value: string | string[] | undefined) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const permission =
    req.method === 'GET'
      ? permissions.parkInspectionView
      : permissions.parkInspectionManage
  const user = await requirePermission(req, res, permission)
  if (!user) return
  const id = getId(req.query.id)
  if (!id) return res.status(400).json({ error: 'Identifiant invalide.' })

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ inspection: await getInspection(id) })
    }
    if (req.method === 'PATCH') {
      const inspection = await updateInspectionDraft(id, parseInspectionInput(req.body))
      return res.status(200).json({ inspection })
    }
    res.setHeader('Allow', 'GET, PATCH')
    return res.status(405).json({ error: 'Méthode non autorisée.' })
  } catch (error) {
    if (error instanceof ParkInspectionError) {
      return res.status(error.statusCode).json({ error: error.message })
    }
    console.error('Failed to handle park inspection', { id, error })
    return res.status(500).json({ error: 'Gestion du contrôle impossible.' })
  }
}

export default withTenantApiRoute(handler)
