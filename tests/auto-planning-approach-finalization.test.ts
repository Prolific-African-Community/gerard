// Finalisation automatique des approches après « Planifier automatiquement ».
// Base en mémoire et Google simulé : aucune donnée n'est lue ni écrite, aucun
// appel payant. On vérifie l'origine (chaîne de missions), le cache d'abord,
// l'absence d'appel pour les candidats écartés et l'absence de fausse précision.

import assert from 'node:assert/strict'

process.env.GOOGLE_MAPS_API_KEY = 'test-key'
delete process.env.GOOGLE_ROUTES_MAX_CALLS_PER_MISSION_ROUTE

import { prisma } from '../lib/prisma'
import {
  approachBatchBudget,
  finalizeApproachesForAssignments,
  finalizeAssignmentApproach,
} from '../lib/dispatch/approach-finalization'
import { routeFingerprint } from '../lib/dispatch/maps/route-control'

type Row = Record<string, any>
const day = (n: number, hour = 8) => new Date(Date.UTC(2030, 8, 16 + n, hour))

const place = {
  truckStart: { latitude: 49.5, longitude: 6.0, source: 'DRIVER_GPS' },
  pickupA: { latitude: 49.1, longitude: 6.2 }, deliveryA: { latitude: 48.6, longitude: 7.7 },
  pickupB: { latitude: 48.9, longitude: 2.3 }, deliveryB: { latitude: 45.7, longitude: 4.8 },
  pickupC: { latitude: 43.3, longitude: 5.4 }, deliveryC: { latitude: 43.7, longitude: 7.2 },
}

function assignment(id: string, truckId: string, scheduled: Date, sortOrder: number, pickup: any, delivery: any, extra: Row = {}): Row {
  return {
    id, missionId: `m-${id}`, truckId, planningRowId: 'row-1', scheduledDate: scheduled, sortOrder,
    approachDistanceMeters: null, approachDurationSeconds: null, approachPolyline: null, approachCalculatedAt: null, approachProvider: null,
    mission: { id: `m-${id}`, reference: `QA-${id}`, status: 'ASSIGNED', pickupLat: pickup?.latitude ?? null, pickupLng: pickup?.longitude ?? null, deliveryLat: delivery.latitude, deliveryLng: delivery.longitude },
    ...extra,
  }
}

let rows: Row[] = []
const updates: Row[] = []
const routeStore = new Map<string, any>()
const googleRequests: Array<{ origin: any; destination: any }> = []
let googleStatus = 200
const realFetch = globalThis.fetch
globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body))
  googleRequests.push({ origin: body.origin.location.latLng, destination: body.destination.location.latLng })
  if (googleStatus !== 200) return new Response('error', { status: googleStatus })
  return new Response(JSON.stringify({ routes: [{ duration: '3600s', distanceMeters: 100_000 + googleRequests.length, polyline: { encodedPolyline: `poly${googleRequests.length}` } }] }), { status: 200 })
}) as typeof fetch

const p: any = prisma
p.missionAssignment = {
  findUnique: async ({ where }: any) => rows.find((row) => row.id === where.id) ?? null,
  findFirst: async ({ where }: any) =>
    rows
      .filter((row) => row.truckId === where.truckId && row.missionId !== where.missionId.not && row.scheduledDate < where.scheduledDate.lt && row.mission.status !== 'CANCELLED')
      .sort((a, b) => b.scheduledDate - a.scheduledDate || b.sortOrder - a.sortOrder)[0] ?? null,
  findMany: async ({ where }: any) =>
    rows.filter((row) => where.missionId.in.includes(row.missionId)).sort((a, b) => a.scheduledDate - b.scheduledDate || a.sortOrder - b.sortOrder).map((row) => ({ id: row.id, planningRowId: row.planningRowId })),
  update: async ({ where, data }: any) => {
    const row = rows.find((item) => item.id === where.id)!
    Object.assign(row, data); updates.push({ id: where.id, ...data }); return row
  },
}
p.routeCache = {
  findUnique: async ({ where }: any) => routeStore.get(where.fingerprint) ?? null,
  upsert: async ({ where, create }: any) => { routeStore.set(where.fingerprint, create); return create },
}
p.routeFailureCache = { findUnique: async () => null, upsert: async () => null, deleteMany: async () => null }

function reset(initial: Row[]) {
  rows = initial; updates.length = 0; googleRequests.length = 0; googleStatus = 200; routeStore.clear()
}
const ok = (label: string) => console.log(`${label}: OK`)
const fallbackMap = new Map([['row-1', place.truckStart]])

