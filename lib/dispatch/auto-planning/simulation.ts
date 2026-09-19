import {
  buildOptimizationCandidates,
  compareDispatchStrategies,
  optimizeDispatch,
  rankOptimizationCandidates,
  toProposedMission,
} from '../optimization'
import type { OptimizationStrategy } from '../optimization'
import { createSnapshotToken } from './token'
import { buildAutoPlanningSnapshot } from './snapshot'
import type { SimulationResponse } from './types'

type ReconciledOutcome =
  SimulationResponse['reconciliation']['outcomes'][number]

export function reconcileOptimizationOutcomes(input: {
  result: ReturnType<typeof optimizeDispatch>
  includedMissionIds: string[]
}) {
  const rawOutcomes: ReconciledOutcome[] = [
    ...input.result.confirmedProposals.flatMap((proposal) =>
      proposal.missions.map((mission) => ({
        missionId: mission.missionId,
        reference: mission.reference,
        category: 'CONFIRMED' as const,
        code: 'COMPATIBLE',
        reason: mission.explanation.summary,
      }))
    ),
    ...input.result.conditionalProposals.flatMap((proposal) =>
      proposal.missions.map((mission) => ({
        missionId: mission.missionId,
        reference: mission.reference,
        category: 'CONDITIONAL' as const,
        code: 'COMPATIBLE_WITH_CONDITION',
        reason: mission.explanation.summary,
      }))
    ),
    ...input.result.impossibleMissions.map((mission) => ({
      missionId: mission.missionId,
      reference: mission.reference,
      category: 'IMPOSSIBLE' as const,
      code: mission.category,
      reason: mission.message,
    })),
    ...input.result.deferredMissions.map((mission) => ({
      missionId: mission.missionId,
      reference: mission.reference,
      category: 'DEFERRED' as const,
      code: mission.category,
      reason: mission.message,
    })),
    ...input.result.unassignedMissions.map((mission) => ({
      missionId: mission.missionId,
      reference: mission.reference,
      category: 'UNASSIGNED' as const,
      code: mission.category,
      reason: mission.message,
    })),
  ]
  const includedIds = new Set(input.includedMissionIds)
  const countsByMissionId = new Map<string, number>()
  for (const outcome of rawOutcomes) {
    if (!includedIds.has(outcome.missionId)) {
      throw new Error(`UNEXPECTED_MISSION_OUTCOME:${outcome.missionId}`)
    }
    countsByMissionId.set(
      outcome.missionId,
      (countsByMissionId.get(outcome.missionId) ?? 0) + 1
    )
  }
  for (const missionId of input.includedMissionIds) {
    const count = countsByMissionId.get(missionId) ?? 0
    if (count !== 1) {
      throw new Error(`MISSION_OUTCOME_CARDINALITY:${missionId}:${count}`)
    }
  }
  return rawOutcomes
}

