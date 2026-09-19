import { scryptSync } from 'crypto'

import {
  MissionEventType,
  MissionStatus,
  PlanningDay,
  PrismaClient,
  TrailerCargoType,
  TrailerCustodyState,
  TrailerLoadStatus,
  TrailerStatus,
  TrailerType,
  TruckStatus,
  UserRole,
} from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

import { requireGerardDemoDatabaseUrl } from '../../lib/demo-database-guard'
import { PARK_SPOTS } from '../../lib/park/site-plan'

export const GERARD_DEMO_ADMIN = {
  username: 'admin',
  email: 'admin@gerard.demo',
  password: 'GerardDemo!2026',
} as const

export const GERARD_DEMO_DRIVER = {
  username: 'marc.denis',
  email: 'marc.denis@gerard.demo',
  password: 'MarcDemo!2026',
} as const

const DEMO_PREFIX = 'demo-gerard-'
// Minuit local Europe/Berlin le 14 septembre 2026 (UTC+2).
const WEEK_START = new Date('2026-09-13T22:00:00.000Z')

function demoPasswordHash(password: string, account: string) {
  const salt = Buffer.from(`gerard-demo-${account}`).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `scrypt:${salt}:${hash}`
}

function at(day: number, hour: number, minute = 0) {
  return new Date(Date.UTC(2026, 8, day, hour, minute))
}

type DemoClient = {
  key: string
  name: string
  email: string
}

const clients: DemoClient[] = [
  { key: 'translog', name: 'Translog Nord', email: 'dispatch@translog-nord.demo' },
  { key: 'atlas', name: 'Atlas Freight', email: 'ops@atlasfreight.demo' },
  { key: 'helios', name: 'Helios Transport', email: 'planning@helios-transport.demo' },
  { key: 'delta', name: 'Delta Routes', email: 'commandes@delta-routes.demo' },
  { key: 'euromove', name: 'Euromove Cargo', email: 'expedition@euromove-cargo.demo' },
]

const drivers = [
  { key: 'marc', name: 'Marc Denis', email: 'marc.denis@gerard.demo', phone: '+352 621 000 101' },
  { key: 'karim', name: 'Karim El Mansouri', email: 'karim.el-mansouri@gerard.demo', phone: '+352 621 000 102' },
  { key: 'julien', name: 'Julien Morel', email: 'julien.morel@gerard.demo', phone: '+352 621 000 103' },
  { key: 'sofia', name: 'Sofia Marin', email: 'sofia.marin@gerard.demo', phone: '+352 621 000 104' },
] as const

const trucks = [
  { key: 'marc', plate: 'GX-482-LM', brand: 'Mercedes', model: 'Actros' },
  { key: 'karim', plate: 'TR-915-KV', brand: 'Volvo', model: 'FH16' },
  { key: 'julien', plate: 'AB-274-XD', brand: 'Scania', model: 'R450' },
  { key: 'sofia', plate: 'TR-338-QP', brand: 'DAF', model: 'XF' },
] as const

const trailers = [
  { key: 'marc', plate: 'RM-204-TL', type: TrailerType.CURTAINSIDER },
  { key: 'karim', plate: 'SR-118-DK', type: TrailerType.CURTAINSIDER },
  { key: 'julien', plate: 'PL-663-NT', type: TrailerType.FLATBED },
  { key: 'sofia', plate: 'RM-291-VC', type: TrailerType.CURTAINSIDER },
] as const

type MissionSeed = {
  reference: string
  client: string
  pickupCity: string
  deliveryCity: string
  pickup: [number, number]
  delivery: [number, number]
  pickupDate: Date
  deliveryDate: Date
  distanceKm: number
  price: number
  status: MissionStatus
  driver?: 'marc' | 'karim' | 'julien' | 'sofia'
  day?: PlanningDay
  plannedEndAt?: Date
  trailer?: 'marc' | 'karim' | 'julien' | 'sofia'
}

