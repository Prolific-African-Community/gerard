import { resourceStateBefore } from '../resource-availability'
import { evaluateTemporalMissionSequence } from '../regulatory'
import { buildOptimizationCandidate, trailerChoices } from './candidate'
import { optimizationStrategies } from './config'
import { explainOptimizationDecision } from './explain'
import type {
  DispatchOptimizationInput,
  DispatchOptimizationResult,
  OptimizationCandidate,
  OptimizationMetrics,
  OptimizationMission,
  OptimizationPair,
  PairProposal,
  ProposedMission,
  StrategyComparison,
  UnassignedMission,
} from './types'

type PairRuntime = {
  pair: OptimizationPair
  state: OptimizationPair['regulatoryState']
  availableAt: string
  positionId: string | null
  position: OptimizationPair['initialPosition']
  missions: ProposedMission[]
  conditionalMissions: ProposedMission[]
  score: number
}

function validateInput(input: DispatchOptimizationInput) {
  const startsAt = new Date(input.period.startsAt)
  const endsAt = new Date(input.period.endsAt)
  if (
    Number.isNaN(startsAt.getTime()) ||
    Number.isNaN(endsAt.getTime()) ||
    startsAt >= endsAt
  ) {
    throw new Error('Période d’optimisation invalide.')
  }
  const pairIds = new Set<string>()
  for (const pair of input.pairs) {
    if (pairIds.has(pair.pair.rowId)) {
      throw new Error(`Couple dupliqué: ${pair.pair.rowId}`)
    }
    pairIds.add(pair.pair.rowId)
    if (!pair.pair.driverId || !pair.pair.truckId) {
      throw new Error(
        'Chaque couple doit contenir un chauffeur et un tracteur.'
      )
    }
  }
  const missionIds = new Set<string>()
  for (const mission of input.missions) {
    if (missionIds.has(mission.id)) {
      throw new Error(`Mission dupliquée: ${mission.id}`)
    }
    missionIds.add(mission.id)
  }
}

function missionDrivingSeconds(mission: OptimizationMission) {
  return mission.temporalPlan.steps
    .filter((step) => step.activityType === 'DRIVING')
    .reduce((sum, step) => sum + step.durationSeconds, 0)
}

function runtimeWorkloadHours(runtime: PairRuntime | undefined) {
  if (!runtime) return 0
  return [...runtime.missions, ...runtime.conditionalMissions].reduce((sum, mission) => {
    const evaluation = mission.temporalEvaluation
    if (!evaluation) return sum
    if (evaluation.possibleStartAt && evaluation.completedAt) {
      return (
        sum +
        Math.max(
          0,
          new Date(evaluation.completedAt).getTime() -
            new Date(evaluation.possibleStartAt).getTime()
        ) /
          3_600_000
      )
    }
    if (mission.plannedWindow) {
      return (
        sum +
        Math.max(
          0,
          new Date(mission.plannedWindow.endsAt).getTime() -
            new Date(mission.plannedWindow.startsAt).getTime()
        ) /
          3_600_000
      )
    }
    return (
      sum +
      (evaluation.consumedDrivingSeconds +
        evaluation.consumedOtherWorkSeconds) /
        3600
    )
  }, 0)
}

function orderMissions(input: DispatchOptimizationInput) {
  return [...input.missions].sort((left, right) => {
    if (input.strategy === 'MAX_PROFITABILITY') {
      const economic = (right.revenueAmount ?? -1) - (left.revenueAmount ?? -1)
      if (economic) return economic
    }
    if (input.strategy === 'MAX_COVERAGE') {
      const nonReportable =
        Number(Boolean(right.nonReportable)) -
        Number(Boolean(left.nonReportable))
      if (nonReportable) return nonReportable
      const duration =
        missionDrivingSeconds(left) - missionDrivingSeconds(right)
      if (duration) return duration
    }
    const priority = right.priority - left.priority
    if (priority) return priority
    const leftStart = left.temporalPlan.earliestStartAt ?? ''
    const rightStart = right.temporalPlan.earliestStartAt ?? ''
    return (
      leftStart.localeCompare(rightStart) || left.id.localeCompare(right.id)
    )
  })
}

function compareCandidates(
  left: OptimizationCandidate,
  right: OptimizationCandidate
) {
  return (
    right.score - left.score ||
    left.pair.pair.rowId.localeCompare(right.pair.pair.rowId) ||
    (left.trailer?.id ?? '').localeCompare(right.trailer?.id ?? '') ||
    left.id.localeCompare(right.id)
  )
}

