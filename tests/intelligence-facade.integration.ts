// Couverture directe de la façade Intelligence (T2).
//
// Jusqu'ici ces fonctions n'étaient exercées qu'à travers l'assistant, sur le
// jeu de données `gerard` permanent — donc sautées quand il est absent. Ce test
// monte son propre tenant jetable et appelle la façade sans intermédiaire.
process.env.GOOGLE_MAPS_API_KEY = 'qa-intelligence-facade'
process.env.GOOGLE_ROUTES_MAX_CALLS_PER_OPERATION = '200'

import assert from 'node:assert/strict'

import { prisma } from '../lib/prisma'
import { runWithOrganization } from '../lib/auth/organization-context'
import { routeFingerprint } from '../lib/dispatch/maps/route-control'
import {
  explainSuggestion,
  getMissionContext,
  getPlanningSummary,
  getResourceAvailability,
  resolveMissionReference,
  simulateSuggestion,
} from '../lib/dispatch/intelligence/facade'

const prefix = 'QA_INT_FACADE_'
const weekStart = new Date(2033, 0, 3)
const missionStart = new Date(2033, 0, 4, 8)
const missionEnd = new Date(2033, 0, 4, 22)
const neighbourStart = new Date(2033, 0, 4, 9)
const neighbourEnd = new Date(2033, 0, 4, 20)
const regulatoryReference = new Date('2033-01-04T04:00:00.000Z')
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
        polyline: { encodedPolyline: 'qa-intelligence-facade' },
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
    currentIsoWeek: '2033-W01',
  }
}

