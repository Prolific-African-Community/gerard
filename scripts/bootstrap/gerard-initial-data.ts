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

import { hashPassword } from '../../lib/auth/password'
import { PARK_SPOTS } from '../../lib/park/site-plan'

/**
 * Identifiants du bootstrap. Aucun mot de passe n'est ecrit dans le depot :
 * ils viennent de l'environnement local (voir .env.example).
 */
function requiredEnv(name: string) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Variable d'environnement manquante : ${name}.`)
  }
  return value
}

export const GERARD_ADMIN_ACCOUNT = {
  get username() {
    return process.env.GERARD_ADMIN_USERNAME?.trim() || 'gerard.superadmin'
  },
  get email() {
    return process.env.GERARD_ADMIN_EMAIL?.trim() || null
  },
  get password() {
    return requiredEnv('GERARD_ADMIN_PASSWORD')
  },
}

export const GERARD_DRIVER_ACCOUNT = {
  get username() {
    return process.env.GERARD_DRIVER_USERNAME?.trim() || 'marc.denis'
  },
  get email() {
    return process.env.GERARD_DRIVER_EMAIL?.trim() || null
  },
  get password() {
    return requiredEnv('GERARD_DRIVER_PASSWORD')
  },
}

// Prefixe des identifiants crees par le bootstrap initial. La valeur est
// conservee telle quelle : les donnees deja en base l'utilisent.
const BOOTSTRAP_PREFIX = 'demo-gerard-'
const GERARD_ORGANIZATION_ID = 'org-gerard-default'
// Minuit local Europe/Berlin le 14 septembre 2026 (UTC+2).
const WEEK_START = new Date('2026-09-13T22:00:00.000Z')


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
  { key: 'reefer', plate: 'RF-407-GD', type: TrailerType.REFRIGERATED },
] as const

const locations = {
  Luxembourg: { address: 'Pl. de la Gare, 1351 Gare Luxembourg', latitude: 49.5988403, longitude: 6.1326175 },
  Anvers: { address: 'Koningin Astridplein 27, 2018 Antwerpen, Belgium', latitude: 51.21751, longitude: 4.421235 },
  Liège: { address: '4000 Liège, Belgium', latitude: 50.6244335, longitude: 5.5667081 },
  Rotterdam: { address: 'Plaza 2-29, 3012 CN Rotterdam, Netherlands', latitude: 51.9231281, longitude: 4.4727452 },
  Namur: { address: 'Pl. de la Station 1, 5000 Namur, Belgium', latitude: 50.4685547, longitude: 4.8625174 },
  Cologne: { address: 'Trankgasse 11, 50667 Köln, Germany', latitude: 50.9425739, longitude: 6.9590016 },
  Metz: { address: '1 Pl. du Général de Gaulle, 57000 Metz, France', latitude: 49.1098328, longitude: 6.1773477 },
  Strasbourg: { address: '20 Pl. de la Gare Hall Nord, 67000 Strasbourg, France', latitude: 48.585223, longitude: 7.734541 },
  'Esch-sur-Alzette': { address: '1 Bd John Fitzgerald Kennedy, 4170 Esch-sur-Alzette, Luxembourg', latitude: 49.494, longitude: 5.98518 },
  Arlon: { address: 'Gare d\'Arlon, 6700 Arlon, Belgium', latitude: 49.6804497, longitude: 5.809462 },
  Bruxelles: { address: 'Av. Fonsny 47B, 1060 Bruxelles, Belgium', latitude: 50.8349275, longitude: 4.3363709 },
  Charleroi: { address: 'Sq. des Martyrs 18, 6000 Charleroi, Belgium', latitude: 50.4048334, longitude: 4.4387656 },
  Düsseldorf: { address: 'Konrad-Adenauer-Platz 14, 40210 Düsseldorf, Germany', latitude: 51.220471, longitude: 6.7927497 },
  Reims: { address: '1 Cr de la Gare, 51100 Reims, France', latitude: 49.2586306, longitude: 4.0240589 },
  Lille: { address: 'Pl. de la Gare, 59800 Lille, France', latitude: 50.636553, longitude: 3.070412 },
  Sedan: { address: 'Gare de Sedan, 08200 Sedan, France', latitude: 49.695216, longitude: 4.93069 },
  Gand: { address: 'Kon. Maria Hendrikaplein 1, 9000 Gent, Belgium', latitude: 51.0362488, longitude: 3.710765 },
  Mons: { address: 'Pl. Léopold, 7000 Mons, Belgium', latitude: 50.4534768, longitude: 3.9418035 },
  Nancy: { address: '3 Place Thiers, 54000 Nancy, France', latitude: 48.6892683, longitude: 6.1753537 },
} as const

type LocationKey = keyof typeof locations

