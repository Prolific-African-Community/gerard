import { withTenantApiRoute } from '../../../../../lib/auth/authorization'
import { DriverActivitySource } from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../../../lib/auth/authorization'
import { permissions } from '../../../../../lib/auth/permissions'
import {
  parseActivityInput,
  validateActivityAppend,
} from '../../../../../lib/dispatch/regulatory/activity-input'
import {
  getDriverActivityState,
  serializeActivityEvent,
} from '../../../../../lib/dispatch/regulatory/activity-service'
import { prisma } from '../../../../../lib/prisma'

function driverIdFromRequest(req: NextApiRequest) {
  return typeof req.query.id === 'string' ? req.query.id.trim() : ''
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const driverId = driverIdFromRequest(req)
  if (!driverId) return res.status(400).json({ error: 'Chauffeur requis.' })

  if (req.method === 'GET') {
    if (!(await requirePermission(req, res, permissions.driversView))) return
    const state = await getDriverActivityState(driverId)
    if (!state) return res.status(404).json({ error: 'Chauffeur introuvable.' })
    return res.status(200).json({
      driver: state.driver,
      summary: state.summary,
      assessment: state.assessment,
      position: state.position,
      presentation: state.presentation,
      events: state.events.slice(-80).reverse().map(serializeActivityEvent),
      initialState: state.declaration
        ? {
            id: state.declaration.id,
            referenceAt: state.declaration.referenceAt.toISOString(),
            validUntil:
              state.declaration.validUntil?.toISOString() ?? null,
            source: state.declaration.source,
            timeZone: state.declaration.timeZone,
            drivingSinceValidBreakSeconds:
              state.declaration.drivingSinceValidBreakSeconds,
            dailyDrivingSeconds: state.declaration.dailyDrivingSeconds,
            weeklyDrivingSeconds: state.declaration.weeklyDrivingSeconds,
            previousWeekDrivingSeconds:
              state.declaration.previousWeekDrivingSeconds,
            dailyExtensionsUsedThisWeek:
              state.declaration.dailyExtensionsUsedThisWeek,
            reducedDailyRestsUsedSinceWeeklyRest:
              state.declaration.reducedDailyRestsUsedSinceWeeklyRest,
            splitBreakFirstPartSeconds:
              state.declaration.splitBreakFirstPartSeconds,
            splitDailyRestFirstPartSeconds:
              state.declaration.splitDailyRestFirstPartSeconds,
            lastValidRestEndedAt:
              state.declaration.lastValidRestEndedAt.toISOString(),
            dutyPeriodStartedAt:
              state.declaration.dutyPeriodStartedAt.toISOString(),
            currentIsoWeek: state.declaration.currentIsoWeek,
            weeklyRestDueAt:
              state.declaration.weeklyRestDueAt?.toISOString() ?? null,
            weeklyRestCompensationDueSeconds:
              state.declaration.weeklyRestCompensationDueSeconds,
            notes: state.declaration.notes,
          }
        : null,
    })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Méthode non autorisée.' })
  }
  const user = await requirePermission(req, res, permissions.dispatchAssign)
  if (!user) return
  const now = new Date()
  const input = parseActivityInput(req.body, now, {
    maximumRetrospectiveHours: 24 * 31,
  })
  const body =
    req.body && typeof req.body === 'object'
      ? (req.body as Record<string, unknown>)
      : {}
  const reason =
    typeof body.correctionReason === 'string'
      ? body.correctionReason.trim().slice(0, 500)
      : ''
  if (!input || reason.length < 5) {
    return res.status(400).json({
      error: 'Correction invalide : une justification vérifiée est requise.',
    })
  }
  const correctedEventId =
    typeof body.correctedEventId === 'string' && body.correctedEventId.trim()
      ? body.correctedEventId.trim()
      : null
  const appendActivity = body.appendActivity === true
  const voidEvent = body.voidEvent === true
  if (voidEvent && !correctedEventId) {
    return res.status(400).json({
      error: 'Sélectionnez l’activité à supprimer.',
    })
  }
  const [driver, previous] = await Promise.all([
    prisma.driver.findUnique({ where: { id: driverId }, select: { id: true } }),
    prisma.driverActivityEvent.findFirst({
      where: correctedEventId
        ? { id: correctedEventId, driverId }
        : { driverId },
      orderBy: correctedEventId
        ? undefined
        : [{ effectiveAt: 'desc' }, { recordedAt: 'desc' }],
    }),
  ])
  if (!driver) return res.status(404).json({ error: 'Chauffeur introuvable.' })
  if (correctedEventId && !previous) {
    return res.status(404).json({ error: 'Événement à corriger introuvable.' })
  }
  if (appendActivity && !voidEvent) {
    const transitionError = validateActivityAppend(
      input.type,
      previous?.type ?? null
    )
    if (transitionError) {
      return res.status(409).json({ error: transitionError })
    }
  }
  const event = await prisma.driverActivityEvent.create({
    data: {
      driverId,
      type: voidEvent && previous ? previous.type : input.type,
      effectiveAt:
        voidEvent && previous ? previous.effectiveAt : input.effectiveAt,
      recordedAt: now,
      source: DriverActivitySource.DISPATCHER_CORRECTION,
      note: voidEvent ? 'Activité supprimée après confirmation.' : input.note,
      authorUserId: user.id,
      retrospective: input.retrospective,
      isVoided: voidEvent,
      correctedEventId: appendActivity && !voidEvent ? null : previous?.id ?? null,
      previousType: appendActivity ? null : previous?.type ?? null,
      previousEffectiveAt: appendActivity
        ? null
        : previous?.effectiveAt ?? null,
      previousNote: appendActivity ? null : previous?.note ?? null,
      correctionReason: reason,
    },
  })
  return res.status(201).json({
    event: serializeActivityEvent(event),
    simulationInvalidated: true,
    message: 'Données chauffeur modifiées — relancez la simulation.',
  })
}

export default withTenantApiRoute(handler)
