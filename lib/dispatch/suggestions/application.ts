import {
  DriverStatus,
  MissionEventType,
  PlanningDay,
  Prisma,
  TrailerStatus,
  TruckStatus,
} from '@prisma/client'

import { prisma } from '../../prisma'
import { requireActiveOrganizationId } from '../../auth/organization-context'
import { parseWeekStartParam } from '../date-utils'
import { findResourceOccupationConflicts } from '../resource-availability'
import { analyzePlanningForSuggestions } from './planning-service'
import type { GerardSuggestion, SuggestionMutationPlan } from './types'

export type SuggestionApplicationStatus =
  | 'APPLIED'
  | 'STALE'
  | 'CONFLICT'
  | 'INVALID'
  | 'ALREADY_APPLIED'

export type SuggestionApplicationResult = {
  status: SuggestionApplicationStatus
  message: string
  missionId?: string
  assignmentId?: string
  applicationId?: string
  snapshotFingerprint?: string
}

export class SuggestionApplicationError extends Error {
  constructor(
    public status: Exclude<SuggestionApplicationStatus, 'APPLIED' | 'ALREADY_APPLIED'>,
    message: string
  ) {
    super(message)
  }
}

const staleMessage =
  'Le planning a changé depuis l’analyse. Relancez l’analyse avant d’appliquer cette suggestion.'
const unavailableTruckStatuses = new Set<TruckStatus>([
  TruckStatus.IN_MAINTENANCE,
  TruckStatus.MAINTENANCE_EXT,
  TruckStatus.OUT_OF_SERVICE,
])
const unavailableTrailerStatuses = new Set<TrailerStatus>([
  TrailerStatus.IN_MAINTENANCE,
  TrailerStatus.MAINTENANCE_EXT,
  TrailerStatus.OUT_OF_SERVICE,
])

function planningDayAt(value: string) {
  const shortName = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: 'Europe/Luxembourg',
  }).format(new Date(value))
  return {
    Mon: PlanningDay.MONDAY,
    Tue: PlanningDay.TUESDAY,
    Wed: PlanningDay.WEDNESDAY,
    Thu: PlanningDay.THURSDAY,
    Fri: PlanningDay.FRIDAY,
    Sat: PlanningDay.SATURDAY,
    Sun: PlanningDay.SUNDAY,
  }[shortName]
}

function replayResult(value: Prisma.JsonValue): SuggestionApplicationResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, Prisma.JsonValue>
  if (
    record.status !== 'APPLIED' ||
    typeof record.missionId !== 'string' ||
    typeof record.assignmentId !== 'string'
  ) return null
  return {
    status: 'ALREADY_APPLIED',
    message: 'Cette suggestion a déjà été appliquée.',
    missionId: record.missionId,
    assignmentId: record.assignmentId,
    applicationId:
      typeof record.applicationId === 'string' ? record.applicationId : undefined,
    snapshotFingerprint:
      typeof record.snapshotFingerprint === 'string'
        ? record.snapshotFingerprint
        : undefined,
  }
}

async function buildMutationPlan(input: {
  suggestion: GerardSuggestion
  requestedFingerprint: string
}): Promise<SuggestionMutationPlan> {
  if (
    input.suggestion.snapshotFingerprint !== input.requestedFingerprint ||
    !input.suggestion.proposedState.possibleStartAt ||
    !input.suggestion.proposedState.completedAt
  ) throw new SuggestionApplicationError('STALE', staleMessage)

  const assignment = await prisma.missionAssignment.findUnique({
    where: { missionId: input.suggestion.currentState.missionId },
  })
  if (
    !assignment ||
    !assignment.planningRowId ||
    !assignment.driverId ||
    !assignment.truckId ||
    assignment.planningRowId !== input.suggestion.currentState.pairRowId ||
    assignment.driverId !== input.suggestion.currentState.driverId ||
    assignment.truckId !== input.suggestion.currentState.truckId ||
    assignment.trailerId !== input.suggestion.currentState.trailerId
  ) throw new SuggestionApplicationError('STALE', staleMessage)

  return {
    suggestionId: input.suggestion.id,
    weekStart: input.suggestion.weekStart,
    snapshotFingerprint: input.requestedFingerprint,
    missionId: input.suggestion.currentState.missionId,
    currentAssignment: {
      assignmentId: assignment.id,
      updatedAt: assignment.updatedAt.toISOString(),
      pairRowId: assignment.planningRowId,
      driverId: assignment.driverId,
      truckId: assignment.truckId,
      trailerId: assignment.trailerId,
    },
    proposedAssignment: {
      pairRowId: input.suggestion.proposedState.pairRowId,
      driverId: input.suggestion.proposedState.driverId,
      truckId: input.suggestion.proposedState.truckId,
      trailerId: input.suggestion.proposedState.trailerId,
      scheduledDate: input.suggestion.proposedState.possibleStartAt,
      plannedEndAt: input.suggestion.proposedState.completedAt,
      approachDistanceMeters:
        input.suggestion.proposedState.approachDistanceMeters,
      approachDurationSeconds:
        input.suggestion.proposedState.approachDurationSeconds,
      approachProvider: input.suggestion.proposedState.approachProvider,
      trailerTransitions: input.suggestion.proposedState.trailerTransitions,
    },
  }
}