const routes: Record<string, { distanceMeters: number; durationSeconds: number }> = {
  'Luxembourg|Anvers': { distanceMeters: 271923, durationSeconds: 10772 },
  'Liège|Rotterdam': { distanceMeters: 229974, durationSeconds: 9485 },
  'Namur|Cologne': { distanceMeters: 188078, durationSeconds: 7743 },
  'Metz|Strasbourg': { distanceMeters: 162430, durationSeconds: 6387 },
  'Esch-sur-Alzette|Liège': { distanceMeters: 172068, durationSeconds: 6891 },
  'Arlon|Bruxelles': { distanceMeters: 188457, durationSeconds: 8069 },
  'Charleroi|Luxembourg': { distanceMeters: 201180, durationSeconds: 7369 },
  'Metz|Namur': { distanceMeters: 220039, durationSeconds: 8929 },
  'Luxembourg|Bruxelles': { distanceMeters: 217958, durationSeconds: 9082 },
  'Charleroi|Düsseldorf': { distanceMeters: 221183, durationSeconds: 8761 },
  'Liège|Reims': { distanceMeters: 269526, durationSeconds: 10251 },
  'Arlon|Lille': { distanceMeters: 285707, durationSeconds: 10964 },
  'Luxembourg|Cologne': { distanceMeters: 215230, durationSeconds: 9674 },
  'Namur|Anvers': { distanceMeters: 118497, durationSeconds: 5624 },
  'Sedan|Düsseldorf': { distanceMeters: 279311, durationSeconds: 11663 },
  'Liège|Gand': { distanceMeters: 151332, durationSeconds: 6054 },
  'Bruxelles|Gand': { distanceMeters: 59294, durationSeconds: 2957 },
  'Namur|Mons': { distanceMeters: 76998, durationSeconds: 3439 },
  'Metz|Nancy': { distanceMeters: 63120, durationSeconds: 3281 },
  'Charleroi|Reims': { distanceMeters: 173665, durationSeconds: 7111 },
  'Liège|Lille': { distanceMeters: 208175, durationSeconds: 8202 },
  'Namur|Luxembourg': { distanceMeters: 162462, durationSeconds: 6242 },
  'Sedan|Reims': { distanceMeters: 104868, durationSeconds: 4159 },
  'Anvers|Esch-sur-Alzette': { distanceMeters: 267641, durationSeconds: 10431 },
  'Liège|Luxembourg': { distanceMeters: 172316, durationSeconds: 6327 },
  'Bruxelles|Luxembourg': { distanceMeters: 219013, durationSeconds: 9205 },
  'Rotterdam|Arlon': { distanceMeters: 324990, durationSeconds: 12707 },
  'Bruxelles|Charleroi': { distanceMeters: 59274, durationSeconds: 2722 },
  'Düsseldorf|Namur': { distanceMeters: 192592, durationSeconds: 7810 },
  'Anvers|Bruxelles': { distanceMeters: 68284, durationSeconds: 3773 },
  'Cologne|Charleroi': { distanceMeters: 221978, durationSeconds: 8686 },
  'Luxembourg|Liège': { distanceMeters: 171601, durationSeconds: 6338 },
  'Reims|Sedan': { distanceMeters: 104388, durationSeconds: 3967 },
  'Strasbourg|Metz': { distanceMeters: 166513, durationSeconds: 6955 },
  'Namur|Arlon': { distanceMeters: 131144, durationSeconds: 5153 },
  'Lille|Liège': { distanceMeters: 202787, durationSeconds: 7613 },
  'Gand|Metz': { distanceMeters: 341452, durationSeconds: 14021 },
  'Luxembourg|Charleroi': { distanceMeters: 202537, durationSeconds: 7457 },
  'Düsseldorf|Bruxelles': { distanceMeters: 205090, durationSeconds: 8761 },
  'Bruxelles|Namur': { distanceMeters: 65789, durationSeconds: 3910 },
}

type MissionSeed = {
  reference: string
  client: string
  pickupCity: LocationKey
  deliveryCity: LocationKey
  pickupDate: Date
  deliveryDate: Date
  price: number
  status: MissionStatus
  driver?: 'marc' | 'karim' | 'julien' | 'sofia'
  day?: PlanningDay
  plannedEndAt?: Date
  trailer?: 'marc' | 'karim' | 'julien' | 'sofia' | 'reefer'
  requiredTrailerType?: TrailerType
}

