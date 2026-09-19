import { euRoadFreightProfileV1 } from './profile'
import type {
  MissionTemporalPlan,
  RegulatoryProfile,
  TemporalLocation,
} from './types'

type DispatchMissionTemporalSource = {
  id: string
  reference?: string
  pickupDate?: Date | string | null
  deliveryDate?: Date | string | null
  pickupAddress?: string | null
  pickupPlaceId?: string | null
  pickupLat?: number | null
  pickupLng?: number | null
  deliveryAddress?: string | null
  deliveryPlaceId?: string | null
  deliveryLat?: number | null
  deliveryLng?: number | null
  routeDurationSeconds?: number | null
  routeProvider?: string | null
}

function asIso(value: Date | string | null | undefined) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function getLocation(
  prefix: string,
  placeId: string | null | undefined,
  address: string | null | undefined,
  latitude: number | null | undefined,
  longitude: number | null | undefined
): TemporalLocation | null {
  if (!placeId && !address && typeof latitude !== 'number') return null
  return {
    id:
      placeId ??
      address ??
      `${prefix}:${String(latitude)},${String(longitude)}`,
    label: address ?? undefined,
    latitude: latitude ?? undefined,
    longitude: longitude ?? undefined,
  }
}

export function buildTemporalMissionPlanFromDispatch(input: {
  mission: DispatchMissionTemporalSource
  startPosition: TemporalLocation | null
  approachDurationSeconds: number | null
  loadingDurationSeconds?: number | null
  unloadingDurationSeconds?: number | null
  trailerChange?: boolean
  returnToBase?: {
    position: TemporalLocation
    durationSeconds: number | null
  } | null
  timeZone?: string
  profile?: RegulatoryProfile
}): MissionTemporalPlan {
  const profile = input.profile ?? euRoadFreightProfileV1
  const pickup = getLocation(
    'pickup',
    input.mission.pickupPlaceId,
    input.mission.pickupAddress,
    input.mission.pickupLat,
    input.mission.pickupLng
  )
  const delivery = getLocation(
    'delivery',
    input.mission.deliveryPlaceId,
    input.mission.deliveryAddress,
    input.mission.deliveryLat,
    input.mission.deliveryLng
  )
  const pickupDate = asIso(input.mission.pickupDate)
  const deliveryDate = asIso(input.mission.deliveryDate)
  const missingData: MissionTemporalPlan['missingData'] = []

  if (!input.startPosition || !pickup || !delivery) {
    missingData.push('MISSING_POSITION')
  }
  if (
    typeof input.approachDurationSeconds !== 'number' ||
    typeof input.mission.routeDurationSeconds !== 'number' ||
    (input.returnToBase &&
      typeof input.returnToBase.durationSeconds !== 'number')
  ) {
    missingData.push('MISSING_ROUTE_DURATION')
  }
  if (!pickupDate || !deliveryDate) {
    missingData.push('MISSING_MISSION_TIME')
  }

  const steps: MissionTemporalPlan['steps'] = []
  if (typeof input.approachDurationSeconds === 'number') {
    steps.push({
      id: 'APPROACH',
      activityType: 'DRIVING',
      durationSeconds: input.approachDurationSeconds,
      source: 'GOOGLE_ROUTES',
      evidence: 'ESTIMATED',
      confidence: 'MEDIUM',
      from: input.startPosition,
      to: pickup,
    })
  }
  steps.push({
    id: 'LOADING',
    activityType: 'OTHER_WORK',
    durationSeconds:
      input.loadingDurationSeconds ?? profile.defaultLoadingSeconds,
    source:
      typeof input.loadingDurationSeconds === 'number'
        ? 'MISSION'
        : 'SYSTEM_DEFAULT',
    evidence:
      typeof input.loadingDurationSeconds === 'number'
        ? 'DECLARED'
        : 'ESTIMATED',
    confidence:
      typeof input.loadingDurationSeconds === 'number' ? 'MEDIUM' : 'LOW',
    from: pickup,
    to: pickup,
    notBefore: pickupDate,
  })
  if (input.trailerChange) {
    steps.push(
      {
        id: 'TRAILER_UNCOUPLING',
        activityType: 'OTHER_WORK',
        durationSeconds: profile.defaultTrailerUncouplingSeconds,
        source: 'SYSTEM_DEFAULT',
        evidence: 'ESTIMATED',
        confidence: 'LOW',
        isTrailerChange: true,
      },
      {
        id: 'TRAILER_COUPLING',
        activityType: 'OTHER_WORK',
        durationSeconds: profile.defaultTrailerCouplingSeconds,
        source: 'SYSTEM_DEFAULT',
        evidence: 'ESTIMATED',
        confidence: 'LOW',
        isTrailerChange: true,
      }
    )
  }
  if (typeof input.mission.routeDurationSeconds === 'number') {
    steps.push({
      id: 'LOADED_ROUTE',
      activityType: 'DRIVING',
      durationSeconds: input.mission.routeDurationSeconds,
      source: input.mission.routeProvider
        ? 'GOOGLE_ROUTES'
        : 'MISSION',
      evidence: 'ESTIMATED',
      confidence: input.mission.routeProvider ? 'MEDIUM' : 'LOW',
      from: pickup,
      to: delivery,
      mustEndBy: deliveryDate,
    })
  }
  steps.push({
    id: 'UNLOADING',
    activityType: 'OTHER_WORK',
    durationSeconds:
      input.unloadingDurationSeconds ?? profile.defaultUnloadingSeconds,
    source:
      typeof input.unloadingDurationSeconds === 'number'
        ? 'MISSION'
        : 'SYSTEM_DEFAULT',
    evidence:
      typeof input.unloadingDurationSeconds === 'number'
        ? 'DECLARED'
        : 'ESTIMATED',
    confidence:
      typeof input.unloadingDurationSeconds === 'number' ? 'MEDIUM' : 'LOW',
    from: delivery,
    to: delivery,
  })
  if (
    input.returnToBase &&
    typeof input.returnToBase.durationSeconds === 'number'
  ) {
    steps.push({
      id: 'RETURN_TO_BASE',
      activityType: 'DRIVING',
      durationSeconds: input.returnToBase.durationSeconds,
      source: 'GOOGLE_ROUTES',
      evidence: 'ESTIMATED',
      confidence: 'MEDIUM',
      from: delivery,
      to: input.returnToBase.position,
    })
  }

  return {
    missionId: input.mission.id,
    reference: input.mission.reference,
    timeZone: input.timeZone ?? profile.timeZone,
    earliestStartAt: pickupDate,
    startPosition: input.startPosition,
    endPosition: input.returnToBase?.position ?? delivery,
    steps,
    missingData: Array.from(new Set(missingData)),
    requiresReturnToBase: Boolean(input.returnToBase),
  }
}
