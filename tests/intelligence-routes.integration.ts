// Couverture des routes HTTP de Gerard Intelligence : simulation et application.
//
// Le test monte une organisation jetable avec son propre planning et exerce les
// handlers Next directement, avec de vrais cookies de session. Les routes
// Google sont servies par un fournisseur déterministe local.
process.env.GOOGLE_MAPS_API_KEY = 'qa-intelligence-routes'
process.env.GOOGLE_ROUTES_MAX_CALLS_PER_OPERATION = '200'
process.env.JWT_SECRET ??= 'qa-intelligence-routes'

import assert from 'node:assert/strict'
import type { NextApiHandler } from 'next'

import { prisma } from '../lib/prisma'
import { runWithOrganization } from '../lib/auth/organization-context'
import { createSessionToken, sessionCookieName } from '../lib/auth/session'
import { analyzePlanningForSuggestions } from '../lib/dispatch/suggestions/planning-service'
import { routeFingerprint } from '../lib/dispatch/maps/route-control'
import simulateHandler from '../pages/api/dispatch/intelligence/simulate'
import applyHandler from '../pages/api/dispatch/intelligence/apply'

const prefix = 'QA_INT_ROUTE_'
const weekStart = new Date(2032, 0, 5)
const weekStartParam = '2032-01-05'
const missionStart = new Date(2032, 0, 6, 8)
const missionEnd = new Date(2032, 0, 6, 22)
const regulatoryReference = new Date('2032-01-06T04:00:00.000Z')
const pickup = { latitude: 44.1, longitude: -2.1 }
const delivery = { latitude: 44.6, longitude: -2.6 }
const nearPosition = { latitude: 44.11, longitude: -2.11 }
const farPosition = { latitude: 44.9, longitude: -2.9 }
const createdRouteFingerprints = new Set<string>()
const realFetch = globalThis.fetch

