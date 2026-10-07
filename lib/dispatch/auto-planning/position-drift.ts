import { prisma } from '../../prisma'
import { positionProvidersForAnalysis } from '../suggestions/planning-analysis'

/**
 * Un nouveau ping GPS arrivé après la simulation ne périme pas la simulation
 * tant que le chauffeur n'a pas matériellement bougé. Les distances d'approche
 * se comptent en centaines de kilomètres : 20 km ne change pas la faisabilité,
 * alors qu'un chauffeur parti à l'autre bout du pays doit être revalidé.
 */
export const positionDriftToleranceMeters = 20_000

type Point = { latitude: number; longitude: number }

export function distanceMeters(from: Point, to: Point) {
  const radius = 6_371_000
  const toRadians = (value: number) => (value * Math.PI) / 180
  const dLat = toRadians(to.latitude - from.latitude)
  const dLng = toRadians(to.longitude - from.longitude)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(dLng / 2) ** 2
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(a)))
}

export type PositionDrift = {
  driverId: string
  driverName: string
  movedMeters: number
}

/**
 * Pur : compare, pour chaque chauffeur concerné, la position utilisée à la
 * simulation à son dernier ping postérieur. Seul le ping le plus récent compte.
 */
export function findMaterialPositionDrift(input: {
  used: ReadonlyArray<{ driverId: string; driverName: string; position: Point | null }>
  newerPings: ReadonlyArray<{ driverId: string; latitude: number; longitude: number; recordedAt: Date }>
  toleranceMeters?: number
}): PositionDrift[] {
  const tolerance = input.toleranceMeters ?? positionDriftToleranceMeters
  const latest = new Map<string, (typeof input.newerPings)[number]>()
  for (const ping of input.newerPings) {
    const current = latest.get(ping.driverId)
    if (!current || ping.recordedAt > current.recordedAt) latest.set(ping.driverId, ping)
  }
  const drifts: PositionDrift[] = []
  for (const item of input.used) {
    const ping = latest.get(item.driverId)
    if (!ping || !item.position) continue
    const movedMeters = distanceMeters(item.position, ping)
    if (movedMeters > tolerance) {
      drifts.push({ driverId: item.driverId, driverName: item.driverName, movedMeters: Math.round(movedMeters) })
    }
  }
  return drifts
}

/** Lecture seule : pings des chauffeurs retenus, entre l'instant de référence et maintenant. */
export async function detectPositionDrift(input: {
  used: ReadonlyArray<{ driverId: string; driverName: string; position: Point | null }>
  referenceAt: Date
  now?: Date
}) {
  const driverIds = Array.from(new Set(input.used.map((item) => item.driverId)))
  if (!driverIds.length) return []
  const newerPings = await prisma.driverPosition.findMany({
    where: {
      driverId: { in: driverIds },
      provider: { in: [...positionProvidersForAnalysis()] },
      recordedAt: { gt: input.referenceAt, lte: input.now ?? new Date() },
    },
    select: { driverId: true, latitude: true, longitude: true, recordedAt: true },
    orderBy: { recordedAt: 'desc' },
  })
  return findMaterialPositionDrift({ used: input.used, newerPings })
}