const missions: MissionSeed[] = [
  { reference: 'GRD-260914-01', client: 'Translog Nord', pickupCity: 'Luxembourg', deliveryCity: 'Anvers', pickupDate: at(14, 7), deliveryDate: at(14, 16), price: 1180, status: MissionStatus.DONE, driver: 'marc', day: PlanningDay.MONDAY, plannedEndAt: at(14, 16), trailer: 'marc', requiredTrailerType: TrailerType.CURTAINSIDER },
  { reference: 'GRD-260914-02', client: 'Atlas Freight', pickupCity: 'Liège', deliveryCity: 'Rotterdam', pickupDate: at(14, 6, 30), deliveryDate: at(14, 15, 30), price: 1090, status: MissionStatus.DONE, driver: 'karim', day: PlanningDay.MONDAY, plannedEndAt: at(14, 15, 30), trailer: 'karim', requiredTrailerType: TrailerType.CURTAINSIDER },
  { reference: 'GRD-260914-03', client: 'Helios Transport', pickupCity: 'Namur', deliveryCity: 'Cologne', pickupDate: at(14, 8), deliveryDate: at(14, 17), price: 980, status: MissionStatus.DONE, driver: 'julien', day: PlanningDay.MONDAY, plannedEndAt: at(14, 17), trailer: 'julien', requiredTrailerType: TrailerType.FLATBED },
  { reference: 'GRD-260914-04', client: 'Delta Routes', pickupCity: 'Metz', deliveryCity: 'Strasbourg', pickupDate: at(14, 7, 30), deliveryDate: at(14, 14, 30), price: 860, status: MissionStatus.DONE, driver: 'sofia', day: PlanningDay.MONDAY, plannedEndAt: at(14, 14, 30), trailer: 'sofia', requiredTrailerType: TrailerType.CURTAINSIDER },
  { reference: 'GRD-260915-16', client: 'Delta Routes', pickupCity: 'Esch-sur-Alzette', deliveryCity: 'Liège', pickupDate: at(15, 7), deliveryDate: at(15, 13), price: 790, status: MissionStatus.DONE, driver: 'marc', day: PlanningDay.TUESDAY, plannedEndAt: at(15, 13), trailer: 'marc', requiredTrailerType: TrailerType.CURTAINSIDER },
  { reference: 'GRD-260915-17', client: 'Euromove Cargo', pickupCity: 'Arlon', deliveryCity: 'Bruxelles', pickupDate: at(15, 7, 30), deliveryDate: at(15, 14, 30), price: 940, status: MissionStatus.DONE, driver: 'karim', day: PlanningDay.TUESDAY, plannedEndAt: at(15, 14, 30), trailer: 'karim', requiredTrailerType: TrailerType.CURTAINSIDER },
  { reference: 'GRD-260915-18', client: 'Translog Nord', pickupCity: 'Charleroi', deliveryCity: 'Luxembourg', pickupDate: at(15, 8), deliveryDate: at(15, 15), price: 960, status: MissionStatus.DONE, driver: 'julien', day: PlanningDay.TUESDAY, plannedEndAt: at(15, 15), trailer: 'julien', requiredTrailerType: TrailerType.FLATBED },
  { reference: 'GRD-260915-19', client: 'Atlas Freight', pickupCity: 'Metz', deliveryCity: 'Namur', pickupDate: at(15, 6, 45), deliveryDate: at(15, 14), price: 910, status: MissionStatus.DONE, driver: 'sofia', day: PlanningDay.TUESDAY, plannedEndAt: at(15, 14), trailer: 'sofia', requiredTrailerType: TrailerType.CURTAINSIDER },
  { reference: 'GRD-260916-05', client: 'Euromove Cargo', pickupCity: 'Luxembourg', deliveryCity: 'Bruxelles', pickupDate: at(16, 7), deliveryDate: at(16, 16), price: 1040, status: MissionStatus.ASSIGNED, driver: 'marc', day: PlanningDay.WEDNESDAY, plannedEndAt: at(16, 16), trailer: 'marc', requiredTrailerType: TrailerType.CURTAINSIDER },
  { reference: 'GRD-260916-06', client: 'Translog Nord', pickupCity: 'Charleroi', deliveryCity: 'Düsseldorf', pickupDate: at(16, 6, 30), deliveryDate: at(16, 18, 30), price: 1120, status: MissionStatus.ASSIGNED, driver: 'karim', day: PlanningDay.WEDNESDAY, plannedEndAt: at(16, 18, 30), trailer: 'reefer', requiredTrailerType: TrailerType.REFRIGERATED },
  { reference: 'GRD-260916-07', client: 'Atlas Freight', pickupCity: 'Liège', deliveryCity: 'Reims', pickupDate: at(16, 8), deliveryDate: at(16, 16), price: 990, status: MissionStatus.ASSIGNED, driver: 'julien', day: PlanningDay.WEDNESDAY, plannedEndAt: at(16, 16), trailer: 'julien', requiredTrailerType: TrailerType.FLATBED },
  { reference: 'GRD-260916-08', client: 'Helios Transport', pickupCity: 'Arlon', deliveryCity: 'Lille', pickupDate: at(16, 7, 15), deliveryDate: at(16, 16, 30), price: 1160, status: MissionStatus.ASSIGNED, driver: 'sofia', day: PlanningDay.WEDNESDAY, plannedEndAt: at(16, 16, 30), trailer: 'sofia', requiredTrailerType: TrailerType.CURTAINSIDER },
  { reference: 'GRD-260917-20', client: 'Helios Transport', pickupCity: 'Luxembourg', deliveryCity: 'Cologne', pickupDate: at(17, 7), deliveryDate: at(17, 15), price: 1080, status: MissionStatus.ASSIGNED, driver: 'marc', day: PlanningDay.THURSDAY, plannedEndAt: at(17, 15), trailer: 'marc', requiredTrailerType: TrailerType.CURTAINSIDER },
  { reference: 'GRD-260917-21', client: 'Delta Routes', pickupCity: 'Namur', deliveryCity: 'Anvers', pickupDate: at(17, 7, 30), deliveryDate: at(17, 14), price: 760, status: MissionStatus.ASSIGNED, driver: 'karim', day: PlanningDay.THURSDAY, plannedEndAt: at(17, 14), trailer: 'karim', requiredTrailerType: TrailerType.CURTAINSIDER },
  { reference: 'GRD-260917-22', client: 'Euromove Cargo', pickupCity: 'Sedan', deliveryCity: 'Düsseldorf', pickupDate: at(17, 6, 45), deliveryDate: at(17, 15, 30), price: 1190, status: MissionStatus.ASSIGNED, driver: 'julien', day: PlanningDay.THURSDAY, plannedEndAt: at(17, 15, 30), trailer: 'julien', requiredTrailerType: TrailerType.FLATBED },
  { reference: 'GRD-260917-23', client: 'Atlas Freight', pickupCity: 'Liège', deliveryCity: 'Gand', pickupDate: at(17, 8), deliveryDate: at(17, 14, 30), price: 820, status: MissionStatus.ASSIGNED, driver: 'sofia', day: PlanningDay.THURSDAY, plannedEndAt: at(17, 14, 30), trailer: 'sofia', requiredTrailerType: TrailerType.CURTAINSIDER },
  { reference: 'GRD-260918-09', client: 'Delta Routes', pickupCity: 'Bruxelles', deliveryCity: 'Gand', pickupDate: at(18, 7), deliveryDate: at(18, 11), price: 520, status: MissionStatus.ASSIGNED, driver: 'karim', day: PlanningDay.FRIDAY, plannedEndAt: at(18, 11), trailer: 'karim', requiredTrailerType: TrailerType.CURTAINSIDER },
  { reference: 'GRD-260918-10', client: 'Euromove Cargo', pickupCity: 'Namur', deliveryCity: 'Mons', pickupDate: at(18, 8), deliveryDate: at(18, 15), price: 610, status: MissionStatus.ASSIGNED, driver: 'julien', day: PlanningDay.FRIDAY, plannedEndAt: at(18, 15), trailer: 'julien', requiredTrailerType: TrailerType.FLATBED },
  { reference: 'GRD-260918-11', client: 'Translog Nord', pickupCity: 'Metz', deliveryCity: 'Nancy', pickupDate: at(18, 9), deliveryDate: at(18, 17), price: 540, status: MissionStatus.ASSIGNED, driver: 'sofia', day: PlanningDay.FRIDAY, plannedEndAt: at(18, 17), trailer: 'sofia', requiredTrailerType: TrailerType.CURTAINSIDER },
  { reference: 'GRD-260918-12', client: 'Translog Nord', pickupCity: 'Charleroi', deliveryCity: 'Reims', pickupDate: at(18, 8), deliveryDate: at(18, 13), price: 1320, status: MissionStatus.PENDING, requiredTrailerType: TrailerType.REFRIGERATED },
  { reference: 'GRD-260918-13', client: 'Atlas Freight', pickupCity: 'Liège', deliveryCity: 'Lille', pickupDate: at(18, 7), deliveryDate: at(18, 12), price: 1010, status: MissionStatus.PENDING, requiredTrailerType: TrailerType.CURTAINSIDER },
  { reference: 'GRD-260918-14', client: 'Helios Transport', pickupCity: 'Namur', deliveryCity: 'Luxembourg', pickupDate: at(18, 8, 30), deliveryDate: at(18, 12, 30), price: 890, status: MissionStatus.PENDING, requiredTrailerType: TrailerType.FLATBED },
  { reference: 'GRD-260918-15', client: 'Euromove Cargo', pickupCity: 'Sedan', deliveryCity: 'Reims', pickupDate: at(18, 9), deliveryDate: at(18, 13), price: 680, status: MissionStatus.PENDING, requiredTrailerType: TrailerType.CURTAINSIDER },
]

