import { evaluateTemporalMission } from '../regulatory'
import type { MissionTemporalPlan, MissionTemporalStep } from '../regulatory'
import {
  compatibilityMessages,
  evaluateMissionCompatibility,
} from './compatibility'
import type {
  CompatibilityCode,
  CostBreakdown,
  DispatchOptimizationInput,
  OptimizationCandidate,
  OptimizationMission,
  OptimizationPair,
  OptimizationTrailer,
  RouteTransition,
  ScoreFactor,
} from './types'
import { findResourceOccupationConflicts } from '../resource-availability'

export function routeKey(fromId: string, toId: string) {
  return `${fromId}=>${toId}`
}

function findRoute(
  input: DispatchOptimizationInput,
  fromId: string,
  toId: string
) {
  if (fromId === toId) return null
  return input.transitions.find(
    (transition) => transition.key === routeKey(fromId, toId)
  )
}

function requiredTransitions(input: {
  optimization: DispatchOptimizationInput
  pair: OptimizationPair
  mission: OptimizationMission
  trailer: OptimizationTrailer | null
  currentPositionId: string | null
}): { routes: RouteTransition[]; missing: string[]; trailerChange: boolean } {
  const { optimization, pair, mission, trailer } = input
  const pickupId = mission.pickup?.id ?? null
  if (!pickupId || !input.currentPositionId) {
    return { routes: [], missing: ['position'], trailerChange: false }
  }

  const routes: RouteTransition[] = []
  const missing: string[] = []
  const trailerChange = Boolean(
    trailer && trailer.attachedTruckId !== pair.pair.truckId
  )
  let cursorId = input.currentPositionId

  if (trailerChange) {
    if (!trailer?.position) {
      missing.push('trailerPosition')
    } else {
      const toTrailer = findRoute(optimization, cursorId, trailer.position.id)
      if (cursorId !== trailer.position.id && !toTrailer) {
        missing.push(routeKey(cursorId, trailer.position.id))
      } else if (toTrailer) {
        routes.push({
          ...toTrailer,
          reason:
            trailer.position.id === 'BASE'
              ? 'RETURN_TO_BASE'
              : 'TRAILER_PICKUP',
          empty: true,
        })
      }
      cursorId = trailer.position.id
    }
  }

  const toPickup = findRoute(optimization, cursorId, pickupId)
  if (cursorId !== pickupId && !toPickup) {
    missing.push(routeKey(cursorId, pickupId))
  } else if (toPickup) {
    routes.push({
      ...toPickup,
      reason: routes.length > 0 ? 'BASE_TO_PICKUP' : 'INITIAL_APPROACH',
      empty: true,
    })
  }
  return { routes, missing, trailerChange }
}

function buildCandidatePlan(input: {
  mission: OptimizationMission
  routes: RouteTransition[]
  trailerChange: boolean
  profile: DispatchOptimizationInput['profile']
  currentPosition: OptimizationPair['initialPosition']
}): MissionTemporalPlan {
  const routeSteps: MissionTemporalStep[] = input.routes.map(
    (route, index) => ({
      id: `OPTIMIZATION_TRANSITION_${index + 1}`,
      activityType: 'DRIVING',
      durationSeconds: route.durationSeconds,
      source: route.source === 'GOOGLE_ROUTES' ? 'GOOGLE_ROUTES' : 'MISSION',
      evidence: route.source === 'ESTIMATED' ? 'ESTIMATED' : 'DECLARED',
      confidence: route.confidence,
      from: route.from,
      to: route.to,
    })
  )
  const trailerSteps: MissionTemporalStep[] = input.trailerChange
    ? [
        {
          id: 'OPTIMIZATION_TRAILER_UNCOUPLING',
          activityType: 'OTHER_WORK',
          durationSeconds: input.profile.defaultTrailerUncouplingSeconds,
          source: 'SYSTEM_DEFAULT',
          evidence: 'ESTIMATED',
          confidence: 'LOW',
          isTrailerChange: true,
        },
        {
          id: 'OPTIMIZATION_TRAILER_COUPLING',
          activityType: 'OTHER_WORK',
          durationSeconds: input.profile.defaultTrailerCouplingSeconds,
          source: 'SYSTEM_DEFAULT',
          evidence: 'ESTIMATED',
          confidence: 'LOW',
          isTrailerChange: true,
        },
      ]
    : []
  return {
    ...input.mission.temporalPlan,
    earliestStartAt: input.mission.temporalPlan.earliestStartAt,
    startPosition:
      routeSteps[0]?.from ??
      input.currentPosition ??
      input.mission.temporalPlan.startPosition,
    steps: [
      ...routeSteps,
      ...trailerSteps,
      ...input.mission.temporalPlan.steps.filter(
        (step) => step.id !== 'APPROACH'
      ),
    ],
  }
}

