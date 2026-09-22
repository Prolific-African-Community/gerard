import type {
  OptimizationCandidate,
  OptimizationConfidence,
  OptimizationDataSource,
} from '../optimization'
import { reassignmentEfficiencyConfig } from './config'
import type {
  GerardSuggestion,
  GerardSuggestionConfidence,
  GerardSuggestionState,
} from './types'

export type DetectReassignmentEfficiencyInput = {
  currentCandidate: OptimizationCandidate
  alternatives: readonly OptimizationCandidate[]
  weekStart: string
  snapshotFingerprint: string
  scoringPolicy?: {
    minimumEmptyKmSaving: number
    minimumCostSaving: number
    minimumMarginGain: number
  }
}

type CandidateDelta = {
  candidate: OptimizationCandidate
  emptyKmSaving: number
  costSaving: number | null
  marginGain: number | null
  economicComparisonAvailable: boolean
}

type AssignmentScoringPolicy = {
  minimumEmptyKmSaving: number
  minimumCostSaving: number
  minimumMarginGain: number
}

const confidenceRank: Record<OptimizationConfidence, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
}

const unreliableRouteSources = new Set<OptimizationDataSource>([
  'ESTIMATED',
  'UNKNOWN',
])

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function unique<T>(values: readonly T[]) {
  return Array.from(new Set(values))
}

function candidateMissingData(candidate: OptimizationCandidate) {
  return unique([
    ...candidate.mission.missingData,
    ...candidate.compatibility.missingData,
    ...(candidate.temporalEvaluation?.missingData ?? []),
  ])
}

function hasKnownRoutes(candidate: OptimizationCandidate) {
  return (
    !candidate.compatibility.codes.includes('MISSING_ROUTE') &&
    candidate.transitions.every(
      (route) =>
        finite(route.distanceMeters) &&
        route.distanceMeters >= 0 &&
        finite(route.durationSeconds) &&
        route.durationSeconds >= 0 &&
        route.confidence !== 'LOW' &&
        !unreliableRouteSources.has(route.source)
    )
  )
}

function hasUsableBaseline(candidate: OptimizationCandidate) {
  return (
    candidate.compatibility.status === 'COMPATIBLE' &&
    candidate.temporalEvaluation?.status === 'FEASIBLE' &&
    candidate.confidence !== 'LOW' &&
    candidateMissingData(candidate).length === 0 &&
    hasKnownRoutes(candidate) &&
    finite(candidate.cost.emptyDistanceKm)
  )
}

function hasUsableAlternative(
  candidate: OptimizationCandidate,
  currentCandidate: OptimizationCandidate
) {
  return (
    candidate.mission.id === currentCandidate.mission.id &&
    candidate.id !== currentCandidate.id &&
    candidate.compatibility.status === 'COMPATIBLE' &&
    candidate.compatibility.codes.every(
      (code) => code === 'COMPATIBLE'
    ) &&
    candidate.temporalEvaluation?.status === 'FEASIBLE' &&
    candidate.confidence !== 'LOW' &&
    confidenceRank[candidate.confidence] >=
      confidenceRank[currentCandidate.confidence] &&
    candidateMissingData(candidate).length === 0 &&
    hasKnownRoutes(candidate) &&
    finite(candidate.cost.emptyDistanceKm)
  )
}

function economicComparison(
  currentCandidate: OptimizationCandidate,
  candidate: OptimizationCandidate
) {
  const sameCurrency = currentCandidate.cost.currency === candidate.cost.currency
  const available =
    sameCurrency &&
    finite(currentCandidate.cost.estimatedCost) &&
    finite(candidate.cost.estimatedCost) &&
    finite(currentCandidate.cost.estimatedMargin) &&
    finite(candidate.cost.estimatedMargin)
  return {
    available,
    costSaving: available
      ? (currentCandidate.cost.estimatedCost as number) -
        (candidate.cost.estimatedCost as number)
      : null,
    marginGain: available
      ? (candidate.cost.estimatedMargin as number) -
        (currentCandidate.cost.estimatedMargin as number)
      : null,
  }
}

function candidateDelta(
  currentCandidate: OptimizationCandidate,
  candidate: OptimizationCandidate,
  scoringPolicy: AssignmentScoringPolicy = reassignmentEfficiencyConfig,
): CandidateDelta | null {
  if (!hasUsableAlternative(candidate, currentCandidate)) return null
  const economics = economicComparison(currentCandidate, candidate)
  const emptyKmSaving =
    currentCandidate.cost.emptyDistanceKm - candidate.cost.emptyDistanceKm
  const significant =
    emptyKmSaving >= scoringPolicy.minimumEmptyKmSaving ||
    (economics.costSaving ?? -Infinity) >=
      scoringPolicy.minimumCostSaving ||
    (economics.marginGain ?? -Infinity) >=
      scoringPolicy.minimumMarginGain
  if (!significant) return null
  return {
    candidate,
    emptyKmSaving,
    costSaving: economics.costSaving,
    marginGain: economics.marginGain,
    economicComparisonAvailable: economics.available,
  }
}

