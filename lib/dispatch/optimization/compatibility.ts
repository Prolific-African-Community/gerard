import type {
  CompatibilityCode,
  CompatibilityEvaluation,
  OptimizationMission,
  OptimizationPair,
  OptimizationTrailer,
} from './types'
import { euRoadFreightProfileV1 } from '../regulatory/profile'
export const compatibilityMessages: Record<CompatibilityCode, string> = {
  COMPATIBLE: 'Les contraintes connues sont satisfaites.',
  COMPATIBLE_WITH_CONDITION:
    'La combinaison reste à confirmer avec les données manquantes.',
  DRIVER_UNAVAILABLE: 'Le chauffeur est indisponible.',
  TRUCK_UNAVAILABLE: 'Le tracteur est indisponible.',
  TRAILER_UNAVAILABLE: 'La remorque est indisponible.',
  TRUCK_TYPE_MISMATCH: 'Le type de tracteur ne répond pas à la mission.',
  TRAILER_TYPE_MISMATCH: 'Le type de remorque ne répond pas à la mission.',
  TRAILER_CARGO_MISMATCH:
    'La remorque ne correspond pas au type de marchandise requis.',
  COUPLING_TYPE_MISMATCH:
    'Le tracteur et la remorque ont des systèmes d’attelage incompatibles.',
  INSUFFICIENT_CAPACITY: 'La capacité confirmée est insuffisante.',
  RESOURCE_TIME_CONFLICT: 'La ressource est déjà utilisée sur ce créneau.',
  DRIVER_TIME_CONFLICT: 'Le chauffeur est déjà occupé sur ce créneau.',
  TRUCK_TIME_CONFLICT: 'Le camion est déjà occupé sur ce créneau.',
  TRAILER_TIME_CONFLICT: 'La remorque est déjà occupée sur ce créneau.',
  REQUIRED_TRAILER_MISSING: 'La remorque imposée est absente.',
  TRAILER_POSITION_UNKNOWN: 'La position de la remorque est inconnue.',
  MISSION_REQUIREMENTS_UNKNOWN:
    'Les exigences techniques de la mission sont incomplètes.',
  REGULATORY_STATE_UNKNOWN: 'L’état réglementaire est incomplet.',
  POSITION_UNCERTAIN:
    'La position de départ est estimée ou inconnue et doit être confirmée.',
  TEMPORALLY_INFEASIBLE: 'La chronologie est temporellement impossible.',
  REGULATORILY_INFEASIBLE:
    'Une limite réglementaire confirmée serait dépassée.',
  MISSING_ROUTE: 'Une transition indispensable ne possède pas d’itinéraire.',
  FORCED_PAIR_MISMATCH: 'La mission est imposée à un autre couple.',
}

const unavailableDriverStatuses = new Set([
  'UNAVAILABLE',
  'ON_LEAVE',
  'INACTIVE',
])
const unavailableTruckStatuses = new Set([
  'IN_MAINTENANCE',
  'MAINTENANCE_EXT',
  'OUT_OF_SERVICE',
])
const unavailableTrailerStatuses = new Set([
  'IN_MAINTENANCE',
  'MAINTENANCE_EXT',
  'OUT_OF_SERVICE',
])