const missions: MissionSeed[] = [
  { reference: 'GRD-260914-01', client: 'Translog Nord', pickupCity: 'Luxembourg', deliveryCity: 'Anvers', pickup: [49.6117, 6.1319], delivery: [51.2194, 4.4025], pickupDate: at(14, 7), deliveryDate: at(14, 16), distanceKm: 257, price: 1180, status: MissionStatus.DONE, driver: 'marc', day: PlanningDay.MONDAY, plannedEndAt: at(14, 16), trailer: 'marc' },
  { reference: 'GRD-260914-02', client: 'Atlas Freight', pickupCity: 'Liège', deliveryCity: 'Rotterdam', pickup: [50.6326, 5.5797], delivery: [51.9244, 4.4777], pickupDate: at(14, 6, 30), deliveryDate: at(14, 15, 30), distanceKm: 226, price: 1090, status: MissionStatus.DONE, driver: 'karim', day: PlanningDay.MONDAY, plannedEndAt: at(14, 15, 30), trailer: 'karim' },
  { reference: 'GRD-260914-03', client: 'Helios Transport', pickupCity: 'Namur', deliveryCity: 'Cologne', pickup: [50.4674, 4.8718], delivery: [50.9375, 6.9603], pickupDate: at(14, 8), deliveryDate: at(14, 17), distanceKm: 209, price: 980, status: MissionStatus.DONE, driver: 'julien', day: PlanningDay.MONDAY, plannedEndAt: at(14, 17), trailer: 'julien' },
  { reference: 'GRD-260914-04', client: 'Delta Routes', pickupCity: 'Metz', deliveryCity: 'Strasbourg', pickup: [49.1193, 6.1757], delivery: [48.5734, 7.7521], pickupDate: at(14, 7, 30), deliveryDate: at(14, 14, 30), distanceKm: 165, price: 860, status: MissionStatus.DONE, driver: 'sofia', day: PlanningDay.MONDAY, plannedEndAt: at(14, 14, 30), trailer: 'sofia' },
  { reference: 'GRD-260915-16', client: 'Delta Routes', pickupCity: 'Esch-sur-Alzette', deliveryCity: 'Liège', pickup: [49.4958, 5.9806], delivery: [50.6326, 5.5797], pickupDate: at(15, 7), deliveryDate: at(15, 13), distanceKm: 154, price: 790, status: MissionStatus.DONE, driver: 'marc', day: PlanningDay.TUESDAY, plannedEndAt: at(15, 13), trailer: 'marc' },
  { reference: 'GRD-260915-17', client: 'Euromove Cargo', pickupCity: 'Arlon', deliveryCity: 'Bruxelles', pickup: [49.6833, 5.8167], delivery: [50.8503, 4.3517], pickupDate: at(15, 7, 30), deliveryDate: at(15, 14, 30), distanceKm: 194, price: 940, status: MissionStatus.DONE, driver: 'karim', day: PlanningDay.TUESDAY, plannedEndAt: at(15, 14, 30), trailer: 'karim' },
  { reference: 'GRD-260915-18', client: 'Translog Nord', pickupCity: 'Charleroi', deliveryCity: 'Luxembourg', pickup: [50.4108, 4.4446], delivery: [49.6117, 6.1319], pickupDate: at(15, 8), deliveryDate: at(15, 15), distanceKm: 196, price: 960, status: MissionStatus.DONE, driver: 'julien', day: PlanningDay.TUESDAY, plannedEndAt: at(15, 15), trailer: 'julien' },
  { reference: 'GRD-260915-19', client: 'Atlas Freight', pickupCity: 'Metz', deliveryCity: 'Namur', pickup: [49.1193, 6.1757], delivery: [50.4674, 4.8718], pickupDate: at(15, 6, 45), deliveryDate: at(15, 14), distanceKm: 191, price: 910, status: MissionStatus.DONE, driver: 'sofia', day: PlanningDay.TUESDAY, plannedEndAt: at(15, 14), trailer: 'sofia' },
  { reference: 'GRD-260916-05', client: 'Euromove Cargo', pickupCity: 'Luxembourg', deliveryCity: 'Bruxelles', pickup: [49.6117, 6.1319], delivery: [50.8503, 4.3517], pickupDate: at(16, 7), deliveryDate: at(16, 16), distanceKm: 221, price: 1040, status: MissionStatus.ASSIGNED, driver: 'marc', day: PlanningDay.WEDNESDAY, plannedEndAt: at(16, 16), trailer: 'marc' },
  { reference: 'GRD-260916-06', client: 'Translog Nord', pickupCity: 'Charleroi', deliveryCity: 'Düsseldorf', pickup: [50.4108, 4.4446], delivery: [51.2277, 6.7735], pickupDate: at(16, 6, 30), deliveryDate: at(16, 15, 30), distanceKm: 228, price: 1120, status: MissionStatus.ASSIGNED, driver: 'karim', day: PlanningDay.WEDNESDAY, plannedEndAt: at(16, 15, 30), trailer: 'karim' },
  { reference: 'GRD-260916-07', client: 'Atlas Freight', pickupCity: 'Liège', deliveryCity: 'Reims', pickup: [50.6326, 5.5797], delivery: [49.2583, 4.0317], pickupDate: at(16, 8), deliveryDate: at(16, 16), distanceKm: 236, price: 990, status: MissionStatus.ASSIGNED, driver: 'julien', day: PlanningDay.WEDNESDAY, plannedEndAt: at(16, 16), trailer: 'julien' },
  { reference: 'GRD-260916-08', client: 'Helios Transport', pickupCity: 'Arlon', deliveryCity: 'Lille', pickup: [49.6833, 5.8167], delivery: [50.6292, 3.0573], pickupDate: at(16, 7, 15), deliveryDate: at(16, 16, 30), distanceKm: 247, price: 1160, status: MissionStatus.ASSIGNED, driver: 'sofia', day: PlanningDay.WEDNESDAY, plannedEndAt: at(16, 16, 30), trailer: 'sofia' },
  { reference: 'GRD-260917-20', client: 'Helios Transport', pickupCity: 'Luxembourg', deliveryCity: 'Cologne', pickup: [49.6117, 6.1319], delivery: [50.9375, 6.9603], pickupDate: at(17, 7), deliveryDate: at(17, 15), distanceKm: 214, price: 1080, status: MissionStatus.ASSIGNED, driver: 'marc', day: PlanningDay.THURSDAY, plannedEndAt: at(17, 15), trailer: 'marc' },
  { reference: 'GRD-260917-21', client: 'Delta Routes', pickupCity: 'Namur', deliveryCity: 'Anvers', pickup: [50.4674, 4.8718], delivery: [51.2194, 4.4025], pickupDate: at(17, 7, 30), deliveryDate: at(17, 14), distanceKm: 128, price: 760, status: MissionStatus.ASSIGNED, driver: 'karim', day: PlanningDay.THURSDAY, plannedEndAt: at(17, 14), trailer: 'karim' },
  { reference: 'GRD-260917-22', client: 'Euromove Cargo', pickupCity: 'Sedan', deliveryCity: 'Düsseldorf', pickup: [49.7019, 4.9403], delivery: [51.2277, 6.7735], pickupDate: at(17, 6, 45), deliveryDate: at(17, 15, 30), distanceKm: 245, price: 1190, status: MissionStatus.ASSIGNED, driver: 'julien', day: PlanningDay.THURSDAY, plannedEndAt: at(17, 15, 30), trailer: 'julien' },
  { reference: 'GRD-260917-23', client: 'Atlas Freight', pickupCity: 'Liège', deliveryCity: 'Gand', pickup: [50.6326, 5.5797], delivery: [51.0543, 3.7174], pickupDate: at(17, 8), deliveryDate: at(17, 14, 30), distanceKm: 153, price: 820, status: MissionStatus.ASSIGNED, driver: 'sofia', day: PlanningDay.THURSDAY, plannedEndAt: at(17, 14, 30), trailer: 'sofia' },
  { reference: 'GRD-260918-09', client: 'Delta Routes', pickupCity: 'Bruxelles', deliveryCity: 'Gand', pickup: [50.8503, 4.3517], delivery: [51.0543, 3.7174], pickupDate: at(18, 7), deliveryDate: at(18, 11), distanceKm: 58, price: 520, status: MissionStatus.ASSIGNED, driver: 'karim', day: PlanningDay.FRIDAY, plannedEndAt: at(18, 11), trailer: 'karim' },
  { reference: 'GRD-260918-10', client: 'Euromove Cargo', pickupCity: 'Namur', deliveryCity: 'Mons', pickup: [50.4674, 4.8718], delivery: [50.4542, 3.9523], pickupDate: at(18, 8), deliveryDate: at(18, 12), distanceKm: 75, price: 610, status: MissionStatus.ASSIGNED, driver: 'julien', day: PlanningDay.FRIDAY, plannedEndAt: at(18, 12), trailer: 'julien' },
  { reference: 'GRD-260918-11', client: 'Translog Nord', pickupCity: 'Metz', deliveryCity: 'Nancy', pickup: [49.1193, 6.1757], delivery: [48.6921, 6.1844], pickupDate: at(18, 9), deliveryDate: at(18, 13), distanceKm: 58, price: 540, status: MissionStatus.ASSIGNED, driver: 'sofia', day: PlanningDay.FRIDAY, plannedEndAt: at(18, 13), trailer: 'sofia' },
  { reference: 'GRD-260918-12', client: 'Translog Nord', pickupCity: 'Charleroi', deliveryCity: 'Reims', pickup: [50.4108, 4.4446], delivery: [49.2583, 4.0317], pickupDate: at(18, 8), deliveryDate: at(18, 13), distanceKm: 284, price: 1320, status: MissionStatus.PENDING },
  { reference: 'GRD-260918-13', client: 'Atlas Freight', pickupCity: 'Liège', deliveryCity: 'Lille', pickup: [50.6326, 5.5797], delivery: [50.6292, 3.0573], pickupDate: at(18, 7), deliveryDate: at(18, 12), distanceKm: 213, price: 1010, status: MissionStatus.PENDING },
  { reference: 'GRD-260918-14', client: 'Helios Transport', pickupCity: 'Namur', deliveryCity: 'Luxembourg', pickup: [50.4674, 4.8718], delivery: [49.6117, 6.1319], pickupDate: at(18, 8, 30), deliveryDate: at(18, 12, 30), distanceKm: 169, price: 890, status: MissionStatus.PENDING },
  { reference: 'GRD-260918-15', client: 'Euromove Cargo', pickupCity: 'Sedan', deliveryCity: 'Reims', pickup: [49.7019, 4.9403], delivery: [49.2583, 4.0317], pickupDate: at(18, 9), deliveryDate: at(18, 13), distanceKm: 101, price: 680, status: MissionStatus.PENDING },
]