async function seedPlanning() {
  await prisma.driver.create({ data: { id: `${prefix}DRIVER_FAR`, name: 'Bertrand Loin', hourlyCostAmount: 20 } })
  await prisma.driver.create({ data: { id: `${prefix}DRIVER_NEAR`, name: 'Bertrand Proche', hourlyCostAmount: 20 } })
  await prisma.driver.create({ data: { id: `${prefix}DRIVER_BUSY`, name: 'Sylvain Occupe', hourlyCostAmount: 20 } })
  await prisma.truck.create({ data: { id: `${prefix}TRUCK_FAR`, plateNumber: 'QA-FACADE-FAR', driverId: `${prefix}DRIVER_FAR` } })
  await prisma.truck.create({ data: { id: `${prefix}TRUCK_NEAR`, plateNumber: 'QA-FACADE-NEAR', driverId: `${prefix}DRIVER_NEAR` } })
  await prisma.truck.create({ data: { id: `${prefix}TRUCK_BUSY`, plateNumber: 'QA-FACADE-BUSY', driverId: `${prefix}DRIVER_BUSY` } })
  await prisma.planningRow.create({ data: { id: `${prefix}ROW_FAR`, weekStartDate: weekStart, driverId: `${prefix}DRIVER_FAR`, truckId: `${prefix}TRUCK_FAR`, sortOrder: 0 } })
  await prisma.planningRow.create({ data: { id: `${prefix}ROW_NEAR`, weekStartDate: weekStart, driverId: `${prefix}DRIVER_NEAR`, truckId: `${prefix}TRUCK_NEAR`, sortOrder: 1 } })
  await prisma.planningRow.create({ data: { id: `${prefix}ROW_BUSY`, weekStartDate: weekStart, driverId: `${prefix}DRIVER_BUSY`, truckId: `${prefix}TRUCK_BUSY`, sortOrder: 2 } })
  await prisma.driverPosition.createMany({
    data: [
      { id: `${prefix}POSITION_FAR`, driverId: `${prefix}DRIVER_FAR`, latitude: farPosition.latitude, longitude: farPosition.longitude, provider: 'DRIVER_PHONE', recordedAt: regulatoryReference, accuracy: 10 },
      { id: `${prefix}POSITION_NEAR`, driverId: `${prefix}DRIVER_NEAR`, latitude: nearPosition.latitude, longitude: nearPosition.longitude, provider: 'DRIVER_PHONE', recordedAt: regulatoryReference, accuracy: 10 },
    ],
  })
  await prisma.driverRegulatoryDeclaration.createMany({
    data: [declaration(`${prefix}DRIVER_FAR`, `${prefix}DECLARATION_FAR`), declaration(`${prefix}DRIVER_NEAR`, `${prefix}DECLARATION_NEAR`)],
  })
  // Mission optimisable, complète.
  await prisma.mission.create({
    data: {
      id: `${prefix}MISSION`, reference: 'QA-FACADE-01', clientName: 'QA Client Façade',
      status: 'ASSIGNED', pickupDate: missionStart, deliveryDate: missionEnd,
      pickupAddress: 'QA Enlèvement', deliveryAddress: 'QA Livraison',
      pickupResolvedAddress: 'QA-FACADE-PICKUP', deliveryResolvedAddress: 'QA-FACADE-DELIVERY',
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
  // Mission voisine qui occupe Sylvain sur le même créneau.
  await prisma.mission.create({
    data: {
      id: `${prefix}MISSION_BUSY`, reference: 'QA-FACADE-02', clientName: 'QA Client Façade',
      status: 'ASSIGNED', pickupDate: neighbourStart, deliveryDate: neighbourEnd,
      pickupAddress: 'QA Enlèvement 2', deliveryAddress: 'QA Livraison 2',
      pickupResolvedAddress: 'QA-FACADE-PICKUP-2', deliveryResolvedAddress: 'QA-FACADE-DELIVERY-2',
      pickupLat: 44.2, pickupLng: -2.2, deliveryLat: 44.7, deliveryLng: -2.7,
      priceAmount: 1500, priceCurrency: 'EUR',
    },
  })
  await prisma.missionAssignment.create({
    data: {
      id: `${prefix}ASSIGNMENT_BUSY`, missionId: `${prefix}MISSION_BUSY`, planningRowId: `${prefix}ROW_BUSY`,
      driverId: `${prefix}DRIVER_BUSY`, truckId: `${prefix}TRUCK_BUSY`, trailerId: null,
      day: 'TUESDAY', scheduledDate: neighbourStart, plannedEndAt: neighbourEnd,
    },
  })
  // Mission sans données économiques ni adresses résolues : volontairement incomplète.
  await prisma.mission.create({
    data: {
      id: `${prefix}MISSION_INCOMPLETE`, reference: 'QA-FACADE-03', clientName: 'QA Client Façade',
      status: 'PENDING', pickupDate: missionStart, deliveryDate: missionEnd,
      pickupCity: 'Ville départ', deliveryCity: 'Ville arrivée',
    },
  })
}

function factOf(context: { facts: Array<{ label: string; value: unknown }> } | null, label: string) {
  return context?.facts.find((item) => item.label === label)?.value
}

async function main() {
  const organization = await prisma.organization.create({
    data: { id: `${prefix}ORG`, name: 'QA Intelligence Facade', slug: 'qa-intelligence-facade' },
  })
  const user = await prisma.user.create({
    data: { id: `${prefix}USER`, name: 'QA Facade', firstName: 'QA', lastName: 'Facade', username: 'qa_intelligence_facade', role: 'ADMIN', isActive: true, mustChangePassword: false },
  })
  const membership = await prisma.organizationUser.create({
    data: { id: `${prefix}MEMBERSHIP`, organizationId: organization.id, userId: user.id, role: 'ORG_ADMIN' },
  })
  const context = { organizationId: organization.id, organizationRole: membership.role, platformRole: null, userId: user.id }

  installDeterministicRouteProvider()
  try {
    await runWithOrganization(context, async () => {
      await seedPlanning()

      // A — résumé de planning sur données réelles du tenant.
      const summary = await getPlanningSummary(weekStart)
      assert.equal(factOf(summary, 'Missions affectées'), 2)
      assert.equal(factOf(summary, 'Missions à planifier'), 1)
      assert.ok(Number(factOf(summary, 'Missions analysées')) >= 1)
      assert.equal(summary.suggestions?.length, 1, 'le jeu doit produire une suggestion')
      assert.ok(summary.availableActions.every((action) => action.type === 'SIMULATE'))
      assert.ok(summary.details?.snapshotFingerprint)
      console.log('A getPlanningSummary sur tenant jetable: OK')

      // B — mission existante : contexte complet et alternatives comptées.
      const mission = await getMissionContext(weekStart, 'QA-FACADE-01')
      assert.ok(mission)
      assert.equal(factOf(mission, 'Mission'), 'QA-FACADE-01')
      assert.equal(factOf(mission, 'Statut'), 'ASSIGNED')
      assert.equal(factOf(mission, 'Chauffeur'), 'Bertrand Loin')
      assert.equal(factOf(mission, 'Camion'), 'QA-FACADE-FAR')
      assert.equal(factOf(mission, 'Remorque'), null)
      assert.equal(factOf(mission, 'Prix client enregistré'), 2000)
      assert.deepEqual(mission.missionIds, [`${prefix}MISSION`])
      assert.ok(Number(factOf(mission, 'Alternatives valides')) >= 1)
      console.log('B getMissionContext sur mission existante: OK')

      // C — mission inexistante, et résolution ambiguë par suffixe.
      assert.equal(await getMissionContext(weekStart, 'QA-FACADE-INEXISTANTE'), null)
      assert.equal((await resolveMissionReference(weekStart, 'QA-FACADE-INEXISTANTE')).status, 'NOT_FOUND')
      assert.equal((await resolveMissionReference(weekStart, 'QA-FACADE-01')).status, 'FOUND')
      console.log('C mission inexistante et résolution: OK')

      // D — données économiques incomplètes : la façade le dit, sans inventer.
      const incomplete = await getMissionContext(weekStart, 'QA-FACADE-03')
      assert.ok(incomplete)
      assert.equal(factOf(incomplete, 'Prix client enregistré'), null)
      assert.equal(factOf(incomplete, 'Chauffeur'), null)
      const estimatedCost = factOf(incomplete, 'Coût opérationnel estimé')
      const costFact = incomplete.facts.find((item) => item.label === 'Coût opérationnel estimé')
      assert.ok(estimatedCost === null || costFact?.confidence === 'LOW', 'un coût incomplet doit être nul ou de faible confiance')
      assert.ok(
        incomplete.warnings.some((warning) => /incomplète|n’ont pas pu|Estimation/i.test(warning)) || estimatedCost === null,
        'l’incomplétude doit être visible'
      )
      console.log('D données économiques incomplètes signalées honnêtement: OK')

      // E — ressource connue, sans chevauchement.
      const free = await getResourceAvailability({ weekStart, missionReference: 'QA-FACADE-01', driverName: 'Bertrand Proche' })
      assert.ok(free)
      assert.equal(factOf(free, 'Chauffeur évalué'), 'Bertrand Proche')
      assert.equal(factOf(free, 'Disponible sur le créneau'), true)
      assert.equal(factOf(free, 'Conflits détectés'), 0)
      assert.ok(free.driverIds.includes(`${prefix}DRIVER_NEAR`))
      console.log('E ressource connue et libre: OK')

      // F — ressource réellement occupée sur le créneau.
      const busy = await getResourceAvailability({ weekStart, missionReference: 'QA-FACADE-01', driverName: 'Sylvain Occupe' })
      assert.ok(busy)
      assert.equal(factOf(busy, 'Disponible sur le créneau'), false)
      assert.equal(factOf(busy, 'Conflits détectés'), 1)
      assert.ok(busy.warnings.some((warning) => warning.includes('QA-FACADE-02')), 'le conflit doit nommer la mission occupante')
      assert.deepEqual(busy.details?.conflictMissionIds, [`${prefix}MISSION_BUSY`])
      console.log('F conflit de ressource détecté et nommé: OK')

      // G — ressource inconnue, puis ambiguë.
      const unknown = await getResourceAvailability({ weekStart, missionReference: 'QA-FACADE-01', driverName: 'Personne Inconnue' })
      assert.equal(unknown?.details?.resolution, 'NOT_FOUND')
      assert.ok(unknown?.warnings.at(-1)?.includes('inconnu'))
      const ambiguous = await getResourceAvailability({ weekStart, missionReference: 'QA-FACADE-01', driverName: 'Bertrand' })
      assert.equal(ambiguous?.details?.resolution, 'AMBIGUOUS')
      assert.ok(ambiguous?.warnings.at(-1)?.includes('ambigu'))
      // Une ressource ambiguë n'est jamais validée : aucun fait de disponibilité
      // n'est produit et rien n'est affirmé sur le chauffeur visé. L'action de
      // simulation conservée porte sur la mission, pas sur la ressource, et
      // reste en lecture seule.
      assert.equal(ambiguous?.details?.candidateValidated, undefined)
      assert.equal(factOf(ambiguous, 'Disponible sur le créneau'), undefined)
      assert.equal(factOf(ambiguous, 'Chauffeur évalué'), undefined)
      assert.ok(ambiguous?.availableActions.every((action) => action.type === 'SIMULATE'))
      assert.equal(unknown?.details?.candidateValidated, undefined)
      console.log('G ressource inconnue et ressource ambiguë: OK')

      // H — camion et remorque passent par le même chemin que le chauffeur.
      const truck = await getResourceAvailability({ weekStart, missionReference: 'QA-FACADE-01', truckPlate: 'QA-FACADE-NEAR' })
      assert.equal(factOf(truck, 'Camion évalué'), 'QA-FACADE-NEAR')
      assert.equal(factOf(truck, 'Conflits détectés'), 0)
      const trailer = await getResourceAvailability({ weekStart, missionReference: 'QA-FACADE-01', trailerPlate: 'QA-INEXISTANTE' })
      assert.equal(trailer?.details?.resolution, 'NOT_FOUND')
      console.log('H camion évalué et remorque inconnue: OK')

      // I — mission introuvable ou non affectée : pas de disponibilité.
      assert.equal(await getResourceAvailability({ weekStart, missionReference: 'QA-FACADE-INEXISTANTE', driverName: 'Bertrand Proche' }), null)
      assert.equal(await getResourceAvailability({ weekStart, missionReference: 'QA-FACADE-03', driverName: 'Bertrand Proche' }), null)
      console.log('I mission introuvable ou non affectée: OK')

      // J — explication d'une suggestion valide, puis d'un identifiant inconnu.
      const suggestionId = summary.suggestions![0].id
      const explained = await explainSuggestion(weekStart, suggestionId)
      assert.ok(explained)
      assert.equal(explained.id, suggestionId)
      assert.ok(explained.scoreBreakdown.components.length === 4)
      assert.ok(explained.evidenceFingerprint)
      assert.equal(await explainSuggestion(weekStart, 'reassignment:inconnue'), null)
      console.log('J explainSuggestion, connue et inconnue: OK')

      // K — simulation : désignée, non désignée, périmée.
      const simulated = await simulateSuggestion(weekStart, suggestionId)
      assert.equal(simulated.status, 'VALID')
      assert.equal(simulated.suggestion?.id, suggestionId)
      assert.equal(simulated.snapshotFingerprint, simulated.suggestion?.snapshotFingerprint)
      assert.equal((await simulateSuggestion(weekStart, '')).status, 'UNDESIGNATED')
      assert.equal((await simulateSuggestion(weekStart, 'reassignment:inconnue')).status, 'STALE')
      console.log('K simulateSuggestion désignée, non désignée, périmée: OK')

      // L — une semaine sans mission ne produit ni suggestion ni action.
      const emptyWeek = await getPlanningSummary(new Date(2033, 5, 6))
      assert.equal(emptyWeek.suggestions?.length, 0)
      assert.deepEqual(emptyWeek.availableActions, [])
      assert.equal(factOf(emptyWeek, 'Missions affectées'), 0)
      console.log('L semaine sans mission: OK')
    })
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

main().finally(() => prisma.$disconnect())
