import {
  MissionEventType,
  MissionStatus,
  PlanningDay,
  Prisma,
} from '@prisma/client'

import {
  buildOptimizationCandidates,
  optimizeDispatch,
  toProposedMission,
} from '../optimization'
import type { DispatchOptimizationResult } from '../optimization'
import { prisma } from '../../prisma'
import { buildAutoPlanningSnapshot } from './snapshot'
import { verifySnapshotToken } from './token'
import type { ApplyRequest, ApplyResult, AutoPlanningSnapshot } from './types'
import {
  AutoPlanningSelectionError,
  validateAutoPlanningSelection,
} from './selection'
import type { SelectedAutoPlanningItem } from './selection'
import { findResourceOccupationConflicts } from '../resource-availability'

const planningDayByShortName: Record<string, PlanningDay> = {
  Mon: PlanningDay.MONDAY,
  Tue: PlanningDay.TUESDAY,
  Wed: PlanningDay.WEDNESDAY,
  Thu: PlanningDay.THURSDAY,
  Fri: PlanningDay.FRIDAY,
  Sat: PlanningDay.SATURDAY,
  Sun: PlanningDay.SUNDAY,
}

function planningDayAt(value: string, timeZone: string) {
  const name = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone,
  }).format(new Date(value))
  return planningDayByShortName[name]
}

function parseStoredResult(value: Prisma.JsonValue): ApplyResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, Prisma.JsonValue>
  if (
    typeof record.applicationId !== 'string' ||
    !Array.isArray(record.appliedMissionIds) ||
    !Array.isArray(record.pairRowIds)
  ) {
    return null
  }
  return {
    idempotentReplay: true,
    applicationId: record.applicationId,
    appliedMissionIds: record.appliedMissionIds.filter(
      (item): item is string => typeof item === 'string'
    ),
    pairRowIds: record.pairRowIds.filter(
      (item): item is string => typeof item === 'string'
    ),
    ignoredMissionIds: Array.isArray(record.ignoredMissionIds)
      ? record.ignoredMissionIds.filter(
          (item): item is string => typeof item === 'string'
        )
      : [],
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter(
          (item): item is string => typeof item === 'string'
        )
      : [],
  }
}

export class AutoPlanningConflictError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

export async function applyAutoPlanning(input: {
  userId: string
  request: ApplyRequest
}): Promise<ApplyResult> {
  const existing = await prisma.dispatchOptimizationApplication.findUnique({
    where: { idempotencyKey: input.request.idempotencyKey },
  })
  if (existing) {
    if (existing.actorId !== input.userId) {
      throw new AutoPlanningConflictError(
        'IDEMPOTENCY_OWNER_MISMATCH',
        'Cette clé d’idempotence appartient à un autre utilisateur.'
      )
    }
    const stored = parseStoredResult(existing.resultSummary)
    if (stored) return stored
  }

  const token = verifySnapshotToken(input.request.snapshotToken, input.userId)
  if (!token) {
    throw new AutoPlanningConflictError(
      'SIMULATION_EXPIRED',
      'La simulation est expirée ou invalide.'
    )
  }
  if (
    token.simulationId !== input.request.simulationId ||
    token.fingerprint !== input.request.snapshotFingerprint
  ) {
    throw new AutoPlanningConflictError(
      'SNAPSHOT_MISMATCH',
      'L’instantané transmis ne correspond pas à la simulation.'
    )
  }
  const weekStartDate = new Date(token.weekStart)
  const snapshot = await buildAutoPlanningSnapshot({
    weekStartDate,
    includeExistingForced: token.includeExistingForced,
  })
  if (snapshot.fingerprint !== token.fingerprint) {
    throw new AutoPlanningConflictError(
      'SNAPSHOT_STALE',
      'Les données Dispatch ont changé. Une nouvelle simulation est requise.'
    )
  }

  const result = optimizeDispatch({
    ...snapshot.input,
    strategy: input.request.strategy,
  })
  return persistValidatedAutoPlanning({
    userId: input.userId,
    request: input.request,
    snapshot,
    result,
  })
}

