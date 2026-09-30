import type { OperatingBasePosition } from './base-location'
import type { TemporalLocation } from './regulatory'

export type TrailerPositionSource =
  | 'ATTACHED_TRUCK'
  | 'MANUAL'
  | 'PARK_SPOT'
  | 'STATUS_BASE'
  | 'MISSION_DELIVERY'
  | 'IDLE_BASE_FALLBACK'
  | 'UNKNOWN'

export type TrailerPositionEvidence = {
  id: string
  label?: string
  latitude?: number | null
  longitude?: number | null
}

export type ResolvedTrailerPosition = {
  location: TemporalLocation | null
  source: TrailerPositionSource
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'
  usable: boolean
  planningEffect: string
}

function valid(
  position: TrailerPositionEvidence | OperatingBasePosition | null
) {
  return Boolean(
    position &&
      typeof position.latitude === 'number' &&
      typeof position.longitude === 'number' &&
      Number.isFinite(position.latitude) &&
      Number.isFinite(position.longitude) &&
      position.latitude >= -90 &&
      position.latitude <= 90 &&
      position.longitude >= -180 &&
      position.longitude <= 180
  )
}

function resolved(
  position: TrailerPositionEvidence | OperatingBasePosition,
  source: Exclude<TrailerPositionSource, 'UNKNOWN'>,
  confidence: 'HIGH' | 'MEDIUM' | 'LOW',
  planningEffect: string
): ResolvedTrailerPosition {
  const evidence = position as TrailerPositionEvidence
  return {
    location: {
      id: evidence.id ?? `BASE:${position.latitude},${position.longitude}`,
      label: evidence.label ?? 'Base d’exploitation',
      latitude: position.latitude as number,
      longitude: position.longitude as number,
      positionSource: source,
      positionConfidence: confidence,
      planningEffect: confidence === 'LOW' ? 'CONDITIONAL' : 'DIRECT',
      observedAt: null,
    },
    source,
    confidence,
    usable: true,
    planningEffect,
  }
}

/**
 * One deterministic trailer position rule for planning and presentation.
 * An idle empty detached trailer falls back to base. A loaded or engaged
 * trailer never does: its location must be evidenced.
 */
export function resolveTrailerPosition(input: {
  attached?: boolean
  attachedTruckPosition?: TrailerPositionEvidence | null
  explicitPosition?: TrailerPositionEvidence | null
  parkSpotCode?: string | null
  status?: string | null
  lastMissionDelivery?: TrailerPositionEvidence | null
  operatingBase: OperatingBasePosition | null
  loadStatus?: string | null
  hasActiveMission?: boolean
}): ResolvedTrailerPosition {
  if (valid(input.attachedTruckPosition ?? null)) {
    return resolved(
      input.attachedTruckPosition!,
      'ATTACHED_TRUCK',
      'HIGH',
      'La remorque suit la position du tracteur auquel elle est attelée.'
    )
  }
  if (input.attached) {
    return {
      location: null,
      source: 'UNKNOWN',
      confidence: 'UNKNOWN',
      usable: false,
      planningEffect:
        'La position du tracteur attelé doit être connue avant la planification.',
    }
  }
  if (valid(input.explicitPosition ?? null)) {
    return resolved(
      input.explicitPosition!,
      'MANUAL',
      'HIGH',
      'La dernière localisation explicite est utilisée.'
    )
  }
  if (input.parkSpotCode && input.operatingBase) {
    return resolved(
      {
        ...input.operatingBase,
        id: `PARK:${input.parkSpotCode}`,
        label: input.parkSpotCode,
      },
      'PARK_SPOT',
      'HIGH',
      'La présence sur le parc prouve la localisation à la base.'
    )
  }
  if (input.status === 'AT_BASE' && input.operatingBase) {
    return resolved(
      input.operatingBase,
      'STATUS_BASE',
      'MEDIUM',
      'La remorque est déclarée à la base.'
    )
  }
  if (valid(input.lastMissionDelivery ?? null)) {
    return resolved(
      input.lastMissionDelivery!,
      'MISSION_DELIVERY',
      'MEDIUM',
      'La dernière livraison terminée fournit la position connue.'
    )
  }
  if (
    input.loadStatus !== 'LOADED' &&
    !input.hasActiveMission &&
    input.operatingBase
  ) {
    return resolved(
      input.operatingBase,
      'IDLE_BASE_FALLBACK',
      'LOW',
      'Remorque vide, décrochée et sans mission : retour à la base supposé pour la planification V1.'
    )
  }
  return {
    location: null,
    source: 'UNKNOWN',
    confidence: 'UNKNOWN',
    usable: false,
    planningEffect:
      'La position doit être renseignée avant utilisation dans le planning.',
  }
}