export async function applyPlanningSuggestion(input: {
  userId: string
  suggestionId: string
  weekStart: string
  snapshotFingerprint: string
  idempotencyKey: string
}): Promise<SuggestionApplicationResult> {
  const organizationId = requireActiveOrganizationId()
  const weekStart = parseWeekStartParam(input.weekStart)
  if (!weekStart || !input.suggestionId || !input.snapshotFingerprint || !input.idempotencyKey) {
    throw new SuggestionApplicationError('INVALID', 'Demande d’application invalide.')
  }
  if (!input.suggestionId.startsWith('reassignment:')) {
    throw new SuggestionApplicationError('INVALID', 'Suggestion inexistante ou invalide.')
  }

  const existing = await prisma.dispatchOptimizationApplication.findFirst({
    where: { idempotencyKey: input.idempotencyKey },
  })
  if (existing) {
    if (existing.actorId !== input.userId) {
      throw new SuggestionApplicationError('CONFLICT', 'Cette clé d’idempotence appartient à un autre utilisateur.')
    }
    const replay = replayResult(existing.resultSummary)
    if (replay) return replay
  }

  const analysis = await analyzePlanningForSuggestions(weekStart)
  const suggestion = analysis.suggestions.find(
    (candidate) => candidate.id === input.suggestionId
  )
  if (!suggestion || suggestion.snapshotFingerprint !== input.snapshotFingerprint) {
    throw new SuggestionApplicationError('STALE', staleMessage)
  }
  const plan = await buildMutationPlan({
    suggestion,
    requestedFingerprint: input.snapshotFingerprint,
  })
  const day = planningDayAt(plan.proposedAssignment.scheduledDate)
  if (!day) throw new SuggestionApplicationError('INVALID', 'Jour de planification invalide.')

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`gerard-intelligence:${organizationId}:${input.weekStart}`}))`
    const replayRecord = await tx.dispatchOptimizationApplication.findFirst({
      where: { idempotencyKey: input.idempotencyKey },
    })
    if (replayRecord) {
      if (replayRecord.actorId !== input.userId) {
        throw new SuggestionApplicationError('CONFLICT', 'Cette clé d’idempotence appartient à un autre utilisateur.')
      }
      const replay = replayResult(replayRecord.resultSummary)
      if (replay) return replay
    }

    const [assignment, targetRow, driver, truck, trailer] = await Promise.all([
      tx.missionAssignment.findUnique({
        where: { id: plan.currentAssignment.assignmentId },
        include: { mission: true },
      }),
      tx.planningRow.findUnique({ where: { id: plan.proposedAssignment.pairRowId } }),
      tx.driver.findUnique({ where: { id: plan.proposedAssignment.driverId } }),
      tx.truck.findUnique({ where: { id: plan.proposedAssignment.truckId } }),
      plan.proposedAssignment.trailerId
        ? tx.trailer.findUnique({ where: { id: plan.proposedAssignment.trailerId } })
        : Promise.resolve(null),
    ])
    if (
      !assignment ||
      assignment.updatedAt.toISOString() !== plan.currentAssignment.updatedAt ||
      assignment.missionId !== plan.missionId ||
      assignment.planningRowId !== plan.currentAssignment.pairRowId ||
      assignment.driverId !== plan.currentAssignment.driverId ||
      assignment.truckId !== plan.currentAssignment.truckId ||
      assignment.trailerId !== plan.currentAssignment.trailerId
    ) throw new SuggestionApplicationError('STALE', staleMessage)
    if (
      !targetRow ||
      targetRow.driverId !== plan.proposedAssignment.driverId ||
      targetRow.truckId !== plan.proposedAssignment.truckId ||
      !driver ||
      driver.status !== DriverStatus.ACTIVE ||
      !truck ||
      unavailableTruckStatuses.has(truck.status)
    ) throw new SuggestionApplicationError('CONFLICT', 'Les ressources proposées ne sont plus disponibles.')
    if (
      plan.proposedAssignment.trailerId &&
      (!trailer || unavailableTrailerStatuses.has(trailer.status))
    ) throw new SuggestionApplicationError('CONFLICT', 'La remorque proposée n’est plus disponible.')

    const proposed = {
      missionId: plan.missionId,
      driverId: plan.proposedAssignment.driverId,
      truckId: plan.proposedAssignment.truckId,
      trailerId: plan.proposedAssignment.trailerId,
      startsAt: new Date(plan.proposedAssignment.scheduledDate),
      endsAt: new Date(plan.proposedAssignment.plannedEndAt),
    }
    const occupied = await tx.missionAssignment.findMany({
      where: {
        missionId: { not: plan.missionId },
        OR: [
          { driverId: proposed.driverId },
          { truckId: proposed.truckId },
          ...(proposed.trailerId ? [{ trailerId: proposed.trailerId }] : []),
        ],
      },
      include: { mission: { select: { deliveryDate: true } } },
    })
    const conflicts = findResourceOccupationConflicts({
      proposed: [proposed],
      occupied: occupied.map((item) => ({
        missionId: item.missionId,
        driverId: item.driverId,
        truckId: item.truckId,
        trailerId: item.trailerId,
        startsAt: item.scheduledDate,
        endsAt: item.plannedEndAt ?? item.mission.deliveryDate,
      })),
    })
    if (conflicts.length) {
      throw new SuggestionApplicationError(
        'CONFLICT',
        'Une ressource proposée est désormais occupée sur ce créneau.'
      )
    }

    const previousAssignment = {
      id: assignment.id,
      planningRowId: assignment.planningRowId,
      driverId: assignment.driverId,
      truckId: assignment.truckId,
      trailerId: assignment.trailerId,
      scheduledDate: assignment.scheduledDate.toISOString(),
      plannedEndAt: assignment.plannedEndAt?.toISOString() ?? null,
    }
    const updated = await tx.missionAssignment.update({
      where: { id: assignment.id },
      data: {
        planningRowId: plan.proposedAssignment.pairRowId,
        driverId: plan.proposedAssignment.driverId,
        truckId: plan.proposedAssignment.truckId,
        trailerId: plan.proposedAssignment.trailerId,
        trailerChangePlanned:
          plan.currentAssignment.trailerId !== plan.proposedAssignment.trailerId,
        trailerTransitions: plan.proposedAssignment.trailerTransitions,
        day,
        scheduledDate: proposed.startsAt,
        plannedEndAt: proposed.endsAt,
        approachDistanceMeters: plan.proposedAssignment.approachDistanceMeters,
        approachDurationSeconds: plan.proposedAssignment.approachDurationSeconds,
        approachCalculatedAt: new Date(),
        approachProvider: plan.proposedAssignment.approachProvider,
        approachPolyline: null,
      },
    })

    for (const cell of [
      { planningRowId: plan.currentAssignment.pairRowId, day: assignment.day },
      { planningRowId: plan.proposedAssignment.pairRowId, day },
    ]) {
      const rows = await tx.missionAssignment.findMany({
        where: cell,
        orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, sortOrder: true },
      })
      for (let index = 0; index < rows.length; index += 1) {
        if (rows[index].sortOrder !== index) {
          await tx.missionAssignment.update({
            where: { id: rows[index].id },
            data: { sortOrder: index },
          })
        }
      }
    }

    await tx.missionEvent.create({
      data: {
        missionId: plan.missionId,
        driverId: plan.proposedAssignment.driverId,
        truckId: plan.proposedAssignment.truckId,
        trailerId: plan.proposedAssignment.trailerId,
        type:
          plan.currentAssignment.driverId !== plan.proposedAssignment.driverId
            ? MissionEventType.DRIVER_CHANGED
            : MissionEventType.TRUCK_CHANGED,
        message: 'Suggestion Gerard Intelligence appliquée après confirmation.',
        fromStatus: assignment.mission.status,
        toStatus: assignment.mission.status,
        actorId: input.userId,
        metadata: {
          origin: 'GERARD_INTELLIGENCE',
          suggestionId: input.suggestionId,
          idempotencyKey: input.idempotencyKey,
          previousAssignment,
          proposedAssignment: plan.proposedAssignment,
        },
      },
    })

    const audit = await tx.dispatchOptimizationApplication.create({
      data: {
        idempotencyKey: input.idempotencyKey,
        simulationId: input.suggestionId,
        snapshotFingerprint: input.snapshotFingerprint,
        strategy: 'INTELLIGENCE_REASSIGNMENT',
        periodStart: weekStart,
        periodEnd: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000),
        missionIds: [plan.missionId],
        pairRowIds: [
          plan.currentAssignment.pairRowId,
          plan.proposedAssignment.pairRowId,
        ],
        warnings: [],
        actorId: input.userId,
        resultSummary: {},
      },
    })
    const result: SuggestionApplicationResult = {
      status: 'APPLIED',
      message: 'Suggestion appliquée.',
      missionId: plan.missionId,
      assignmentId: updated.id,
      applicationId: audit.id,
      snapshotFingerprint: input.snapshotFingerprint,
    }
    await tx.dispatchOptimizationApplication.update({
      where: { id: audit.id },
      data: { resultSummary: result },
    })
    return result
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}
