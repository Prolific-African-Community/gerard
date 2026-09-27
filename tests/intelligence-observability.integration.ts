// Observabilité de Gerard Intelligence.
//
// Les évènements sont des journaux structurés : le test les capture et vérifie
// qu'on peut distinguer chaque issue et la rattacher à une organisation, une
// semaine, une suggestion, une mission et un utilisateur. Aucune durée ni
// horodatage exact n'est asserté — seulement leur présence et leur nature.
process.env.GOOGLE_MAPS_API_KEY = 'qa-intelligence-observability'
process.env.GOOGLE_ROUTES_MAX_CALLS_PER_OPERATION = '200'
process.env.JWT_SECRET ??= 'qa-intelligence-observability'

import assert from 'node:assert/strict'

import { prisma } from '../lib/prisma'
import { runWithOrganization } from '../lib/auth/organization-context'
import { routeFingerprint } from '../lib/dispatch/maps/route-control'
import { analyzePlanningForSuggestions } from '../lib/dispatch/suggestions/planning-service'
import { applyPlanningSuggestion } from '../lib/dispatch/suggestions/application'
import { buildPlanningInsights } from '../lib/dispatch/intelligence/insights'
import { buildPendingApplyAction } from '../lib/dispatch/intelligence/pending-action'
import { answerAssistantQuestion } from '../lib/dispatch/intelligence/assistant'

const prefix = 'QA_INT_OBS_'
const weekStart = new Date(2035, 0, 1)
const weekStartParam = '2035-01-01'
const missionStart = new Date(2035, 0, 2, 8)
const missionEnd = new Date(2035, 0, 2, 22)
const regulatoryReference = new Date('2035-01-02T04:00:00.000Z')
const pickup = { latitude: 44.1, longitude: -2.1 }
const delivery = { latitude: 44.6, longitude: -2.6 }
const nearPosition = { latitude: 44.11, longitude: -2.11 }
const farPosition = { latitude: 44.9, longitude: -2.9 }
const createdRouteFingerprints = new Set<string>()
const realFetch = globalThis.fetch

type Captured = { level: 'info' | 'warn'; event: string; payload: Record<string, unknown> }

const captured: Captured[] = []
const realInfo = console.info
const realWarn = console.warn

function captureConsole() {
  const record = (level: 'info' | 'warn') => (...args: unknown[]) => {
    const line = String(args[0] ?? '')
    if (line.startsWith('[gerard.intelligence] ')) {
      const payload = JSON.parse(line.slice('[gerard.intelligence] '.length)) as Record<string, unknown>
      captured.push({ level, event: String(payload.event), payload })
    }
  }
  console.info = record('info')
  console.warn = record('warn')
}

function restoreConsole() {
  console.info = realInfo
  console.warn = realWarn
}

function drain() {
  const events = [...captured]
  captured.length = 0
  return events
}

function only(events: Captured[], event: string) {
  return events.filter((item) => item.event === event)
}

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
        polyline: { encodedPolyline: 'qa-intelligence-observability' },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
}

function declaration(driverId: string, id: string) {
  return {
    id, driverId, source: 'QA' as const,
    referenceAt: regulatoryReference, timeZone: 'Europe/Luxembourg',
    drivingSinceValidBreakSeconds: 0, dailyDrivingSeconds: 0, weeklyDrivingSeconds: 0,
    previousWeekDrivingSeconds: 0, dailyExtensionsUsedThisWeek: 0,
    reducedDailyRestsUsedSinceWeeklyRest: 0,
    lastValidRestEndedAt: regulatoryReference, dutyPeriodStartedAt: regulatoryReference,
    currentIsoWeek: '2035-W01',
  }
}

