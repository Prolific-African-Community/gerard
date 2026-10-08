import { prisma } from '../prisma'
import { computeGoogleRoute } from './maps/google'
import {
  configuredSingleRouteMaximum,
  measureRouteOperation,
  normalizeRouteCoordinate,
  type RouteMetrics,
} from './maps/route-control'

/**
 * Approche camion → enlèvement d'une affectation, calculée et persistée une
 * fois l'affectation décidée. L'optimisation, elle, continue de classer ses
 * candidats avec le cache et les estimations : aucun appel Google n'est fait
 * par candidat. Seules les affectations réellement retenues déclenchent, au
 * plus, un itinéraire non mis en cache.
 *
 * Origine, par ordre :
 *   1. fin (livraison) de la mission précédente du même camion ;
 *   2. sinon la position de repli fournie par l'appelant (position du camion
 *      retenue par le moteur, ou dernier ping côté action manuelle).
 * Sans origine ou sans coordonnées d'enlèvement, rien n'est inventé : l'état
 * « non résolu » est renvoyé et l'approche reste à calculer.
 */
export type ApproachPoint = { latitude: number; longitude: number; source?: string | null }

export type UnresolvedReason =
  | 'MISSING_TRUCK'
  | 'MISSING_PICKUP_COORDINATES'
  | 'MISSING_ORIGIN'
  | 'ROUTE_UNAVAILABLE'

export type ApproachFinalization =
  | {
      status: 'PERSISTED' | 'ALREADY_PRESENT'
      assignmentId: string
      missionId: string
      reference: string
      distanceMeters: number
      durationSeconds: number
      polyline: string
      origin: 'PREVIOUS_MISSION_DELIVERY' | 'FALLBACK_POSITION'
      originSource: string | null
      cached: boolean
    }
  | {
      status: 'UNRESOLVED'
      assignmentId: string
      missionId: string
      reference: string
      reason: UnresolvedReason
      detail?: string
    }

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function samePlace(left: { latitude: number; longitude: number }, right: { latitude: number; longitude: number }) {
  return (
    normalizeRouteCoordinate(left.latitude) === normalizeRouteCoordinate(right.latitude) &&
    normalizeRouteCoordinate(left.longitude) === normalizeRouteCoordinate(right.longitude)
  )
}

export async function finalizeAssignmentApproach(input: {
  assignmentId: string
  /** Position utilisée quand le camion n'a pas de mission précédente. */
  fallbackOrigin?: ApproachPoint | null
  /** Recalcul explicite : ignore une approche déjà enregistrée. */
  forceRefresh?: boolean
}): Promise<ApproachFinalization> {
  const assignment = await prisma.missionAssignment.findUnique({
    where: { id: input.assignmentId },
    include: { mission: true },
  })
  if (!assignment) throw new Error('ASSIGNMENT_NOT_FOUND')
  const base = { assignmentId: assignment.id, missionId: assignment.missionId, reference: assignment.mission.reference }
  if (!assignment.truckId) return { status: 'UNRESOLVED', ...base, reason: 'MISSING_TRUCK' }
  const { pickupLat, pickupLng } = assignment.mission
  if (!finite(pickupLat) || !finite(pickupLng)) {
    return { status: 'UNRESOLVED', ...base, reason: 'MISSING_PICKUP_COORDINATES' }
  }

  // Origine : fin de la mission précédente du même camion, sinon repli.
  const previous = await prisma.missionAssignment.findFirst({
    where: {
      truckId: assignment.truckId,
      missionId: { not: assignment.missionId },
      scheduledDate: { lt: assignment.scheduledDate },
      mission: { status: { not: 'CANCELLED' } },
    },
    orderBy: [{ scheduledDate: 'desc' }, { sortOrder: 'desc' }],
    include: { mission: { select: { deliveryLat: true, deliveryLng: true } } },
  })
  const previousDelivery =
    previous && finite(previous.mission.deliveryLat) && finite(previous.mission.deliveryLng)
      ? { latitude: previous.mission.deliveryLat, longitude: previous.mission.deliveryLng }
      : null
  const fallback =
    input.fallbackOrigin && finite(input.fallbackOrigin.latitude) && finite(input.fallbackOrigin.longitude)
      ? input.fallbackOrigin
      : null
  const origin = previousDelivery ?? fallback
  if (!origin) return { status: 'UNRESOLVED', ...base, reason: 'MISSING_ORIGIN' }
  const originKind = previousDelivery ? ('PREVIOUS_MISSION_DELIVERY' as const) : ('FALLBACK_POSITION' as const)
  const originSource = previousDelivery ? 'PREVIOUS_MISSION' : (fallback?.source ?? null)

  if (
    !input.forceRefresh &&
    finite(assignment.approachDistanceMeters) &&
    finite(assignment.approachDurationSeconds) &&
    typeof assignment.approachPolyline === 'string' &&
    assignment.approachPolyline.length > 0
  ) {
    return {
      status: 'ALREADY_PRESENT', ...base,
      distanceMeters: assignment.approachDistanceMeters,
      durationSeconds: assignment.approachDurationSeconds,
      polyline: assignment.approachPolyline,
      origin: originKind, originSource, cached: true,
    }
  }

  const destination = { latitude: pickupLat, longitude: pickupLng }
  let distanceMeters = 0
  let durationSeconds = 0
  let polyline = ''
  let provider = 'DISPATCH'
  let cached = false
  if (!samePlace(origin, destination)) {
    try {
      // Cache d'abord, Google seulement si l'itinéraire n'existe pas encore ;
      // budgets, déduplication et cooldowns sont ceux de route-control.
      const route = await computeGoogleRoute({ origin, destination })
      distanceMeters = route.distanceMeters
      durationSeconds = route.durationSeconds
      polyline = route.polyline
      provider = route.provider
      cached = (route as { cached?: boolean }).cached === true
    } catch (error) {
      return {
        status: 'UNRESOLVED', ...base, reason: 'ROUTE_UNAVAILABLE',
        detail: error instanceof Error ? error.message.slice(0, 120) : 'unknown',
      }
    }
  }
  await prisma.missionAssignment.update({
    where: { id: assignment.id },
    data: {
      approachDistanceMeters: distanceMeters,
      approachDurationSeconds: durationSeconds,
      approachPolyline: polyline,
      approachCalculatedAt: new Date(),
      approachProvider: provider,
    },
  })
  return { status: 'PERSISTED', ...base, distanceMeters, durationSeconds, polyline, origin: originKind, originSource, cached }
}