function routeBetween(origin: LocationKey, destination: LocationKey) {
  const route = routes[`${origin}|${destination}`]
  if (!route) {
    throw new Error(`Route Google de demonstration manquante: ${origin} -> ${destination}`)
  }
  return route
}

function assignmentApproach(
  mission: MissionSeed,
  previousMission: MissionSeed | undefined,
) {
  if (!previousMission) {
    return { distanceMeters: 0, durationSeconds: 0, via: [] as LocationKey[] }
  }

  // Karim laisse la curtainsider a Bruxelles, recupere la remorque frigorifique
  // a Luxembourg, puis reprend la curtainsider avant la mission suivante.
  const legs: Array<[LocationKey, LocationKey]> =
    mission.reference === 'GRD-260916-06'
      ? [['Bruxelles', 'Luxembourg'], ['Luxembourg', 'Charleroi']]
      : mission.reference === 'GRD-260917-21'
        ? [['Düsseldorf', 'Bruxelles'], ['Bruxelles', 'Namur']]
        : [[previousMission.deliveryCity, mission.pickupCity]]
  const values = legs.map(([origin, destination]) => routeBetween(origin, destination))
  return {
    distanceMeters: values.reduce((sum, route) => sum + route.distanceMeters, 0),
    durationSeconds: values.reduce((sum, route) => sum + route.durationSeconds, 0),
    via: legs.slice(0, -1).map(([, destination]) => destination),
  }
}

