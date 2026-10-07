// Stabilité de l'instantané d'auto-planification entre SIMULER et APPLIQUER.
//
// Une base en mémoire remplace Prisma : aucune donnée n'est lue ni écrite en
// base, et Google est simulé. On vérifie que le simple passage du temps ou un
// nouveau ping GPS ne périme jamais une simulation, qu'une vraie modification
// la périme avec une cause précise, et que l'ordre d'arrivée des itinéraires ne
// change pas l'empreinte.

import assert from 'node:assert/strict'

process.env.JWT_SECRET ||= 'test-secret'
process.env.GOOGLE_MAPS_API_KEY = 'test-key'

import { prisma } from '../lib/prisma'
import { runWithOrganization } from '../lib/auth/organization-context'
import { buildAutoPlanningSnapshot } from '../lib/dispatch/auto-planning/snapshot'
import { prepareCandidateApproachRoutes } from '../lib/dispatch/auto-planning/approach-routes'
import { changedSnapshotReasons, describeSnapshotChange } from '../lib/dispatch/auto-planning/snapshot-parts'
import { createSnapshotToken, verifySnapshotToken } from '../lib/dispatch/auto-planning/token'
import { findMaterialPositionDrift, positionDriftToleranceMeters } from '../lib/dispatch/auto-planning/position-drift'
import { withRouteOperation } from '../lib/dispatch/maps/route-control'

const weekStart = new Date('2030-09-16T00:00:00.000Z')
const T0 = new Date('2030-09-18T10:00:00.000Z')
const at = (offsetMs: number, from = T0) => new Date(from.getTime() + offsetMs)
const minute = 60_000

type Row = Record<string, any>
type Db = {
  missions: Row[]
  assignments: Row[]
  positions: Row[]
  declarations: Row[]
  events: Row[]
}

const driver = { id: 'drv-a', name: 'Driver A', status: 'ACTIVE', phone: null, email: null, hourlyCostAmount: 25, hourlyCostCurrency: 'EUR' }
const truck = { id: 'trk-a', plateNumber: 'TR-001-AA', status: 'AVAILABLE', couplingType: 'FIFTH_WHEEL', capacityKg: null, category: null, driverId: 'drv-a', technicalInspectionExpiresAt: null, model: null, brand: null }
const planningRow = { id: 'row-a', weekStartDate: weekStart, sortOrder: 0, driverId: 'drv-a', truckId: 'trk-a', trailerId: null, pairLocked: false, assignmentOrigin: 'MANUAL', isExceptionalReplacement: false, usualTruckIdSnapshot: null, driver, truck }
const trailer = { id: 'trl-a', plateNumber: 'TL-001', type: 'FLATBED', status: 'AT_BASE', loadStatus: 'EMPTY', cargoType: null, compatibleCargoTypes: null, cargoDescription: null, truckId: null, capacityKg: 24000, couplingType: 'FIFTH_WHEEL', currentLocationAddress: null, currentLocationPlaceId: null, currentLocationLat: null, currentLocationLng: null, currentLocationUpdatedAt: null, custodyState: 'EMPTY', custodyVersion: 1, technicalInspectionExpiresAt: null, parkSpot: null }

function mission(id: string, overrides: Row = {}): Row {
  return {
    id, reference: `QA-${id}`, title: id, clientName: 'Client', pickupCity: 'Metz', deliveryCity: 'Lyon',
    pickupAddress: 'Metz, France', deliveryAddress: 'Lyon, France', pickupPlaceId: `pick-${id}`, deliveryPlaceId: `del-${id}`,
    pickupLat: 49.12, pickupLng: 6.17, deliveryLat: 45.76, deliveryLng: 4.83,
    pickupDate: new Date('2030-09-19T06:00:00.000Z'), deliveryDate: new Date('2030-09-19T16:00:00.000Z'),
    requiredTruckType: null, priceAmount: 1000, priceCurrency: 'EUR',
    requirements: { requiredTrailerId: null, requiredCapacityKg: 20000, requiredTrailerType: 'FLATBED', requiredCouplingType: 'FIFTH_WHEEL' },
    routeDistanceMeters: 330000, routeDurationSeconds: 13000, routePolyline: 'x', routeCalculatedAt: T0, routeProvider: 'GOOGLE_ROUTES',
    pickupResolvedAddress: 'Metz, France', deliveryResolvedAddress: 'Lyon, France', pickupResolutionStatus: 'CONFIRMED', deliveryResolutionStatus: 'CONFIRMED',
    preparationStatus: 'READY', preparationMissingData: [], status: 'PENDING', createdAt: T0, updatedAt: T0, assignment: null,
    ...overrides,
  }
}