function installDeterministicRouteProvider() {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(typeof input === 'string' ? input : input instanceof URL ? input : (input as Request).url)
    if (!url.startsWith('https://routes.googleapis.com/')) throw new Error(`UNEXPECTED_NETWORK_CALL:${url}`)
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      origin: { location: { latLng: { latitude: number; longitude: number } } }
      destination: { location: { latLng: { latitude: number; longitude: number } } }
      intermediates?: Array<{ location: { latitude: number; longitude: number } }>
      travelMode: 'DRIVE'
      routingPreference: 'TRAFFIC_AWARE' | 'TRAFFIC_UNAWARE'
    }
    const from = body.origin.location.latLng
    const to = body.destination.location.latLng
    createdRouteFingerprints.add(routeFingerprint({
      origin: from, destination: to,
      travelMode: body.travelMode, routingPreference: body.routingPreference,
      waypoints: body.intermediates?.map((item) => item.location) ?? [],
    }))
    const toRadians = (value: number) => (value * Math.PI) / 180
    const deltaLat = toRadians(to.latitude - from.latitude)
    const deltaLng = toRadians(to.longitude - from.longitude)
    const haversine = Math.sin(deltaLat / 2) ** 2 + Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(deltaLng / 2) ** 2
    const kilometres = 6371 * 2 * Math.asin(Math.sqrt(haversine)) * 1.25
    return new Response(JSON.stringify({
      routes: [{
        distanceMeters: Math.max(1, Math.round(kilometres * 1000)),
        duration: `${Math.max(60, Math.round((kilometres / 70) * 3600))}s`,
        polyline: { encodedPolyline: 'qa-intelligence-routes' },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
}

type Invocation = { status: number; body: any; headers: Record<string, string> }

async function invoke(handler: NextApiHandler, input: { method?: string; body?: unknown; cookie?: string }): Promise<Invocation> {
  const result: Invocation = { status: 200, body: undefined, headers: {} }
  const req = {
    method: input.method ?? 'POST',
    body: input.body ?? {},
    headers: input.cookie ? { cookie: input.cookie } : {},
  } as never
  const res = {
    status(code: number) { result.status = code; return this },
    json(value: unknown) { result.body = value; return this },
    setHeader(key: string, value: string) { result.headers[key] = value; return this },
    end() { return this },
  } as never
  await handler(req, res)
  return result
}

function declaration(driverId: string, id: string) {
  return {
    id, driverId, source: 'QA' as const,
    referenceAt: regulatoryReference, timeZone: 'Europe/Luxembourg',
    drivingSinceValidBreakSeconds: 0, dailyDrivingSeconds: 0, weeklyDrivingSeconds: 0,
    previousWeekDrivingSeconds: 0, dailyExtensionsUsedThisWeek: 0,
    reducedDailyRestsUsedSinceWeeklyRest: 0,
    lastValidRestEndedAt: regulatoryReference, dutyPeriodStartedAt: regulatoryReference,
    currentIsoWeek: '2032-W01',
  }
}

async function seedPlanning() {
  await prisma.driver.create({ data: { id: `${prefix}DRIVER_FAR`, name: 'QA Route éloigné', hourlyCostAmount: 20 } })
  await prisma.driver.create({ data: { id: `${prefix}DRIVER_NEAR`, name: 'QA Route proche', hourlyCostAmount: 20 } })
  await prisma.truck.create({ data: { id: `${prefix}TRUCK_FAR`, plateNumber: 'QA-ROUTE-FAR', driverId: `${prefix}DRIVER_FAR` } })
  await prisma.truck.create({ data: { id: `${prefix}TRUCK_NEAR`, plateNumber: 'QA-ROUTE-NEAR', driverId: `${prefix}DRIVER_NEAR` } })
  await prisma.planningRow.create({ data: { id: `${prefix}ROW_FAR`, weekStartDate: weekStart, driverId: `${prefix}DRIVER_FAR`, truckId: `${prefix}TRUCK_FAR`, sortOrder: 0 } })
  await prisma.planningRow.create({ data: { id: `${prefix}ROW_NEAR`, weekStartDate: weekStart, driverId: `${prefix}DRIVER_NEAR`, truckId: `${prefix}TRUCK_NEAR`, sortOrder: 1 } })
  await prisma.driverPosition.createMany({
    data: [
      { id: `${prefix}POSITION_FAR`, driverId: `${prefix}DRIVER_FAR`, latitude: farPosition.latitude, longitude: farPosition.longitude, provider: 'DRIVER_PHONE', recordedAt: regulatoryReference, accuracy: 10 },
      { id: `${prefix}POSITION_NEAR`, driverId: `${prefix}DRIVER_NEAR`, latitude: nearPosition.latitude, longitude: nearPosition.longitude, provider: 'DRIVER_PHONE', recordedAt: regulatoryReference, accuracy: 10 },
    ],
  })
  await prisma.driverRegulatoryDeclaration.createMany({
    data: [declaration(`${prefix}DRIVER_FAR`, `${prefix}DECLARATION_FAR`), declaration(`${prefix}DRIVER_NEAR`, `${prefix}DECLARATION_NEAR`)],
  })
  await prisma.mission.create({
    data: {
      id: `${prefix}MISSION`, reference: 'QA-INT-ROUTE-01', clientName: 'QA Client Route',
      status: 'ASSIGNED', pickupDate: missionStart, deliveryDate: missionEnd,
      pickupAddress: 'QA Enlèvement', deliveryAddress: 'QA Livraison',
      pickupResolvedAddress: 'QA-ROUTE-PICKUP', deliveryResolvedAddress: 'QA-ROUTE-DELIVERY',
      pickupLat: pickup.latitude, pickupLng: pickup.longitude,
      deliveryLat: delivery.latitude, deliveryLng: delivery.longitude,
      priceAmount: 2000, priceCurrency: 'EUR', estimatedKm: 78,
      routeDistanceMeters: 78000, routeDurationSeconds: 4200,
      routeProvider: 'GOOGLE_ROUTES', routeCalculatedAt: regulatoryReference,
    },
  })
  await prisma.missionAssignment.create({
    data: {
      id: `${prefix}ASSIGNMENT`, missionId: `${prefix}MISSION`, planningRowId: `${prefix}ROW_FAR`,
      driverId: `${prefix}DRIVER_FAR`, truckId: `${prefix}TRUCK_FAR`, trailerId: null,
      day: 'TUESDAY', scheduledDate: missionStart, plannedEndAt: missionEnd,
      approachDistanceMeters: 139000, approachDurationSeconds: 7150,
      approachProvider: 'GOOGLE_ROUTES', approachCalculatedAt: regulatoryReference,
    },
  })
}

async function assignmentState() {
  const assignment = await prisma.missionAssignment.findUnique({ where: { id: `${prefix}ASSIGNMENT` } })
  assert.ok(assignment)
  return { planningRowId: assignment.planningRowId, driverId: assignment.driverId, truckId: assignment.truckId }
}

async function writeCounters() {
  return {
    assignment: await assignmentState(),
    events: await prisma.missionEvent.count({ where: { missionId: `${prefix}MISSION` } }),
    applications: await prisma.dispatchOptimizationApplication.count(),
  }
}

async function main() {
  const organization = await prisma.organization.create({
    data: { id: `${prefix}ORG`, name: 'QA Intelligence Routes', slug: 'qa-intelligence-routes' },
  })
  const dispatcher = await prisma.user.create({
    data: { id: `${prefix}USER_ASSIGN`, name: 'QA Route Assign', firstName: 'QA', lastName: 'Assign', username: 'qa_intelligence_route_assign', role: 'ADMIN', isActive: true, mustChangePassword: false },
  })
  const viewer = await prisma.user.create({
    data: { id: `${prefix}USER_VIEW`, name: 'QA Route View', firstName: 'QA', lastName: 'View', username: 'qa_intelligence_route_view', role: 'SECRETARY', isActive: true, mustChangePassword: false },
  })
  const membership = await prisma.organizationUser.create({
    data: { id: `${prefix}MEMBERSHIP_ASSIGN`, organizationId: organization.id, userId: dispatcher.id, role: 'ORG_ADMIN' },
  })
  await prisma.organizationUser.create({
    data: { id: `${prefix}MEMBERSHIP_VIEW`, organizationId: organization.id, userId: viewer.id, role: 'VIEWER' },
  })
  const context = { organizationId: organization.id, organizationRole: membership.role, platformRole: null, userId: dispatcher.id }
  const dispatcherCookie = `${sessionCookieName}=${createSessionToken(dispatcher)}`
  const viewerCookie = `${sessionCookieName}=${createSessionToken(viewer)}`

  installDeterministicRouteProvider()
  try {
    await runWithOrganization(context, seedPlanning)
    const proposedPairRowId = `${prefix}ROW_NEAR`

    // A — méthode et authentification.
    const wrongMethod = await invoke(simulateHandler, { method: 'GET', cookie: dispatcherCookie })
    assert.equal(wrongMethod.status, 405)
    assert.equal(wrongMethod.headers.Allow, 'POST')
    const anonymous = await invoke(simulateHandler, { body: { weekStart: weekStartParam } })
    assert.equal(anonymous.status, 401)
    assert.deepEqual(anonymous.body, { error: 'Authentification requise' })
    console.log('A simulate: méthode et authentification: OK')

    // B — charge utile invalide.
    for (const body of [
      {},
      { weekStart: 'pas-une-semaine', missionId: `${prefix}MISSION`, proposedPairRowId },
      { weekStart: weekStartParam, proposedPairRowId },
      { weekStart: weekStartParam, missionId: `${prefix}MISSION` },
      { weekStart: weekStartParam, missionId: 42, proposedPairRowId },
    ]) {
      const invalid = await invoke(simulateHandler, { body, cookie: dispatcherCookie })
      assert.equal(invalid.status, 400, `charge utile acceptée à tort : ${JSON.stringify(body)}`)
      assert.equal(invalid.body.status, 'INVALID')
    }
    console.log('B simulate: charge utile invalide rejetée: OK')

    // C — candidat valide : la route rend la suggestion et l'action d'application.
    const before = await runWithOrganization(context, writeCounters)
    const valid = await invoke(simulateHandler, { body: { weekStart: weekStartParam, missionId: `${prefix}MISSION`, proposedPairRowId }, cookie: dispatcherCookie })
    assert.equal(valid.status, 200)
    assert.equal(valid.body.status, 'VALID')
    assert.equal(valid.body.suggestion.currentState.missionId, `${prefix}MISSION`)
    assert.equal(valid.body.suggestion.proposedState.pairRowId, proposedPairRowId)
    assert.equal(valid.body.snapshotFingerprint, valid.body.suggestion.snapshotFingerprint)
    assert.ok(valid.body.analyzedAt)
    const pendingApply = valid.body.pendingApply
    assert.ok(pendingApply, 'la simulation doit émettre une action d’application')
    assert.equal(pendingApply.type, 'CONFIRM_APPLY')
    assert.equal(pendingApply.suggestionId, valid.body.suggestion.id)
    assert.equal(pendingApply.snapshotFingerprint, valid.body.suggestion.snapshotFingerprint)
    assert.equal(pendingApply.missionReference, 'QA-INT-ROUTE-01')
    assert.ok(pendingApply.idempotencyKey.length >= 16)
    assert.ok(pendingApply.token.includes('.'))
    assert.deepEqual(await runWithOrganization(context, writeCounters), before, 'simuler n’écrit rien')
    console.log('C simulate: candidat valide, action émise, aucune écriture: OK')

    // D — candidat périmé ou inexistant.
    for (const body of [
      { weekStart: weekStartParam, missionId: `${prefix}MISSION`, proposedPairRowId: `${prefix}ROW_FAR` },
      { weekStart: weekStartParam, missionId: `${prefix}INCONNUE`, proposedPairRowId },
      { weekStart: '2032-02-02', missionId: `${prefix}MISSION`, proposedPairRowId },
    ]) {
      const stale = await invoke(simulateHandler, { body, cookie: dispatcherCookie })
      assert.equal(stale.status, 200)
      assert.equal(stale.body.status, 'STALE', `statut inattendu pour ${JSON.stringify(body)}`)
      assert.equal(stale.body.pendingApply, undefined, 'une simulation périmée n’émet aucune action')
    }
    console.log('D simulate: candidat périmé sans action d application: OK')

    // E — lecture seule : la simulation répond, sans action d'application.
    const readOnly = await invoke(simulateHandler, { body: { weekStart: weekStartParam, missionId: `${prefix}MISSION`, proposedPairRowId }, cookie: viewerCookie })
    assert.equal(readOnly.status, 200)
    assert.equal(readOnly.body.status, 'VALID')
    assert.equal(readOnly.body.pendingApply, null, 'sans dispatch.assign, aucune action n’est émise')
    console.log('E simulate: lecture seule sans action d application: OK')

    // F — module INTELLIGENCE désactivé.
    await prisma.organization.update({ where: { id: organization.id }, data: { enabledModules: ['PLANNING'] } })
    const moduleOff = await invoke(simulateHandler, { body: { weekStart: weekStartParam, missionId: `${prefix}MISSION`, proposedPairRowId }, cookie: dispatcherCookie })
    assert.equal(moduleOff.status, 403)
    assert.equal(moduleOff.body.code, 'MODULE_DISABLED')
    const applyModuleOff = await invoke(applyHandler, { body: { token: pendingApply.token }, cookie: dispatcherCookie })
    assert.equal(applyModuleOff.status, 403)
    await prisma.organization.update({
      where: { id: organization.id },
      data: { enabledModules: ['PLANNING', 'MAP', 'PROFITABILITY', 'INVOICING', 'FLEET', 'INTELLIGENCE', 'ASSISTANT', 'MAINTENANCE'] },
    })
    console.log('F simulate et apply: module désactivé refusé: OK')

    // G — panne de l'analyseur : réponse 5xx structurée, jamais un faux VALID.
    const routeProvider = globalThis.fetch
    globalThis.fetch = (async () => { throw new Error('ANALYZER_DOWN') }) as typeof fetch
    await prisma.routeCache.deleteMany({ where: { fingerprint: { in: Array.from(createdRouteFingerprints) } } })
    const analyzerFailure = await invoke(simulateHandler, { body: { weekStart: weekStartParam, missionId: `${prefix}MISSION`, proposedPairRowId }, cookie: dispatcherCookie })
    globalThis.fetch = routeProvider
    assert.ok(analyzerFailure.status === 503 || analyzerFailure.body.status === 'STALE', `réponse inattendue : ${JSON.stringify(analyzerFailure)}`)
    assert.notEqual(analyzerFailure.body.status, 'VALID', 'une analyse dégradée ne doit jamais rendre VALID')
    assert.deepEqual(await runWithOrganization(context, writeCounters), before, 'une panne n’écrit rien')
    console.log('G simulate: panne de l analyseur sans faux positif ni écriture: OK')

    // H — apply : méthode, authentification, jeton manquant ou falsifié.
    const applyWrongMethod = await invoke(applyHandler, { method: 'GET', cookie: dispatcherCookie })
    assert.equal(applyWrongMethod.status, 405)
    const applyAnonymous = await invoke(applyHandler, { body: { token: pendingApply.token } })
    assert.equal(applyAnonymous.status, 401)
    const applyViewer = await invoke(applyHandler, { body: { token: pendingApply.token }, cookie: viewerCookie })
    assert.equal(applyViewer.status, 403, 'appliquer exige dispatch.assign')
    for (const token of ['', 'sans-point', `${pendingApply.token}x`]) {
      const refused = await invoke(applyHandler, { body: { token }, cookie: dispatcherCookie })
      assert.equal(refused.status, 400)
      assert.equal(refused.body.status, 'INVALID')
    }
    // Les anciens champs explicites ne suffisent plus : seul le jeton signé compte.
    const legacyShape = await invoke(applyHandler, {
      body: { suggestionId: pendingApply.suggestionId, weekStart: weekStartParam, snapshotFingerprint: pendingApply.snapshotFingerprint, idempotencyKey: 'clé-cliente' },
      cookie: dispatcherCookie,
    })
    assert.equal(legacyShape.status, 400)
    assert.equal(legacyShape.body.status, 'INVALID')
    assert.deepEqual(await runWithOrganization(context, writeCounters), before, 'aucun refus n’écrit')
    console.log('H apply: méthode, permission et jeton non falsifiable: OK')

    // I — application réelle, puis rejeu idempotent via la route.
    const applied = await invoke(applyHandler, { body: { token: pendingApply.token }, cookie: dispatcherCookie })
    assert.equal(applied.status, 200)
    assert.equal(applied.body.status, 'APPLIED')
    const replay = await invoke(applyHandler, { body: { token: pendingApply.token }, cookie: dispatcherCookie })
    assert.equal(replay.status, 200)
    assert.equal(replay.body.status, 'ALREADY_APPLIED')
    await runWithOrganization(context, async () => {
      assert.equal((await assignmentState()).planningRowId, proposedPairRowId)
      assert.equal(await prisma.dispatchOptimizationApplication.count(), 1, 'aucun doublon d’audit')
      assert.equal(await prisma.missionEvent.count({ where: { missionId: `${prefix}MISSION` } }), 1)
    })
    console.log('I apply: application puis rejeu idempotent par la route: OK')

    // J — régression B2 : une clé d'idempotence déjà prise par un enregistrement
    // sans résultat rejouable donne un conflit explicite, pas une 500 opaque.
    await runWithOrganization(context, async () => {
      const foreign = await prisma.dispatchOptimizationApplication.create({
        data: {
          idempotencyKey: `${prefix}KEY_INCOMPLETE`, simulationId: 'auto-planning:autre-flux',
          snapshotFingerprint: 'empreinte-autre-flux', strategy: 'AUTO_PLANNING',
          periodStart: weekStart, periodEnd: new Date(weekStart.getTime() + 7 * 24 * 3600 * 1000),
          missionIds: [], pairRowIds: [], warnings: [], actorId: dispatcher.id, resultSummary: {},
        },
      })
      const { createPendingApplyToken } = await import('../lib/dispatch/intelligence/pending-action')
      const collision = createPendingApplyToken({
        userId: dispatcher.id, suggestionId: pendingApply.suggestionId,
        weekStart: weekStartParam, snapshotFingerprint: pendingApply.snapshotFingerprint,
        idempotencyKey: `${prefix}KEY_INCOMPLETE`,
      })
      const conflict = await invoke(applyHandler, { body: { token: collision.token }, cookie: dispatcherCookie })
      assert.equal(conflict.status, 409, `attendu 409, reçu ${conflict.status} : ${JSON.stringify(conflict.body)}`)
      assert.equal(conflict.body.status, 'CONFLICT')
      assert.match(conflict.body.error, /clé d’idempotence/)
      assert.equal(await prisma.dispatchOptimizationApplication.count(), 2, 'aucune application supplémentaire')
      assert.equal(await prisma.missionEvent.count({ where: { missionId: `${prefix}MISSION` } }), 1)
      await prisma.dispatchOptimizationApplication.delete({ where: { id: foreign.id } })
    })
    console.log('J apply: clé d idempotence sans résultat rejouable en conflit explicite: OK')
  } finally {
    globalThis.fetch = realFetch
    await runWithOrganization(context, async () => {
      await prisma.missionEvent.deleteMany({ where: { missionId: { startsWith: prefix } } })
      await prisma.dispatchOptimizationApplication.deleteMany({})
      await prisma.missionAssignment.deleteMany({ where: { id: { startsWith: prefix } } })
      await prisma.mission.deleteMany({ where: { id: { startsWith: prefix } } })
      await prisma.planningRow.deleteMany({ where: { id: { startsWith: prefix } } })
      await prisma.driverPosition.deleteMany({ where: { id: { startsWith: prefix } } })
      await prisma.driverRegulatoryDeclaration.deleteMany({ where: { id: { startsWith: prefix } } })
      await prisma.truck.deleteMany({ where: { id: { startsWith: prefix } } })
      await prisma.driver.deleteMany({ where: { id: { startsWith: prefix } } })
    })
    await prisma.organizationUser.deleteMany({ where: { id: { startsWith: prefix } } })
    await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } })
    await prisma.organization.deleteMany({ where: { id: { startsWith: prefix } } })
    if (createdRouteFingerprints.size) {
      await prisma.routeCache.deleteMany({ where: { fingerprint: { in: Array.from(createdRouteFingerprints) } } })
    }
  }
}

void analyzePlanningForSuggestions
main().finally(() => prisma.$disconnect())