function costCandidate(
  input: DispatchOptimizationInput,
  mission: OptimizationMission,
  routes: RouteTransition[],
  evaluation: ReturnType<typeof evaluateTemporalMission> | null,
  trailerChange: boolean,
  routeDataComplete: boolean
): CostBreakdown {
  const emptyDistanceKm =
    routes.reduce((sum, route) => sum + route.distanceMeters, 0) / 1000
  const approachDurationHours =
    routes.reduce((sum, route) => sum + route.durationSeconds, 0) / 3600
  const loadedDistanceKm =
    typeof mission.loadedDistanceMeters === 'number'
      ? mission.loadedDistanceMeters / 1000
      : null
  const productiveHours = evaluation?.status === 'FEASIBLE'
    ? (evaluation.consumedDrivingSeconds +
        evaluation.consumedOtherWorkSeconds) /
      3600
    : null
  const waitingHours = evaluation?.status === 'FEASIBLE'
    ? evaluation.timeline
        .filter(
          (segment) =>
            segment.activityType === 'AVAILABILITY' &&
            segment.stepId.endsWith(':WAIT')
        )
        .reduce((sum, segment) => sum + segment.durationSeconds, 0) / 3600
    : 0
  const requiresReturnToBase = routes.some(
    (route) => route.reason === 'RETURN_TO_BASE'
  )
  const assumptions: string[] = []
  const distanceCost =
    typeof input.costs.costPerKm === 'number' &&
    routeDataComplete &&
    loadedDistanceKm !== null
      ? (emptyDistanceKm + loadedDistanceKm) * input.costs.costPerKm
      : input.costs.costPerKm == null
      ? 0
      : null
  const timeCost =
    typeof input.costs.defaultHourlyCost === 'number' && productiveHours !== null
      ? productiveHours * input.costs.defaultHourlyCost
      : input.costs.defaultHourlyCost == null
      ? 0
      : null
  const waitingCost =
    typeof input.costs.waitingCostPerHour === 'number' &&
    evaluation?.status === 'FEASIBLE'
      ? waitingHours * input.costs.waitingCostPerHour
      : input.costs.waitingCostPerHour == null
      ? 0
      : null
  const trailerChangeCost = trailerChange
    ? input.costs.trailerChangeCost ?? null
    : 0
  const returnToBaseCost = requiresReturnToBase
    ? input.costs.returnToBaseCost ?? null
    : 0
  const approachDistanceCost =
    typeof input.costs.costPerKm === 'number' && routeDataComplete
      ? emptyDistanceKm * input.costs.costPerKm
      : null
  const approachTimeCost =
    typeof input.costs.defaultHourlyCost === 'number' && routeDataComplete
      ? approachDurationHours * input.costs.defaultHourlyCost
      : null
  const approachCost =
    approachDistanceCost !== null && approachTimeCost !== null
      ? approachDistanceCost + approachTimeCost
      : null
  let estimatedCost: number | null = null
  const components = [
    distanceCost,
    timeCost,
    waitingCost,
    trailerChangeCost,
    returnToBaseCost ?? 0,
  ]
  if (components.every((component) => component !== null)) {
    estimatedCost = components.reduce<number>(
      (sum, component) => sum + (component ?? 0),
      0
    )
    assumptions.push(
      `Approche estimée: ${emptyDistanceKm.toFixed(1)} km, ${approachDurationHours.toFixed(2)} h, ${
        approachCost?.toFixed(2) ?? 'inconnu'
      } ${input.costs.currency}.`
    )
    if (waitingHours > 0) {
      assumptions.push(
        `Attente estimée: ${waitingHours.toFixed(2)} h, ${(
          waitingCost ?? 0
        ).toFixed(2)} ${input.costs.currency}.`
      )
    }
    if (trailerChange) {
      assumptions.push(
        `Changement de remorque estimé: ${(
          trailerChangeCost ?? 0
        ).toFixed(2)} ${input.costs.currency}.`
      )
    }
  } else {
    assumptions.push(
      'Coût total et marge laissés inconnus: distance, route ou durée essentielle manquante.'
    )
  }
  return {
    revenueKnown: mission.revenueAmount,
    knownCost: null,
    estimatedCost,
    estimatedMargin:
      mission.revenueAmount !== null && estimatedCost !== null
        ? mission.revenueAmount - estimatedCost
        : null,
    emptyDistanceKm,
    approachDurationHours,
    approachCost,
    waitingHours,
    waitingCost,
    trailerChangeCost,
    returnToBaseCost,
    currency: mission.currency,
    assumptions,
  }
}