export function createGerardDemoPrisma() {
  const connectionString = requireGerardDemoDatabaseUrl()
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

async function deleteGerardDemoData(prisma: PrismaClient) {
  const demoMissions = await prisma.mission.findMany({
    where: { reference: { startsWith: 'GRD-' } },
    select: { id: true },
  })
  const missionIds = demoMissions.map(({ id }) => id)

  await prisma.$transaction([
    prisma.missionEvent.deleteMany({ where: { missionId: { in: missionIds } } }),
    prisma.missionAssignment.deleteMany({ where: { missionId: { in: missionIds } } }),
    prisma.driverActivityEvent.deleteMany({ where: { missionId: { in: missionIds } } }),
    prisma.trailerCustodyEvent.deleteMany({ where: { missionId: { in: missionIds } } }),
    prisma.mission.deleteMany({ where: { id: { in: missionIds } } }),
    prisma.driverPosition.deleteMany({ where: { driverId: { startsWith: DEMO_PREFIX } } }),
    prisma.truckPosition.deleteMany({ where: { truckId: { startsWith: DEMO_PREFIX } } }),
    prisma.planningRow.deleteMany({
      where: {
        OR: [
          { id: { startsWith: DEMO_PREFIX } },
          { driverId: { startsWith: DEMO_PREFIX } },
          { truckId: { startsWith: DEMO_PREFIX } },
        ],
      },
    }),
    prisma.user.deleteMany({ where: { id: { startsWith: DEMO_PREFIX } } }),
    prisma.trailer.deleteMany({ where: { id: { startsWith: DEMO_PREFIX } } }),
    prisma.truck.deleteMany({ where: { id: { startsWith: DEMO_PREFIX } } }),
    prisma.driver.deleteMany({ where: { id: { startsWith: DEMO_PREFIX } } }),
    prisma.clientProfile.deleteMany({ where: { id: { startsWith: DEMO_PREFIX } } }),
  ])
}

export async function replaceGerardDemoData(prisma: PrismaClient) {
  await deleteGerardDemoData(prisma)

  const driverIds = Object.fromEntries(drivers.map(({ key }) => [key, `${DEMO_PREFIX}driver-${key}`]))
  const truckIds = Object.fromEntries(trucks.map(({ key }) => [key, `${DEMO_PREFIX}truck-${key}`]))
  const trailerIds = Object.fromEntries(trailers.map(({ key }) => [key, `${DEMO_PREFIX}trailer-${key}`]))
  const rowIds = Object.fromEntries(drivers.map(({ key }) => [key, `${DEMO_PREFIX}row-${key}`]))

  await prisma.$transaction(async (tx) => {
    for (const client of clients) {
      await tx.clientProfile.create({ data: {
        id: `${DEMO_PREFIX}client-${client.key}`,
        name: client.name,
        displayName: client.name,
        contactEmails: [client.email],
        isActive: true,
        createdAt: at(1, 8),
        updatedAt: at(1, 8),
      } })
    }

    for (const driver of drivers) {
      await tx.driver.create({ data: {
        id: driverIds[driver.key],
        name: driver.name,
        email: driver.email,
        phone: driver.phone,
        status: 'ACTIVE',
        createdAt: at(1, 8),
        updatedAt: at(1, 8),
      } })
    }

    for (const truck of trucks) {
      await tx.truck.create({ data: {
        id: truckIds[truck.key],
        plateNumber: truck.plate,
        brand: truck.brand,
        model: truck.model,
        status: truck.key === 'sofia' ? TruckStatus.AT_BASE : TruckStatus.ASSIGNED,
        statusUpdatedAt: at(14, 6),
        driverId: driverIds[truck.key],
        category: 'TRACTOR',
        capacityKg: 24000,
        createdAt: at(1, 8),
        updatedAt: at(1, 8),
      } })
    }

    for (const trailer of trailers) {
      await tx.trailer.create({ data: {
        id: trailerIds[trailer.key],
        plateNumber: trailer.plate,
        type: trailer.type,
        status: ['marc', 'sofia'].includes(trailer.key) ? TrailerStatus.AT_BASE : TrailerStatus.ASSIGNED,
        loadStatus: TrailerLoadStatus.EMPTY,
        cargoType: TrailerCargoType.PALLETS,
        custodyState: TrailerCustodyState.EMPTY,
        truckId: trailer.key === 'marc' ? null : truckIds[trailer.key],
        capacityKg: 24000,
        createdAt: at(1, 8),
        updatedAt: at(1, 8),
      } })
    }

    for (const spot of PARK_SPOTS) {
      await tx.parkSpot.upsert({
        where: { code: spot.code },
        create: { ...spot, isActive: true },
        update: { ...spot, isActive: true },
      })
    }

    await tx.user.createMany({ data: [
      {
        id: `${DEMO_PREFIX}user-admin`, name: 'Gerard Admin', firstName: 'Gerard', lastName: 'Admin',
        email: GERARD_DEMO_ADMIN.email, username: GERARD_DEMO_ADMIN.username,
        passwordHash: demoPasswordHash(GERARD_DEMO_ADMIN.password, 'admin'), role: UserRole.ADMIN,
        isActive: true, mustChangePassword: false, passwordChangedAt: at(1, 8), createdAt: at(1, 8), updatedAt: at(1, 8),
      },
      {
        id: `${DEMO_PREFIX}user-marc`, name: 'Marc Denis', firstName: 'Marc', lastName: 'Denis',
        email: GERARD_DEMO_DRIVER.email, username: GERARD_DEMO_DRIVER.username,
        passwordHash: demoPasswordHash(GERARD_DEMO_DRIVER.password, 'marc'), role: UserRole.DRIVER,
        driverId: driverIds.marc, isActive: true, mustChangePassword: false,
        passwordChangedAt: at(1, 8), createdAt: at(1, 8), updatedAt: at(1, 8),
      },
    ] })

    for (let index = 0; index < drivers.length; index += 1) {
      const driver = drivers[index]
      await tx.planningRow.create({ data: {
        id: rowIds[driver.key], weekStartDate: WEEK_START, sortOrder: index,
        driverId: driverIds[driver.key], truckId: truckIds[driver.key],
        trailerId: trailerIds[driver.key] ?? null, pairLocked: true,
        usualTruckIdSnapshot: truckIds[driver.key], createdAt: at(1, 8), updatedAt: at(1, 8),
      } })
    }

    for (let index = 0; index < missions.length; index += 1) {
      const mission = missions[index]
      const missionId = `${DEMO_PREFIX}mission-${mission.reference.toLowerCase()}`
      const createdAt = at(2, 8, index)
      await tx.mission.create({ data: {
        id: missionId,
        reference: mission.reference,
        title: `${mission.pickupCity} → ${mission.deliveryCity}`,
        clientName: mission.client,
        pickupCity: mission.pickupCity,
        deliveryCity: mission.deliveryCity,
        pickupAddress: `Zone logistique fictive, ${mission.pickupCity}`,
        deliveryAddress: `Zone logistique fictive, ${mission.deliveryCity}`,
        pickupLat: mission.pickup[0], pickupLng: mission.pickup[1],
        deliveryLat: mission.delivery[0], deliveryLng: mission.delivery[1],
        pickupDate: mission.pickupDate, deliveryDate: mission.deliveryDate,
        estimatedKm: mission.distanceKm,
        routeDistanceMeters: mission.distanceKm * 1000,
        routeDurationSeconds: Math.round((mission.distanceKm / 65) * 3600),
        routeCalculatedAt: at(10, 10), routeProvider: 'GERARD_DEMO',
        priceAmount: mission.price, priceCurrency: 'EUR',
        paymentTerms: '30 jours', requiredTruckType: 'Semi-remorque',
        preparationStatus: 'READY', pickupResolutionStatus: 'CONFIRMED', deliveryResolutionStatus: 'CONFIRMED',
        pickupResolutionMethod: 'MANUAL', deliveryResolutionMethod: 'MANUAL',
        pickupResolvedAt: at(10, 10), deliveryResolvedAt: at(10, 10),
        pickupResolvedAddress: `Zone logistique fictive, ${mission.pickupCity}`,
        deliveryResolvedAddress: `Zone logistique fictive, ${mission.deliveryCity}`,
        status: mission.status,
        notes: 'Données entièrement fictives pour la démonstration Gerard.',
        createdAt, updatedAt: createdAt,
      } })

      if (mission.driver && mission.day && mission.plannedEndAt) {
        await tx.missionAssignment.create({ data: {
          id: `${DEMO_PREFIX}assignment-${mission.reference.toLowerCase()}`,
          missionId, planningRowId: rowIds[mission.driver], driverId: driverIds[mission.driver],
          truckId: truckIds[mission.driver], trailerId: mission.trailer ? trailerIds[mission.trailer] : null,
          day: mission.day, scheduledDate: mission.pickupDate, plannedEndAt: mission.plannedEndAt,
          sortOrder: index, approachDistanceMeters: 12000 + index * 900,
          approachDurationSeconds: 900 + index * 30, approachCalculatedAt: at(10, 10),
          approachProvider: 'GERARD_DEMO', createdAt, updatedAt: createdAt,
        } })
      }
    }

    const positions = [
      ['marc', 50.8503, 4.3517], ['karim', 50.6326, 5.5797],
      ['julien', 49.6117, 6.1319], ['sofia', 49.1193, 6.1757],
    ] as const
    for (const [key, latitude, longitude] of positions) {
      await tx.driverPosition.create({ data: {
        id: `${DEMO_PREFIX}position-${key}`, driverId: driverIds[key], truckId: truckIds[key],
        latitude, longitude, accuracy: 18, speedKmh: 0, heading: 0,
        provider: 'DEMO_SIMULATED', recordedAt: at(15, 8), createdAt: at(15, 8),
      } })
    }

    const marcDoneId = `${DEMO_PREFIX}mission-grd-260914-01`
    const marcAssignedId = `${DEMO_PREFIX}mission-grd-260916-05`
    const heroId = `${DEMO_PREFIX}mission-grd-260918-12`
    await tx.missionEvent.createMany({ data: [
      { id: `${DEMO_PREFIX}event-01`, missionId: marcDoneId, actorId: `${DEMO_PREFIX}user-admin`, type: MissionEventType.CREATED, message: 'Mission créée.', toStatus: MissionStatus.PENDING, createdAt: at(11, 8) },
      { id: `${DEMO_PREFIX}event-02`, missionId: marcDoneId, actorId: `${DEMO_PREFIX}user-admin`, driverId: driverIds.marc, truckId: truckIds.marc, trailerId: trailerIds.marc, type: MissionEventType.ASSIGNED, message: 'Mission affectée à Marc Denis.', fromStatus: MissionStatus.PENDING, toStatus: MissionStatus.ASSIGNED, createdAt: at(11, 9) },
      { id: `${DEMO_PREFIX}event-03`, missionId: marcDoneId, driverId: driverIds.marc, truckId: truckIds.marc, type: MissionEventType.STATUS_CHANGED, message: 'Mission démarrée.', fromStatus: MissionStatus.ASSIGNED, toStatus: MissionStatus.IN_PROGRESS, createdAt: at(14, 7) },
      { id: `${DEMO_PREFIX}event-04`, missionId: marcDoneId, driverId: driverIds.marc, truckId: truckIds.marc, type: MissionEventType.NOTE_ADDED, message: 'Arrivée au chargement.', createdAt: at(14, 8, 15) },
      { id: `${DEMO_PREFIX}event-05`, missionId: marcDoneId, driverId: driverIds.marc, truckId: truckIds.marc, type: MissionEventType.COMPLETED, message: 'Mission terminée.', fromStatus: MissionStatus.IN_PROGRESS, toStatus: MissionStatus.DONE, createdAt: at(15, 10) },
      { id: `${DEMO_PREFIX}event-06`, missionId: marcAssignedId, actorId: `${DEMO_PREFIX}user-admin`, type: MissionEventType.CREATED, message: 'Mission créée.', toStatus: MissionStatus.PENDING, createdAt: at(12, 8) },
      { id: `${DEMO_PREFIX}event-07`, missionId: marcAssignedId, actorId: `${DEMO_PREFIX}user-admin`, driverId: driverIds.marc, truckId: truckIds.marc, trailerId: trailerIds.marc, type: MissionEventType.ASSIGNED, message: 'Mission affectée à Marc Denis.', fromStatus: MissionStatus.PENDING, toStatus: MissionStatus.ASSIGNED, createdAt: at(12, 9) },
      { id: `${DEMO_PREFIX}event-08`, missionId: heroId, actorId: `${DEMO_PREFIX}user-admin`, type: MissionEventType.CREATED, message: 'Mission créée pour la démonstration.', toStatus: MissionStatus.PENDING, createdAt: at(13, 8) },
    ] })
  })
}

export async function getGerardDemoCounts(prisma: PrismaClient) {
  const [users, driverCount, truckCount, trailerCount, clientCount, missionCount, missionEvents] = await Promise.all([
    prisma.user.count({ where: { id: { startsWith: DEMO_PREFIX } } }),
    prisma.driver.count({ where: { id: { startsWith: DEMO_PREFIX } } }),
    prisma.truck.count({ where: { id: { startsWith: DEMO_PREFIX } } }),
    prisma.trailer.count({ where: { id: { startsWith: DEMO_PREFIX } } }),
    prisma.clientProfile.count({ where: { id: { startsWith: DEMO_PREFIX } } }),
    prisma.mission.count({ where: { reference: { startsWith: 'GRD-' } } }),
    prisma.missionEvent.count({ where: { id: { startsWith: DEMO_PREFIX } } }),
  ])
  return { users, drivers: driverCount, trucks: truckCount, trailers: trailerCount, clients: clientCount, missions: missionCount, missionEvents }
}