async function main() {
  // A — une mission affectée automatiquement : approche enregistrée.
  reset([assignment('a1', 'truck-1', day(0), 0, place.pickupA, place.deliveryA)])
  const single = await finalizeApproachesForAssignments({ missionIds: ['m-a1'], fallbackByPlanningRowId: fallbackMap })
  assert.equal(single.persisted, 1); assert.equal(single.unresolved, 0)
  const a1 = rows[0]
  assert.equal(typeof a1.approachDistanceMeters, 'number'); assert.ok(a1.approachDistanceMeters > 0)
  assert.equal(typeof a1.approachDurationSeconds, 'number'); assert.ok(a1.approachDurationSeconds > 0)
  assert.ok(a1.approachPolyline.length > 0); assert.equal(a1.approachProvider, 'GOOGLE_ROUTES'); assert.ok(a1.approachCalculatedAt instanceof Date)
  assert.deepEqual(googleRequests, [{ origin: { latitude: 49.5, longitude: 6.0 }, destination: { latitude: 49.1, longitude: 6.2 } }])
  ok('A Approche persistée à l’affectation (distance, durée, tracé, fournisseur, date)')

  // B — missions chaînées : camion → A, fin de A → B, fin de B → C.
  reset([
    assignment('b1', 'truck-1', day(0), 0, place.pickupA, place.deliveryA),
    assignment('b2', 'truck-1', day(1), 0, place.pickupB, place.deliveryB),
    assignment('b3', 'truck-1', day(2), 0, place.pickupC, place.deliveryC),
  ])
  const chain = await finalizeApproachesForAssignments({ missionIds: ['m-b3', 'm-b1', 'm-b2'], fallbackByPlanningRowId: fallbackMap })
  assert.equal(chain.persisted, 3)
  assert.deepEqual(googleRequests, [
    { origin: { latitude: 49.5, longitude: 6.0 }, destination: place.pickupA },
    { origin: place.deliveryA, destination: place.pickupB },
    { origin: place.deliveryB, destination: place.pickupC },
  ])
  assert.ok(rows.every((row) => row.approachDistanceMeters > 0 && row.approachPolyline))
  ok('B Chaîne A → B → C : chaque approche part de la fin de la mission précédente')

  // Mission précédente déjà posée hors du lot : elle sert d'origine, et l'annulée est ignorée.
  reset([
    assignment('x0', 'truck-1', day(0), 0, place.pickupA, place.deliveryA),
    assignment('x-cancelled', 'truck-1', day(1, 6), 0, place.pickupC, place.deliveryC, { mission: { id: 'm-x-cancelled', reference: 'QA-c', status: 'CANCELLED', pickupLat: 1, pickupLng: 1, deliveryLat: 10, deliveryLng: 10 } }),
    assignment('x1', 'truck-1', day(1, 12), 0, place.pickupB, place.deliveryB),
  ])
  await finalizeApproachesForAssignments({ missionIds: ['m-x1'], fallbackByPlanningRowId: fallbackMap })
  assert.deepEqual(googleRequests, [{ origin: place.deliveryA, destination: place.pickupB }])
  ok('B2 Mission précédente déjà affectée : origine = sa livraison (annulées ignorées)')

  // C — itinéraire en cache : aucun appel Google.
  reset([assignment('c1', 'truck-1', day(0), 0, place.pickupA, place.deliveryA)])
  routeStore.set(routeFingerprint({ origin: place.truckStart, destination: place.pickupA }), { fingerprint: 'x', distanceMeters: 321_000, durationSeconds: 12_000, polyline: 'cachedpoly', provider: 'GOOGLE_ROUTES' })
  const cached = await finalizeApproachesForAssignments({ missionIds: ['m-c1'], fallbackByPlanningRowId: fallbackMap })
  assert.equal(googleRequests.length, 0, 'cache RouteCache => zéro appel Google')
  assert.equal(cached.routeMetrics.cacheHits, 1); assert.equal(cached.routeMetrics.googleCalls, 0)
  assert.equal(rows[0].approachDistanceMeters, 321_000); assert.equal(rows[0].approachPolyline, 'cachedpoly')
  ok('C RouteCache : approche persistée sans appel Google')

  // D — non mis en cache : un seul calcul, puis réutilisé.
  reset([
    assignment('d1', 'truck-1', day(0), 0, place.pickupA, place.deliveryA),
    assignment('d2', 'truck-2', day(0), 0, place.pickupA, place.deliveryA, { planningRowId: 'row-2' }),
  ])
  const dedup = await finalizeApproachesForAssignments({ missionIds: ['m-d1', 'm-d2'], fallbackByPlanningRowId: new Map([['row-1', place.truckStart], ['row-2', place.truckStart]]) })
  assert.equal(googleRequests.length, 1, 'même trajet pour deux affectations : un seul appel')
  assert.equal(dedup.routeMetrics.googleCalls, 1); assert.equal(dedup.persisted, 2)
  assert.equal(rows[0].approachDistanceMeters, rows[1].approachDistanceMeters)
  ok('D Itinéraire non mis en cache : calculé une fois, persisté, réutilisé')

  // E — candidats écartés : seules les affectations retenues coûtent.
  reset([
    assignment('e1', 'truck-1', day(0), 0, place.pickupA, place.deliveryA),
    assignment('e2', 'truck-2', day(0), 0, place.pickupB, place.deliveryB, { planningRowId: 'row-2' }),
    assignment('e3', 'truck-3', day(0), 0, place.pickupC, place.deliveryC, { planningRowId: 'row-3' }),
  ])
  const retained = await finalizeApproachesForAssignments({ missionIds: ['m-e2'], fallbackByPlanningRowId: new Map([['row-2', place.truckStart]]) })
  assert.equal(googleRequests.length, 1); assert.equal(retained.persisted, 1)
  assert.equal(rows[0].approachDistanceMeters, null); assert.equal(rows[2].approachDistanceMeters, null)
  assert.equal((await finalizeApproachesForAssignments({ missionIds: [], fallbackByPlanningRowId: fallbackMap })).routeMetrics.googleCalls, 0)
  ok('E Aucun appel pour les missions non retenues')

  // F — données manquantes : rien d'inventé.
  reset([
    assignment('f1', 'truck-1', day(0), 0, null, place.deliveryA),
    assignment('f2', 'truck-2', day(0), 0, place.pickupB, place.deliveryB, { planningRowId: 'row-9' }),
  ])
  const missing = await finalizeApproachesForAssignments({ missionIds: ['m-f1', 'm-f2'], fallbackByPlanningRowId: fallbackMap })
  assert.equal(googleRequests.length, 0); assert.equal(updates.length, 0)
  assert.equal(missing.unresolved, 2); assert.equal(missing.persisted, 0)
  assert.ok(rows.every((row) => row.approachDistanceMeters === null && row.approachDurationSeconds === null))
  assert.match(missing.warnings.join(' '), /QA-f1 : approche à calculer \(coordonnées d’enlèvement manquantes\)/)
  assert.match(missing.warnings.join(' '), /QA-f2 : approche à calculer \(aucune position de départ connue\)/)
  // Google en échec : l'affectation reste, l'approche reste non résolue, aucune valeur inventée.
  reset([assignment('f3', 'truck-1', day(0), 0, place.pickupA, place.deliveryA)])
  googleStatus = 500
  const failed = await finalizeApproachesForAssignments({ missionIds: ['m-f3'], fallbackByPlanningRowId: fallbackMap })
  assert.equal(failed.unresolved, 1); assert.equal(rows[0].approachDistanceMeters, null); assert.equal(updates.length, 0)
  assert.match(failed.warnings[0], /itinéraire indisponible/)
  ok('F Coordonnées/origine absentes ou Google en échec : état non résolu explicite, aucune fausse précision')

  // Budget : interrupteur explicite à 0 et plafond par lot.
  reset([assignment('g0', 'truck-1', day(0), 0, place.pickupA, place.deliveryA)])
  process.env.GOOGLE_ROUTES_MAX_CALLS_PER_MISSION_ROUTE = '0'
  assert.equal(approachBatchBudget(10), 0)
  const blocked = await finalizeApproachesForAssignments({ missionIds: ['m-g0'], fallbackByPlanningRowId: fallbackMap })
  assert.equal(googleRequests.length, 0); assert.equal(blocked.unresolved, 1); assert.equal(rows[0].approachDistanceMeters, null)
  delete process.env.GOOGLE_ROUTES_MAX_CALLS_PER_MISSION_ROUTE
  assert.equal(approachBatchBudget(10), 10); assert.equal(approachBatchBudget(500), 50)
  ok('Budget : interrupteur à 0 respecté, plafond de 50 par lot')

  // G — action manuelle : relance explicite et approche déjà présente.
  reset([assignment('h1', 'truck-1', day(0), 0, place.pickupA, place.deliveryA)])
  const first = await finalizeAssignmentApproach({ assignmentId: 'h1', fallbackOrigin: place.truckStart })
  assert.equal(first.status, 'PERSISTED'); assert.equal(updates.length, 1)
  const again = await finalizeAssignmentApproach({ assignmentId: 'h1', fallbackOrigin: place.truckStart })
  assert.equal(again.status, 'ALREADY_PRESENT'); assert.equal(updates.length, 1, 'rien n’est recalculé sans demande')
  rows[0].approachDistanceMeters = null; rows[0].approachDurationSeconds = null // approche invalidée (ex. camion déplacé)
  const manual = await finalizeAssignmentApproach({ assignmentId: 'h1', fallbackOrigin: { latitude: 49.6, longitude: 6.1 }, forceRefresh: true })
  assert.equal(manual.status, 'PERSISTED'); assert.equal(updates.length, 2)
  assert.deepEqual(googleRequests.at(-1)!.origin, { latitude: 49.6, longitude: 6.1 })
  const forced = await finalizeAssignmentApproach({ assignmentId: 'h1', fallbackOrigin: place.truckStart, forceRefresh: true })
  assert.equal(forced.status, 'PERSISTED'); assert.equal(updates.length, 3)
  ok('G Recalcul manuel : relance explicite possible, jamais de recalcul implicite')
}

main()
  .then(() => console.log('Auto-planning approach finalization: OK'))
  .catch((error) => { console.error(error); process.exit(1) })
  .finally(() => { globalThis.fetch = realFetch; process.exit(process.exitCode ?? 0) })
