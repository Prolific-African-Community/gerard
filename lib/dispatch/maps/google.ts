import { supportedRegionCodes } from './europe-coverage'
import type { SupportedCountryCode } from './europe-coverage'
import { getOrComputeRoute, withRouteOperation, type RouteRequest } from './route-control'

export type AddressCandidate = {
  placeId: string
  formattedAddress: string
  latitude: number
  longitude: number
}

export type CalculatedRoute = {
  distanceMeters: number
  durationSeconds: number
  polyline: string
  provider: 'GOOGLE_ROUTES'
}

type GoogleAutocompleteResponse = {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string
      text?: { text?: string }
    }
  }>
}

type GooglePlaceDetailsResponse = {
  id?: string
  formattedAddress?: string
  location?: { latitude?: number; longitude?: number }
}

type GoogleRoutesResponse = {
  routes?: Array<{
    duration?: string
    distanceMeters?: number
    polyline?: { encodedPolyline?: string }
  }>
}

function apiKey() {
  const value = process.env.GOOGLE_MAPS_API_KEY?.trim()
  if (!value) throw new Error('GOOGLE_MAPS_API_KEY_MISSING')
  return value
}

async function googleJson<T>(response: Response, code: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`${code}:${response.status}`)
  }
  return (await response.json()) as T
}

export async function getGooglePlaceDetails(
  placeId: string
): Promise<AddressCandidate> {
  const normalizedPlaceId = placeId.trim().replace(/^places\//, '')
  const data = await googleJson<GooglePlaceDetailsResponse>(
    await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(
        normalizedPlaceId
      )}`,
      {
        headers: {
          'X-Goog-Api-Key': apiKey(),
          'X-Goog-FieldMask': 'id,formattedAddress,location',
        },
      }
    ),
    'GOOGLE_PLACE_DETAILS_FAILED'
  )
  const latitude = data.location?.latitude
  const longitude = data.location?.longitude
  if (
    !data.id ||
    !data.formattedAddress ||
    typeof latitude !== 'number' ||
    typeof longitude !== 'number'
  ) {
    throw new Error('GOOGLE_PLACE_DETAILS_INVALID')
  }
  return {
    placeId: data.id,
    formattedAddress: data.formattedAddress,
    latitude,
    longitude,
  }
}

export async function searchGoogleAddresses(
  query: string,
  maximumResults = 5,
  options: { country?: SupportedCountryCode | null } = {}
): Promise<AddressCandidate[]> {
  // La liste couvre les douze pays européens desservis. Lorsqu'un pays est
  // détecté dans l'adresse, on restreint à ce pays pour lever l'ambiguïté
  // entre villes homonymes (Valence FR / Valencia ES, Naples IT / FR…).
  const regionCodes = options.country
    ? [options.country.toLowerCase()]
    : supportedRegionCodes
  const data = await googleJson<GoogleAutocompleteResponse>(
    await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey(),
        'X-Goog-FieldMask':
          'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text',
      },
      body: JSON.stringify({
        input: query.trim(),
        languageCode: 'fr',
        includedRegionCodes: regionCodes,
      }),
    }),
    'GOOGLE_PLACES_FAILED'
  )
  const placeIds = (data.suggestions ?? [])
    .map((item) => item.placePrediction?.placeId)
    .filter((value): value is string => Boolean(value))
    .slice(0, maximumResults)
  return Promise.all(placeIds.map(getGooglePlaceDetails))
}

async function requestGoogleRoute(input: Required<RouteRequest>): Promise<CalculatedRoute> {
  const data = await googleJson<GoogleRoutesResponse>(
    await fetch(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',
        signal: AbortSignal.timeout(8000),
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey(),
          'X-Goog-FieldMask':
            'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
        },
        body: JSON.stringify({
          origin: {
            location: {
              latLng: {
                latitude: input.origin.latitude,
                longitude: input.origin.longitude,
              },
            },
          },
          destination: {
            location: {
              latLng: {
                latitude: input.destination.latitude,
                longitude: input.destination.longitude,
              },
            },
          },
          ...(input.waypoints.length ? { intermediates: input.waypoints.map((waypoint) => ({
            location: { latLng: waypoint },
          })) } : {}),
          travelMode: input.travelMode,
          routingPreference: input.routingPreference,
          computeAlternativeRoutes: false,
          languageCode: 'fr-FR',
          units: 'METRIC',
        }),
      }
    ),
    'GOOGLE_ROUTES_FAILED'
  )
  const route = data.routes?.[0]
  const distanceMeters = route?.distanceMeters
  const durationSeconds = route?.duration
    ? Math.round(Number.parseFloat(route.duration.replace('s', '')))
    : null
  const polyline = route?.polyline?.encodedPolyline
  if (
    typeof distanceMeters !== 'number' ||
    typeof durationSeconds !== 'number' ||
    durationSeconds <= 0 ||
    !Number.isFinite(durationSeconds) ||
    typeof polyline !== 'string' ||
    polyline.length === 0
  ) {
    throw new Error('GOOGLE_ROUTES_INVALID')
  }
  return {
    distanceMeters,
    durationSeconds,
    polyline,
    provider: 'GOOGLE_ROUTES',
  }
}

/**
 * Unique entry point for Google Routes. Coordinates are normalized to five
 * decimals (roughly one metre), persisted by fingerprint and deduplicated
 * while an identical provider request is in flight.
 */
export async function computeGoogleRoute(input: RouteRequest): Promise<CalculatedRoute> {
  const route = await withRouteOperation('Google route request', () =>
    getOrComputeRoute(input, { provider: requestGoogleRoute })
  )
  if (!route.polyline) throw new Error('GOOGLE_ROUTES_GEOMETRY_MISSING')
  return { ...route, polyline: route.polyline }
}

/**
 * Route lookup for deterministic dispatch calculations that consume only
 * distance and duration. This may reuse a legacy cache entry without encoded
 * geometry; map rendering continues to use computeGoogleRoute above.
 */
export async function computeGoogleRouteMetrics(input: RouteRequest): Promise<CalculatedRoute> {
  const route = await withRouteOperation('Google route metrics request', () =>
    getOrComputeRoute(input, { provider: requestGoogleRoute, allowMetricsOnly: true })
  )
  return { ...route, polyline: route.polyline ?? '' }
}