function compareNullableDescending(left: number | null, right: number | null) {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return right - left
}

function rankDeltas(left: CandidateDelta, right: CandidateDelta) {
  return (
    compareNullableDescending(left.marginGain, right.marginGain) ||
    compareNullableDescending(left.costSaving, right.costSaving) ||
    right.emptyKmSaving - left.emptyKmSaving ||
    right.candidate.score - left.candidate.score ||
    left.candidate.id.localeCompare(right.candidate.id)
  )
}

function elapsedMinutes(candidate: OptimizationCandidate) {
  const start = candidate.temporalEvaluation?.possibleStartAt
  const end = candidate.temporalEvaluation?.completedAt
  if (!start || !end) return null
  const duration = new Date(end).getTime() - new Date(start).getTime()
  return Number.isFinite(duration) && duration >= 0
    ? duration / 60_000
    : null
}

function state(candidate: OptimizationCandidate): GerardSuggestionState {
  const approachRoutes = candidate.transitions.filter(
    (transition) => transition.reason !== 'MISSION_TRANSITION'
  )
  return {
    candidateId: candidate.id,
    missionId: candidate.mission.id,
    missionReference: candidate.mission.reference,
    pairRowId: candidate.pair.pair.rowId,
    driverId: candidate.pair.pair.driverId,
    driverName: candidate.pair.driverName,
    truckId: candidate.pair.pair.truckId,
    truckPlateNumber: candidate.pair.truckPlateNumber,
    trailerId: candidate.trailer?.id ?? null,
    trailerPlateNumber: candidate.trailer?.plateNumber ?? null,
    possibleStartAt: candidate.temporalEvaluation?.possibleStartAt ?? null,
    completedAt: candidate.temporalEvaluation?.completedAt ?? null,
    score: candidate.score,
    emptyKm: candidate.cost.emptyDistanceKm,
    estimatedCost: candidate.cost.estimatedCost,
    estimatedMargin: candidate.cost.estimatedMargin,
    currency: candidate.cost.currency,
    approachDistanceMeters: approachRoutes.reduce(
      (total, transition) => total + transition.distanceMeters,
      0
    ),
    approachDurationSeconds: approachRoutes.reduce(
      (total, transition) => total + transition.durationSeconds,
      0
    ),
    approachProvider:
      Array.from(new Set(approachRoutes.map((route) => route.source))).join('+') ||
      null,
    trailerTransitions: approachRoutes
      .filter((transition) => transition.reason === 'TRAILER_PICKUP')
      .map((transition) => ({
        reason: transition.reason,
        from: transition.from.id,
        to: transition.to.id,
      })),
  }
}

function scoreFactorEvidence(
  currentCandidate: OptimizationCandidate,
  candidate: OptimizationCandidate
) {
  const currentByCode = new Map(
    currentCandidate.factors.map((factor) => [factor.code, factor.value])
  )
  const proposedByCode = new Map(
    candidate.factors.map((factor) => [factor.code, factor.value])
  )
  return unique([
    ...Array.from(currentByCode.keys()),
    ...Array.from(proposedByCode.keys()),
  ])
    .sort()
    .map((code) => {
      const currentValue = currentByCode.get(code) ?? null
      const proposedValue = proposedByCode.get(code) ?? null
      return {
        code,
        currentValue,
        proposedValue,
        delta:
          currentValue !== null && proposedValue !== null
            ? proposedValue - currentValue
            : null,
      }
    })
}

function suggestionConfidence(
  currentCandidate: OptimizationCandidate,
  candidate: OptimizationCandidate,
  economicComparisonAvailable: boolean
): GerardSuggestionConfidence {
  return currentCandidate.confidence === 'HIGH' &&
    candidate.confidence === 'HIGH' &&
    economicComparisonAvailable
    ? 'HIGH'
    : 'MEDIUM'
}

function summary(
  currentCandidate: OptimizationCandidate,
  delta: CandidateDelta
) {
  const candidate = delta.candidate
  const parts: string[] = []
  if (delta.emptyKmSaving > 0) {
    parts.push(
      `réduire l’approche de ${currentCandidate.cost.emptyDistanceKm.toFixed(1)} km à ${candidate.cost.emptyDistanceKm.toFixed(1)} km`
    )
  }
  if (delta.marginGain !== null && delta.marginGain > 0) {
    parts.push(
      `améliorer la marge estimée de ${delta.marginGain.toFixed(2)} ${candidate.cost.currency}`
    )
  } else if (delta.costSaving !== null && delta.costSaving > 0) {
    parts.push(
      `réduire le coût estimé de ${delta.costSaving.toFixed(2)} ${candidate.cost.currency}`
    )
  }
  return `Réaffecter ${candidate.mission.reference} à ${candidate.pair.driverName} / ${candidate.pair.truckPlateNumber} permettrait de ${parts.join(' et ')}.`
}