function scoreCandidate(
  input: DispatchOptimizationInput,
  pair: OptimizationPair,
  mission: OptimizationMission,
  routes: RouteTransition[],
  cost: CostBreakdown,
  trailerChange: boolean,
  workload: number,
  confidence: OptimizationCandidate['confidence']
) {
  const weights = input.configuration.weights[input.strategy]
  const emptyKm =
    routes.reduce((sum, route) => sum + route.distanceMeters, 0) / 1000
  const economicEstimateAvailable = cost.estimatedMargin !== null
  const raw = [
    [
      'REVENUE',
      economicEstimateAvailable ? 0 : cost.revenueKnown ?? 0,
      weights.revenue,
      'Revenu connu (secours sans marge)',
    ],
    [
      'ESTIMATED_MARGIN',
      cost.estimatedMargin ?? 0,
      weights.estimatedMargin,
      'Marge opérationnelle estimée',
    ],
    ['COVERAGE', 1, weights.coverage, 'Mission couverte'],
    ['PRIORITY', mission.priority, weights.priority, 'Priorité déclarée'],
    [
      'EMPTY_KM',
      economicEstimateAvailable ? 0 : emptyKm,
      weights.emptyKm,
      'Kilomètres à vide (secours sans marge)',
    ],
    ['WORK_BALANCE', workload, weights.workBalance, 'Charge du couple'],
    [
      'RETURN_TO_BASE',
      !economicEstimateAvailable &&
      routes.some((route) => route.reason === 'RETURN_TO_BASE')
        ? 1
        : 0,
      weights.returnToBase,
      'Retour à la base',
    ],
    [
      'TRAILER_CHANGE',
      !economicEstimateAvailable && trailerChange ? 1 : 0,
      weights.trailerChange,
      'Changement de remorque',
    ],
    [
      'LOW_CONFIDENCE',
      confidence === 'HIGH' ? 0 : confidence === 'MEDIUM' ? 0.5 : 1,
      weights.lowConfidence,
      'Incertitude des données',
    ],
    [
      'HABITUAL_TRUCK',
      pair.usualTruckId === pair.pair.truckId ? 1 : 0,
      weights.habitualTruck,
      'Tracteur habituel',
    ],
  ] as const
  const factors: ScoreFactor[] = raw.map(
    ([code, value, weight, explanation]) => ({
      code,
      value,
      weightedValue: value * weight,
      explanation,
    })
  )
  return {
    factors,
    score: factors.reduce((sum, factor) => sum + factor.weightedValue, 0),
  }
}