export async function persistValidatedAutoPlanning(input: {
  userId: string
  request: ApplyRequest
  snapshot: AutoPlanningSnapshot
  result: DispatchOptimizationResult
}): Promise<ApplyResult> {
  const selected = input.request.selectedMissionIds
  const adjustedMissionIds = input.request.adjustments.map(
    (adjustment) => adjustment.missionId
  )
  if (
    new Set(adjustedMissionIds).size !== adjustedMissionIds.length ||
    adjustedMissionIds.some((missionId) => !selected.includes(missionId))
  ) {
    throw new AutoPlanningConflictError(
      'INVALID_ADJUSTMENT',
      'Les ajustements transmis sont invalides.'
    )
  }
  let selectedItems: SelectedAutoPlanningItem[]
  try {
    selectedItems = validateAutoPlanningSelection(
      input.result,
      selected,
      input.request.confirmedConditionalMissionIds,
      adjustedMissionIds
    )
  } catch (error) {
    if (error instanceof AutoPlanningSelectionError) {
      throw new AutoPlanningConflictError(error.code, error.message)
    }
    throw error
  }
  const confirmedConditionalSet = new Set(
    input.request.confirmedConditionalMissionIds
  )
  selectedItems = selectedItems.map((item) => {
    const adjustment = input.request.adjustments.find(
      (candidate) => candidate.missionId === item.mission.missionId
    )
    if (!adjustment) return item
    const snapshotMission = input.snapshot.input.missions.find(
      (mission) => mission.id === adjustment.missionId
    )
    if (!snapshotMission) {
      throw new AutoPlanningConflictError(
        'ADJUSTMENT_OUTSIDE_SNAPSHOT',
        'La mission ajustée n’appartient pas au snapshot signé.'
      )
    }
    const alternatives = buildOptimizationCandidates(
      input.snapshot.input,
      snapshotMission
    )
    const candidate = alternatives.find(
      (alternative) =>
        alternative.pair.pair.rowId === adjustment.pairRowId &&
        (alternative.trailer?.id ?? null) === adjustment.trailerId
    )
    if (!candidate) {
      throw new AutoPlanningConflictError(
        'ADJUSTMENT_OUTSIDE_SNAPSHOT',
        'Une ressource ajustée n’appartient pas au snapshot signé.'
      )
    }
    if (
      candidate.compatibility.status === 'INCOMPATIBLE' ||
      candidate.temporalEvaluation?.status === 'IMPOSSIBLE'
    ) {
      throw new AutoPlanningConflictError(
        'ADJUSTMENT_INCOMPATIBLE',
        'La proposition ajustée est certainement incompatible.'
      )
    }
    const conditional =
      candidate.compatibility.status !== 'COMPATIBLE' ||
      candidate.temporalEvaluation?.status !== 'FEASIBLE'
    if (conditional && !confirmedConditionalSet.has(adjustment.missionId)) {
      throw new AutoPlanningConflictError(
        'CONDITIONAL_ADJUSTMENT_REQUIRES_CONFIRMATION',
        'La proposition ajustée orange doit être confirmée explicitement.'
      )
    }
    const mission = toProposedMission(candidate, alternatives)
    return {
      mission,
      proposal: {
        ...item.proposal,
        pair: candidate.pair.pair,
        locked: candidate.pair.pair.pairLocked,
        missions: [mission],
      },
    }
  })
  const pairRowIds = Array.from(
    new Set(selectedItems.map((item) => item.proposal.pair.rowId))
  )
  const trailerIds = Array.from(
    new Set(
      selectedItems
        .map((item) => item.mission.trailerId)
        .filter((id): id is string => Boolean(id))
    )
  )
  const warnings: string[] = input.request.adjustments.map(
    (adjustment) => `MANUAL_ADJUSTMENT:${adjustment.missionId}`
  )

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`auto-planning:${input.snapshot.input.period.startsAt}`}))`
    const replay = await tx.dispatchOptimizationApplication.findUnique({
      where: { idempotencyKey: input.request.idempotencyKey },
    })
    if (replay) {
      if (replay.actorId !== input.userId) {
        throw new AutoPlanningConflictError(
          'IDEMPOTENCY_OWNER_MISMATCH',
          'Cette clé d’idempotence appartient à un autre utilisateur.'
        )
      }
      const stored = parseStoredResult(replay.resultSummary)
      if (stored) return stored
    }

    const [rows, missions, assignments, trailers] =
      await Promise.all([
        tx.planningRow.findMany({
          where: { id: { in: pairRowIds } },
        }),
        tx.mission.findMany({ where: { id: { in: selected } } }),
        tx.missionAssignment.findMany({
          where: { missionId: { in: selected } },
        }),
        tx.trailer.findMany({ where: { id: { in: trailerIds } } }),
      ])
    if (
      rows.length !== pairRowIds.length ||
      missions.length !== selected.length
    ) {
      throw new AutoPlanningConflictError(
        'RESOURCE_CHANGED',
        'Une mission ou un couple n’existe plus.'
      )
    }
    if (assignments.length) {
      throw new AutoPlanningConflictError(
        'MISSION_ALREADY_ASSIGNED',
        'Une mission sélectionnée a été affectée depuis la simulation.'
      )
    }
    if (trailers.length !== trailerIds.length) {
      throw new AutoPlanningConflictError(
        'TRAILER_CHANGED',
        'Une remorque proposée n’existe plus.'
      )
    }
    for (const trailer of trailers) {
      const snapshotTrailer = input.snapshot.input.trailers.find(
        (item) => item.id === trailer.id
      )
      if (
        !snapshotTrailer ||
        snapshotTrailer.status !== trailer.status ||
        snapshotTrailer.attachedTruckId !== trailer.truckId ||
        snapshotTrailer.type !== trailer.type ||
        snapshotTrailer.capacity !== trailer.capacityKg ||
        snapshotTrailer.couplingType !== trailer.couplingType ||
        JSON.stringify(snapshotTrailer.compatibleCargoTypes ?? null) !==
          JSON.stringify(trailer.compatibleCargoTypes ?? null)
      ) {
        throw new AutoPlanningConflictError(
          'TRAILER_CHANGED',
          'Une remorque a changé depuis la simulation.'
        )
      }
    }
    for (const row of rows) {
      const proposal = selectedItems.find(
        (item) => item.proposal.pair.rowId === row.id
      )?.proposal
      if (
        !proposal ||
        row.driverId !== proposal.pair.driverId ||
        row.truckId !== proposal.pair.truckId ||
        row.pairLocked !== proposal.pair.pairLocked
      ) {
        throw new AutoPlanningConflictError(
          'PAIR_CHANGED',
          'Un couple chauffeur–tracteur a changé.'
        )
      }
    }

    const proposedIntervals = selectedItems.map((item) => {
      const startsAt = item.mission.temporalEvaluation?.possibleStartAt
      const endsAt = item.mission.temporalEvaluation?.completedAt
      if (!startsAt || !endsAt) {
        throw new AutoPlanningConflictError(
          'MISSING_CONFIRMED_START',
          'La fenêtre d’utilisation d’une remorque est incomplète.'
        )
      }
      return {
        missionId: item.mission.missionId,
        driverId: item.proposal.pair.driverId,
        truckId: item.proposal.pair.truckId,
        trailerId: item.mission.trailerId,
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
      }
    })
    const proposedConflicts = proposedIntervals.flatMap((proposed, index) =>
      findResourceOccupationConflicts({
        proposed: [proposed],
        occupied: proposedIntervals.slice(index + 1),
      })
    )
    if (proposedConflicts.length) {
      throw new AutoPlanningConflictError(
        'RESOURCE_TIME_CONFLICT',
        'Un chauffeur, camion ou remorque est proposé sur deux missions simultanées.'
      )
    }
    const existingResourceAssignments = await tx.missionAssignment.findMany({
      where: {
        missionId: { notIn: selected },
        scheduledDate: {
          lt: new Date(input.snapshot.input.period.endsAt),
        },
         OR: [
           { driverId: { in: proposedIntervals.map((item) => item.driverId) } },
           { truckId: { in: proposedIntervals.map((item) => item.truckId) } },
           ...(trailerIds.length
             ? [{ trailerId: { in: trailerIds } }]
             : []),
         ],
      },
      include: { mission: { select: { deliveryDate: true } } },
    })
    const existingConflicts = findResourceOccupationConflicts({
      proposed: proposedIntervals,
      occupied: existingResourceAssignments.map((existing) => ({
        missionId: existing.missionId,
        driverId: existing.driverId,
        truckId: existing.truckId,
        trailerId: existing.trailerId,
        startsAt: existing.scheduledDate,
        endsAt: existing.plannedEndAt ?? existing.mission.deliveryDate,
      })),
    })
    const firstExistingConflict = existingConflicts[0]
    if (firstExistingConflict) {
      if (firstExistingConflict.availabilityUnknown) {
        throw new AutoPlanningConflictError(
          'RESOURCE_AVAILABILITY_UNKNOWN',
          'Une affectation existante ne possède pas de fin vérifiable.'
        )
      }
      const trailerOnly = firstExistingConflict.kinds.every(
        (kind) => kind === 'TRAILER'
      )
      throw new AutoPlanningConflictError(
        trailerOnly ? 'TRAILER_TIME_CONFLICT' : 'RESOURCE_TIME_CONFLICT',
        trailerOnly
          ? 'Une remorque est déjà planifiée sur ce créneau.'
          : 'Un chauffeur ou un camion est déjà planifié sur ce créneau.'
      )
    }

    for (const item of selectedItems) {
      const possibleStart = item.mission.temporalEvaluation?.possibleStartAt
      const completedAt = item.mission.temporalEvaluation?.completedAt
      if (!possibleStart || !completedAt) {
        throw new AutoPlanningConflictError(
          'MISSING_CONFIRMED_START',
          'L’horaire confirmé de la mission est absent.'
        )
      }
      const day = planningDayAt(possibleStart, input.snapshot.input.timeZone)
      if (!day) {
        throw new AutoPlanningConflictError(
          'INVALID_SCHEDULE_DAY',
          'Le jour calculé est invalide.'
        )
      }
      const sortOrder = item.proposal.missions.findIndex(
        (mission) => mission.missionId === item.mission.missionId
      )
      await tx.missionAssignment.create({
        data: {
          missionId: item.mission.missionId,
          planningRowId: item.proposal.pair.rowId,
          driverId: item.proposal.pair.driverId,
          truckId: item.proposal.pair.truckId,
          trailerId: item.mission.trailerId,
          trailerChangePlanned: item.mission.trailerChange,
          trailerTransitions: item.mission.transitions.map((transition) => ({
            reason: transition.reason,
            from: transition.from.id,
            to: transition.to.id,
          })),
          day,
          scheduledDate: new Date(possibleStart),
          plannedEndAt: new Date(completedAt),
          sortOrder,
        },
      })
      await tx.mission.update({
        where: { id: item.mission.missionId },
        data: { status: MissionStatus.ASSIGNED },
      })
      await tx.missionEvent.create({
        data: {
          missionId: item.mission.missionId,
          driverId: item.proposal.pair.driverId,
          truckId: item.proposal.pair.truckId,
          trailerId: item.mission.trailerId,
          type: MissionEventType.ASSIGNED,
          message:
            'Mission appliquée depuis une simulation automatique confirmée.',
          fromStatus: MissionStatus.PENDING,
          toStatus: MissionStatus.ASSIGNED,
          actorId: input.userId,
          metadata: {
            simulationId: input.request.simulationId,
            strategy: input.request.strategy,
            idempotencyKey: input.request.idempotencyKey,
            manuallyAdjusted: input.request.adjustments.some(
              (adjustment) => adjustment.missionId === item.mission.missionId
            ),
            trailerId: item.mission.trailerId,
            trailerTransitions: item.mission.transitions.map((transition) => ({
              reason: transition.reason,
              from: transition.from.id,
              to: transition.to.id,
            })),
          },
        },
      })
    }

    const audit = await tx.dispatchOptimizationApplication.create({
      data: {
        idempotencyKey: input.request.idempotencyKey,
        simulationId: input.request.simulationId,
        snapshotFingerprint: input.request.snapshotFingerprint,
        strategy: input.request.strategy,
        periodStart: new Date(input.snapshot.input.period.startsAt),
        periodEnd: new Date(input.snapshot.input.period.endsAt),
        missionIds: selected,
        pairRowIds,
        warnings,
        actorId: input.userId,
        resultSummary: {},
      },
    })
    const response: ApplyResult = {
      idempotentReplay: false,
      applicationId: audit.id,
      appliedMissionIds: selected,
      pairRowIds,
      ignoredMissionIds: [],
      warnings,
    }
    await tx.dispatchOptimizationApplication.update({
      where: { id: audit.id },
      data: { resultSummary: response },
    })
    return response
  })
}