function candidateClassificationRank(candidate: OptimizationCandidate) {
  // Un candidat incompatible le reste, quelle que soit l'évaluation temporelle.
  // Sans ce garde-fou, un chevauchement avéré avec une affectation déjà posée
  // était classé « à confirmer » parce que l'état réglementaire, lui, était
  // seulement indéterminé.
  if (candidate.compatibility.status === 'INCOMPATIBLE') return 2
  if (
    candidate.compatibility.status === 'COMPATIBLE' &&
    candidate.temporalEvaluation?.status === 'FEASIBLE'
  ) {
    return 0
  }
  if (
    candidate.compatibility.status === 'INDETERMINATE' ||
    candidate.compatibility.status === 'CONDITIONAL' ||
    candidate.temporalEvaluation?.status === 'INDETERMINATE'
  ) {
    return 1
  }
  return 2
}

export function rankOptimizationCandidates(
  candidates: OptimizationCandidate[]
) {
  return [...candidates].sort(
    (left, right) =>
      candidateClassificationRank(left) - candidateClassificationRank(right) ||
      compareCandidates(left, right)
  )
}

function unassigned(
  mission: OptimizationMission,
  candidates: OptimizationCandidate[],
  limitReached: boolean
): UnassignedMission {
  const codes = Array.from(
    new Set(candidates.flatMap((candidate) => candidate.compatibility.codes))
  )
  const missingData = Array.from(
    new Set(
      candidates.flatMap((candidate) => candidate.compatibility.missingData)
    )
  )
  if (limitReached) {
    return {
      missionId: mission.id,
      reference: mission.reference,
      category: 'COMPUTATION_LIMIT_REACHED',
      codes,
      missingData,
      message: 'Mission non évaluée complètement dans le budget de calcul.',
    }
  }
  const regulatory = codes.includes('REGULATORILY_INFEASIBLE')
  const temporal = codes.includes('TEMPORALLY_INFEASIBLE')
  if (regulatory || temporal) {
    return {
      missionId: mission.id,
      reference: mission.reference,
      category: regulatory ? 'REGULATORY_LIMIT' : 'TIME_WINDOW_IMPOSSIBLE',
      codes,
      missingData,
      message: regulatory
        ? 'Limite réglementaire confirmée.'
        : 'Fenêtre temporelle confirmée impossible.',
    }
  }
  if (mission.reportable) {
    return {
      missionId: mission.id,
      reference: mission.reference,
      category: 'DEFERRED',
      codes,
      missingData,
      message: 'Mission reportable non retenue sur la période.',
    }
  }
  return {
    missionId: mission.id,
    reference: mission.reference,
    category: candidates.some(
      (candidate) => candidate.compatibility.status === 'INDETERMINATE'
    )
      ? 'INDETERMINATE'
      : mission.requiredTrailerId ||
        mission.requiredTrailerType ||
        mission.requiredCapacity ||
        mission.requiredCargoType ||
        mission.requiredCouplingType
      ? 'NO_COMPATIBLE_TRAILER'
      : 'NO_COMPATIBLE_PAIR',
    codes,
    missingData,
    message: 'Aucune affectation confirmée n’a été trouvée.',
  }
}

export function toProposedMission(
  candidate: OptimizationCandidate,
  alternatives: OptimizationCandidate[]
): ProposedMission {
  return {
    missionId: candidate.mission.id,
    reference: candidate.mission.reference,
    trailerId: candidate.trailer?.id ?? null,
    trailerPlateNumber: candidate.trailer?.plateNumber ?? null,
    trailerChange: candidate.trailerChange,
    temporalEvaluation: candidate.temporalEvaluation,
    plannedWindow: candidate.plannedWindow,
    transitions: candidate.transitions,
    loadedDistanceMeters: candidate.mission.loadedDistanceMeters,
    cost: candidate.cost,
    score: candidate.score,
    confidence: candidate.confidence,
    explanation: explainOptimizationDecision(candidate, alternatives),
  }
}

