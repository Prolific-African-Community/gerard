import { prepareCandidateApproachRoutes } from '../auto-planning/approach-routes'
import { computeGoogleRouteMetrics } from '../maps/google'
import {
  buildOptimizationCandidates,
  routeKey,
  type DispatchOptimizationInput,
  type OptimizationCandidate,
  type RouteTransition,
} from '../optimization'
import type { TemporalLocation } from '../regulatory'
import { findResourceOccupationConflicts } from '../resource-availability'
import { detectReassignmentEfficiency } from './reassignment-efficiency'
import type { GerardSuggestion } from './types'

export type PlanningNeighbor = {
  missionId: string
  pairRowId: string
  trailerId: string | null
  startsAt: string
  endsAt: string
  pickup: TemporalLocation
  delivery: TemporalLocation
}

export type PlanningAnalysisDiagnostic =
  | 'ANALYZED'
  | 'NO_VALID_ALTERNATIVE'
  | 'MISSING_ROUTE'
  | 'REGULATORY_UNKNOWN'
  | 'RESOURCE_CONFLICT'
  | 'TRAILER_CONFLICT'
  | 'LOW_CONFIDENCE'
  | 'BASELINE_INVALID'

/**
 * Sources de position exploitables par l'analyse. DEMO_SIMULATED reste une
 * provenance simulee du prototype : elle est lue comme les autres, mais sa
 * confiance est evaluee separement (voir driver-position.ts).
 */
export function positionProvidersForAnalysis() {
  return ['DRIVER_PHONE', 'DEMO_SIMULATED'] as const
}

export function analyticalMission<T extends { forcedPairRowId?: string | null; requiredTrailerId?: string | null }>(mission: T): Omit<T, 'forcedPairRowId' | 'requiredTrailerId'> & { forcedPairRowId: null; requiredTrailerId: null } {
  return { ...mission, forcedPairRowId: null, requiredTrailerId: null }
}

export function hasAlternativeOccupationConflict(input: {
  missionId: string
  pairRowId: string
  driverId: string
  truckId: string
  trailerId: string | null
  startsAt: string
  endsAt: string
  neighbors: PlanningNeighbor[]
}) {
  return findResourceOccupationConflicts({
    proposed: [{
      missionId: input.missionId,
      driverId: input.driverId,
      truckId: input.truckId,
      trailerId: input.trailerId,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
    }],
    occupied: input.neighbors
      .filter((neighbor) => neighbor.missionId !== input.missionId)
      .map((neighbor) => ({
        missionId: neighbor.missionId,
        driverId:
          neighbor.pairRowId === input.pairRowId ? input.driverId : null,
        truckId:
          neighbor.pairRowId === input.pairRowId ? input.truckId : null,
        trailerId: neighbor.trailerId,
        startsAt: new Date(neighbor.startsAt),
        endsAt: new Date(neighbor.endsAt),
      })),
  }).length > 0
}

function pairNeighborhood(neighbors: PlanningNeighbor[], rowId: string, missionId: string) {
  const target = neighbors.find((item) => item.missionId === missionId)
  const ordered = neighbors
    .filter((item) => item.pairRowId === rowId && item.missionId !== missionId)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  return {
    predecessor: [...ordered]
      .reverse()
      .find((item) => item.endsAt <= target?.startsAt!),
    successor: ordered.find((item) => item.startsAt >= target?.startsAt!),
  }
}

function diagnostics(current: OptimizationCandidate | null, alternatives: OptimizationCandidate[]) {
  const values = new Set<PlanningAnalysisDiagnostic>()
  if (!current || current.compatibility.status !== 'COMPATIBLE' || current.temporalEvaluation?.status !== 'FEASIBLE') values.add('BASELINE_INVALID')
  const all = current ? [current, ...alternatives] : alternatives
  if (all.some((candidate) => candidate.compatibility.codes.includes('MISSING_ROUTE'))) values.add('MISSING_ROUTE')
  if (all.some((candidate) => candidate.compatibility.codes.includes('REGULATORY_STATE_UNKNOWN'))) values.add('REGULATORY_UNKNOWN')
  if (all.some((candidate) => candidate.compatibility.codes.includes('RESOURCE_TIME_CONFLICT'))) values.add('RESOURCE_CONFLICT')
  if (all.some((candidate) => candidate.compatibility.codes.some((code) => code.includes('TRAILER_')))) values.add('TRAILER_CONFLICT')
  if (all.some((candidate) => candidate.confidence === 'LOW')) values.add('LOW_CONFIDENCE')
  if (!alternatives.length) values.add('NO_VALID_ALTERNATIVE')
  if (!values.has('BASELINE_INVALID')) values.add('ANALYZED')
  return Array.from(values)
}