/**
 * Un seul pipeline : DATABASE_URL est la base Gerard, en local comme en
 * deploiement. Aucun aiguillage vers une base secondaire.
 */
export function createGerardPrisma() {
  const connectionString = requiredEnv('DATABASE_URL')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

async function deleteGerardBootstrapData(prisma: PrismaClient) {
  const demoMissions = await prisma.mission.findMany({
    where: { reference: { startsWith: 'GRD-' } },
    select: { id: true },
  })
  const missionIds = demoMissions.map(({ id }) => id)
  const demoInvoices = await prisma.invoice.findMany({
    where: {
      OR: [
        { missionId: { in: missionIds } },
        { invoiceMissions: { some: { missionId: { in: missionIds } } } },
      ],
    },
    select: { id: true },
  })
  const invoiceIds = demoInvoices.map(({ id }) => id)

  await prisma.$transaction([
    prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } }),
    prisma.invoiceMission.deleteMany({
      where: {
        OR: [
          { missionId: { in: missionIds } },
          { invoiceId: { in: invoiceIds } },
        ],
      },
    }),
    prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } }),
    prisma.missionEvent.deleteMany({ where: { missionId: { in: missionIds } } }),
    prisma.missionAssignment.deleteMany({ where: { missionId: { in: missionIds } } }),
    prisma.driverActivityEvent.deleteMany({ where: { missionId: { in: missionIds } } }),
    prisma.trailerCustodyEvent.deleteMany({
      where: {
        OR: [
          { missionId: { in: missionIds } },
          { trailerId: { startsWith: BOOTSTRAP_PREFIX } },
        ],
      },
    }),
    prisma.mission.deleteMany({ where: { id: { in: missionIds } } }),
    prisma.driverPosition.deleteMany({ where: { driverId: { startsWith: BOOTSTRAP_PREFIX } } }),
    prisma.truckPosition.deleteMany({ where: { truckId: { startsWith: BOOTSTRAP_PREFIX } } }),
    prisma.planningRow.deleteMany({
      where: {
        OR: [
          { id: { startsWith: BOOTSTRAP_PREFIX } },
          { driverId: { startsWith: BOOTSTRAP_PREFIX } },
          { truckId: { startsWith: BOOTSTRAP_PREFIX } },
        ],
      },
    }),
    prisma.user.deleteMany({ where: { id: { startsWith: BOOTSTRAP_PREFIX } } }),
    prisma.trailer.deleteMany({ where: { id: { startsWith: BOOTSTRAP_PREFIX } } }),
    prisma.truck.deleteMany({ where: { id: { startsWith: BOOTSTRAP_PREFIX } } }),
    prisma.driver.deleteMany({ where: { id: { startsWith: BOOTSTRAP_PREFIX } } }),
    prisma.clientProfile.deleteMany({ where: { id: { startsWith: BOOTSTRAP_PREFIX } } }),
  ])
}

