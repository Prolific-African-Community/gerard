import assert from 'node:assert/strict'
import {
  getOrComputeRoute,
  measureRouteOperation,
  normalizeRouteCoordinate,
  routeFingerprint,
  type CachedRoute,
  type RouteCacheStore,
} from '../lib/dispatch/maps/route-control'

function storeFixture(): RouteCacheStore & { values: Map<string, CachedRoute> } {
  const values = new Map<string, CachedRoute>()
  const failures = new Map<string, { errorCode: string; retryAfter: Date }>()
  return {
    values,
    async find(fingerprint) {
      const value = values.get(fingerprint)
      return value ? { fingerprint, ...value } : null
    },
    async save(fingerprint, _request, route) { values.set(fingerprint, route) },
    async findFailure(fingerprint) { return failures.get(fingerprint) ?? null },
    async saveFailure(fingerprint, errorCode, retryAfter) { failures.set(fingerprint, { errorCode, retryAfter }) },
    async clearFailure(fingerprint) { failures.delete(fingerprint) },
  }
}

const base = {
  origin: { latitude: 49.611621, longitude: 6.131935 },
  destination: { latitude: 50.850346, longitude: 4.351721 },
  routingPreference: 'TRAFFIC_UNAWARE' as const,
}
const route: CachedRoute = { distanceMeters: 210000, durationSeconds: 8000, polyline: 'encoded', provider: 'GOOGLE_ROUTES' }

async function main() {
  const store = storeFixture()
  let calls = 0
  const provider = async () => { calls += 1; return route }
  const first = await measureRouteOperation('A first', () => getOrComputeRoute(base, { store, provider }), { log: false })
  assert.equal(first.metrics.googleCalls, 1)
  assert.equal(calls, 1)
  const second = await measureRouteOperation('B second', () => getOrComputeRoute(base, { store, provider }), { log: false })
  assert.equal(second.metrics.googleCalls, 0)
  assert.equal(second.metrics.cacheHits, 1)

  assert.equal(normalizeRouteCoordinate(49.611621), normalizeRouteCoordinate(49.611622))
  const equivalent = await measureRouteOperation('C normalized', () => getOrComputeRoute({ ...base, origin: { latitude: 49.611622, longitude: 6.1319351 } }, { store, provider }), { log: false })
  assert.equal(equivalent.metrics.googleCalls, 0)

  await getOrComputeRoute({ ...base, destination: { latitude: 50.9, longitude: 4.35 } }, { store, provider })
  assert.equal(calls, 2)
  await getOrComputeRoute({ ...base, waypoints: [{ latitude: 50.1, longitude: 5.2 }] }, { store, provider })
  assert.equal(calls, 3)
  assert.notEqual(routeFingerprint(base), routeFingerprint({ ...base, waypoints: [{ latitude: 50.1, longitude: 5.2 }] }))

  const crossOperationStore = storeFixture()
  let sharedCalls = 0
  const sharedProvider = async () => { sharedCalls += 1; return route }
  const analyze1 = await measureRouteOperation('F analyze pass 1', () => getOrComputeRoute(base, { store: crossOperationStore, provider: sharedProvider }), { log: false })
  const analyze2 = await measureRouteOperation('F analyze pass 2', () => getOrComputeRoute(base, { store: crossOperationStore, provider: sharedProvider }), { log: false })
  const simulate = await measureRouteOperation('G simulate', () => getOrComputeRoute(base, { store: crossOperationStore, provider: sharedProvider }), { log: false })
  const assistant = await measureRouteOperation('H assistant', () => getOrComputeRoute(base, { store: crossOperationStore, provider: sharedProvider }), { log: false })
  assert.equal(analyze1.metrics.googleCalls, 1)
  assert.equal(analyze2.metrics.googleCalls, 0)
  assert.equal(simulate.metrics.googleCalls, 0)
  assert.equal(assistant.metrics.googleCalls, 0)

  const concurrentStore = storeFixture()
  let concurrentCalls = 0
  const slowProvider = async () => { concurrentCalls += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return route }
  const concurrent = await measureRouteOperation('I concurrent', () => Promise.all([
    getOrComputeRoute(base, { store: concurrentStore, provider: slowProvider }),
    getOrComputeRoute(base, { store: concurrentStore, provider: slowProvider }),
  ]), { log: false })
  assert.equal(concurrentCalls, 1)
  assert.equal(concurrent.metrics.deduplicated, 1)

  const limitedStore = storeFixture()
  const limited = await measureRouteOperation('J limit', async () => {
    await getOrComputeRoute(base, { store: limitedStore, provider })
    await assert.rejects(() => getOrComputeRoute({ ...base, destination: { latitude: 51, longitude: 5 } }, { store: limitedStore, provider }), /GOOGLE_ROUTES_OPERATION_LIMIT/)
  }, { maxCalls: 1, log: false })
  assert.equal(limited.metrics.blockedByLimit, 1)

  const fallbackStore = storeFixture()
  await getOrComputeRoute(base, { store: fallbackStore, provider: async () => route })
  const unavailable = async () => { throw new Error('GOOGLE_ROUTES_FAILED:429') }
  const cached429 = await getOrComputeRoute(base, { store: fallbackStore, provider: unavailable })
  assert.equal(cached429.distanceMeters, route.distanceMeters)
  const timeout = async () => { throw new DOMException('Aborted', 'AbortError') }
  const cachedTimeout = await getOrComputeRoute(base, { store: fallbackStore, provider: timeout })
  assert.equal(cachedTimeout.durationSeconds, route.durationSeconds)

  const emptyStore = storeFixture()
  await assert.rejects(() => getOrComputeRoute(base, { store: emptyStore, provider: unavailable }), /429/)
  assert.equal(emptyStore.values.size, 0)
  let retryCalls = 0
  const retry = await measureRouteOperation('M provider cooldown', async () => {
    await assert.rejects(() => getOrComputeRoute(base, { store: emptyStore, provider: async () => { retryCalls += 1; return route } }), /PROVIDER_COOLDOWN/)
  }, { log: false })
  assert.equal(retry.metrics.googleCalls, 0)
  assert.equal(retryCalls, 0)
  console.log('A-M route cache, normalisation, déduplication, limites et résilience: OK')
}

main()