function toPairProposal(
  runtime: PairRuntime,
  missions: ProposedMission[] = runtime.missions
): PairProposal {
  const evaluations = missions
    .map((mission) => mission.temporalEvaluation)
    .filter((evaluation): evaluation is NonNullable<typeof evaluation> =>
      Boolean(evaluation)
    )
  const revenueKnown = missions.reduce(
    (sum, mission) => sum + (mission.cost.revenueKnown ?? 0),
    0
  )
  const estimatedCosts = missions
    .map((mission) => mission.cost.estimatedCost)
    .filter((value): value is number => typeof value === 'number')
  const lastEvaluation = evaluations[evaluations.length - 1]
  return {
    pair: runtime.pair.pair,
    locked: runtime.pair.pair.pairLocked,
    missions,
    timeline: evaluations.flatMap((evaluation) => evaluation.timeline),
    finalPosition: runtime.position,
    finalRegulatoryState: lastEvaluation?.stateAfter ?? runtime.state,
    nextAvailableAt: lastEvaluation?.nextAvailableAt ?? runtime.availableAt,
    revenueKnown,
    knownCost: null,
    estimatedCost:
      estimatedCosts.length === missions.length
        ? estimatedCosts.reduce((sum, value) => sum + value, 0)
        : null,
    estimatedMargin:
      estimatedCosts.length === missions.length
        ? revenueKnown - estimatedCosts.reduce((sum, value) => sum + value, 0)
        : null,
    score: runtime.score,
    confidence: missions.some((mission) => mission.confidence === 'LOW')
      ? 'LOW'
      : missions.some((mission) => mission.confidence === 'MEDIUM')
      ? 'MEDIUM'
      : 'HIGH',
  }
}

function metricsFrom(
  confirmed: PairProposal[],
  conditional: PairProposal[],
  unassignedCount: number,
  generated: number,
  eliminated: number,
  sequences: number
): OptimizationMetrics {
  const confirmedMissions = confirmed.flatMap((proposal) => proposal.missions)
  const conditionalMissions = conditional.flatMap(
    (proposal) => proposal.missions
  )
  const all = [...confirmedMissions, ...conditionalMissions]
  const workloads = confirmed.map((proposal) =>
    proposal.missions.reduce(
      (sum, mission) =>
        sum +
        (mission.temporalEvaluation?.consumedDrivingSeconds ?? 0) +
        (mission.temporalEvaluation?.consumedOtherWorkSeconds ?? 0),
      0
    )
  )
  const mean =
    workloads.length > 0
      ? workloads.reduce((sum, value) => sum + value, 0) / workloads.length
      : 0
  const estimatedMargins = confirmed
    .map((proposal) => proposal.estimatedMargin)
    .filter((value): value is number => typeof value === 'number')
  return {
    assignedMissions: all.length,
    confirmedMissions: confirmedMissions.length,
    conditionalMissions: conditionalMissions.length,
    unassignedMissions: unassignedCount,
    revenueCovered: all.reduce(
      (sum, mission) => sum + (mission.cost.revenueKnown ?? 0),
      0
    ),
    estimatedMargin:
      estimatedMargins.length === confirmed.length
        ? estimatedMargins.reduce((sum, value) => sum + value, 0)
        : null,
    loadedKilometers:
      all.reduce(
        (sum, mission) => sum + (mission.loadedDistanceMeters ?? 0),
        0
      ) / 1000,
    emptyKilometers:
      all.reduce(
        (sum, mission) =>
          sum +
          mission.transitions.reduce(
            (routeSum, route) => routeSum + route.distanceMeters,
            0
          ),
        0
      ) / 1000,
    drivingSeconds: all.reduce(
      (sum, mission) =>
        sum + (mission.temporalEvaluation?.consumedDrivingSeconds ?? 0),
      0
    ),
    otherWorkSeconds: all.reduce(
      (sum, mission) =>
        sum + (mission.temporalEvaluation?.consumedOtherWorkSeconds ?? 0),
      0
    ),
    returnsToBase: all.filter((mission) =>
      mission.transitions.some((route) => route.reason === 'RETURN_TO_BASE')
    ).length,
    trailerChanges: all.filter((mission) =>
      mission.temporalEvaluation?.timeline.some(
        (segment) => segment.stepId === 'OPTIMIZATION_TRAILER_COUPLING'
      )
    ).length,
    workloadImbalance:
      workloads.length > 0
        ? workloads.reduce((sum, value) => sum + Math.abs(value - mean), 0) /
          workloads.length
        : 0,
    candidatesGenerated: generated,
    candidatesEliminated: eliminated,
    sequencesEvaluated: sequences,
  }
}