export async function simulateAutoPlanning(input: {
  userId: string
  weekStartDate: Date
  strategy?: OptimizationStrategy
  compareStrategies?: boolean
  includeExistingForced?: boolean
  now?: Date
}): Promise<SimulationResponse> {
  const strategy = input.strategy ?? 'BALANCED'
  const snapshot = await buildAutoPlanningSnapshot({
    weekStartDate: input.weekStartDate,
    includeExistingForced: input.includeExistingForced ?? false,
    now: input.now,
  })
  const result = optimizeDispatch({
    ...snapshot.input,
    strategy,
  })
  const { strategy: _strategy, ...sharedInput } = snapshot.input
  const comparison = input.compareStrategies
    ? compareDispatchStrategies(sharedInput)
    : null
  const adjustmentOptions = Object.fromEntries(
    snapshot.input.missions.map((mission) => {
      const allCandidates = buildOptimizationCandidates(snapshot.input, mission)
      const options = rankOptimizationCandidates(allCandidates)
        .filter(
          (candidate) =>
            candidate.compatibility.status !== 'INCOMPATIBLE' &&
            candidate.temporalEvaluation?.status !== 'IMPOSSIBLE'
        )
        .slice(0, 12)
        .map((candidate) => ({
          id: `${candidate.pair.pair.rowId}:${candidate.trailer?.id ?? 'none'}`,
          missionId: mission.id,
          pairRowId: candidate.pair.pair.rowId,
          driverId: candidate.pair.pair.driverId,
          truckId: candidate.pair.pair.truckId,
          trailerId: candidate.trailer?.id ?? null,
          driverName: candidate.pair.driverName,
          truckPlateNumber: candidate.pair.truckPlateNumber,
          trailerPlateNumber: candidate.trailer?.plateNumber ?? null,
          classification:
            candidate.compatibility.status === 'COMPATIBLE' &&
            candidate.temporalEvaluation?.status === 'FEASIBLE'
              ? ('GREEN' as const)
              : ('ORANGE' as const),
          score: candidate.score,
          possibleStartAt:
            candidate.temporalEvaluation?.possibleStartAt ?? null,
          explanation: {
            summary: toProposedMission(candidate, allCandidates).explanation
              .summary,
            missingData: Array.from(
              new Set([
                ...candidate.compatibility.missingData,
                ...(candidate.temporalEvaluation?.missingData ?? []),
              ])
            ),
          },
        }))
      return [mission.id, options]
    })
  )
  const token = createSnapshotToken({
    simulationId: snapshot.id,
    fingerprint: snapshot.fingerprint,
    userId: input.userId,
    weekStart: input.weekStartDate.toISOString(),
    includeExistingForced: input.includeExistingForced ?? false,
    createdAt: snapshot.createdAt,
    expiresAt: snapshot.expiresAt,
  })
  const includedOutcomes = reconcileOptimizationOutcomes({
    result,
    includedMissionIds: snapshot.input.missions.map((mission) => mission.id),
  })
  const excludedOutcomes = snapshot.missionScope.exclusions.map((mission) => ({
    missionId: mission.missionId,
    reference: mission.reference,
    category: 'EXCLUDED' as const,
    code: mission.code,
    reason: mission.reason,
  }))
  const confirmedCount = includedOutcomes.filter(
    (outcome) => outcome.category === 'CONFIRMED'
  ).length
  const conditionalCount = includedOutcomes.filter(
    (outcome) => outcome.category === 'CONDITIONAL'
  ).length
  return {
    simulationId: snapshot.id,
    snapshotFingerprint: snapshot.fingerprint,
    snapshotToken: token,
    createdAt: snapshot.createdAt,
    expiresAt: snapshot.expiresAt,
    heuristicNotice:
      'Meilleure proposition trouvée dans les limites de calcul.',
    selectedStrategy: strategy,
    result,
    comparison,
    pairLabels: Object.fromEntries(
      snapshot.input.pairs.map((pair) => [
        pair.pair.rowId,
        {
          driverName: pair.driverName,
          truckPlateNumber: pair.truckPlateNumber,
          locked: pair.pair.pairLocked,
        },
      ])
    ),
    adjustmentOptions,
    snapshotSummary: {
      sourceCounts: snapshot.sourceCounts,
      missingData: snapshot.missingData,
      missionScope: snapshot.missionScope,
    },
    reconciliation: {
      visible: snapshot.missionScope.counts.visible,
      included: snapshot.missionScope.counts.included,
      excluded: snapshot.missionScope.exclusions.length,
      confirmed: confirmedCount,
      conditional: conditionalCount,
      red:
        result.impossibleMissions.length +
        result.deferredMissions.length +
        result.unassignedMissions.length,
      manualPreserved: snapshot.missionScope.counts.manualPreserved,
      impossible: result.impossibleMissions.length,
      deferred: result.deferredMissions.length,
      unassigned: result.unassignedMissions.length,
      candidates: result.metrics.candidatesGenerated,
      confirmedProposals: result.confirmedProposals.length,
      conditionalProposals: result.conditionalProposals.length,
      poolEquationValid:
        snapshot.missionScope.counts.visible ===
        snapshot.missionScope.counts.included +
          snapshot.missionScope.exclusions.length,
      resultEquationValid:
        snapshot.missionScope.counts.included === includedOutcomes.length,
      outcomes: [...includedOutcomes, ...excludedOutcomes],
    },
    defaults: { strategy: 'BALANCED' },
  }
}