export type ApproachBatchSummary = {
  persisted: number
  unresolved: number
  routeMetrics: Pick<RouteMetrics, 'lookups' | 'cacheHits' | 'cacheMisses' | 'googleCalls' | 'blockedByLimit'>
  warnings: string[]
}

const unresolvedLabels: Record<UnresolvedReason, string> = {
  MISSING_TRUCK: 'aucun camion affecté',
  MISSING_PICKUP_COORDINATES: 'coordonnées d’enlèvement manquantes',
  MISSING_ORIGIN: 'aucune position de départ connue',
  ROUTE_UNAVAILABLE: 'itinéraire indisponible pour le moment',
}

/**
 * Budget Google d'un lot : au plus un appel par affectation retenue (plafond
 * 50). `GOOGLE_ROUTES_MAX_CALLS_PER_MISSION_ROUTE=0` reste l'interrupteur
 * explicite des itinéraires demandés individuellement.
 */
export function approachBatchBudget(count: number) {
  if (configuredSingleRouteMaximum() === 0) return 0
  return Math.min(Math.max(count, 1), 50)
}

/** Finalise les approches des seules affectations retenues, dans l'ordre chronologique. */
export async function finalizeApproachesForAssignments(input: {
  missionIds: string[]
  /** Position de repli par ligne de planning (position du camion retenue par le moteur). */
  fallbackByPlanningRowId: ReadonlyMap<string, ApproachPoint>
}): Promise<ApproachBatchSummary> {
  if (!input.missionIds.length) {
    return { persisted: 0, unresolved: 0, routeMetrics: { lookups: 0, cacheHits: 0, cacheMisses: 0, googleCalls: 0, blockedByLimit: 0 }, warnings: [] }
  }
  const assignments = await prisma.missionAssignment.findMany({
    where: { missionId: { in: input.missionIds } },
    orderBy: [{ scheduledDate: 'asc' }, { sortOrder: 'asc' }],
    select: { id: true, planningRowId: true },
  })
  const warnings: string[] = []
  let persisted = 0
  let unresolved = 0
  const { metrics } = await measureRouteOperation(
    'Auto-planning approach finalization',
    async () => {
      for (const assignment of assignments) {
        const result = await finalizeAssignmentApproach({
          assignmentId: assignment.id,
          fallbackOrigin: assignment.planningRowId ? (input.fallbackByPlanningRowId.get(assignment.planningRowId) ?? null) : null,
        })
        if (result.status === 'UNRESOLVED') {
          unresolved += 1
          warnings.push(`${result.reference} : approche à calculer (${unresolvedLabels[result.reason]}).`)
          continue
        }
        persisted += 1
        if (result.origin === 'FALLBACK_POSITION' && result.originSource && /BASE/.test(result.originSource)) {
          warnings.push(`${result.reference} : approche calculée depuis la base d’exploitation (position du camion inconnue).`)
        }
      }
    },
    { maxCalls: approachBatchBudget(assignments.length) }
  )
  return {
    persisted,
    unresolved,
    routeMetrics: {
      lookups: metrics.lookups,
      cacheHits: metrics.cacheHits,
      cacheMisses: metrics.cacheMisses,
      googleCalls: metrics.googleCalls,
      blockedByLimit: metrics.blockedByLimit,
    },
    warnings,
  }
}
