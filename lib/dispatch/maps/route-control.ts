import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma'

export type RoutePoint = { latitude: number; longitude: number }
export type RouteRequest = {
  origin: RoutePoint
  destination: RoutePoint
  waypoints?: RoutePoint[]
  travelMode?: 'DRIVE'
  routingPreference?: 'TRAFFIC_AWARE' | 'TRAFFIC_UNAWARE'
}
export type CachedRoute = {
  distanceMeters: number
  durationSeconds: number
  polyline: string | null
  provider: 'GOOGLE_ROUTES'
}
export type RouteMetrics = {
  operation: string
  lookups: number
  uniqueLookups: number
  cacheHits: number
  cacheMisses: number
  googleCalls: number
  deduplicated: number
  blockedByLimit: number
}

type StoredRoute = CachedRoute & { fingerprint: string }
export type RouteCacheStore = {
  find(fingerprint: string): Promise<StoredRoute | null>
  save(fingerprint: string, request: Required<RouteRequest>, route: CachedRoute): Promise<void>
  findFailure?(fingerprint: string): Promise<{ errorCode: string; retryAfter: Date } | null>
  saveFailure?(fingerprint: string, errorCode: string, retryAfter: Date): Promise<void>
  clearFailure?(fingerprint: string): Promise<void>
}

const coordinatePrecision = 5
const providerFailureKey = 'provider:GOOGLE_ROUTES'
const inFlight = new Map<string, Promise<CachedRoute>>()
const operationStorage = new AsyncLocalStorage<{
  metrics: RouteMetrics
  maxCalls: number
  fingerprints: Set<string>
  cacheResults: Map<string, StoredRoute | null>
  providerChecked: boolean
  providerUnavailable: boolean
}>()