export async function analyzeExistingPlanningMission(input: {
  optimization: DispatchOptimizationInput
  missionId: string
  currentPairRowId: string
  currentTrailerId: string | null
  neighbors: PlanningNeighbor[]
  weekStart: string
  snapshotFingerprint: string
  maximumAlternativePairs?: number
  routeProvider?: Parameters<typeof prepareCandidateApproachRoutes>[0]['provider']
}) {
  const sourceMission = input.optimization.missions.find((mission) => mission.id === input.missionId)
  if (!sourceMission) throw new Error('SUGGESTION_MISSION_NOT_FOUND')
  const mission = analyticalMission(sourceMission)
  const target = input.neighbors.find((item) => item.missionId === input.missionId)
  if (!target) throw new Error('SUGGESTION_NEIGHBORHOOD_MISSING')
  const orderedPairs = [...input.optimization.pairs].sort((a, b) =>
    a.pair.rowId === input.currentPairRowId ? -1 : b.pair.rowId === input.currentPairRowId ? 1 : a.pair.rowId.localeCompare(b.pair.rowId)
  ).slice(0, 1 + (input.maximumAlternativePairs ?? 3))
  const pairContexts = new Map<string, ReturnType<typeof pairNeighborhood>>()
  const pairs = orderedPairs.map((pair) => {
    const context = pairNeighborhood(input.neighbors, pair.pair.rowId, input.missionId)
    pairContexts.set(pair.pair.rowId, context)
    return {
      ...pair,
      availableAt: context.predecessor?.endsAt ?? pair.availableAt,
      initialPosition: context.predecessor?.delivery ?? pair.initialPosition,
    }
  })
  const occupations = (input.optimization.resourceOccupations ?? []).filter((item) => item.missionId !== input.missionId)
  const base: DispatchOptimizationInput = {
    ...input.optimization,
    pairs,
    missions: [mission],
    resourceOccupations: occupations,
  }
  const transitions = await prepareCandidateApproachRoutes({
    pairs,
    missions: [mission],
    trailers: base.trailers,
    existing: base.transitions,
    provider: input.routeProvider,
  })
  const provider = input.routeProvider ?? computeGoogleRouteMetrics
  for (const pair of pairs) {
    const successor = pairContexts.get(pair.pair.rowId)?.successor
    if (
      !mission.delivery ||
      !successor ||
      typeof mission.delivery.latitude !== 'number' ||
      typeof mission.delivery.longitude !== 'number' ||
      typeof successor.pickup.latitude !== 'number' ||
      typeof successor.pickup.longitude !== 'number'
    ) continue
    const key = routeKey(mission.delivery.id, successor.pickup.id)
    if (transitions.some((item) => item.key === key)) continue
    try {
      const route = await provider({
        origin: { latitude: mission.delivery.latitude, longitude: mission.delivery.longitude },
        destination: { latitude: successor.pickup.latitude, longitude: successor.pickup.longitude },
        routingPreference: 'TRAFFIC_UNAWARE',
      })
      transitions.push({ key, from: mission.delivery, to: successor.pickup, distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds, source: route.provider, confidence: 'HIGH', reason: 'MISSION_TRANSITION', empty: true })
    } catch {
      // Missing successor route is reported by filtering the alternative.
    }
  }
  const candidates = buildOptimizationCandidates({ ...base, transitions }, mission)
  const currentCandidate = candidates.find((candidate) =>
    candidate.pair.pair.rowId === input.currentPairRowId &&
    (candidate.trailer?.id ?? null) === input.currentTrailerId
  ) ?? null
  const alternatives = candidates.filter((candidate) => {
    if (candidate === currentCandidate || candidate.compatibility.status !== 'COMPATIBLE' || candidate.temporalEvaluation?.status !== 'FEASIBLE') return false
    const proposedStart = candidate.temporalEvaluation?.possibleStartAt
    const proposedEnd = candidate.temporalEvaluation?.completedAt
    if (proposedStart && proposedEnd && hasAlternativeOccupationConflict({
      missionId: input.missionId,
      pairRowId: candidate.pair.pair.rowId,
      driverId: candidate.pair.pair.driverId,
      truckId: candidate.pair.pair.truckId,
      trailerId: candidate.trailer?.id ?? null,
      startsAt: proposedStart,
      endsAt: proposedEnd,
      neighbors: input.neighbors,
    })) return false
    const successor = pairContexts.get(candidate.pair.pair.rowId)?.successor
    if (!successor || !candidate.mission.delivery || !candidate.temporalEvaluation.completedAt) return true
    const route = transitions.find((item) => item.from.id === candidate.mission.delivery?.id && item.to.id === successor.pickup.id)
    return Boolean(route && new Date(candidate.temporalEvaluation.completedAt).getTime() + route.durationSeconds * 1000 <= new Date(successor.startsAt).getTime())
  })
  const suggestion: GerardSuggestion | null = currentCandidate
    ? detectReassignmentEfficiency({ currentCandidate, alternatives, weekStart: input.weekStart, snapshotFingerprint: input.snapshotFingerprint })
    : null
  return { currentCandidate, alternatives, suggestion, diagnostics: diagnostics(currentCandidate, alternatives), transitions: transitions as RouteTransition[] }
}