async function seedPlanning() {
  await prisma.driver.create({ data: { id: `${prefix}DRIVER_FAR`, name: 'QA Obs Loin', hourlyCostAmount: 20 } })
  await prisma.driver.create({ data: { id: `${prefix}DRIVER_NEAR`, name: 'QA Obs Proche', hourlyCostAmount: 20 } })
  await prisma.truck.create({ data: { id: `${prefix}TRUCK_FAR`, plateNumber: 'QA-OBS-FAR', driverId: `${prefix}DRIVER_FAR` } })
  await prisma.truck.create({ data: { id: `${prefix}TRUCK_NEAR`, plateNumber: 'QA-OBS-NEAR', driverId: `${prefix}DRIVER_NEAR` } })
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
      id: `${prefix}MISSION`, reference: 'QA-OBS-01', clientName: 'QA Client Obs',
      status: 'ASSIGNED', pickupDate: missionStart, deliveryDate: missionEnd,
      pickupAddress: 'QA Enlèvement', deliveryAddress: 'QA Livraison',
      pickupResolvedAddress: 'QA-OBS-PICKUP', deliveryResolvedAddress: 'QA-OBS-DELIVERY',
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

async function main() {
  const organization = await prisma.organization.create({
    data: { id: `${prefix}ORG`, name: 'QA Intelligence Observability', slug: 'qa-intelligence-observability' },
  })
  const user = await prisma.user.create({
    data: { id: `${prefix}USER`, name: 'QA Obs', firstName: 'QA', lastName: 'Obs', username: 'qa_intelligence_obs', role: 'ADMIN', isActive: true, mustChangePassword: false },
  })
  const membership = await prisma.organizationUser.create({
    data: { id: `${prefix}MEMBERSHIP`, organizationId: organization.id, userId: user.id, role: 'ORG_ADMIN' },
  })
  const context = { organizationId: organization.id, organizationRole: membership.role, platformRole: null, userId: user.id }

  installDeterministicRouteProvider()
  try {
    await runWithOrganization(context, seedPlanning)

    // A — une analyse réussie est encadrée par un début et une fin, avec ses
    // compteurs métier et sa consommation de routes.
    captureConsole()
    const analysis = await runWithOrganization(context, () => analyzePlanningForSuggestions(weekStart))
    restoreConsole()
    const analysisEvents = drain()
    assert.equal(only(analysisEvents, 'analysis.started').length, 1)
    const completed = only(analysisEvents, 'analysis.completed')
    assert.equal(completed.length, 1)
    assert.equal(completed[0].payload.organizationId, organization.id)
    assert.equal(completed[0].payload.week, weekStartParam)
    assert.equal(completed[0].payload.analyzedMissions, 1)
    assert.equal(completed[0].payload.suggestions, 1)
    assert.equal(completed[0].payload.incompleteMissions, 0)
    assert.equal(typeof completed[0].payload.durationMs, 'number')
    assert.equal(typeof completed[0].payload.routeLookups, 'number')
    assert.equal(typeof completed[0].payload.routeProviderCalls, 'number')
    console.log('A analyse réussie : bornée, comptée, avec métriques de routes: OK')

    // B — une analyse dégradée reste visible : la mission non analysable est
    // comptée, l'analyse n'échoue pas.
    await runWithOrganization(context, async () => {
      await prisma.mission.create({
        data: {
          id: `${prefix}MISSION_INCOMPLETE`, reference: 'QA-OBS-02', clientName: 'QA Client Obs',
          status: 'ASSIGNED', pickupDate: missionStart, deliveryDate: missionEnd,
          pickupCity: 'Ville', deliveryCity: 'Ville',
        },
      })
      await prisma.missionAssignment.create({
        data: {
          id: `${prefix}ASSIGNMENT_INCOMPLETE`, missionId: `${prefix}MISSION_INCOMPLETE`, planningRowId: `${prefix}ROW_NEAR`,
          driverId: `${prefix}DRIVER_NEAR`, truckId: `${prefix}TRUCK_NEAR`,
          day: 'THURSDAY', scheduledDate: new Date(2035, 0, 4, 8), plannedEndAt: new Date(2035, 0, 4, 18),
        },
      })
    })
    captureConsole()
    await runWithOrganization(context, () => analyzePlanningForSuggestions(weekStart))
    restoreConsole()
    const degraded = only(drain(), 'analysis.completed')[0]
    assert.ok(Number(degraded.payload.incompleteMissions) >= 1, 'une mission non analysable doit être comptée')
    await runWithOrganization(context, async () => {
      await prisma.missionAssignment.delete({ where: { id: `${prefix}ASSIGNMENT_INCOMPLETE` } })
      await prisma.mission.delete({ where: { id: `${prefix}MISSION_INCOMPLETE` } })
    })
    console.log('B analyse dégradée : missions incomplètes comptées, pas d échec: OK')

    // C — les insights rapportent leur volume et leur répartition.
    captureConsole()
    await runWithOrganization(context, () => buildPlanningInsights({ weekStart, now: new Date(2035, 0, 1) }))
    restoreConsole()
    const insightEvent = only(drain(), 'insights.completed')[0]
    assert.ok(insightEvent)
    assert.equal(insightEvent.payload.week, weekStartParam)
    assert.equal(typeof insightEvent.payload.insights, 'number')
    assert.ok(insightEvent.payload.bySeverity && typeof insightEvent.payload.bySeverity === 'object')
    console.log('C insights : volume et répartition journalisés: OK')

    // D — une action confirmable est tracée, sans jamais divulguer son jeton.
    const suggestion = analysis.suggestions[0]
    captureConsole()
    const action = buildPendingApplyAction({
      userId: user.id, weekStart: weekStartParam,
      suggestionId: suggestion.id, snapshotFingerprint: suggestion.snapshotFingerprint,
      evidenceFingerprint: suggestion.evidenceFingerprint,
      missionReference: suggestion.currentState.missionReference,
      summary: 'résumé',
    })
    restoreConsole()
    const offered = only(drain(), 'confirmation.offered')[0]
    assert.ok(offered)
    assert.equal(offered.payload.suggestionId, suggestion.id)
    assert.equal(offered.payload.userId, user.id)
    const serialized = JSON.stringify(offered.payload)
    assert.ok(!serialized.includes(action.token), 'un jeton ne doit jamais être journalisé')
    assert.ok(!serialized.includes(action.idempotencyKey), 'une clé d’idempotence ne doit jamais être journalisée')
    console.log('D confirmation proposée tracée, sans jeton ni clé: OK')

    // E — INVALID : demande malformée, refus distinct.
    captureConsole()
    await runWithOrganization(context, async () => {
      await assert.rejects(applyPlanningSuggestion({
        userId: user.id, suggestionId: 'autre-flux', weekStart: weekStartParam,
        snapshotFingerprint: suggestion.snapshotFingerprint, idempotencyKey: `${prefix}KEY_INVALID`,
      }))
    })
    restoreConsole()
    const invalid = drain()
    assert.equal(only(invalid, 'application.attempted').length, 1)
    assert.equal(only(invalid, 'application.refused')[0].payload.result, 'INVALID')
    assert.equal(only(invalid, 'application.refused')[0].level, 'info')
    console.log('E refus INVALID distinct: OK')

    // F — STALE : empreinte de preuve périmée.
    captureConsole()
    await runWithOrganization(context, async () => {
      await assert.rejects(applyPlanningSuggestion({
        userId: user.id, suggestionId: suggestion.id, weekStart: weekStartParam,
        snapshotFingerprint: suggestion.snapshotFingerprint,
        evidenceFingerprint: 'preuve-perimee', idempotencyKey: `${prefix}KEY_STALE`,
      }))
    })
    restoreConsole()
    const stale = only(drain(), 'application.refused')[0]
    assert.equal(stale.payload.result, 'STALE')
    assert.equal(stale.payload.suggestionId, suggestion.id)
    assert.equal(stale.payload.userId, user.id)
    assert.equal(stale.payload.week, weekStartParam)
    assert.equal(stale.payload.organizationId, organization.id)
    console.log('F refus STALE traçable jusqu à l organisation: OK')

    // G — APPLIED puis ALREADY_APPLIED se distinguent.
    captureConsole()
    const applied = await runWithOrganization(context, () => applyPlanningSuggestion({
      userId: user.id, suggestionId: suggestion.id, weekStart: weekStartParam,
      snapshotFingerprint: suggestion.snapshotFingerprint,
      evidenceFingerprint: suggestion.evidenceFingerprint, idempotencyKey: `${prefix}KEY_APPLIED`,
    }))
    const replayed = await runWithOrganization(context, () => applyPlanningSuggestion({
      userId: user.id, suggestionId: suggestion.id, weekStart: weekStartParam,
      snapshotFingerprint: suggestion.snapshotFingerprint,
      evidenceFingerprint: suggestion.evidenceFingerprint, idempotencyKey: `${prefix}KEY_APPLIED`,
    }))
    restoreConsole()
    assert.equal(applied.status, 'APPLIED')
    assert.equal(replayed.status, 'ALREADY_APPLIED')
    const outcomes = only(drain(), 'application.completed').map((item) => item.payload.result)
    assert.deepEqual(outcomes, ['APPLIED', 'ALREADY_APPLIED'])
    console.log('G APPLIED et ALREADY_APPLIED distincts: OK')

    // H — CONFLICT : clé d'idempotence appartenant à un autre utilisateur.
    captureConsole()
    await runWithOrganization(context, async () => {
      await assert.rejects(applyPlanningSuggestion({
        userId: `${prefix}AUTRE`, suggestionId: suggestion.id, weekStart: weekStartParam,
        snapshotFingerprint: suggestion.snapshotFingerprint,
        evidenceFingerprint: suggestion.evidenceFingerprint, idempotencyKey: `${prefix}KEY_APPLIED`,
      }))
    })
    restoreConsole()
    assert.equal(only(drain(), 'application.refused')[0].payload.result, 'CONFLICT')
    console.log('H refus CONFLICT distinct: OK')

    // I — le routage de l'assistant distingue le déterministe du repli.
    captureConsole()
    await runWithOrganization(context, () => answerAssistantQuestion({
      message: 'Analyse mon planning de cette semaine', weekStart, userId: user.id, canApply: true,
    }))
    restoreConsole()
    const routed = only(drain(), 'assistant.routed')[0]
    assert.ok(routed)
    assert.equal(routed.payload.providerSource, 'ROUTER')
    assert.equal(routed.payload.providerCalls, 0)
    assert.equal(routed.payload.result, 'PLANNING_SUMMARY')
    console.log('I routage déterministe de l assistant journalisé: OK')

    // J — une panne du fournisseur est signalée comme telle, en avertissement,
    // et reste distincte d'un repli déterministe volontaire.
    const originalApiKey = process.env.OPENAI_API_KEY
    const originalModel = process.env.OPENAI_MODEL
    const routeProvider = globalThis.fetch
    process.env.OPENAI_API_KEY = 'qa-observability'
    process.env.OPENAI_MODEL = 'qa-observability'
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = String(typeof input === 'string' ? input : input instanceof URL ? input : (input as Request).url)
      if (!url.startsWith('https://api.openai.com/')) return routeProvider(input, init)
      // Enveloppe valide, contenu illisible : le fournisseur répond mais sa
      // sortie est inexploitable.
      return new Response(JSON.stringify({ output_text: '{illisible' }), { status: 200 })
    }) as typeof fetch
    captureConsole()
    await runWithOrganization(context, () => answerAssistantQuestion({
      message: 'je me demande ce que tu en penses globalement', weekStart, userId: user.id, canApply: true,
    }))
    restoreConsole()
    globalThis.fetch = routeProvider
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalApiKey
    if (originalModel === undefined) delete process.env.OPENAI_MODEL
    else process.env.OPENAI_MODEL = originalModel
    const providerEvents = drain()
    const degradedProvider = only(providerEvents, 'provider.degraded')[0]
    assert.ok(degradedProvider, 'une panne de fournisseur doit être signalée')
    assert.equal(degradedProvider.level, 'warn')
    assert.equal(degradedProvider.payload.providerStatus, 'INVALID_OUTPUT')
    assert.equal(only(providerEvents, 'assistant.routed')[0].payload.providerSource, 'FALLBACK')
    console.log('J panne du fournisseur signalée et distincte du repli: OK')

    // K — aucun évènement ne transporte de secret ni de message utilisateur.
    captureConsole()
    await runWithOrganization(context, () => buildPlanningInsights({ weekStart, now: new Date(2035, 0, 1) }))
    restoreConsole()
    for (const item of drain()) {
      const text = JSON.stringify(item.payload)
      assert.ok(!/OPENAI_API_KEY|Bearer |JWT_SECRET|passwordHash/i.test(text), `secret journalisé : ${text}`)
      assert.ok(!/je me demande/i.test(text), 'un message utilisateur ne doit pas être journalisé')
    }
    console.log('K aucun secret ni message utilisateur journalisé: OK')
  } finally {
    restoreConsole()
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

main().finally(() => prisma.$disconnect())