export function detectReassignmentEfficiency(
  input: DetectReassignmentEfficiencyInput
): GerardSuggestion | null {
  if (!hasUsableBaseline(input.currentCandidate)) return null
  const best = input.alternatives
    .map((candidate) => candidateDelta(input.currentCandidate, candidate, input.scoringPolicy))
    .filter((delta): delta is CandidateDelta => delta !== null)
    .sort(rankDeltas)[0]
  if (!best) return null

  const candidate = best.candidate
  const currentTime = elapsedMinutes(input.currentCandidate)
  const proposedTime = elapsedMinutes(candidate)
  const currency = candidate.cost.currency
  const confidence = suggestionConfidence(
    input.currentCandidate,
    candidate,
    best.economicComparisonAvailable
  )
  const missingData = unique([
    ...candidateMissingData(input.currentCandidate),
    ...candidateMissingData(candidate),
  ])

  return {
    id: `reassignment:${input.snapshotFingerprint.slice(0, 16)}:${candidate.mission.id}:${candidate.id}`,
    version: reassignmentEfficiencyConfig.version,
    type: 'REASSIGNMENT_EFFICIENCY',
    severity: 'INFO',
    weekStart: input.weekStart,
    snapshotFingerprint: input.snapshotFingerprint,
    title: `Réaffectation plus efficace · ${candidate.mission.reference}`,
    summary: summary(input.currentCandidate, best),
    reason:
      'Cette alternative est compatible, temporellement faisable et dépasse le seuil minimal d’amélioration.',
    currentState: state(input.currentCandidate),
    proposedState: state(candidate),
    impact: {
      emptyKm: {
        current: input.currentCandidate.cost.emptyDistanceKm,
        proposed: candidate.cost.emptyDistanceKm,
        delta:
          candidate.cost.emptyDistanceKm -
          input.currentCandidate.cost.emptyDistanceKm,
      },
      estimatedCost: {
        current: best.economicComparisonAvailable
          ? input.currentCandidate.cost.estimatedCost
          : null,
        proposed: best.economicComparisonAvailable
          ? candidate.cost.estimatedCost
          : null,
        delta: best.costSaving === null ? null : -best.costSaving,
        currency,
      },
      estimatedMargin: {
        current: best.economicComparisonAvailable
          ? input.currentCandidate.cost.estimatedMargin
          : null,
        proposed: best.economicComparisonAvailable
          ? candidate.cost.estimatedMargin
          : null,
        delta: best.marginGain,
        currency,
      },
      timeMinutes: {
        current: currentTime,
        proposed: proposedTime,
        delta:
          currentTime !== null && proposedTime !== null
            ? proposedTime - currentTime
            : null,
      },
    },
    confidence,
    evidence: {
      candidateIds: [input.currentCandidate.id, candidate.id],
      routeKeys: unique(
        [...input.currentCandidate.transitions, ...candidate.transitions].map(
          (route) => route.key
        )
      ),
      routeSources: unique(
        [...input.currentCandidate.transitions, ...candidate.transitions].map(
          (route) => route.source
        )
      ),
      compatibilityCodes: unique([
        ...input.currentCandidate.compatibility.codes,
        ...candidate.compatibility.codes,
      ]),
      scoreFactors: scoreFactorEvidence(input.currentCandidate, candidate),
      assumptions: unique([
        ...input.currentCandidate.cost.assumptions,
        ...candidate.cost.assumptions,
      ]),
      missingData,
    },
    affectedMissionIds: [candidate.mission.id],
    affectedResources: {
      pairRowIds: unique([
        input.currentCandidate.pair.pair.rowId,
        candidate.pair.pair.rowId,
      ]),
      driverIds: unique([
        input.currentCandidate.pair.pair.driverId,
        candidate.pair.pair.driverId,
      ]),
      truckIds: unique([
        input.currentCandidate.pair.pair.truckId,
        candidate.pair.pair.truckId,
      ]),
      trailerIds: unique(
        [input.currentCandidate.trailer?.id, candidate.trailer?.id].filter(
          (id): id is string => Boolean(id)
        )
      ),
    },
    applicability: {
      canSimulate: true,
      canApply: true,
      blockingCodes: [],
      requiresExplicitConfirmation: true,
    },
    availableActions: ['VIEW_REASON', 'SIMULATE', 'APPLY'],
  }
}
