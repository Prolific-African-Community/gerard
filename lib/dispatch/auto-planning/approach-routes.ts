import { computeGoogleRouteMetrics } from '../maps/google'
import { routeKey, trailerChoices } from '../optimization'
import type {
  DispatchOptimizationInput,
  RouteTransition,
} from '../optimization'
import type { TemporalLocation } from '../regulatory'

type RoutableLocation = TemporalLocation & {
  latitude: number
  longitude: number
}

type RouteProvider = typeof computeGoogleRouteMetrics

function routable(
  location: TemporalLocation | null | undefined
): location is RoutableLocation {
  return Boolean(
    location &&
      typeof location.latitude === 'number' &&
      typeof location.longitude === 'number'
  )
}

// Calibrated on the Gerard route cache: road distance is about 1.22 times the
// great-circle distance and a tractor averages close to 90 km/h door to door.
const geodesicDetourFactor = 1.22
const geodesicAverageSpeedKmh = 90

function geodesicRoute(from: RoutableLocation, to: RoutableLocation) {
  const earthRadiusMeters = 6_371_000
  const toRadians = (value: number) => (value * Math.PI) / 180
  const deltaLat = toRadians(to.latitude - from.latitude)
  const deltaLng = toRadians(to.longitude - from.longitude)
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(deltaLng / 2) ** 2
  const straightMeters =
    2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  const distanceMeters = Math.round(straightMeters * geodesicDetourFactor)
  return {
    distanceMeters,
    durationSeconds: Math.round(
      distanceMeters / ((geodesicAverageSpeedKmh * 1000) / 3600)
    ),
  }
}

function sameCoordinates(left: RoutableLocation, right: RoutableLocation) {
  return (
    Math.abs(left.latitude - right.latitude) < 0.000001 &&
    Math.abs(left.longitude - right.longitude) < 0.000001
  )
}

/**
 * Resolves the pure candidate routes before scoring. Nothing is persisted and
 * no assignment is required. Stable traffic-unaware routes keep a signed
 * simulation reproducible when apply rebuilds its snapshot.
 */
export async function prepareCandidateApproachRoutes(input: {
  pairs: DispatchOptimizationInput['pairs']
  missions: DispatchOptimizationInput['missions']
  trailers: DispatchOptimizationInput['trailers']
  existing: RouteTransition[]
  provider?: RouteProvider
}) {
  const provider = input.provider ?? computeGoogleRouteMetrics
  const transitions = [...input.existing]
  const known = new Set(transitions.map((transition) => transition.key))
  const requested = new Map<
    string,
    { from: RoutableLocation; to: RoutableLocation }
  >()

  const request = (
    from: TemporalLocation | null | undefined,
    to: TemporalLocation | null | undefined
  ) => {
    if (!routable(from) || !routable(to)) return
    const key = routeKey(from.id, to.id)
    if (known.has(key) || requested.has(key)) return
    if (sameCoordinates(from, to)) {
      transitions.push({
        key,
        from,
        to,
        distanceMeters: 0,
        durationSeconds: 0,
        source: 'DISPATCH',
        confidence: 'HIGH',
        reason: 'INITIAL_APPROACH',
        empty: true,
      })
      known.add(key)
      return
    }
    requested.set(key, { from, to })
  }

  for (const pair of input.pairs) {
    for (const mission of input.missions) {
      const pickup = mission.pickup
      for (const trailer of trailerChoices(mission, input.trailers)) {
        const pairPositions = [
          pair.initialPosition,
          ...input.missions.map((item) => item.delivery),
        ]
        const trailerPositions = trailer
          ? [
              trailer.position,
              ...(trailer.timeline?.map((item) => item.positionAfter) ?? []),
              ...input.missions.map((item) => item.delivery),
            ]
          : []
        for (const pairPosition of pairPositions) {
          const attached = Boolean(
            trailer && trailer.attachedTruckId === pair.pair.truckId
          )
          if (trailer && !attached) {
            for (const trailerPosition of trailerPositions) {
              request(pairPosition, trailerPosition)
              request(trailerPosition, pickup)
            }
          } else {
            request(pairPosition, pickup)
          }
        }
      }
    }
  }

  const jobs = Array.from(requested.entries())
  // Resolved out of order by the workers, appended in job order: the snapshot
  // fingerprint is computed over this list and has to stay reproducible
  // between the simulation and the apply that replays it.
  const resolved = new Array<RouteTransition | null>(jobs.length).fill(null)
  let cursor = 0
  const workers = Array.from(
    { length: Math.min(2, jobs.length) },
    async () => {
      while (cursor < jobs.length) {
        const index = cursor++
        const [key, endpoints] = jobs[index]
        try {
          const route = await provider({
            origin: {
              latitude: endpoints.from.latitude,
              longitude: endpoints.from.longitude,
            },
            destination: {
              latitude: endpoints.to.latitude,
              longitude: endpoints.to.longitude,
            },
            routingPreference: 'TRAFFIC_UNAWARE',
          })
          resolved[index] = {
            key,
            from: endpoints.from,
            to: endpoints.to,
            distanceMeters: route.distanceMeters,
            durationSeconds: route.durationSeconds,
            source: route.provider,
            confidence: 'HIGH',
            reason: 'INITIAL_APPROACH',
            empty: true,
          }
        } catch {
          // No provider answer (quota, cooldown, call budget): fall back to a
          // geodesic estimate rather than dropping the transition. A missing
          // transition makes the candidate unplannable through MISSING_ROUTE,
          // whereas an estimate only downgrades it to a conditional proposal.
          const estimate = geodesicRoute(endpoints.from, endpoints.to)
          resolved[index] = {
            key,
            from: endpoints.from,
            to: endpoints.to,
            distanceMeters: estimate.distanceMeters,
            durationSeconds: estimate.durationSeconds,
            source: 'ESTIMATED',
            confidence: 'LOW',
            reason: 'INITIAL_APPROACH',
            empty: true,
          }
        }
      }
    }
  )
  await Promise.all(workers)
  for (const transition of resolved) {
    if (transition) transitions.push(transition)
  }
  return transitions
}
