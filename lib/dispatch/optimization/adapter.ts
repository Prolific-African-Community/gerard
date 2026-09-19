import {
  buildTemporalMissionPlanFromDispatch,
  createUnknownDriverRegulatoryState,
} from '../regulatory'
import type {
  DriverRegulatoryState,
  TemporalLocation,
} from '../regulatory'
import type {
  OptimizationMission,
  OptimizationPair,
  OptimizationTrailer,
} from './types'

type PreparedPairSource = {
  rowId: string
  pairLocked: boolean
  assignmentOrigin: 'MANUAL' | 'AUTOMATIC' | 'ADJUSTED'
  isExceptionalReplacement: boolean
  usualTruckIdSnapshot: string | null
  driver: {
    id: string
    name: string
    status: string
  } | null
  assignedTruck: {
    id: string
    plateNumber: string
    status: string
    model?: string | null
    brand?: string | null
    category?: string | null
    capacityKg?: number | null
    couplingType?: string | null
  } | null
}

export function adaptPreparedPairForOptimization(input: {
  source: PreparedPairSource
  availableAt: string
  initialPosition: TemporalLocation | null
  timeZone: string
  regulatoryState?: DriverRegulatoryState | null
}): OptimizationPair | null {
  const { source } = input
  if (!source.driver || !source.assignedTruck) return null
  return {
    pair: {
      rowId: source.rowId,
      driverId: source.driver.id,
      truckId: source.assignedTruck.id,
      pairLocked: source.pairLocked,
      assignmentOrigin: source.assignmentOrigin,
    },
    driverName: source.driver.name,
    driverStatus: source.driver.status,
    truckPlateNumber: source.assignedTruck.plateNumber,
    truckStatus: source.assignedTruck.status,
    usualTruckId: source.usualTruckIdSnapshot,
    exceptionalReplacement: source.isExceptionalReplacement,
    availableAt: input.availableAt,
    initialPosition: input.initialPosition,
    regulatoryState:
      input.regulatoryState ??
      createUnknownDriverRegulatoryState({
        driverId: source.driver.id,
        timeZone: input.timeZone,
        observedAt: input.availableAt,
      }),
    // Le schéma actuel ne porte aucun type/capacité technique structuré.
    truckType: null,
    truckCapacity: null,
    couplingType: source.assignedTruck.couplingType,
    restrictions: [],
  }
}

type DispatchMissionSource = Parameters<
  typeof buildTemporalMissionPlanFromDispatch
>[0]['mission'] & {
  status: string
  createdAt?: Date | string
  requiredTrailerType?: string | null
  requiredTrailerId?: string | null
  routeDistanceMeters?: number | null
  priceAmount?: number | null
  priceCurrency?: string | null
  requiredTruckType?: string | null
  requiredCapacity?: number | null
  requiredCargoType?: string | null
  requiredCouplingType?: string | null
  compatibilityMissingData?: string[]
}

export function adaptDispatchMissionForOptimization(input: {
  mission: DispatchMissionSource
  startPosition: TemporalLocation | null
  approachDurationSeconds: number | null
  priority?: number
  reportable?: boolean
  timeZone: string
  candidateApproachEvaluation?: boolean
}): OptimizationMission {
  const rawTemporalPlan = buildTemporalMissionPlanFromDispatch({
    mission: input.mission,
    startPosition: input.startPosition,
    approachDurationSeconds: input.approachDurationSeconds,
    timeZone: input.timeZone,
  })
  const hasPickupAndDelivery = Boolean(
    rawTemporalPlan.steps.find((step) => step.id === 'LOADING')?.from &&
      rawTemporalPlan.steps.find((step) => step.id === 'UNLOADING')?.to
  )
  const temporalPlan = input.candidateApproachEvaluation
    ? {
        ...rawTemporalPlan,
        missingData: rawTemporalPlan.missingData.filter(
          (code) =>
            !(
              (code === 'MISSING_POSITION' && hasPickupAndDelivery) ||
              (code === 'MISSING_ROUTE_DURATION' &&
                typeof input.mission.routeDurationSeconds === 'number')
            )
        ),
      }
    : rawTemporalPlan
  const pickup = temporalPlan.steps.find((step) => step.id === 'LOADING')?.from
  const delivery = temporalPlan.steps.find(
    (step) => step.id === 'UNLOADING'
  )?.to
  return {
    id: input.mission.id,
    reference: input.mission.reference ?? input.mission.id,
    status: input.mission.status,
    priority: input.priority ?? 0,
    createdAt:
      input.mission.createdAt instanceof Date
        ? input.mission.createdAt.toISOString()
        : input.mission.createdAt,
    reportable: input.reportable ?? true,
    temporalPlan,
    pickup: pickup ?? null,
    delivery: delivery ?? null,
    loadedDistanceMeters:
      typeof input.mission.routeDistanceMeters === 'number'
        ? input.mission.routeDistanceMeters
        : null,
    revenueAmount:
      typeof input.mission.priceAmount === 'number'
        ? input.mission.priceAmount
        : null,
    currency: input.mission.priceCurrency ?? 'EUR',
    requiredTruckType: null,
    requiredTrailerType: input.mission.requiredTrailerType,
    requiredTrailerId: input.mission.requiredTrailerId,
    requiredCapacity: input.mission.requiredCapacity,
    requiredCargoType: input.mission.requiredCargoType,
    requiredCouplingType: input.mission.requiredCouplingType,
    dependencies: [],
    missingData: [
      ...temporalPlan.missingData,
      ...(input.mission.compatibilityMissingData ?? []),
    ],
    confidence:
      temporalPlan.missingData.length === 0 &&
      !(input.mission.compatibilityMissingData?.length)
        ? input.mission.routeProvider
          ? 'MEDIUM'
          : 'LOW'
        : 'LOW',
  }
}

export function adaptTrailerForOptimization(input: {
  id: string
  plateNumber: string
  status: string
  type: string
  truckId?: string | null
  position: TemporalLocation | null
  availableAt: string
  capacity?: number | null
  couplingType?: string | null
  compatibleCargoTypes?: string[] | null
}): OptimizationTrailer {
  return {
    id: input.id,
    plateNumber: input.plateNumber,
    status: input.status,
    type: input.type,
    position: input.position,
    availableAt: input.availableAt,
    attachedTruckId: input.truckId,
    capacity: input.capacity,
    couplingType: input.couplingType,
    compatibleCargoTypes: input.compatibleCargoTypes,
    restrictions: [],
  }
}