function configuredMaximum() {
  const parsed = Number.parseInt(process.env.GOOGLE_ROUTES_MAX_CALLS_PER_OPERATION ?? '10', 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 10
}

export function normalizeRouteCoordinate(value: number) {
  if (!Number.isFinite(value)) throw new Error('ROUTE_COORDINATE_INVALID')
  return Number(value.toFixed(coordinatePrecision))
}

export function normalizeRouteRequest(input: RouteRequest): Required<RouteRequest> {
  const point = (value: RoutePoint) => ({
    latitude: normalizeRouteCoordinate(value.latitude),
    longitude: normalizeRouteCoordinate(value.longitude),
  })
  return {
    origin: point(input.origin),
    destination: point(input.destination),
    waypoints: (input.waypoints ?? []).map(point),
    travelMode: input.travelMode ?? 'DRIVE',
    routingPreference: input.routingPreference ?? 'TRAFFIC_AWARE',
  }
}

export function routeFingerprint(input: RouteRequest) {
  return createHash('sha256')
    .update(JSON.stringify(normalizeRouteRequest(input)))
    .digest('hex')
}

const prismaStore: RouteCacheStore = {
  async find(fingerprint) {
    const cached = await prisma.routeCache.findUnique({ where: { fingerprint } })
    return cached ? {
      fingerprint: cached.fingerprint,
      distanceMeters: cached.distanceMeters,
      durationSeconds: cached.durationSeconds,
      polyline: cached.polyline,
      provider: 'GOOGLE_ROUTES',
    } : null
  },
  async save(fingerprint, request, route) {
    await prisma.routeCache.upsert({
      where: { fingerprint },
      create: {
        fingerprint,
        originLat: request.origin.latitude,
        originLng: request.origin.longitude,
        destinationLat: request.destination.latitude,
        destinationLng: request.destination.longitude,
        waypoints: request.waypoints as Prisma.InputJsonValue,
        travelMode: request.travelMode,
        routingPreference: request.routingPreference,
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        polyline: route.polyline,
        provider: route.provider,
      },
      update: {
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        polyline: route.polyline,
        provider: route.provider,
      },
    })
  },
  async findFailure(fingerprint) {
    return prisma.routeFailureCache.findUnique({
      where: { fingerprint },
      select: { errorCode: true, retryAfter: true },
    })
  },
  async saveFailure(fingerprint, errorCode, retryAfter) {
    await prisma.routeFailureCache.upsert({
      where: { fingerprint },
      create: { fingerprint, errorCode, retryAfter },
      update: { errorCode, retryAfter },
    })
  },
  async clearFailure(fingerprint) {
    await prisma.routeFailureCache.deleteMany({ where: { fingerprint } })
  },
}

function freshMetrics(operation: string): RouteMetrics {
  return { operation, lookups: 0, uniqueLookups: 0, cacheHits: 0, cacheMisses: 0, googleCalls: 0, deduplicated: 0, blockedByLimit: 0 }
}

export async function measureRouteOperation<T>(operation: string, task: () => Promise<T>, options: { maxCalls?: number; log?: boolean } = {}) {
  const active = operationStorage.getStore()
  if (active) return { result: await task(), metrics: active.metrics }
  const state = {
    metrics: freshMetrics(operation),
    maxCalls: options.maxCalls ?? configuredMaximum(),
    fingerprints: new Set<string>(),
    cacheResults: new Map<string, StoredRoute | null>(),
    providerChecked: false,
    providerUnavailable: false,
  }
  const result = await operationStorage.run(state, task)
  if (options.log !== false) {
    const value = state.metrics
    console.info(`[Routes] ${value.operation}: lookups=${value.lookups} unique=${value.uniqueLookups} hits=${value.cacheHits} misses=${value.cacheMisses} googleCalls=${value.googleCalls} deduplicated=${value.deduplicated} blocked=${value.blockedByLimit}`)
  }
  return { result, metrics: { ...state.metrics } }
}

export async function withRouteOperation<T>(operation: string, task: () => Promise<T>) {
  return (await measureRouteOperation(operation, task)).result
}

export async function getOrComputeRoute(
  input: RouteRequest,
  options: {
    provider: (request: Required<RouteRequest>) => Promise<CachedRoute>
    store?: RouteCacheStore
    allowMetricsOnly?: boolean
  }
) {
  const normalized = normalizeRouteRequest(input)
  const fingerprint = routeFingerprint(normalized)
  const store = options.store ?? prismaStore
  const state = operationStorage.getStore()
  if (state) {
    state.metrics.lookups += 1
    if (!state.fingerprints.has(fingerprint)) {
      state.fingerprints.add(fingerprint)
      state.metrics.uniqueLookups += 1
    }
  }

  const cached = state?.cacheResults.has(fingerprint)
    ? state.cacheResults.get(fingerprint) ?? null
    : await store.find(fingerprint)
  if (state && !state.cacheResults.has(fingerprint)) state.cacheResults.set(fingerprint, cached)
  if (cached && (options.allowMetricsOnly || cached.polyline)) {
    if (state) state.metrics.cacheHits += 1
    return { ...cached, fingerprint, cached: true as const }
  }
  if (state) state.metrics.cacheMisses += 1

  if (state?.providerUnavailable) {
    state.metrics.blockedByLimit += 1
    throw new Error('GOOGLE_ROUTES_PROVIDER_COOLDOWN:OPERATION')
  }

  const providerFailure = !state || !state.providerChecked
    ? await store.findFailure?.(providerFailureKey)
    : null
  if (state) state.providerChecked = true
  if (providerFailure && providerFailure.retryAfter > new Date()) {
    if (state) {
      state.providerUnavailable = true
      state.metrics.blockedByLimit += 1
    }
    throw new Error(`GOOGLE_ROUTES_PROVIDER_COOLDOWN:${providerFailure.errorCode}`)
  }
  if (providerFailure) await store.clearFailure?.(providerFailureKey)
  const previousFailure = await store.findFailure?.(fingerprint)
  if (previousFailure && previousFailure.retryAfter > new Date()) {
    if (state) state.metrics.blockedByLimit += 1
    throw new Error(`GOOGLE_ROUTES_PROVIDER_COOLDOWN:${previousFailure.errorCode}`)
  }
  if (previousFailure) await store.clearFailure?.(fingerprint)

  const pending = inFlight.get(fingerprint)
  if (pending) {
    if (state) {
      state.metrics.cacheHits += 1
      state.metrics.deduplicated += 1
    }
    return { ...(await pending), fingerprint, cached: true as const }
  }
  if (state && (state.providerUnavailable || state.metrics.googleCalls >= state.maxCalls)) {
    state.metrics.blockedByLimit += 1
    throw new Error('GOOGLE_ROUTES_OPERATION_LIMIT')
  }
  if (state) state.metrics.googleCalls += 1

  const job = options.provider(normalized)
    .then(async (route) => {
      await store.save(fingerprint, normalized, route)
      await store.clearFailure?.(fingerprint)
      if (state) state.cacheResults.set(fingerprint, { fingerprint, ...route })
      return route
    })
    .catch(async (error) => {
      const transient = error instanceof Error && (
        error.name === 'AbortError' ||
        /GOOGLE_ROUTES_FAILED:(429|5\d\d)/.test(error.message)
      )
      if (transient) {
        if (state) state.providerUnavailable = true
        const code = error instanceof Error ? error.name === 'AbortError' ? 'TIMEOUT' : error.message : 'PROVIDER_UNAVAILABLE'
        const cooldownMs = /429/.test(code) ? 15 * 60_000 : 2 * 60_000
        const retryAfter = new Date(Date.now() + cooldownMs)
        await Promise.all([
          store.saveFailure?.(fingerprint, code, retryAfter),
          store.saveFailure?.(providerFailureKey, code, retryAfter),
        ])
      }
      throw error
    })
  inFlight.set(fingerprint, job)
  try {
    return { ...(await job), fingerprint, cached: false as const }
  } finally {
    inFlight.delete(fingerprint)
  }
}

export const routeCacheCoordinatePrecision = coordinatePrecision
