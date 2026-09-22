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
        const trailerChange = Boolean(
          trailer && trailer.attachedTruckId !== pair.pair.truckId
        )
        if (trailerChange) {
          request(pair.initialPosition, trailer?.position)
          request(trailer?.position, pickup)
        } else {
          request(pair.initialPosition, pickup)
        }
      }
    }
  }

  const jobs = Array.from(requested.entries())
  let cursor = 0
  const workers = Array.from(
    { length: Math.min(2, jobs.length) },
    async () => {
      while (cursor < jobs.length) {
        const [key, endpoints] = jobs[cursor++]
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
          transitions.push({
            key,
            from: endpoints.from,
            to: endpoints.to,
            distanceMeters: route.distanceMeters,
            durationSeconds: route.durationSeconds,
            source: route.provider,
            confidence: 'HIGH',
            reason: 'INITIAL_APPROACH',
            empty: true,
          })
        } catch {
          // The candidate remains explicitely indeterminate through
          // MISSING_ROUTE; one provider failure must not abort the snapshot.
        }
      }
    }
  )
  await Promise.all(workers)
  return transitions
}