export function buildOptimizationCandidates(
  input: DispatchOptimizationInput,
  mission: OptimizationMission,
  runtimes?: Map<string, PairRuntime>,
  trailerRuntimes?: Map<string, DispatchOptimizationInput['trailers'][number]>
) {
  const candidates: OptimizationCandidate[] = []
  for (const pair of input.pairs) {
    const runtime = runtimes?.get(pair.pair.rowId)
    // Une affectation manuelle déjà posée est une mission déjà faite : le
    // couple repart de son heure de fin et de son point de livraison, comme
    // après une mission que le moteur vient lui-même de placer.
    const priorState = resourceStateBefore({
      occupations: input.resourceOccupations ?? [],
      driverId: pair.pair.driverId,
      truckId: pair.pair.truckId,
      before:
        mission.temporalPlan.earliestStartAt ??
        runtime?.availableAt ??
        pair.availableAt,
    })
    const pairAvailableAt = (() => {
      const base = runtime?.availableAt ?? pair.availableAt
      if (!priorState) return base
      return new Date(priorState.availableAt) > new Date(base)
        ? priorState.availableAt
        : base
    })()
    const pairPosition =
      priorState?.position &&
      new Date(priorState.availableAt) >=
        new Date(runtime?.availableAt ?? pair.availableAt)
        ? priorState.position
        : runtime?.position ?? pair.initialPosition
    const pairPositionId =
      priorState?.position &&
      new Date(priorState.availableAt) >=
        new Date(runtime?.availableAt ?? pair.availableAt)
        ? priorState.position.id
        : runtime?.positionId ?? pair.initialPosition?.id ?? null
    for (const originalTrailer of trailerChoices(mission, input.trailers)) {
      const runtimeTrailer = originalTrailer
        ? trailerRuntimes?.get(originalTrailer.id) ?? originalTrailer
        : null
      const earliestTarget =
        mission.temporalPlan.earliestStartAt ?? pairAvailableAt
      const targetAt = new Date(
        runtimeTrailer?.loadStatus === 'LOADED' ||
          runtimeTrailer?.forcedMissionId
          ? mission.temporalPlan.steps.find((step) => step.mustStartBy)
              ?.mustStartBy ?? earliestTarget
          : earliestTarget
      )
      const completedTimeline = runtimeTrailer?.timeline
        ?.filter(
          (item) =>
            new Date(item.endsAt) <= targetAt &&
            new Date(item.endsAt) > new Date(runtimeTrailer.availableAt)
        )
        .sort((left, right) => left.endsAt.localeCompare(right.endsAt))
      const latestTimeline = completedTimeline?.[completedTimeline.length - 1]
      const trailer = runtimeTrailer
        ? {
            ...runtimeTrailer,
            ...(latestTimeline
              ? {
                  availableAt: latestTimeline.endsAt,
                  position: latestTimeline.positionAfter,
                  attachedTruckId: latestTimeline.truckId,
                  loadStatus: 'EMPTY' as const,
                  forcedMissionId: null,
                }
              : {}),
          }
        : null
      candidates.push(
        buildOptimizationCandidate({
          optimization: input,
          pair,
          mission,
          trailer,
          state: runtime?.state ?? pair.regulatoryState,
          availableAt: pairAvailableAt,
          currentPositionId: pairPositionId,
          currentPosition: pairPosition,
          workload: runtimeWorkloadHours(runtime),
        })
      )
    }
  }
  return candidates.sort(compareCandidates)
}