export function evaluateMissionCompatibility(input: {
  pair: OptimizationPair
  mission: OptimizationMission
  trailer: OptimizationTrailer | null
  unavailableResourceIds?: string[]
}): CompatibilityEvaluation {
  const hard: CompatibilityCode[] = []
  const unknown: CompatibilityCode[] = []
  const missingData: string[] = []
  const unavailable = new Set(input.unavailableResourceIds ?? [])
  const { pair, mission, trailer } = input

  if (
    !pair.initialPosition ||
    pair.initialPosition.planningEffect === 'CONDITIONAL'
  ) {
    unknown.push('POSITION_UNCERTAIN')
    missingData.push(
      pair.initialPosition?.positionSource === 'LAST_COMPLETED_MISSION'
        ? 'position.lastCompletedMission'
        : pair.initialPosition?.positionSource === 'OPERATING_BASE'
          ? 'position.operatingBase'
          : 'position.unknown'
    )
  }

  if (
    unavailableDriverStatuses.has(pair.driverStatus) ||
    unavailable.has(pair.pair.driverId)
  ) {
    hard.push('DRIVER_UNAVAILABLE')
  }
  if (
    unavailableTruckStatuses.has(pair.truckStatus) ||
    unavailable.has(pair.pair.truckId)
  ) {
    hard.push('TRUCK_UNAVAILABLE')
  }
  if (
    mission.forcedPairRowId &&
    mission.forcedPairRowId !== pair.pair.rowId
  ) {
    hard.push('FORCED_PAIR_MISMATCH')
  }

  const requiresTrailer = Boolean(
    mission.requiredTrailerId ||
      mission.requiredTrailerType ||
      mission.requiredCapacity ||
      mission.requiredCargoType ||
      mission.requiredCouplingType
  )
  if (requiresTrailer && !trailer) {
    hard.push('REQUIRED_TRAILER_MISSING')
  }
  if (trailer) {
    if (
      unavailableTrailerStatuses.has(trailer.status) ||
      unavailable.has(trailer.id)
    ) {
      hard.push('TRAILER_UNAVAILABLE')
    }
    if (
      mission.requiredTrailerId &&
      mission.requiredTrailerId !== trailer.id
    ) {
      hard.push('REQUIRED_TRAILER_MISSING')
    }
    if (
      mission.requiredTrailerType &&
      mission.requiredTrailerType !== trailer.type
    ) {
      hard.push('TRAILER_TYPE_MISMATCH')
    }
    if (typeof mission.requiredCapacity === 'number') {
      if (typeof trailer.capacity !== 'number') {
        unknown.push('MISSION_REQUIREMENTS_UNKNOWN')
        missingData.push('trailerCapacity')
      } else if (trailer.capacity < mission.requiredCapacity) {
        hard.push('INSUFFICIENT_CAPACITY')
      }
    }
    if (mission.requiredCargoType) {
      if (!trailer.compatibleCargoTypes) {
        unknown.push('MISSION_REQUIREMENTS_UNKNOWN')
        missingData.push('trailerCargoType')
      } else if (
        !trailer.compatibleCargoTypes.includes(mission.requiredCargoType)
      ) {
        hard.push('TRAILER_CARGO_MISMATCH')
      }
    }
    if (mission.requiredCouplingType) {
      if (!trailer.couplingType) {
        unknown.push('MISSION_REQUIREMENTS_UNKNOWN')
        missingData.push('trailerCouplingType')
      } else if (trailer.couplingType !== mission.requiredCouplingType) {
        hard.push('COUPLING_TYPE_MISMATCH')
      }
    }
    if (
      pair.couplingType &&
      trailer.couplingType &&
      pair.couplingType !== trailer.couplingType
    ) {
      hard.push('COUPLING_TYPE_MISMATCH')
    } else if (!pair.couplingType || !trailer.couplingType) {
      unknown.push('MISSION_REQUIREMENTS_UNKNOWN')
      missingData.push(
        !pair.couplingType ? 'truckCouplingType' : 'trailerCouplingType'
      )
    }
    if (!trailer.position && trailer.attachedTruckId !== pair.pair.truckId) {
      unknown.push('TRAILER_POSITION_UNKNOWN')
      missingData.push('trailerPosition')
    }
  }

  if (mission.missingData.length) {
    unknown.push('MISSION_REQUIREMENTS_UNKNOWN')
    missingData.push(...mission.missingData)
  }
  const unknownRegulatoryFields = Object.entries(pair.regulatoryState)
    .filter(
      ([, value]) =>
        value &&
        typeof value === 'object' &&
        'status' in value &&
        value.status === 'UNKNOWN'
    )
    .map(([field]) => field)
  if (unknownRegulatoryFields.length) {
    unknown.push('REGULATORY_STATE_UNKNOWN')
    missingData.push(
      ...unknownRegulatoryFields.map((field) => `regulatory.${field}`)
    )
  }
  const knownNumber = (field: keyof typeof pair.regulatoryState) => {
    const value = pair.regulatoryState[field]
    return value &&
      typeof value === 'object' &&
      'status' in value &&
      value.status === 'KNOWN' &&
      typeof value.value === 'number'
      ? value.value
      : null
  }
  const weekly = knownNumber('weeklyDrivingSeconds')
  const previousWeek = knownNumber('previousWeekDrivingSeconds')
  const daily = knownNumber('dailyDrivingSeconds')
  if (
    (weekly !== null &&
      weekly > euRoadFreightProfileV1.maximumWeeklyDrivingSeconds) ||
    (weekly !== null &&
      previousWeek !== null &&
      weekly + previousWeek >
        euRoadFreightProfileV1.maximumFortnightDrivingSeconds) ||
    (daily !== null &&
      daily > euRoadFreightProfileV1.extendedDailyDrivingSeconds)
  ) {
    hard.push('REGULATORILY_INFEASIBLE')
  }

  const codes = Array.from(new Set([...hard, ...unknown]))
  if (hard.length) {
    return {
      status: 'INCOMPATIBLE',
      codes,
      messages: codes.map((code) => compatibilityMessages[code]),
      missingData: Array.from(new Set(missingData)),
    }
  }
  if (unknown.length) {
    const conditionalCodes = [
      'COMPATIBLE_WITH_CONDITION' as const,
      ...codes,
    ]
    return {
      status: 'INDETERMINATE',
      codes: conditionalCodes,
      messages: conditionalCodes.map((code) => compatibilityMessages[code]),
      missingData: Array.from(new Set(missingData)),
    }
  }
  return {
    status: 'COMPATIBLE',
    codes: ['COMPATIBLE'],
    messages: [compatibilityMessages.COMPATIBLE],
    missingData: [],
  }
}
