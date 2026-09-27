/**
 * Jeu de données jetable pour valider manuellement le flux
 * assistant → simulation → confirmation → application de Gerard Intelligence.
 *
 * Tout est créé dans une organisation dédiée, sous le préfixe QA_CHAT_APPLY_ :
 * aucune donnée opérationnelle n'est lue ni modifiée.
 *
 *   npm run qa:intelligence-chat:create
 *   npm run qa:intelligence-chat:verify
 *   npm run qa:intelligence-chat:cleanup
 */
// Le fournisseur de routes ci-dessous est déterministe et local : la clé n'est
// qu'un jeton d'activation, et la limite d'appels ne protège aucun quota ici.
process.env.GOOGLE_MAPS_API_KEY ||= 'qa-chat-apply'
process.env.GOOGLE_ROUTES_MAX_CALLS_PER_OPERATION = '200'

import { prisma } from '../lib/prisma'
import { runWithOrganization } from '../lib/auth/organization-context'
import { hashPassword } from '../lib/auth/password'
import { analyzePlanningForSuggestions } from '../lib/dispatch/suggestions/planning-service'
import { addDays, formatDateParam, getWeekStartDate, parseWeekStartParam } from '../lib/dispatch/date-utils'

const prefix = 'QA_CHAT_APPLY_'
const slug = 'qa-chat-apply'
const username = 'qa_chat_apply'
const password = 'QaChatApply!2031'
// Par défaut la semaine courante, celle que le planning ouvre au démarrage.
const requestedWeek = process.argv.find((value) => value.startsWith('--week='))?.slice('--week='.length)
const weekStart = (requestedWeek ? parseWeekStartParam(requestedWeek) : null) ?? getWeekStartDate(new Date())
const missionDay = addDays(weekStart, 1)
const missionStart = new Date(missionDay.getFullYear(), missionDay.getMonth(), missionDay.getDate(), 8)
const missionEnd = new Date(missionDay.getFullYear(), missionDay.getMonth(), missionDay.getDate(), 22)
const regulatoryReference = new Date(`${formatDateParam(missionDay)}T04:00:00.000Z`)
const dayName = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'][missionDay.getDay()] as never
const isoWeek = (() => {
  const reference = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate()))
  const yearStart = new Date(Date.UTC(reference.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((reference.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${reference.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
})()

/**
 * Points synthétiques du jeu QA. Ils sont fixes, ce qui permet de supprimer
 * exactement leurs entrées de cache de routes au nettoyage.
 */
const points = {
  pickup: { latitude: 44.10000, longitude: -2.10000 },
  delivery: { latitude: 44.60000, longitude: -2.60000 },
  near: { latitude: 44.11000, longitude: -2.11000 },
  far: { latitude: 44.90000, longitude: -2.90000 },
}

/**
 * Le poste de travail local n'a pas de clé Google. Un fournisseur déterministe
 * remplit le cache de routes une fois, pour que le serveur de développement
 * travaille ensuite sans aucun appel réseau. Les distances sont synthétiques et
 * ne servent qu'à rendre le jeu QA exploitable.
 */
function installDeterministicRouteProvider() {
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(typeof input === 'string' ? input : input instanceof URL ? input : (input as Request).url)
    if (!url.startsWith('https://routes.googleapis.com/')) return realFetch(input, init)
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      origin: { location: { latLng: { latitude: number; longitude: number } } }
      destination: { location: { latLng: { latitude: number; longitude: number } } }
    }
    const from = body.origin.location.latLng
    const to = body.destination.location.latLng
    const toRadians = (value: number) => (value * Math.PI) / 180
    const deltaLat = toRadians(to.latitude - from.latitude)
    const deltaLng = toRadians(to.longitude - from.longitude)
    const haversine = Math.sin(deltaLat / 2) ** 2 + Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(deltaLng / 2) ** 2
    const kilometres = 6371 * 2 * Math.asin(Math.sqrt(haversine)) * 1.25
    return new Response(JSON.stringify({
      routes: [{
        distanceMeters: Math.max(1, Math.round(kilometres * 1000)),
        duration: `${Math.max(60, Math.round((kilometres / 70) * 3600))}s`,
        polyline: { encodedPolyline: 'qa-chat-apply' },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  return () => { globalThis.fetch = realFetch }
}

function declaration(driverId: string, id: string) {
  return {
    id,
    driverId,
    source: 'QA' as const,
    referenceAt: regulatoryReference,
    timeZone: 'Europe/Luxembourg',
    drivingSinceValidBreakSeconds: 0,
    dailyDrivingSeconds: 0,
    weeklyDrivingSeconds: 0,
    previousWeekDrivingSeconds: 0,
    dailyExtensionsUsedThisWeek: 0,
    reducedDailyRestsUsedSinceWeeklyRest: 0,
    lastValidRestEndedAt: regulatoryReference,
    dutyPeriodStartedAt: regulatoryReference,
    currentIsoWeek: isoWeek,
  }
}

async function context() {
  const membership = await prisma.organizationUser.findFirst({
    where: { organizationId: `${prefix}ORG` },
    include: { user: true },
  })
  if (!membership) throw new Error('QA_CHAT_APPLY_NOT_CREATED')
  return {
    organizationId: membership.organizationId,
    organizationRole: membership.role,
    platformRole: membership.user.platformRole,
    userId: membership.userId,
  }
}

async function create() {
  await prisma.organization.upsert({
    where: { id: `${prefix}ORG` },
    update: {},
    create: { id: `${prefix}ORG`, name: 'QA Chat Apply', slug },
  })
  await prisma.user.upsert({
    where: { id: `${prefix}USER` },
    update: { passwordHash: hashPassword(password), mustChangePassword: false, isActive: true },
    create: {
      id: `${prefix}USER`,
      name: 'QA Chat Apply',
      firstName: 'QA',
      lastName: 'Chat',
      username,
      role: 'ADMIN',
      isActive: true,
      mustChangePassword: false,
      passwordHash: hashPassword(password),
    },
  })
  await prisma.organizationUser.upsert({
    where: { id: `${prefix}MEMBERSHIP` },
    update: {},
    create: { id: `${prefix}MEMBERSHIP`, organizationId: `${prefix}ORG`, userId: `${prefix}USER`, role: 'ORG_ADMIN' },
  })

  await runWithOrganization(await context(), async () => {
    await prisma.driver.create({ data: { id: `${prefix}DRIVER_FAR`, name: 'QA Chauffeur éloigné', hourlyCostAmount: 20 } })
    await prisma.driver.create({ data: { id: `${prefix}DRIVER_NEAR`, name: 'QA Chauffeur proche', hourlyCostAmount: 20 } })
    await prisma.truck.create({ data: { id: `${prefix}TRUCK_FAR`, plateNumber: 'QA-CHAT-FAR', driverId: `${prefix}DRIVER_FAR` } })
    await prisma.truck.create({ data: { id: `${prefix}TRUCK_NEAR`, plateNumber: 'QA-CHAT-NEAR', driverId: `${prefix}DRIVER_NEAR` } })
    await prisma.planningRow.create({ data: { id: `${prefix}ROW_FAR`, weekStartDate: weekStart, driverId: `${prefix}DRIVER_FAR`, truckId: `${prefix}TRUCK_FAR`, sortOrder: 0 } })
    await prisma.planningRow.create({ data: { id: `${prefix}ROW_NEAR`, weekStartDate: weekStart, driverId: `${prefix}DRIVER_NEAR`, truckId: `${prefix}TRUCK_NEAR`, sortOrder: 1 } })
    await prisma.driverPosition.createMany({
      data: [
        { id: `${prefix}POSITION_FAR`, driverId: `${prefix}DRIVER_FAR`, latitude: points.far.latitude, longitude: points.far.longitude, provider: 'DRIVER_PHONE', recordedAt: regulatoryReference, accuracy: 10 },
        { id: `${prefix}POSITION_NEAR`, driverId: `${prefix}DRIVER_NEAR`, latitude: points.near.latitude, longitude: points.near.longitude, provider: 'DRIVER_PHONE', recordedAt: regulatoryReference, accuracy: 10 },
      ],
    })
    await prisma.driverRegulatoryDeclaration.createMany({
      data: [declaration(`${prefix}DRIVER_FAR`, `${prefix}DECLARATION_FAR`), declaration(`${prefix}DRIVER_NEAR`, `${prefix}DECLARATION_NEAR`)],
    })
    // Mission jamais affectée : alimente l'insight UNASSIGNED_MISSION.
    await prisma.mission.create({
      data: {
        id: `${prefix}MISSION_PENDING`,
        reference: 'QA-CHAT-APPLY-02',
        clientName: 'QA Client Chat',
        status: 'PENDING',
        pickupDate: missionStart,
        deliveryDate: missionEnd,
        pickupResolvedAddress: 'QA-CHAT-PICKUP-2',
        deliveryResolvedAddress: 'QA-CHAT-DELIVERY-2',
        pickupLat: points.pickup.latitude + 0.05,
        pickupLng: points.pickup.longitude - 0.05,
        deliveryLat: points.delivery.latitude + 0.05,
        deliveryLng: points.delivery.longitude - 0.05,
        routeDurationSeconds: 4200,
      },
    })
    await prisma.mission.create({
      data: {
        id: `${prefix}MISSION`,
        reference: 'QA-CHAT-APPLY-01',
        clientName: 'QA Client Chat',
        status: 'ASSIGNED',
        pickupDate: missionStart,
        deliveryDate: missionEnd,
        pickupAddress: 'QA Enlèvement',
        deliveryAddress: 'QA Livraison',
        pickupResolvedAddress: 'QA-CHAT-PICKUP',
        deliveryResolvedAddress: 'QA-CHAT-DELIVERY',
        pickupLat: points.pickup.latitude,
        pickupLng: points.pickup.longitude,
        deliveryLat: points.delivery.latitude,
        deliveryLng: points.delivery.longitude,
        priceAmount: 2000,
        priceCurrency: 'EUR',
        estimatedKm: 78,
        routeDistanceMeters: 78000,
        routeDurationSeconds: 4200,
        routeProvider: 'GOOGLE_ROUTES',
        routeCalculatedAt: regulatoryReference,
      },
    })
    await prisma.driver.create({ data: { id: `${prefix}DRIVER_THIRD`, name: 'QA Chauffeur tiers', hourlyCostAmount: 20 } })
    await prisma.truck.create({ data: { id: `${prefix}TRUCK_THIRD`, plateNumber: 'QA-CHAT-THIRD', driverId: `${prefix}DRIVER_THIRD` } })
    await prisma.planningRow.create({ data: { id: `${prefix}ROW_THIRD`, weekStartDate: weekStart, driverId: `${prefix}DRIVER_THIRD`, truckId: `${prefix}TRUCK_THIRD`, sortOrder: 2 } })
    // Mission affectée mais incomplète : alimente INCOMPLETE_CRITICAL_DATA.
    await prisma.mission.create({
      data: {
        id: `${prefix}MISSION_INCOMPLETE`,
        reference: 'QA-CHAT-APPLY-03',
        clientName: 'QA Client Chat',
        status: 'ASSIGNED',
        pickupDate: missionStart,
        deliveryDate: missionEnd,
        pickupCity: 'Ville départ',
        deliveryCity: 'Ville arrivée',
      },
    })
    await prisma.missionAssignment.create({
      data: {
        id: `${prefix}ASSIGNMENT_INCOMPLETE`,
        missionId: `${prefix}MISSION_INCOMPLETE`,
        planningRowId: `${prefix}ROW_THIRD`,
        driverId: `${prefix}DRIVER_THIRD`,
        truckId: `${prefix}TRUCK_THIRD`,
        day: dayName,
        scheduledDate: missionStart,
        plannedEndAt: missionEnd,
      },
    })
    await prisma.missionAssignment.create({
      data: {
        id: `${prefix}ASSIGNMENT`,
        missionId: `${prefix}MISSION`,
        planningRowId: `${prefix}ROW_FAR`,
        driverId: `${prefix}DRIVER_FAR`,
        truckId: `${prefix}TRUCK_FAR`,
        day: dayName,
        scheduledDate: missionStart,
        plannedEndAt: missionEnd,
        approachDistanceMeters: 139000,
        approachDurationSeconds: 7150,
        approachProvider: 'GOOGLE_ROUTES',
        approachCalculatedAt: regulatoryReference,
      },
    })
  })
  const restoreFetch = installDeterministicRouteProvider()
  try {
    const primed = await runWithOrganization(await context(), () => analyzePlanningForSuggestions(weekStart))
    console.log(`Cache de routes amorcé : ${primed.suggestions.length} suggestion(s) disponible(s).`)
  } finally { restoreFetch() }
  console.log(`QA chat apply prêt. Connexion ${username} / ${password}, semaine du ${formatDateParam(weekStart)}.`)
}

async function verify() {
  await runWithOrganization(await context(), async () => {
    const analysis = await analyzePlanningForSuggestions(weekStart)
    const assignment = await prisma.missionAssignment.findUnique({ where: { id: `${prefix}ASSIGNMENT` } })
    const applications = await prisma.dispatchOptimizationApplication.findMany({ orderBy: { createdAt: 'asc' } })
    const events = await prisma.missionEvent.findMany({ where: { missionId: `${prefix}MISSION` } })
    console.log(JSON.stringify({
      diagnostics: analysis.missionDiagnostics,
      summary: analysis.summary,
      suggestions: analysis.suggestions.map((item) => ({ id: item.id, emptyKmDelta: item.impact.emptyKm.delta })),
      assignment: { planningRowId: assignment?.planningRowId, driverId: assignment?.driverId, truckId: assignment?.truckId },
      applications: applications.map((item) => ({ idempotencyKey: item.idempotencyKey, simulationId: item.simulationId, strategy: item.strategy, actorId: item.actorId, result: item.resultSummary })),
      events: events.map((item) => ({ type: item.type, origin: (item.metadata as Record<string, unknown>)?.origin })),
    }, null, 2))
  })
}

async function cleanup() {
  const membership = await prisma.organizationUser.findFirst({ where: { organizationId: `${prefix}ORG` }, include: { user: true } })
  if (membership) {
    await runWithOrganization({
      organizationId: membership.organizationId,
      organizationRole: membership.role,
      platformRole: membership.user.platformRole,
      userId: membership.userId,
    }, async () => {
      await prisma.missionEvent.deleteMany({ where: { missionId: { startsWith: prefix } } })
      await prisma.dispatchOptimizationApplication.deleteMany({ where: { actorId: `${prefix}USER` } })
      await prisma.missionAssignment.deleteMany({ where: { id: { startsWith: prefix } } })
      await prisma.mission.deleteMany({ where: { id: { startsWith: prefix } } })
      await prisma.planningRow.deleteMany({ where: { id: { startsWith: prefix } } })
      await prisma.driverPosition.deleteMany({ where: { id: { startsWith: prefix } } })
      await prisma.driverRegulatoryDeclaration.deleteMany({ where: { id: { startsWith: prefix } } })
      await prisma.truck.deleteMany({ where: { id: { startsWith: prefix } } })
      await prisma.driver.deleteMany({ where: { id: { startsWith: prefix } } })
    })
  }
  await prisma.organizationUser.deleteMany({ where: { id: { startsWith: prefix } } })
  await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } })
  await prisma.organization.deleteMany({ where: { id: { startsWith: prefix } } })
  // Le cache de routes est global : on ne retire que les entrées dont une
  // extrémité est exactement un point synthétique du jeu QA.
  for (const point of Object.values(points)) {
    await prisma.routeCache.deleteMany({ where: { originLat: point.latitude, originLng: point.longitude } })
    await prisma.routeCache.deleteMany({ where: { destinationLat: point.latitude, destinationLng: point.longitude } })
  }
  console.log('QA chat apply supprimé.')
}

const mode = process.argv.includes('--cleanup') ? cleanup : process.argv.includes('--verify') ? verify : create
mode().finally(() => prisma.$disconnect())
