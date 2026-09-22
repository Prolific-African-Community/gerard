import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import {
  normalizeRouteRequest,
  routeFingerprint,
  type RouteRequest,
} from '../lib/dispatch/maps/route-control'

type IgnoreReason =
  | 'NOT_GOOGLE_ROUTES'
  | 'MISSING_ENDPOINTS'
  | 'MISSING_METRICS'
  | 'NO_PREDECESSOR_ROUTE'
  | 'TRAILER_WAYPOINT_UNKNOWN'
  | 'RETURN_ORIGIN_UNKNOWN'
  | 'DUPLICATE_FINGERPRINT'

type BackfillReport = {
  inspected: number
  eligible: number
  created: number
  existing: number
  ignored: Record<IgnoreReason, number>
}

type KnownRoute = {
  request: RouteRequest
  distanceMeters: number
  durationSeconds: number
  polyline: string | null
  provider: string
}

function emptyIgnored(): Record<IgnoreReason, number> {
  return {
    NOT_GOOGLE_ROUTES: 0,
    MISSING_ENDPOINTS: 0,
    MISSING_METRICS: 0,
    NO_PREDECESSOR_ROUTE: 0,
    TRAILER_WAYPOINT_UNKNOWN: 0,
    RETURN_ORIGIN_UNKNOWN: 0,
    DUPLICATE_FINGERPRINT: 0,
  }
}

function completeMetrics(value: { distanceMeters: number | null; durationSeconds: number | null }) {
  return value.distanceMeters !== null && value.durationSeconds !== null && value.durationSeconds > 0
}