export function optimizeDispatch(
  input: DispatchOptimizationInput
): DispatchOptimizationResult {
  validateInput(input)
  const started = Date.now()
  const runtimes = new Map<string, PairRuntime>(
    input.pairs.map((pair) => [
      pair.pair.rowId,
      {
        pair,
        state: pair.regulatoryState,
        availableAt: pair.availableAt,
        positionId: pair.initialPosition?.id ?? null,
        position: pair.initialPosition,
        missions: [],
        conditionalMissions: [],
        score: 0,
      } as PairRuntime,
    ])
  )
  const trailerRuntimes = new Map(
    input.trailers.map((trailer) => [trailer.id, { ...trailer }])
  )
  const impossible: UnassignedMission[] = []
  const deferred: UnassignedMission[] = []
  const unassignedMissions: UnassignedMission[] = []
  const assignedMissionIds = new Set<string>()
  let generated = 0
  let eliminated = 0
  let sequences = 0
  let iterations = 0
  let limitReached = false

  for (const mission of orderMissions(input)) {
    if (
      mission.temporalPlan.earliestStartAt &&
      new Date(mission.temporalPlan.earliestStartAt) >=
        new Date(input.period.endsAt)
    ) {
      const item: UnassignedMission = {
        missionId: mission.id,
        reference: mission.reference,
        category: mission.reportable ? 'DEFERRED' : 'TIME_WINDOW_IMPOSSIBLE',
        codes: ['TEMPORALLY_INFEASIBLE'],
        missingData: [],
        message: mission.reportable
          ? 'Mission reportée au-delà de la période simulée.'
          : 'La mission non reportable commence hors période.',
      }
      if (mission.reportable) deferred.push(item)
      else impossible.push(item)
      continue
    }
    if (
      iterations >= input.configuration.limits.maximumIterations ||
      generated >= input.configuration.limits.maximumCandidates ||
      Date.now() - started >= input.configuration.limits.maximumDurationMs
    ) {
      limitReached = true
      unassignedMissions.push(unassigned(mission, [], true))
      continue
    }
    iterations += 1
    const allCandidates = buildOptimizationCandidates(
      input,
      mission,
      runtimes,
      trailerRuntimes
    )
    const candidates = rankOptimizationCandidates(allCandidates).slice(
      0,
      input.configuration.limits.maximumAlternativesPerMission
    )
    generated += allCandidates.length
    eliminated += allCandidates.filter(
      (candidate) => candidate.compatibility.status === 'INCOMPATIBLE'
    ).length
    sequences += allCandidates.filter(
      (candidate) => candidate.temporalEvaluation
    ).length

    const confirmed = candidates.find(
      (candidate) =>
        candidate.compatibility.status === 'COMPATIBLE' &&
        candidate.temporalEvaluation?.status === 'FEASIBLE' &&
        candidate.temporalEvaluation.completedAt &&
        new Date(candidate.temporalEvaluation.completedAt) <=
          new Date(input.period.endsAt)
    )
    if (confirmed?.temporalEvaluation) {
      const runtime = runtimes.get(confirmed.pair.pair.rowId) as PairRuntime
      runtime.missions.push(toProposedMission(confirmed, allCandidates))
      runtime.state = confirmed.temporalEvaluation.stateAfter ?? runtime.state
      runtime.availableAt =
        confirmed.temporalEvaluation.nextAvailableAt ?? runtime.availableAt
      runtime.positionId = confirmed.mission.delivery?.id ?? runtime.positionId
      runtime.position = confirmed.mission.delivery ?? runtime.position
      runtime.score += confirmed.score
      if (confirmed.trailer) {
        trailerRuntimes.set(confirmed.trailer.id, {
          ...confirmed.trailer,
          availableAt:
            confirmed.temporalEvaluation.nextAvailableAt ??
            confirmed.trailer.availableAt,
          position: confirmed.mission.delivery,
          attachedTruckId: confirmed.pair.pair.truckId,
        })
      }
      assignedMissionIds.add(mission.id)
      continue
    }

    const conditional = candidates.find(
      (candidate) =>
        candidate.compatibility.status !== 'INCOMPATIBLE' &&
        (candidate.compatibility.status === 'INDETERMINATE' ||
          candidate.temporalEvaluation?.status === 'INDETERMINATE')
    )
    if (conditional) {
      const runtime = runtimes.get(conditional.pair.pair.rowId) as PairRuntime
      runtime.conditionalMissions.push(
        toProposedMission(conditional, allCandidates)
      )
      runtime.score += conditional.score
      // A conditional assignment still occupies the crew and the trailer: the
      // data is incomplete, the truck is not. Advancing the runtime is what
      // lets the next missions see this one and reach the other pairs.
      const endsAt =
        conditional.temporalEvaluation?.nextAvailableAt ??
        conditional.plannedWindow?.endsAt ??
        null
      if (endsAt && new Date(endsAt) > new Date(runtime.availableAt)) {
        runtime.availableAt = endsAt
      }
      runtime.state = conditional.temporalEvaluation?.stateAfter ?? runtime.state
      runtime.positionId = conditional.mission.delivery?.id ?? runtime.positionId
      runtime.position = conditional.mission.delivery ?? runtime.position
      if (conditional.trailer) {
        trailerRuntimes.set(conditional.trailer.id, {
          ...conditional.trailer,
          availableAt: endsAt ?? conditional.trailer.availableAt,
          position: conditional.mission.delivery,
          attachedTruckId: conditional.pair.pair.truckId,
        })
      }
      assignedMissionIds.add(mission.id)
      continue
    }

    const item = unassigned(mission, allCandidates, false)
    if (item.category === 'DEFERRED') deferred.push(item)
    else if (
      item.category === 'REGULATORY_LIMIT' ||
      item.category === 'TIME_WINDOW_IMPOSSIBLE' ||
      item.category === 'INFEASIBLE'
    ) {
      impossible.push(item)
    } else {
      unassignedMissions.push(item)
    }
  }

  const confirmedProposals = Array.from(runtimes.values())
    .filter((runtime) => runtime.missions.length)
    .map((runtime) => toPairProposal(runtime))
  const conditionalProposals = Array.from(runtimes.values())
    .filter((runtime) => runtime.conditionalMissions.length)
    .map((runtime) => toPairProposal(runtime, runtime.conditionalMissions))

  // Final pure sequence verification reuses the Run 2 sequence evaluator.
  for (const runtime of Array.from(runtimes.values())) {
    const plans = runtime.missions
      .map((mission) => {
        const source = input.missions.find(
          (candidate) => candidate.id === mission.missionId
        )
        return source?.temporalPlan ?? null
      })
      .filter((plan): plan is NonNullable<typeof plan> => Boolean(plan))
    if (plans.length > 1) {
      evaluateTemporalMissionSequence({
        pair: runtime.pair.pair,
        plans,
        initialState: runtime.pair.regulatoryState,
        simulationStartAt: runtime.pair.availableAt,
        initialPosition: runtime.pair.initialPosition,
        profile: input.profile,
      })
    }
  }

  const allUnassigned = [...impossible, ...deferred, ...unassignedMissions]
  const metrics = metricsFrom(
    confirmedProposals,
    conditionalProposals,
    allUnassigned.length,
    generated,
    eliminated,
    sequences
  )
  const usedTrailerIds = new Set(
    [...confirmedProposals, ...conditionalProposals].flatMap((proposal) =>
      proposal.missions
        .map((mission) => mission.trailerId)
        .filter((id): id is string => Boolean(id))
    )
  )
  const score = [...confirmedProposals, ...conditionalProposals].reduce(
    (sum, proposal) => sum + proposal.score,
    0
  )
  return {
    executionId: `${input.executionSeed}:${input.strategy}:${input.configuration.version}`,
    strategy: input.strategy,
    configurationVersion: input.configuration.version,
    period: input.period,
    status: limitReached
      ? 'PARTIAL'
      : conditionalProposals.length
      ? 'INDETERMINATE'
      : 'COMPLETE',
    score,
    metrics,
    confirmedProposals,
    conditionalProposals,
    impossibleMissions: impossible,
    deferredMissions: deferred,
    unassignedMissions,
    unusedPairRowIds: input.pairs
      .map((pair) => pair.pair.rowId)
      .filter(
        (id) =>
          !confirmedProposals.some((proposal) => proposal.pair.rowId === id) &&
          !conditionalProposals.some((proposal) => proposal.pair.rowId === id)
      ),
    unusedTrailerIds: input.trailers
      .map((trailer) => trailer.id)
      .filter((id) => !usedTrailerIds.has(id)),
    trailerFinalStates: Array.from(trailerRuntimes.values()).map((trailer) => ({
      trailerId: trailer.id,
      position: trailer.position,
      availableAt: trailer.availableAt,
      attachedTruckId: trailer.attachedTruckId ?? null,
    })),
    alerts: limitReached
      ? ['Meilleure proposition trouvée dans les limites de calcul.']
      : [],
    missingData: Array.from(
      new Set(
        conditionalProposals.flatMap((proposal) =>
          proposal.missions.flatMap(
            (mission) => mission.explanation.missingData
          )
        )
      )
    ),
    computationLimitReached: limitReached,
    computationDurationMs: Date.now() - started,
  }
}

export function compareDispatchStrategies(
  input: Omit<DispatchOptimizationInput, 'strategy'>
): StrategyComparison {
  const entries = optimizationStrategies.map((strategy) => [
    strategy,
    // L'optimiseur fait évoluer ses états réglementaires et matériels de
    // travail. Chaque stratégie doit donc partir d'un instantané indépendant :
    // sinon la première comparaison contamine les suivantes.
    optimizeDispatch({ ...structuredClone(input), strategy }),
  ]) as Array<
    [typeof optimizationStrategies[number], DispatchOptimizationResult]
  >
  const results = Object.fromEntries(entries) as StrategyComparison['results']
  return {
    results,
    metrics: {
      MAX_PROFITABILITY: results.MAX_PROFITABILITY.metrics,
      BALANCED: results.BALANCED.metrics,
      MAX_COVERAGE: results.MAX_COVERAGE.metrics,
    },
  }
}
