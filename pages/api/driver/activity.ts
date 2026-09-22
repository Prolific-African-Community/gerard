import { withTenantApiRoute } from '../../../lib/auth/authorization'
import { DriverActivitySource, UserRole } from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requireActiveUser, requireOrganizationModule } from '../../../lib/auth/authorization'
import { parseActivityInput } from '../../../lib/dispatch/regulatory/activity-input'
import {
  getDriverActivityState,
  serializeActivityEvent,
} from '../../../lib/dispatch/regulatory/activity-service'
import { prisma } from '../../../lib/prisma'

async function inferMissionId(driverId: string, effectiveAt: Date) {
  const candidates = await prisma.missionAssignment.findMany({
    where: {
      OR: [{ driverId }, { planningRow: { driverId } }],
      scheduledDate: {
        gte: new Date(effectiveAt.getTime() - 12 * 60 * 60 * 1000),
        lte: new Date(effectiveAt.getTime() + 12 * 60 * 60 * 1000),
      },
    },
    select: { missionId: true },
    take: 2,
  })
  return candidates.length === 1 ? candidates[0].missionId : null
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const user = await requireActiveUser(req, res)
  if (!user) return
  if (!(await requireOrganizationModule(req, res, 'PLANNING'))) return
  if (user.role !== UserRole.DRIVER || !user.driverId) {
    return res.status(403).json({ error: 'Accès réservé au chauffeur.' })
  }

  if (req.method === 'GET') {
    const state = await getDriverActivityState(user.driverId)
    if (!state) return res.status(404).json({ error: 'Chauffeur introuvable.' })
    return res.status(200).json({
      driver: state.driver,
      summary: state.summary,
      presentation: state.presentation,
      events: state.events.slice(-40).reverse().map(serializeActivityEvent),
    })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Méthode non autorisée.' })
  }

  const now = new Date()
  const input = parseActivityInput(req.body, now, {
    maximumRetrospectiveHours: 24,
  })
  if (!input) {
    return res.status(400).json({
      error:
        'Déclaration invalide. La date doit être comprise dans les dernières 24 heures.',
    })
  }
  const missionId =
    input.type === 'DRIVE_START'
      ? await inferMissionId(user.driverId, input.effectiveAt)
      : null
  const event = await prisma.driverActivityEvent.create({
    data: {
      driverId: user.driverId,
      type: input.type,
      effectiveAt: input.effectiveAt,
      recordedAt: now,
      source: DriverActivitySource.DRIVER,
      note: input.note,
      authorUserId: user.id,
      missionId,
      latitude: input.latitude,
      longitude: input.longitude,
      retrospective: input.retrospective,
    },
  })
  return res.status(201).json({
    event: serializeActivityEvent(event),
    simulationInvalidated: true,
    message: 'Données chauffeur modifiées — relancez la simulation.',
  })
}

export default withTenantApiRoute(handler)
