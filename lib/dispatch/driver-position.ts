import type { TemporalLocation } from './regulatory'

/**
 * Base d'exploitation utilisee quand DISPATCH_BASE_LATITUDE / LONGITUDE ne sont
 * pas renseignees. C'est la base Gerard actuelle (Luxembourg).
 */
export const DEFAULT_OPERATING_BASE = {
  latitude: 49.5988403,
  longitude: 6.1326175,
  label: 'Base d’exploitation · Luxembourg',
} as const

export const DRIVER_GPS_MAX_AGE_SECONDS = 30 * 60
export const COMPLETED_MISSION_DIRECT_MAX_AGE_SECONDS = 24 * 60 * 60

export type DriverPositionSource =
  | 'DRIVER_GPS'
  | 'LAST_COMPLETED_MISSION'
  | 'OPERATING_BASE'
  | 'UNKNOWN'

export type PositionConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'

export type SharedGpsPosition = {
  latitude: number
  longitude: number
  recordedAt: Date
  accuracy?: number | null
}

export type CompletedMissionPosition = {
  missionId: string
  reference: string
  latitude: number
  longitude: number
  completedAt: Date
}

export type OperatingBasePosition = {
  latitude: number
  longitude: number
  label?: string
}

export type ResolvedDriverPosition = {
  location: TemporalLocation | null
  source: DriverPositionSource
  sourceLabel: string
  observedAt: string | null
  freshnessSeconds: number | null
  confidence: PositionConfidence
  usable: boolean
  planningEffect: string
  latestGps: {
    latitude: number
    longitude: number
    recordedAt: string
    accuracy: number | null
    freshnessSeconds: number
    fresh: boolean
  } | null
}

function validCoordinate(latitude: number, longitude: number) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  )
}

function freshnessSeconds(recordedAt: Date, at: Date) {
  return Math.max(
    0,
    Math.floor((at.getTime() - recordedAt.getTime()) / 1000)
  )
}

function location(input: {
  id: string
  label: string
  latitude: number
  longitude: number
  source: DriverPositionSource
  observedAt: string | null
  confidence: PositionConfidence
  planningEffect: 'DIRECT' | 'CONDITIONAL'
}): TemporalLocation {
  return {
    id: input.id,
    label: input.label,
    latitude: input.latitude,
    longitude: input.longitude,
    positionSource: input.source,
    observedAt: input.observedAt,
    positionConfidence: input.confidence,
    planningEffect: input.planningEffect,
  }
}

export function resolveDriverPosition(input: {
  at: Date
  gps: SharedGpsPosition | null
  lastCompletedMission: CompletedMissionPosition | null
  operatingBase: OperatingBasePosition | null
  maximumGpsAgeSeconds?: number
}): ResolvedDriverPosition {
  const maximumGpsAgeSeconds =
    input.maximumGpsAgeSeconds ?? DRIVER_GPS_MAX_AGE_SECONDS
  const gps =
    input.gps && validCoordinate(input.gps.latitude, input.gps.longitude)
      ? input.gps
      : null
  const gpsFreshness = gps
    ? freshnessSeconds(gps.recordedAt, input.at)
    : null
  const latestGps = gps
    ? {
        latitude: gps.latitude,
        longitude: gps.longitude,
        recordedAt: gps.recordedAt.toISOString(),
        accuracy: gps.accuracy ?? null,
        freshnessSeconds: gpsFreshness as number,
        fresh: (gpsFreshness as number) <= maximumGpsAgeSeconds,
      }
    : null

  if (gps && latestGps?.fresh) {
    const observedAt = gps.recordedAt.toISOString()
    return {
      location: location({
        id: `GPS:${gps.latitude},${gps.longitude}`,
        label: 'Dernière position GPS chauffeur',
        latitude: gps.latitude,
        longitude: gps.longitude,
        source: 'DRIVER_GPS',
        observedAt,
        confidence: 'HIGH',
        planningEffect: 'DIRECT',
      }),
      source: 'DRIVER_GPS',
      sourceLabel: 'GPS chauffeur',
      observedAt,
      freshnessSeconds: gpsFreshness,
      confidence: 'HIGH',
      usable: true,
      planningEffect:
        'Position récente utilisée directement pour les distances et coûts.',
      latestGps,
    }
  }

  const mission = input.lastCompletedMission
  if (
    mission &&
    validCoordinate(mission.latitude, mission.longitude)
  ) {
    const observedAt = mission.completedAt.toISOString()
    const missionFreshness = freshnessSeconds(mission.completedAt, input.at)
    const recentAndObserved =
      mission.completedAt <= input.at &&
      missionFreshness <= COMPLETED_MISSION_DIRECT_MAX_AGE_SECONDS
    return {
      location: location({
        id: `MISSION:${mission.missionId}:DELIVERY`,
        label: `Dernière livraison terminée · ${mission.reference}`,
        latitude: mission.latitude,
        longitude: mission.longitude,
        source: 'LAST_COMPLETED_MISSION',
        observedAt,
        confidence: 'MEDIUM',
        planningEffect: recentAndObserved ? 'DIRECT' : 'CONDITIONAL',
      }),
      source: 'LAST_COMPLETED_MISSION',
      sourceLabel: 'Dernière mission terminée',
      observedAt,
      freshnessSeconds: missionFreshness,
      confidence: 'MEDIUM',
      usable: true,
      planningEffect:
        recentAndObserved
          ? 'Dernière livraison terminée depuis moins de 24 h ; position utilisée directement avec une confiance moyenne.'
          : 'Position estimée depuis une ancienne livraison ; la proposition reste conditionnelle.',
      latestGps,
    }
  }

  const base = input.operatingBase
  if (base && validCoordinate(base.latitude, base.longitude)) {
    return {
      location: location({
        id: `BASE:${base.latitude},${base.longitude}`,
        label: base.label ?? 'Base d’exploitation',
        latitude: base.latitude,
        longitude: base.longitude,
        source: 'OPERATING_BASE',
        observedAt: null,
        confidence: 'LOW',
        planningEffect: 'CONDITIONAL',
      }),
      source: 'OPERATING_BASE',
      sourceLabel: 'Base d’exploitation',
      observedAt: null,
      freshnessSeconds: null,
      confidence: 'LOW',
      usable: true,
      planningEffect:
        'Repli sur la base faute de position récente ; la proposition reste conditionnelle.',
      latestGps,
    }
  }

  return {
    location: null,
    source: 'UNKNOWN',
    sourceLabel: 'Position inconnue',
    observedAt: null,
    freshnessSeconds: null,
    confidence: 'UNKNOWN',
    usable: false,
    planningEffect:
      'Aucune position n’est inventée ; les distances restent à confirmer.',
    latestGps,
  }
}

export function configuredOperatingBase(): OperatingBasePosition | null {
  const latitude = Number(process.env.DISPATCH_BASE_LATITUDE)
  const longitude = Number(process.env.DISPATCH_BASE_LONGITUDE)
  if (!validCoordinate(latitude, longitude)) {
    return DEFAULT_OPERATING_BASE
  }
  return validCoordinate(latitude, longitude)
    ? {
        latitude,
        longitude,
        label: 'Base d’exploitation',
      }
    : null
}