export function buildOptimizationCandidate(input: {
  optimization: DispatchOptimizationInput
  pair: OptimizationPair
  mission: OptimizationMission
  trailer: OptimizationTrailer | null
  state: OptimizationPair['regulatoryState']
  availableAt: string
  currentPositionId: string | null
  currentPosition?: OptimizationPair['initialPosition']
  workload: number
}): OptimizationCandidate {
  const compatibility = evaluateMissionCompatibility({
    pair: { ...input.pair, regulatoryState: input.state },
    mission: input.mission,
    trailer: input.trailer,
    unavailableResourceIds: input.optimization.unavailableResourceIds,
  })
  const transitionResult = requiredTransitions({
    optimization: input.optimization,
    pair: input.pair,
    mission: input.mission,
    trailer: input.trailer,
    currentPositionId: input.currentPositionId,
  })
  const certainStart = new Date(
    new Date(input.availableAt) >
    new Date(input.mission.temporalPlan.earliestStartAt ?? input.availableAt)
      ? input.availableAt
      : input.mission.temporalPlan.earliestStartAt ?? input.availableAt
  )
  let certainCursor = certainStart.getTime()
  const certainMissionWindowConflict = input.mission.temporalPlan.steps.some(
    (step) => {
      if (step.notBefore) {
        certainCursor = Math.max(
          certainCursor,
          new Date(step.notBefore).getTime()
        )
      }
      if (
        step.mustStartBy &&
        certainCursor > new Date(step.mustStartBy).getTime()
      ) {
        return true
      }
      certainCursor += step.durationSeconds * 1000
      return Boolean(
        step.mustEndBy && certainCursor > new Date(step.mustEndBy).getTime()
      )
    }
  )
  if (certainMissionWindowConflict) {
    compatibility.status = 'INCOMPATIBLE'
    compatibility.codes = Array.from(
      new Set<CompatibilityCode>([
        ...compatibility.codes,
        'TEMPORALLY_INFEASIBLE',
      ])
    )
    compatibility.messages = compatibility.codes.map(
      (code) => compatibilityMessages[code]
    )
  }
  if (transitionResult.missing.length) {
    compatibility.status =
      compatibility.status === 'INCOMPATIBLE' ? 'INCOMPATIBLE' : 'INDETERMINATE'
    compatibility.codes = Array.from(
      new Set<CompatibilityCode>([...compatibility.codes, 'MISSING_ROUTE'])
    )
    compatibility.messages = compatibility.codes.map(
      (code) => compatibilityMessages[code]
    )
    compatibility.missingData.push(...transitionResult.missing)
  }

  let temporalEvaluation: OptimizationCandidate['temporalEvaluation'] = null
  if (
    compatibility.status !== 'INCOMPATIBLE' &&
    !transitionResult.missing.length
  ) {
    const candidatePlan = buildCandidatePlan({
      mission: input.mission,
      routes: transitionResult.routes,
      trailerChange: transitionResult.trailerChange,
      profile: input.optimization.profile,
      currentPosition: input.currentPosition ?? null,
    })
    const earliestStart = new Date(
      new Date(input.availableAt) >
      new Date(input.mission.temporalPlan.earliestStartAt ?? input.availableAt)
        ? input.availableAt
        : input.mission.temporalPlan.earliestStartAt ?? input.availableAt
    )
    let minimumCursor = earliestStart.getTime()
    const certainWindowConflict = candidatePlan.steps.some((step) => {
      if (step.notBefore) {
        minimumCursor = Math.max(
          minimumCursor,
          new Date(step.notBefore).getTime()
        )
      }
      if (
        step.mustStartBy &&
        minimumCursor > new Date(step.mustStartBy).getTime()
      ) {
        return true
      }
      minimumCursor += step.durationSeconds * 1000
      return Boolean(
        step.mustEndBy && minimumCursor > new Date(step.mustEndBy).getTime()
      )
    })
    if (certainWindowConflict) {
      compatibility.status = 'INCOMPATIBLE'
      compatibility.codes = Array.from(
        new Set<CompatibilityCode>([
          ...compatibility.codes,
          'TEMPORALLY_INFEASIBLE',
        ])
      )
      compatibility.messages = compatibility.codes.map(
        (code) => compatibilityMessages[code]
      )
    } else {
      temporalEvaluation = evaluateTemporalMission({
        pair: input.pair.pair,
        plan: candidatePlan,
        initialState: input.state,
        simulationStartAt:
          new Date(input.availableAt) >
          new Date(
            input.mission.temporalPlan.earliestStartAt ?? input.availableAt
          )
            ? input.availableAt
            : input.mission.temporalPlan.earliestStartAt ?? input.availableAt,
        profile: input.optimization.profile,
      })
      if (temporalEvaluation.status === 'IMPOSSIBLE') {
        compatibility.status = 'INCOMPATIBLE'
        compatibility.codes.push(
          temporalEvaluation.decisions.some((code) =>
            code.includes('LIMIT_EXCEEDED')
          )
            ? 'REGULATORILY_INFEASIBLE'
            : 'TEMPORALLY_INFEASIBLE'
        )
      } else if (temporalEvaluation.status === 'INDETERMINATE') {
        compatibility.status = 'INDETERMINATE'
        compatibility.codes.push('REGULATORY_STATE_UNKNOWN')
        compatibility.missingData.push(...temporalEvaluation.missingData)
      } else if (
        input.trailer &&
        temporalEvaluation.possibleStartAt &&
        new Date(input.trailer.availableAt) >
          new Date(temporalEvaluation.possibleStartAt)
      ) {
        compatibility.status = 'INCOMPATIBLE'
        compatibility.codes.push('RESOURCE_TIME_CONFLICT')
        compatibility.messages.push(
          compatibilityMessages.RESOURCE_TIME_CONFLICT
        )
      }
      if (
        temporalEvaluation?.possibleStartAt &&
        temporalEvaluation.completedAt
      ) {
        const conflicts = findResourceOccupationConflicts({
          proposed: [
            {
              missionId: input.mission.id,
              driverId: input.pair.pair.driverId,
              truckId: input.pair.pair.truckId,
              trailerId: input.trailer?.id ?? null,
              startsAt: temporalEvaluation.possibleStartAt,
              endsAt: temporalEvaluation.completedAt,
            },
          ],
          occupied: input.optimization.resourceOccupations ?? [],
        })
        if (conflicts.length) {
          const codes: CompatibilityCode[] = ['RESOURCE_TIME_CONFLICT']
          if (conflicts.some((conflict) => conflict.kinds.includes('DRIVER'))) {
            codes.push('DRIVER_TIME_CONFLICT')
          }
          if (conflicts.some((conflict) => conflict.kinds.includes('TRUCK'))) {
            codes.push('TRUCK_TIME_CONFLICT')
          }
          if (conflicts.some((conflict) => conflict.kinds.includes('TRAILER'))) {
            codes.push('TRAILER_TIME_CONFLICT')
          }
          compatibility.status = 'INCOMPATIBLE'
          compatibility.codes = Array.from(
            new Set([...compatibility.codes, ...codes])
          )
          compatibility.messages = compatibility.codes.map(
            (code) => compatibilityMessages[code]
          )
        }
      }
    }
  }

  const dataConfidence: OptimizationCandidate['confidence'] =
    compatibility.status === 'INDETERMINATE'
      ? 'LOW'
      : input.mission.confidence === 'HIGH' &&
        transitionResult.routes.every((route) => route.confidence === 'HIGH')
      ? 'HIGH'
      : 'MEDIUM'
  const cost = costCandidate(
    input.optimization,
    input.mission,
    transitionResult.routes,
    temporalEvaluation,
    transitionResult.trailerChange,
    transitionResult.missing.length === 0
  )
  const hasConfiguredEconomicCost =
    typeof input.optimization.costs.costPerKm === 'number' ||
    typeof input.optimization.costs.defaultHourlyCost === 'number' ||
    typeof input.optimization.costs.waitingCostPerHour === 'number'
  const confidence: OptimizationCandidate['confidence'] =
    hasConfiguredEconomicCost && cost.estimatedCost === null
      ? 'LOW'
      : dataConfidence
  const scored = scoreCandidate(
    input.optimization,
    input.pair,
    input.mission,
    transitionResult.routes,
    cost,
    transitionResult.trailerChange,
    input.workload,
    confidence
  )
  return {
    id: `${input.mission.id}:${input.pair.pair.rowId}:${
      input.trailer?.id ?? 'none'
    }`,
    pair: input.pair,
    mission: input.mission,
    trailer: input.trailer,
    transitions: transitionResult.routes,
    compatibility,
    temporalEvaluation,
    cost,
    score: scored.score,
    factors: scored.factors,
    confidence,
    requiresReturnToBase: transitionResult.routes.some(
      (route) => route.reason === 'RETURN_TO_BASE'
    ),
    trailerChange: transitionResult.trailerChange,
  }
}

export function trailerChoices(
  mission: OptimizationMission,
  trailers: OptimizationTrailer[]
) {
  if (mission.requiredTrailerId) {
    return trailers.filter(
      (trailer) => trailer.id === mission.requiredTrailerId
    )
  }
  if (
    mission.requiredTrailerType ||
    mission.requiredCapacity ||
    mission.requiredCargoType ||
    mission.requiredCouplingType
  )
    return trailers
  return [null]
}