function freshDb(): Db {
  return {
    missions: [mission('m1')],
    assignments: [],
    positions: [{ id: 'pos-1', driverId: 'drv-a', truckId: 'trk-a', latitude: 49.5, longitude: 6.0, accuracy: 10, provider: 'DRIVER_PHONE', recordedAt: at(-29 * minute - 50_000) }],
    declarations: [{ id: 'decl-1', driverId: 'drv-a', source: 'DISPATCHER_DECLARATION', referenceAt: at(-2 * 24 * 60 * minute), validUntil: null, timeZone: 'Europe/Luxembourg', drivingSinceValidBreakSeconds: 0, dailyDrivingSeconds: 0, weeklyDrivingSeconds: 72000, previousWeekDrivingSeconds: 14400, dailyExtensionsUsedThisWeek: 0, reducedDailyRestsUsedSinceWeeklyRest: 0, splitBreakFirstPartSeconds: 0, splitDailyRestFirstPartSeconds: 0, lastValidRestEndedAt: at(-3 * 24 * 60 * minute), dutyPeriodStartedAt: at(-2 * 24 * 60 * minute), currentIsoWeek: '2030-W38', weeklyRestDueAt: null, weeklyRestCompensationDueSeconds: 0, knownFields: ['dailyDrivingSeconds', 'weeklyDrivingSeconds'], updatedAt: at(-2 * 24 * 60 * minute) }],
    events: [],
  }
}

const routeStore = new Map<string, any>()
let googleCalls = 0
const originalFetch = globalThis.fetch
globalThis.fetch = (async () => {
  googleCalls += 1
  return new Response(JSON.stringify({ routes: [{ duration: '3600s', distanceMeters: 100_000 + googleCalls, polyline: { encodedPolyline: 'abc' } }] }), { status: 200 })
}) as typeof fetch

function install(db: Db) {
  const p: any = prisma
  const inRange = (value: Date, range: any) => (!range?.gte || value >= range.gte) && (!range?.lte || value <= range.lte)
  p.planningRow = { findMany: async () => [planningRow] }
  p.truck = { findMany: async () => [truck] }
  p.organization = { findUnique: async () => ({ operatingBaseAddress: 'Base', operatingBasePlaceId: 'base', operatingBaseLat: 49.6, operatingBaseLng: 6.1 }) }
  p.mission = { findMany: async () => db.missions }
  p.missionAssignment = { findMany: async (args: any) => (args?.where?.mission?.status === 'DONE' ? [] : db.assignments) }
  p.trailer = { findMany: async () => [trailer] }
  p.driverPosition = { findMany: async (args: any) => db.positions.filter((row) => inRange(row.recordedAt, args.where.recordedAt)).sort((a, b) => b.recordedAt - a.recordedAt) }
  p.driverRegulatoryDeclaration = { findMany: async (args: any) => db.declarations.filter((row) => inRange(row.referenceAt, args.where.referenceAt)) }
  p.driverActivityEvent = { findMany: async (args: any) => db.events.filter((row) => inRange(row.effectiveAt, args.where.effectiveAt)).sort((a, b) => a.effectiveAt - b.effectiveAt) }
  p.routeCache = {
    findUnique: async ({ where }: any) => routeStore.get(where.fingerprint) ?? null,
    upsert: async ({ where, create }: any) => { routeStore.set(where.fingerprint, create); return create },
  }
  p.routeFailureCache = { findUnique: async () => null, upsert: async () => null, deleteMany: async () => null }
}

const build = (now: Date, options: { routes?: boolean } = {}) =>
  buildAutoPlanningSnapshot({ weekStartDate: weekStart, includeExistingForced: false, now, prepareCandidateRoutes: options.routes ?? false })