export async function backfillRouteCache(): Promise<BackfillReport> {
  const [missions, assignments, trucks] = await Promise.all([
    prisma.mission.findMany({
      select: {
        pickupLat: true,
        pickupLng: true,
        deliveryLat: true,
        deliveryLng: true,
        routeDistanceMeters: true,
        routeDurationSeconds: true,
        routePolyline: true,
        routeProvider: true,
      },
    }),
    prisma.missionAssignment.findMany({
      orderBy: [{ planningRowId: 'asc' }, { scheduledDate: 'asc' }, { id: 'asc' }],
      select: {
        planningRowId: true,
        scheduledDate: true,
        plannedEndAt: true,
        trailerChangePlanned: true,
        approachDistanceMeters: true,
        approachDurationSeconds: true,
        approachPolyline: true,
        approachProvider: true,
        mission: {
          select: {
            pickupLat: true,
            pickupLng: true,
            deliveryLat: true,
            deliveryLng: true,
            deliveryDate: true,
          },
        },
      },
    }),
    prisma.truck.findMany({
      select: {
        returnToBaseDistanceMeters: true,
        returnToBaseDurationSeconds: true,
        returnToBasePolyline: true,
        returnToBaseProvider: true,
      },
    }),
  ])

  const ignored = emptyIgnored()
  const candidates: KnownRoute[] = []

  for (const mission of missions) {
    if (mission.routeProvider !== 'GOOGLE_ROUTES') {
      ignored.NOT_GOOGLE_ROUTES += 1
      continue
    }
    if ([mission.pickupLat, mission.pickupLng, mission.deliveryLat, mission.deliveryLng].some((value) => value === null)) {
      ignored.MISSING_ENDPOINTS += 1
      continue
    }
    if (!completeMetrics({ distanceMeters: mission.routeDistanceMeters, durationSeconds: mission.routeDurationSeconds })) {
      ignored.MISSING_METRICS += 1
      continue
    }
    candidates.push({
      request: {
        origin: { latitude: mission.pickupLat!, longitude: mission.pickupLng! },
        destination: { latitude: mission.deliveryLat!, longitude: mission.deliveryLng! },
        routingPreference: 'TRAFFIC_AWARE',
      },
      distanceMeters: mission.routeDistanceMeters!,
      durationSeconds: mission.routeDurationSeconds!,
      polyline: mission.routePolyline,
      provider: mission.routeProvider,
    })
  }

  const previousByRow = new Map<string, (typeof assignments)[number]>()
  for (const assignment of assignments) {
    if (!assignment.planningRowId) {
      ignored.NO_PREDECESSOR_ROUTE += 1
      continue
    }
    const previous = previousByRow.get(assignment.planningRowId)
    previousByRow.set(assignment.planningRowId, assignment)
    if (assignment.approachProvider !== 'GOOGLE_ROUTES') {
      ignored.NOT_GOOGLE_ROUTES += 1
      continue
    }
    const previousEndsAt = previous?.plannedEndAt ?? previous?.mission.deliveryDate
    if (!previous || !previousEndsAt || previousEndsAt > assignment.scheduledDate || assignment.approachDistanceMeters === 0) {
      ignored.NO_PREDECESSOR_ROUTE += 1
      continue
    }
    if (assignment.trailerChangePlanned) {
      ignored.TRAILER_WAYPOINT_UNKNOWN += 1
      continue
    }
    const endpointValues = [
      previous.mission.deliveryLat,
      previous.mission.deliveryLng,
      assignment.mission.pickupLat,
      assignment.mission.pickupLng,
    ]
    if (endpointValues.some((value) => value === null)) {
      ignored.MISSING_ENDPOINTS += 1
      continue
    }
    if (!completeMetrics({ distanceMeters: assignment.approachDistanceMeters, durationSeconds: assignment.approachDurationSeconds })) {
      ignored.MISSING_METRICS += 1
      continue
    }
    candidates.push({
      request: {
        origin: { latitude: previous.mission.deliveryLat!, longitude: previous.mission.deliveryLng! },
        destination: { latitude: assignment.mission.pickupLat!, longitude: assignment.mission.pickupLng! },
        routingPreference: 'TRAFFIC_UNAWARE',
      },
      distanceMeters: assignment.approachDistanceMeters!,
      durationSeconds: assignment.approachDurationSeconds!,
      polyline: assignment.approachPolyline,
      provider: assignment.approachProvider,
    })
  }

  for (const truck of trucks) {
    if (truck.returnToBaseProvider !== 'GOOGLE_ROUTES') {
      ignored.NOT_GOOGLE_ROUTES += 1
    } else {
      ignored.RETURN_ORIGIN_UNKNOWN += 1
    }
  }

  const unique = new Map<string, KnownRoute>()
  for (const candidate of candidates) {
    const fingerprint = routeFingerprint(candidate.request)
    if (unique.has(fingerprint)) {
      ignored.DUPLICATE_FINGERPRINT += 1
      continue
    }
    unique.set(fingerprint, candidate)
  }

  const fingerprints = Array.from(unique.keys())
  const existing = await prisma.routeCache.findMany({
    where: { fingerprint: { in: fingerprints } },
    select: { fingerprint: true },
  })
  const existingFingerprints = new Set(existing.map(({ fingerprint }) => fingerprint))
  const toCreate = Array.from(unique.entries()).filter(([fingerprint]) => !existingFingerprints.has(fingerprint))

  if (toCreate.length > 0) {
    await prisma.routeCache.createMany({
      data: toCreate.map(([fingerprint, candidate]) => {
        const request = normalizeRouteRequest(candidate.request)
        return {
          fingerprint,
          originLat: request.origin.latitude,
          originLng: request.origin.longitude,
          destinationLat: request.destination.latitude,
          destinationLng: request.destination.longitude,
          waypoints: request.waypoints as Prisma.InputJsonValue,
          travelMode: request.travelMode,
          routingPreference: request.routingPreference,
          distanceMeters: candidate.distanceMeters,
          durationSeconds: candidate.durationSeconds,
          polyline: candidate.polyline,
          provider: candidate.provider,
        }
      }),
      skipDuplicates: true,
    })
  }

  return {
    inspected: missions.length + assignments.length + trucks.length,
    eligible: unique.size,
    created: toCreate.length,
    existing: existing.length,
    ignored,
  }
}

backfillRouteCache()
  .then((report) => console.log(JSON.stringify(report, null, 2)))
  .finally(() => prisma.$disconnect())