export async function replaceGerardBootstrapData(prisma: PrismaClient) {
  await prisma.organization.upsert({
    where: { slug: 'gerard' },
    create: { id: GERARD_ORGANIZATION_ID, name: 'Gerard', slug: 'gerard', status: 'ACTIVE' },
    update: { name: 'Gerard', status: 'ACTIVE' },
  })
  await deleteGerardBootstrapData(prisma)

  const driverIds = Object.fromEntries(drivers.map(({ key }) => [key, `${BOOTSTRAP_PREFIX}driver-${key}`]))
  const truckIds = Object.fromEntries(trucks.map(({ key }) => [key, `${BOOTSTRAP_PREFIX}truck-${key}`]))
  const trailerIds = Object.fromEntries(trailers.map(({ key }) => [key, `${BOOTSTRAP_PREFIX}trailer-${key}`]))
  const rowIds = Object.fromEntries(drivers.map(({ key }) => [key, `${BOOTSTRAP_PREFIX}row-${key}`]))

  await prisma.$transaction(async (tx) => {
    for (const client of clients) {
      await tx.clientProfile.create({ data: {
        organizationId: GERARD_ORGANIZATION_ID,
        id: `${BOOTSTRAP_PREFIX}client-${client.key}`,
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
        organizationId: GERARD_ORGANIZATION_ID,
        id: driverIds[driver.key],
        name: driver.name,
        email: driver.email,
        phone: driver.phone,
        status: 'ACTIVE',
        hourlyCostAmount: 32,
        hourlyCostCurrency: 'EUR',
        createdAt: at(1, 8),
        updatedAt: at(1, 8),
      } })
    }

    for (const truck of trucks) {
      await tx.truck.create({ data: {
        organizationId: GERARD_ORGANIZATION_ID,
        id: truckIds[truck.key],
        plateNumber: truck.plate,
        brand: truck.brand,
        model: truck.model,
        status: truck.key === 'sofia' ? TruckStatus.AT_BASE : TruckStatus.ASSIGNED,
        statusUpdatedAt: at(14, 6),
        driverId: driverIds[truck.key],
        category: 'TRACTOR',
        capacityKg: 24000,
        couplingType: 'STANDARD_FIFTH_WHEEL',
        createdAt: at(1, 8),
        updatedAt: at(1, 8),
      } })
    }

    for (const trailer of trailers) {
      await tx.trailer.create({ data: {
        organizationId: GERARD_ORGANIZATION_ID,
        id: trailerIds[trailer.key],
        plateNumber: trailer.plate,
        type: trailer.type,
        status: trailer.key === 'reefer' || ['marc', 'sofia'].includes(trailer.key)
          ? TrailerStatus.AT_BASE
          : TrailerStatus.ASSIGNED,
        loadStatus: TrailerLoadStatus.EMPTY,
        cargoType: trailer.key === 'reefer' ? TrailerCargoType.FOOD : TrailerCargoType.PALLETS,
        custodyState: TrailerCustodyState.EMPTY,
        truckId: trailer.key === 'marc' || trailer.key === 'reefer'
          ? null
          : truckIds[trailer.key],
        capacityKg: 24000,
        couplingType: 'STANDARD_FIFTH_WHEEL',
        createdAt: at(1, 8),
        updatedAt: at(1, 8),
      } })
    }

    for (const spot of PARK_SPOTS) {
      await tx.parkSpot.upsert({
        where: { organizationId_code: { organizationId: GERARD_ORGANIZATION_ID, code: spot.code } },
        create: { ...spot, organizationId: GERARD_ORGANIZATION_ID, isActive: true },
        update: { ...spot, isActive: true },
      })
    }

    await tx.user.createMany({ data: [
      {
        id: `${BOOTSTRAP_PREFIX}user-admin`, name: 'Gerard Admin', firstName: 'Gerard', lastName: 'Admin',
        email: GERARD_ADMIN_ACCOUNT.email, username: GERARD_ADMIN_ACCOUNT.username,
        passwordHash: hashPassword(GERARD_ADMIN_ACCOUNT.password), role: UserRole.ADMIN,
        isActive: true, mustChangePassword: false, passwordChangedAt: at(1, 8), createdAt: at(1, 8), updatedAt: at(1, 8),
      },
      {
        id: `${BOOTSTRAP_PREFIX}user-marc`, name: 'Marc Denis', firstName: 'Marc', lastName: 'Denis',
        email: GERARD_DRIVER_ACCOUNT.email, username: GERARD_DRIVER_ACCOUNT.username,
        passwordHash: hashPassword(GERARD_DRIVER_ACCOUNT.password), role: UserRole.DRIVER,
        driverId: driverIds.marc, isActive: true, mustChangePassword: false,
        passwordChangedAt: at(1, 8), createdAt: at(1, 8), updatedAt: at(1, 8),
      },
    ] })
    await tx.organizationUser.createMany({ data: [
      { organizationId: GERARD_ORGANIZATION_ID, userId: `${BOOTSTRAP_PREFIX}user-admin`, role: 'ORG_ADMIN' },
      ...drivers.map((driver) => ({ organizationId: GERARD_ORGANIZATION_ID, userId: `${BOOTSTRAP_PREFIX}user-${driver.key}`, role: 'DRIVER' as const })),
    ] })

    for (const driver of drivers) {
      for (const day of [14, 15, 16, 17, 18]) {
        const referenceAt = at(day, 4, 30)
        await tx.driverRegulatoryDeclaration.create({ data: {
          organizationId: GERARD_ORGANIZATION_ID,
        id: `${BOOTSTRAP_PREFIX}regulatory-${driver.key}-${day}`,
        driverId: driverIds[driver.key],
        source: 'QA',
        referenceAt,
        validUntil: at(day + 1, 4, 30),
        timeZone: 'Europe/Luxembourg',
        drivingSinceValidBreakSeconds: 0,
        dailyDrivingSeconds: 0,
        weeklyDrivingSeconds: 0,
        previousWeekDrivingSeconds: 0,
        dailyExtensionsUsedThisWeek: 0,
        reducedDailyRestsUsedSinceWeeklyRest: 0,
        splitBreakFirstPartSeconds: 0,
        splitDailyRestFirstPartSeconds: 0,
        lastValidRestEndedAt: referenceAt,
        dutyPeriodStartedAt: referenceAt,
        currentIsoWeek: '2026-W38',
        weeklyRestDueAt: new Date('2026-09-20T22:00:00.000Z'),
        weeklyRestCompensationDueSeconds: 0,
        notes: 'Etat reglementaire fictif du dataset protege Gerard Demo.',
        createdAt: referenceAt,
        updatedAt: referenceAt,
      } })
      }
    }

    for (let index = 0; index < drivers.length; index += 1) {
      const driver = drivers[index]
      await tx.planningRow.create({ data: {
        organizationId: GERARD_ORGANIZATION_ID,
        id: rowIds[driver.key], weekStartDate: WEEK_START, sortOrder: index,
        driverId: driverIds[driver.key], truckId: truckIds[driver.key],
        trailerId: trailerIds[driver.key] ?? null, pairLocked: true,
        usualTruckIdSnapshot: truckIds[driver.key], createdAt: at(1, 8), updatedAt: at(1, 8),
      } })
    }

    const previousMissionByDriver = new Map<string, MissionSeed>()
    for (let index = 0; index < missions.length; index += 1) {
      const mission = missions[index]
      const pickup = locations[mission.pickupCity]
      const delivery = locations[mission.deliveryCity]
      const loadedRoute = routeBetween(mission.pickupCity, mission.deliveryCity)
      const missionId = `${BOOTSTRAP_PREFIX}mission-${mission.reference.toLowerCase()}`
      const createdAt = at(2, 8, index)
      await tx.mission.create({ data: {
        organizationId: GERARD_ORGANIZATION_ID,
        id: missionId,
        reference: mission.reference,
        title: `${mission.pickupCity} → ${mission.deliveryCity}`,
        clientName: mission.client,
        pickupCity: mission.pickupCity,
        deliveryCity: mission.deliveryCity,
        pickupAddress: pickup.address,
        deliveryAddress: delivery.address,
        pickupSourceAddress: pickup.address,
        deliverySourceAddress: delivery.address,
        pickupNormalizedAddress: pickup.address,
        deliveryNormalizedAddress: delivery.address,
        pickupLat: pickup.latitude, pickupLng: pickup.longitude,
        deliveryLat: delivery.latitude, deliveryLng: delivery.longitude,
        pickupDate: mission.pickupDate, deliveryDate: mission.deliveryDate,
        estimatedKm: Math.round(loadedRoute.distanceMeters / 1000),
        routeDistanceMeters: loadedRoute.distanceMeters,
        routeDurationSeconds: loadedRoute.durationSeconds,
        routeCalculatedAt: at(10, 10), routeProvider: 'GOOGLE_ROUTES',
        priceAmount: mission.price, priceCurrency: 'EUR',
        paymentTerms: '30 jours', requiredTruckType: 'Semi-remorque',
        requirements: mission.requiredTrailerType
          ? { requiredTrailerType: mission.requiredTrailerType }
          : undefined,
        preparationStatus: 'READY', pickupResolutionStatus: 'CONFIRMED', deliveryResolutionStatus: 'CONFIRMED',
        pickupResolutionMethod: 'MANUAL', deliveryResolutionMethod: 'MANUAL',
        pickupResolvedAt: at(10, 10), deliveryResolvedAt: at(10, 10),
        pickupResolvedAddress: pickup.address,
        deliveryResolvedAddress: delivery.address,
        status: mission.status,
        notes: 'Données entièrement fictives pour la démonstration Gerard.',
        createdAt, updatedAt: createdAt,
      } })

      if (mission.driver && mission.day && mission.plannedEndAt) {
        const previousMission = previousMissionByDriver.get(mission.driver)
        const approach = assignmentApproach(mission, previousMission)
        const trailerChangePlanned = ['GRD-260916-06', 'GRD-260917-21'].includes(
          mission.reference,
        )
        await tx.missionAssignment.create({ data: {
          organizationId: GERARD_ORGANIZATION_ID,
          id: `${BOOTSTRAP_PREFIX}assignment-${mission.reference.toLowerCase()}`,
          missionId, planningRowId: rowIds[mission.driver], driverId: driverIds[mission.driver],
          truckId: truckIds[mission.driver], trailerId: mission.trailer ? trailerIds[mission.trailer] : null,
          trailerChangePlanned,
          trailerTransitions: trailerChangePlanned
            ? [{
                reason: mission.reference === 'GRD-260916-06'
                  ? 'Recuperation de la remorque frigorifique a Luxembourg.'
                  : 'Reprise de la remorque curtainsider laissee a Bruxelles.',
                from: previousMission?.deliveryCity ?? 'POSITION_INITIALE',
                to: approach.via[0] ?? mission.pickupCity,
              }]
            : [],
          day: mission.day, scheduledDate: mission.pickupDate, plannedEndAt: mission.plannedEndAt,
          sortOrder: index, approachDistanceMeters: approach.distanceMeters,
          approachDurationSeconds: approach.durationSeconds, approachCalculatedAt: at(10, 10),
          approachProvider: 'GOOGLE_ROUTES', createdAt, updatedAt: createdAt,
        } })
        previousMissionByDriver.set(mission.driver, mission)
      }
    }

    const positions = [
      ['marc', locations.Luxembourg.latitude, locations.Luxembourg.longitude],
      ['karim', locations.Liège.latitude, locations.Liège.longitude],
      ['julien', locations.Namur.latitude, locations.Namur.longitude],
      ['sofia', locations.Metz.latitude, locations.Metz.longitude],
    ] as const
    for (const [key, latitude, longitude] of positions) {
      await tx.driverPosition.create({ data: {
        organizationId: GERARD_ORGANIZATION_ID,
        id: `${BOOTSTRAP_PREFIX}position-${key}`, driverId: driverIds[key], truckId: truckIds[key],
        latitude, longitude, accuracy: 18, speedKmh: 0, heading: 0,
        provider: 'DEMO_SIMULATED', recordedAt: WEEK_START, createdAt: WEEK_START,
      } })
    }

    const marcDoneId = `${BOOTSTRAP_PREFIX}mission-grd-260914-01`
    const marcAssignedId = `${BOOTSTRAP_PREFIX}mission-grd-260916-05`
    const heroId = `${BOOTSTRAP_PREFIX}mission-grd-260918-12`
    await tx.missionEvent.createMany({ data: [
      { id: `${BOOTSTRAP_PREFIX}event-01`, missionId: marcDoneId, actorId: `${BOOTSTRAP_PREFIX}user-admin`, type: MissionEventType.CREATED, message: 'Mission créée.', toStatus: MissionStatus.PENDING, createdAt: at(11, 8) },
      { id: `${BOOTSTRAP_PREFIX}event-02`, missionId: marcDoneId, actorId: `${BOOTSTRAP_PREFIX}user-admin`, driverId: driverIds.marc, truckId: truckIds.marc, trailerId: trailerIds.marc, type: MissionEventType.ASSIGNED, message: 'Mission affectée à Marc Denis.', fromStatus: MissionStatus.PENDING, toStatus: MissionStatus.ASSIGNED, createdAt: at(11, 9) },
      { id: `${BOOTSTRAP_PREFIX}event-03`, missionId: marcDoneId, driverId: driverIds.marc, truckId: truckIds.marc, type: MissionEventType.STATUS_CHANGED, message: 'Mission démarrée.', fromStatus: MissionStatus.ASSIGNED, toStatus: MissionStatus.IN_PROGRESS, createdAt: at(14, 7) },
      { id: `${BOOTSTRAP_PREFIX}event-04`, missionId: marcDoneId, driverId: driverIds.marc, truckId: truckIds.marc, type: MissionEventType.NOTE_ADDED, message: 'Arrivée au chargement.', createdAt: at(14, 8, 15) },
      { id: `${BOOTSTRAP_PREFIX}event-05`, missionId: marcDoneId, driverId: driverIds.marc, truckId: truckIds.marc, type: MissionEventType.COMPLETED, message: 'Mission terminée.', fromStatus: MissionStatus.IN_PROGRESS, toStatus: MissionStatus.DONE, createdAt: at(15, 10) },
      { id: `${BOOTSTRAP_PREFIX}event-06`, missionId: marcAssignedId, actorId: `${BOOTSTRAP_PREFIX}user-admin`, type: MissionEventType.CREATED, message: 'Mission créée.', toStatus: MissionStatus.PENDING, createdAt: at(12, 8) },
      { id: `${BOOTSTRAP_PREFIX}event-07`, missionId: marcAssignedId, actorId: `${BOOTSTRAP_PREFIX}user-admin`, driverId: driverIds.marc, truckId: truckIds.marc, trailerId: trailerIds.marc, type: MissionEventType.ASSIGNED, message: 'Mission affectée à Marc Denis.', fromStatus: MissionStatus.PENDING, toStatus: MissionStatus.ASSIGNED, createdAt: at(12, 9) },
      { id: `${BOOTSTRAP_PREFIX}event-08`, missionId: heroId, actorId: `${BOOTSTRAP_PREFIX}user-admin`, type: MissionEventType.CREATED, message: 'Mission créée pour la démonstration.', toStatus: MissionStatus.PENDING, createdAt: at(13, 8) },
    ].map((event) => ({ ...event, organizationId: GERARD_ORGANIZATION_ID })) })
  })
}

export async function getGerardDataCounts(prisma: PrismaClient) {
  const [users, driverCount, truckCount, trailerCount, clientCount, missionCount, missionEvents] = await Promise.all([
    prisma.user.count({ where: { id: { startsWith: BOOTSTRAP_PREFIX } } }),
    prisma.driver.count({ where: { id: { startsWith: BOOTSTRAP_PREFIX } } }),
    prisma.truck.count({ where: { id: { startsWith: BOOTSTRAP_PREFIX } } }),
    prisma.trailer.count({ where: { id: { startsWith: BOOTSTRAP_PREFIX } } }),
    prisma.clientProfile.count({ where: { id: { startsWith: BOOTSTRAP_PREFIX } } }),
    prisma.mission.count({ where: { reference: { startsWith: 'GRD-' } } }),
    prisma.missionEvent.count({ where: { id: { startsWith: BOOTSTRAP_PREFIX } } }),
  ])
  return { users, drivers: driverCount, trucks: truckCount, trailers: trailerCount, clients: clientCount, missions: missionCount, missionEvents }
}