const tokenFor = (snapshot: Awaited<ReturnType<typeof build>>) => verifySnapshotToken(createSnapshotToken({
  simulationId: snapshot.id, fingerprint: snapshot.fingerprint, userId: 'u', weekStart: weekStart.toISOString(), includeExistingForced: false,
  createdAt: snapshot.createdAt, expiresAt: new Date(Date.now() + 15 * minute).toISOString(), parts: snapshot.fingerprintParts,
}), 'u')!

/** Ce que fait l'application : rejouer à l'instant de référence du jeton. */
const revalidate = (token: ReturnType<typeof tokenFor>, options: { routes?: boolean } = {}) =>
  build(new Date(token.createdAt), options)

const ok = (label: string) => console.log(`${label}: OK`)

async function main() {
  const db = freshDb()
  install(db)

  // --- Cause racine : sans instant figé, la même base donne deux empreintes ---
  const simulated = await build(T0)
  const token = tokenFor(simulated)
  const wallClockLater = await build(at(30_000))
  assert.notEqual(wallClockLater.fingerprint, simulated.fingerprint, 'un ping GPS qui franchit 30 min de fraîcheur change l’instantané (cause du SNAPSHOT_STALE permanent)')
  assert.ok(changedSnapshotReasons(token.parts!, wallClockLater.fingerprintParts).includes('POSITION_CHANGED'))
  ok('Cause racine reproduite : horloge courante => empreinte différente')

  // --- A/B : l'instant de référence figé rend le temps neutre ----------------
  const revalidated = await revalidate(token)
  assert.equal(revalidated.fingerprint, simulated.fingerprint)
  assert.deepEqual(changedSnapshotReasons(token.parts!, revalidated.fingerprintParts), [])
  const original = Date.now
  try {
    for (const delay of [30_000, 5 * minute, 14 * minute]) {
      Date.now = () => original() + delay
      assert.equal((await revalidate(token)).fingerprint, simulated.fingerprint, `rejeu à +${delay} ms`)
    }
  } finally { Date.now = original }
  ok('A/B Mêmes données, rejeu 30 s / 5 min / 14 min plus tard : même empreinte')

  // --- Expiré ≠ périmé ------------------------------------------------------
  const expired = verifySnapshotToken(createSnapshotToken({ simulationId: 'x', fingerprint: 'y', userId: 'u', weekStart: weekStart.toISOString(), includeExistingForced: false, createdAt: T0.toISOString(), expiresAt: new Date(Date.now() - 1000).toISOString() }), 'u')
  assert.equal(expired, null, 'un jeton trop vieux est EXPIRÉ (SIMULATION_EXPIRED), pas périmé')
  assert.equal(describeSnapshotChange([]), 'Les données Dispatch ont changé. Une nouvelle simulation est requise.')
  ok('Expiration et péremption restent deux états distincts')

  // --- G : même ping, simplement plus vieux ----------------------------------
  assert.equal((await build(T0)).fingerprint, simulated.fingerprint)
  assert.equal((await revalidate(token)).fingerprint, simulated.fingerprint)
  ok('G Le même ping GPS qui vieillit ne périme pas la simulation')

  // --- H : nouveau ping GPS ---------------------------------------------------
  db.positions.push({ id: 'pos-2', driverId: 'drv-a', truckId: 'trk-a', latitude: 49.5004, longitude: 6.0, accuracy: 10, provider: 'DRIVER_PHONE', recordedAt: at(20_000) })
  assert.equal((await revalidate(token)).fingerprint, simulated.fingerprint, 'un ping postérieur à la simulation est ignoré par le rejeu')
  const used = [{ driverId: 'drv-a', driverName: 'Driver A', position: { latitude: 49.5, longitude: 6.0 } }]
  const ping = (latitude: number, longitude: number) => [{ driverId: 'drv-a', latitude, longitude, recordedAt: at(20_000) }]
  assert.deepEqual(findMaterialPositionDrift({ used, newerPings: ping(49.5004, 6.0) }), [], 'quelques dizaines de mètres : pas de péremption')
  assert.deepEqual(findMaterialPositionDrift({ used, newerPings: ping(49.6, 6.1) }), [], 'environ 13 km : sous la tolérance')
  const far = findMaterialPositionDrift({ used, newerPings: ping(48.85, 2.35) })
  assert.equal(far.length, 1, 'un chauffeur parti à plus de 20 km est revalidé')
  assert.equal(far[0].driverName, 'Driver A')
  assert.ok(far[0].movedMeters > positionDriftToleranceMeters)
  assert.deepEqual(findMaterialPositionDrift({ used: [{ ...used[0], position: null }], newerPings: ping(48.85, 2.35) }), [])
  // Seul le ping le plus récent compte.
  assert.deepEqual(findMaterialPositionDrift({ used, newerPings: [{ driverId: 'drv-a', latitude: 48.85, longitude: 2.35, recordedAt: at(10_000) }, { driverId: 'drv-a', latitude: 49.5, longitude: 6.0, recordedAt: at(20_000) }] }), [])
  // Un ping tardif, daté d'avant la simulation mais écrit après, est une vraie révision.
  db.positions.push({ id: 'pos-late', driverId: 'drv-a', truckId: 'trk-a', latitude: 49.52, longitude: 6.01, accuracy: 10, provider: 'DRIVER_PHONE', recordedAt: at(-60_000) })
  const late = await revalidate(token)
  assert.notEqual(late.fingerprint, simulated.fingerprint)
  assert.deepEqual(changedSnapshotReasons(token.parts!, late.fingerprintParts).filter((reason) => reason === 'POSITION_CHANGED'), ['POSITION_CHANGED'])
  db.positions.pop()
  ok('H Nouveau ping : ignoré s’il est mineur, POSITION_CHANGED s’il est matériel ou tardif')

  // --- C : mission modifiée ---------------------------------------------------
  db.missions[0] = mission('m1', { pickupDate: new Date('2030-09-19T07:00:00.000Z'), updatedAt: at(5_000) })
  const edited = await revalidate(token)
  assert.notEqual(edited.fingerprint, simulated.fingerprint)
  assert.ok(changedSnapshotReasons(token.parts!, edited.fingerprintParts).includes('MISSION_CHANGED'))
  assert.match(describeSnapshotChange(['MISSION_CHANGED']), /une mission a été modifiée/)
  db.missions[0] = mission('m1')
  ok('C Mission modifiée : MISSION_CHANGED')

  // --- D : affectation créée --------------------------------------------------
  db.assignments.push({ id: 'asg-1', missionId: 'm1', planningRowId: 'row-a', driverId: 'drv-a', truckId: 'trk-a', trailerId: null, scheduledDate: new Date('2030-09-19T06:00:00.000Z'), plannedEndAt: new Date('2030-09-19T16:00:00.000Z'), sortOrder: 0, updatedAt: at(8_000), mission: { id: 'm1', reference: 'QA-m1', status: 'ASSIGNED', deliveryPlaceId: 'del-m1', deliveryAddress: 'Lyon', deliveryLat: 45.76, deliveryLng: 4.83, deliveryDate: new Date('2030-09-19T16:00:00.000Z') }, planningRow: { driverId: 'drv-a', truckId: 'trk-a' } })
  const assigned = await revalidate(token)
  assert.ok(changedSnapshotReasons(token.parts!, assigned.fingerprintParts).includes('ASSIGNMENT_CHANGED'))
  db.assignments.length = 0
  ok('D Affectation créée : ASSIGNMENT_CHANGED')

  // --- E : activité chauffeur écrite ------------------------------------------
  db.events.push({ id: 'ev-1', driverId: 'drv-a', type: 'DRIVE_START', effectiveAt: at(-10 * minute), recordedAt: at(10_000), source: 'DRIVER', correctedEventId: null, isVoided: false, missionId: null })
  const activity = await revalidate(token)
  assert.notEqual(activity.fingerprint, simulated.fingerprint)
  assert.ok(changedSnapshotReasons(token.parts!, activity.fingerprintParts).includes('DRIVER_ACTIVITY_CHANGED'))
  // Événement daté après l'instant de référence : le temps qui passe ne l'y fait pas entrer.
  db.events.length = 0
  db.events.push({ id: 'ev-future', driverId: 'drv-a', type: 'DRIVE_START', effectiveAt: at(10_000), recordedAt: at(1_000), source: 'DRIVER', correctedEventId: null, isVoided: false, missionId: null })
  assert.equal((await revalidate(token)).fingerprint, simulated.fingerprint)
  db.events.length = 0
  ok('E Activité écrite : DRIVER_ACTIVITY_CHANGED ; événement futur : ignoré')

  // --- F : déclaration réglementaire modifiée ----------------------------------
  db.declarations[0] = { ...db.declarations[0], weeklyDrivingSeconds: 80000, updatedAt: at(12_000) }
  const declared = await revalidate(token)
  assert.notEqual(declared.fingerprint, simulated.fingerprint)
  assert.ok(changedSnapshotReasons(token.parts!, declared.fingerprintParts).some((reason) => reason === 'REGULATORY_CHANGED'))
  db.declarations[0] = freshDb().declarations[0]
  assert.equal((await revalidate(token)).fingerprint, simulated.fingerprint, 'même déclaration, horloge plus tardive : pas périmé')
  ok('F Déclaration modifiée : REGULATORY_CHANGED ; inchangée : stable')

  // --- I + cache-only : l'ordre d'arrivée des routes ne change rien --------------
  routeStore.clear(); googleCalls = 0
  const routed = await withRouteOperation('simulation', () => build(T0, { routes: true }), { maxCalls: 2, log: false })
  assert.ok(googleCalls >= 1 && googleCalls <= 2, 'la simulation dépense son budget Google')
  const spent = googleCalls
  const cacheOnly = await withRouteOperation('revalidation', () => revalidate(tokenFor(routed), { routes: true }), { maxCalls: 0, log: false })
  assert.equal(googleCalls, spent, 'la revalidation ne dépense aucun appel Google')
  assert.equal(cacheOnly.fingerprint, routed.fingerprint, 'itinéraires obtenus à la simulation + cache seul => même empreinte')
  const budgetAgain = await withRouteOperation('revalidation avec budget', () => revalidate(tokenFor(routed), { routes: true }), { maxCalls: 2, log: false })
  assert.ok(googleCalls > spent && budgetAgain.fingerprint !== routed.fingerprint, 'sans cache seul, de nouveaux itinéraires périment l’empreinte sans aucun changement métier')

  const jobs = routed.input
  const resolveWith = async (delays: number[]) => {
    let call = 0
    return prepareCandidateApproachRoutes({
      pairs: jobs.pairs, missions: jobs.missions, trailers: jobs.trailers, existing: [],
      provider: async (request) => {
        const delay = delays[call++ % delays.length]
        await new Promise((resolve) => setTimeout(resolve, delay))
        return { distanceMeters: Math.round(request.origin.latitude * 1000 + request.destination.longitude), durationSeconds: 1000, polyline: '', provider: 'GOOGLE_ROUTES' as const }
      },
    })
  }
  const fast = await resolveWith([1, 12, 3, 9, 2])
  const slow = await resolveWith([14, 1, 11, 2, 8])
  assert.ok(fast.length > 0)
  assert.deepEqual(fast.map((item) => [item.key, item.distanceMeters]), slow.map((item) => [item.key, item.distanceMeters]))
  ok('I Ordre d’arrivée des itinéraires sans effet ; revalidation en cache seul = simulation')

  // --- Diagnostics lisibles, sans empreinte --------------------------------------
  const message = describeSnapshotChange(['MISSION_CHANGED', 'POSITION_CHANGED'])
  assert.match(message, /une mission a été modifiée, la position d’un chauffeur a changé/)
  assert.doesNotMatch(message, /[0-9a-f]{12}/)
  ok('Diagnostic précis sans hash')
}

const identity = { organizationId: 'org-stability-test', organizationRole: 'ADMIN' } as any
runWithOrganization(identity, main)
  .then(() => console.log('Auto-planning snapshot stability: OK'))
  .catch((error) => { console.error(error); process.exit(1) })
  .finally(() => { globalThis.fetch = originalFetch; process.exit(process.exitCode ?? 0) })
