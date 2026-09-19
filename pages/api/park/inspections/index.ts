import {
  ParkInspectionOverallResult,
  ParkInspectionStatus,
  ParkVehicleType,
} from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../../lib/auth/authorization'
import { permissions } from '../../../../lib/auth/permissions'
import {
  createInspectionDraft,
  listInspections,
  listInspectionSummaries,
  parseInspectionInput,
  ParkInspectionError,
} from '../../../../lib/park/inspections'

function queryString(value: string | string[] | undefined) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function queryDate(value: string | undefined) {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new ParkInspectionError('Filtre de date invalide.', 400)
  return date
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const permission =
    req.method === 'GET'
      ? permissions.parkInspectionView
      : permissions.parkInspectionManage
  const user = await requirePermission(req, res, permission)
  if (!user) return

  try {
    if (req.method === 'GET') {
      if (queryString(req.query.summary) === 'true') {
        return res.status(200).json({ summaries: await listInspectionSummaries() })
      }
      const rawVehicleType = queryString(req.query.vehicleType)
      const rawStatus = queryString(req.query.status)
      const rawResult = queryString(req.query.result)
      if (rawVehicleType && !Object.values(ParkVehicleType).includes(rawVehicleType as ParkVehicleType)) {
        throw new ParkInspectionError('Type de véhicule invalide.', 400)
      }
      if (rawStatus && !Object.values(ParkInspectionStatus).includes(rawStatus as ParkInspectionStatus)) {
        throw new ParkInspectionError('Statut de contrôle invalide.', 400)
      }
      if (rawResult && !Object.values(ParkInspectionOverallResult).includes(rawResult as ParkInspectionOverallResult)) {
        throw new ParkInspectionError('Résultat global invalide.', 400)
      }
      const rawLimit = queryString(req.query.limit)
      const limit = rawLimit ? Number.parseInt(rawLimit, 10) : undefined
      if (rawLimit && (!Number.isInteger(limit) || (limit as number) < 1)) {
        throw new ParkInspectionError('Limite invalide.', 400)
      }
      const inspections = await listInspections({
        vehicleType: rawVehicleType as ParkVehicleType | undefined,
        vehicleId: queryString(req.query.vehicleId),
        status: rawStatus as ParkInspectionStatus | undefined,
        overallResult: rawResult as ParkInspectionOverallResult | undefined,
        from: queryDate(queryString(req.query.from)),
        to: queryDate(queryString(req.query.to)),
        limit,
      })
      return res.status(200).json({ inspections })
    }

    if (req.method === 'POST') {
      const inspection = await createInspectionDraft(parseInspectionInput(req.body), user)
      return res.status(201).json({ inspection })
    }

    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Méthode non autorisée.' })
  } catch (error) {
    if (error instanceof ParkInspectionError) {
      return res.status(error.statusCode).json({ error: error.message })
    }
    console.error('Failed to handle park inspections', error)
    return res.status(500).json({ error: 'Gestion des contrôles impossible.' })
  }
}
