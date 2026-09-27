import type {
  OptimizationCandidate,
  OptimizationConfidence,
  OptimizationDataSource,
} from '../optimization'
import { fingerprintSnapshot } from '../auto-planning/snapshot'
import { reassignmentEfficiencyConfig } from './config'
import {
  compareScoredCandidates,
  reassignmentScoringReferences,
  scoreReassignment,
  type EconomicBasis,
  type ReassignmentScore,
} from './scoring'
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
  /** Gain composite minimal exigé. Centralisé dans scoring.ts. */
  minimumScoreImprovement?: number
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
  economicBasis: EconomicBasis
  score: ReassignmentScore
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

/**
 * Les paramètres de coût de l'optimisation sont aujourd'hui des constantes
 * (prix au kilomètre, coût horaire). Une comparaison économique disponible reste
 * donc une estimation, jamais une mesure, et le score l'amortit en conséquence.
 */
function economicBasisOf(available: boolean): EconomicBasis {
  return available ? 'ESTIMATED' : 'UNAVAILABLE'
}

/**
 * Matérialité V1 : un gain opérationnel ou économique minimal ET un gain
 * composite minimal. L'ancienne règle acceptait un candidat sur un seul seuil,
 * ce qui laissait passer des réaffectations dont l'intérêt réel tenait à une
 * estimation de coût.
 */
function isMaterial(input: {
  emptyKmSaving: number
  costSaving: number | null
  marginGain: number | null
  economicComparisonAvailable: boolean
  scoreTotal: number
  scoringPolicy: AssignmentScoringPolicy
  minimumScoreImprovement: number
}) {
  const reachesThreshold =
    input.emptyKmSaving >= input.scoringPolicy.minimumEmptyKmSaving ||
    (input.economicComparisonAvailable &&
      ((input.costSaving ?? -Infinity) >= input.scoringPolicy.minimumCostSaving ||
        (input.marginGain ?? -Infinity) >= input.scoringPolicy.minimumMarginGain))
  return reachesThreshold && input.scoreTotal >= input.minimumScoreImprovement
}

function candidateDelta(
  currentCandidate: OptimizationCandidate,
  candidate: OptimizationCandidate,
  scoringPolicy: AssignmentScoringPolicy = reassignmentEfficiencyConfig,
  minimumScoreImprovement: number = reassignmentScoringReferences.minimumScoreImprovement,
): CandidateDelta | null {
  // Contrainte dure d'abord : un candidat rejeté ici ne reçoit jamais de score.
  if (!hasUsableAlternative(candidate, currentCandidate)) return null
  const economics = economicComparison(currentCandidate, candidate)
  const economicBasis = economicBasisOf(economics.available)
  const emptyKmSaving =
    currentCandidate.cost.emptyDistanceKm - candidate.cost.emptyDistanceKm
  const score = scoreReassignment({
    currentCandidate,
    candidate,
    emptyKmSaving,
    marginGain: economics.marginGain,
    economicBasis,
  })
  if (!isMaterial({
    emptyKmSaving,
    costSaving: economics.costSaving,
    marginGain: economics.marginGain,
    economicComparisonAvailable: economics.available,
    scoreTotal: score.total,
    scoringPolicy,
    minimumScoreImprovement,
  })) return null
  return {
    candidate,
    emptyKmSaving,
    costSaving: economics.costSaving,
    marginGain: economics.marginGain,
    economicComparisonAvailable: economics.available,
    economicBasis,
    score,
  }
}

/**
 * Empreinte des faits sur lesquels le répartiteur se prononce.
 *
 * L'empreinte de snapshot ne couvre volontairement pas les routes : deux
 * analyses peuvent partager la même identité de planning alors que les
 * distances ont changé, donc l'ampleur du gain aussi. L'identité d'une
 * suggestion (`id`) est elle-même purement structurelle
 * (`missionId:pairRowId:trailerId`). Sans cette seconde empreinte, une action
 * confirmée sur « 137 km gagnés » pourrait s'appliquer sur « 25 km gagnés ».
 *
 * Elle couvre donc exactement ce qui est montré et ce qui a servi à classer :
 * kilomètres à vide, économie, marge, score, et les routes qui les produisent.
 */
function evidenceFingerprint(input: {
  currentCandidate: OptimizationCandidate
  candidate: OptimizationCandidate
  score: ReassignmentScore
}) {
  const routes = (candidate: OptimizationCandidate) =>
    candidate.transitions
      .map((route) => ({
        key: route.key,
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        source: route.source,
      }))
      .sort((left, right) => left.key.localeCompare(right.key))
  const money = (value: number | null) => (finite(value) ? Math.round(value * 100) / 100 : null)
  const distance = (value: number) => Math.round(value * 1000) / 1000
  return fingerprintSnapshot({
    current: {
      candidateId: input.currentCandidate.id,
      emptyKm: distance(input.currentCandidate.cost.emptyDistanceKm),
      estimatedCost: money(input.currentCandidate.cost.estimatedCost),
      estimatedMargin: money(input.currentCandidate.cost.estimatedMargin),
      routes: routes(input.currentCandidate),
    },
    proposed: {
      candidateId: input.candidate.id,
      emptyKm: distance(input.candidate.cost.emptyDistanceKm),
      estimatedCost: money(input.candidate.cost.estimatedCost),
      estimatedMargin: money(input.candidate.cost.estimatedMargin),
      routes: routes(input.candidate),
    },
    score: {
      total: input.score.total,
      economicBasis: input.score.economicBasis,
      components: input.score.components.map((component) => ({ code: component.code, value: component.value })),
    },
  })
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

/**
 * La confiance décrit la FIABILITÉ DES DONNÉES, pas une probabilité que Gerard
 * ait raison. HAUTE exige des routes sûres des deux côtés, aucune donnée
 * manquante et une comparaison économique disponible. Tant que l'économie
 * repose sur des paramètres par défaut, la nuance est portée par
 * `scoreBreakdown.economicBasis`, que l'explication énonce explicitement.
 */
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
  const ranked = input.alternatives
    .map((candidate) => candidateDelta(input.currentCandidate, candidate, input.scoringPolicy, input.minimumScoreImprovement))
    .filter((delta): delta is CandidateDelta => delta !== null)
    .sort(compareScoredCandidates)
  const best = ranked[0]
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
    evidenceFingerprint: evidenceFingerprint({ currentCandidate: input.currentCandidate, candidate, score: best.score }),
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
    scoreBreakdown: best.score,
    /**
     * Classement interne des alternatives retenues. Le contrat produit reste
     * une suggestion par mission ; cette métadonnée sert l'explication et les
     * évolutions ultérieures, sans imposer d'écran supplémentaire.
     */
    rankedAlternatives: ranked.slice(0, 3).map((item, index) => ({
      rank: index + 1,
      candidateId: item.candidate.id,
      pairRowId: item.candidate.pair.pair.rowId,
      driverName: item.candidate.pair.driverName,
      truckPlateNumber: item.candidate.pair.truckPlateNumber,
      score: item.score.total,
      emptyKmSaving: item.emptyKmSaving,
      marginGain: item.marginGain,
    })),
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
