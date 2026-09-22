import { createHash } from 'crypto'
import {
  MissionStatus,
  TrailerCargoType,
  TrailerStatus,
  TrailerType,
} from '@prisma/client'

import { buildPreparedDriverTruckPairs } from '../driver-truck-pairs'
import { positionProvidersForAnalysis } from '../suggestions/planning-analysis'
import {
  adaptDispatchMissionForOptimization,
  adaptPreparedPairForOptimization,
  adaptTrailerForOptimization,
  defaultOptimizationCostParameters,
  dispatchOptimizationConfigurationV1,
  routeKey,
} from '../optimization'
import type {
  DispatchOptimizationInput,
  RouteTransition,
} from '../optimization'
import {
  calculateDriverActivityState,
  euRoadFreightProfileV1,
  regulatoryHistoryStart,
  regulatoryStateFromActivitySummary,
  regulatoryStateFromDeclaration,
} from '../regulatory'
import { getWeekEndDate } from '../date-utils'
import { prisma } from '../../prisma'
import type { AutoPlanningSnapshot } from './types'
import { classifyPlanningMissions } from './mission-scope'
import { prepareCandidateApproachRoutes } from './approach-routes'
import { withRouteOperation } from '../maps/route-control'
import { COUPLING_TYPE_VALUES } from '../technical-attributes'
import {
  configuredOperatingBase,
  resolveDriverPosition,
} from '../driver-position'

const snapshotLifetimeMs = 15 * 60 * 1000
export const maximumSimulationMissions = 100

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function fingerprintSnapshot(value: unknown) {
  return createHash('sha256').update(stable(value)).digest('hex')
}

function locationFromMission(
  prefix: string,
  mission: {
    pickupPlaceId: string | null
    pickupAddress: string | null
    pickupLat: number | null
    pickupLng: number | null
  }
) {
  if (
    !mission.pickupPlaceId &&
    !mission.pickupAddress &&
    typeof mission.pickupLat !== 'number'
  ) {
    return null
  }
  return {
    id:
      mission.pickupPlaceId ??
      mission.pickupAddress ??
      `${prefix}:${mission.pickupLat},${mission.pickupLng}`,
    label: mission.pickupAddress ?? undefined,
    latitude: mission.pickupLat ?? undefined,
    longitude: mission.pickupLng ?? undefined,
  }
}

function missionTrailerRequirements(
  requirements: unknown,
  legacyRequiredTruckType: string | null
) {
  const empty = {
    requiredTrailerType: null as string | null,
    requiredCapacity: null as number | null,
    requiredCargoType: null as string | null,
    requiredCouplingType: null as string | null,
    compatibilityMissingData: [] as string[],
  }
  if (!requirements || typeof requirements !== 'object') {
    return {
      ...empty,
      requiredTrailerType: Object.values(TrailerType).includes(
        legacyRequiredTruckType as TrailerType
      )
        ? legacyRequiredTruckType
        : null,
    }
  }
  const record = requirements as Record<string, unknown>
  const requiredTrailerType =
    typeof record.requiredTrailerType === 'string' &&
    Object.values(TrailerType).includes(
      record.requiredTrailerType as TrailerType
    )
      ? record.requiredTrailerType
      : Object.values(TrailerType).includes(
          legacyRequiredTruckType as TrailerType
        )
      ? legacyRequiredTruckType
      : null
  const capacity = Number(record.requiredCapacityKg)
  const requiredCargoType =
    typeof record.requiredCargoType === 'string' &&
    Object.values(TrailerCargoType).includes(
      record.requiredCargoType as TrailerCargoType
    )
      ? record.requiredCargoType
      : null
  const compatibilityMissingData: string[] = []
  if (typeof record.requiredTrailerType === 'string' && !requiredTrailerType) {
    compatibilityMissingData.push('requiredTrailerType')
  }
  if (
    typeof record.requiredCapacityKg !== 'undefined' &&
    !(Number.isFinite(capacity) && capacity > 0)
  ) {
    compatibilityMissingData.push('requiredCapacityKg')
  }
  if (typeof record.requiredCargoType === 'string' && !requiredCargoType) {
    compatibilityMissingData.push('requiredCargoType')
  }
  const requiredCouplingType =
    typeof record.requiredCouplingType === 'string' &&
    COUPLING_TYPE_VALUES.includes(
      record.requiredCouplingType as (typeof COUPLING_TYPE_VALUES)[number]
    )
      ? record.requiredCouplingType
      : null
  if (
    typeof record.requiredCouplingType === 'string' &&
    !requiredCouplingType
  ) {
    compatibilityMissingData.push('requiredCouplingType')
  }
  return {
    requiredTrailerType,
    requiredCapacity:
      Number.isFinite(capacity) && capacity > 0 ? capacity : null,
    requiredCargoType,
    requiredCouplingType,
    compatibilityMissingData,
  }
}

async function buildAutoPlanningSnapshotInternal(input: {
  weekStartDate: Date
  includeExistingForced: boolean
  now?: Date
  prepareCandidateRoutes?: boolean
}): Promise<AutoPlanningSnapshot> {
  const snapshotNow = input.now ?? new Date()
  const isolationPrefix = process.env.QA_AUTO_ISOLATION_PREFIX?.trim()
  if (isolationPrefix && !isolationPrefix.startsWith('QA-')) {
    throw new Error('INVALID_QA_ISOLATION_PREFIX')
  }
  const periodEnd = getWeekEndDate(input.weekStartDate)
  const regulatoryReferenceAt =
    snapshotNow >= input.weekStartDate && snapshotNow <= periodEnd
      ? snapshotNow
      : input.weekStartDate
  const preparedPairs = await buildPreparedDriverTruckPairs(input.weekStartDate)
  const preparedDriverIds = preparedPairs
    .map((item) => item.driver?.id)
    .filter((id): id is string => Boolean(id))
  const preparedTruckIds = preparedPairs
    .map((item) => item.assignedTruck?.id)
    .filter((id): id is string => Boolean(id))
  const [
    allMissions,
    assignments,
    trailers,
    latestPositions,
    completedMissionPositions,
    regulatoryDeclarations,
    driverActivityEvents,
  ] = await Promise.all([
    prisma.mission.findMany({
      where: isolationPrefix
        ? { reference: { startsWith: isolationPrefix } }
        : undefined,
      orderBy: [{ pickupDate: 'asc' }, { id: 'asc' }],
      include: {
        assignment: {
          select: {
            scheduledDate: true,
            plannedEndAt: true,
          },
        },
      },
    }),
    prisma.missionAssignment.findMany({
      where: {
        scheduledDate: { lte: periodEnd },
        OR: [
          { plannedEndAt: { gt: input.weekStartDate } },
          {
            plannedEndAt: null,
            mission: { deliveryDate: { gt: input.weekStartDate } },
          },
          {
            plannedEndAt: null,
            mission: { deliveryDate: null },
            scheduledDate: { gte: input.weekStartDate },
          },
        ],
      },
      orderBy: [{ scheduledDate: 'asc' }, { sortOrder: 'asc' }],
      include: {
        mission: {
          select: {
            deliveryPlaceId: true,
            deliveryAddress: true,
            deliveryLat: true,
            deliveryLng: true,
            deliveryDate: true,
          },
        },
        planningRow: {
          select: { driverId: true, truckId: true },
        },
      },
    }),
    prisma.trailer.findMany({
      where: isolationPrefix
        ? { plateNumber: { startsWith: isolationPrefix } }
        : undefined,
      orderBy: { id: 'asc' },
      include: { parkSpot: true },
    }),
    prisma.driverPosition.findMany({
      where: {
        driverId: { in: preparedDriverIds },
        // Provenance des positions retenues pour la planification. La source
        // reste enregistree telle quelle : DEMO_SIMULATED garde une confiance
        // inferieure a un point GPS telephone lors de l'evaluation.
        provider: { in: [...positionProvidersForAnalysis()] },
      },
      orderBy: { recordedAt: 'desc' },
    }),
    prisma.missionAssignment.findMany({
      where: {
        mission: {
          status: MissionStatus.DONE,
          deliveryDate: { lte: regulatoryReferenceAt },
          deliveryLat: { not: null },
          deliveryLng: { not: null },
        },
        OR: [
          { driverId: { in: preparedDriverIds } },
          { truckId: { in: preparedTruckIds } },
          { planningRow: { driverId: { in: preparedDriverIds } } },
          { planningRow: { truckId: { in: preparedTruckIds } } },
        ],
      },
      orderBy: { mission: { deliveryDate: 'desc' } },
      include: {
        mission: {
          select: {
            id: true,
            reference: true,
            deliveryDate: true,
            deliveryLat: true,
            deliveryLng: true,
          },
        },
        planningRow: {
          select: { driverId: true, truckId: true },
        },
      },
    }),
    prisma.driverRegulatoryDeclaration.findMany({
      where: {
        driverId: {
          in: preparedDriverIds,
        },
        referenceAt: { lte: regulatoryReferenceAt },
      },
      orderBy: { referenceAt: 'desc' },
    }),
    prisma.driverActivityEvent.findMany({
      where: {
        driverId: {
          in: preparedDriverIds,
        },
        effectiveAt: {
          gte: regulatoryHistoryStart(regulatoryReferenceAt),
          lte: regulatoryReferenceAt,
        },
      },
      orderBy: [{ effectiveAt: 'asc' }, { recordedAt: 'asc' }, { id: 'asc' }],
    }),
  ])
  const missionScope = classifyPlanningMissions({
    missions: allMissions,
    periodStart: input.weekStartDate,
    periodEnd,
    includeExistingForced: input.includeExistingForced,
  })
  const includedMissionIds = new Set(missionScope.includedMissionIds)
  const missions = allMissions.filter((mission) =>
    includedMissionIds.has(mission.id)
  )
  if (missions.length > maximumSimulationMissions) {
    throw new Error('SIMULATION_VOLUME_EXCEEDED')
  }

  const latestByDriver = new Map<string, typeof latestPositions[number]>()
  for (const position of latestPositions) {
    if (!latestByDriver.has(position.driverId)) {
      latestByDriver.set(position.driverId, position)
    }
  }
  const declarationByDriverId = new Map<
    string,
    typeof regulatoryDeclarations[number]
  >()
  for (const declaration of regulatoryDeclarations) {
    if (!declarationByDriverId.has(declaration.driverId)) {
      declarationByDriverId.set(declaration.driverId, declaration)
    }
  }
  const activityByDriverId = new Map<string, typeof driverActivityEvents>()
  for (const event of driverActivityEvents) {
    const current = activityByDriverId.get(event.driverId) ?? []
    current.push(event)
    activityByDriverId.set(event.driverId, current)
  }
  const operatingBase = configuredOperatingBase()
  const positionByPairRowId = new Map<
    string,
    ReturnType<typeof resolveDriverPosition>['location']
  >()
  const pairs = preparedPairs
    .map((source) => {
      const truck = source.assignedTruck
      const driver = source.driver
      const position = driver ? latestByDriver.get(driver.id) ?? null : null
      const completedAssignment =
        completedMissionPositions.find(
          (assignment) =>
            (driver &&
              (assignment.driverId === driver.id ||
                assignment.planningRow?.driverId === driver.id)) ||
            (truck &&
              (assignment.truckId === truck.id ||
                assignment.planningRow?.truckId === truck.id))
        ) ?? null
      const resolvedPosition = resolveDriverPosition({
        at: regulatoryReferenceAt,
        gps: position
          ? {
              latitude: position.latitude,
              longitude: position.longitude,
              recordedAt: position.recordedAt,
              accuracy: position.accuracy,
            }
          : null,
        lastCompletedMission:
          completedAssignment?.mission.deliveryDate &&
          typeof completedAssignment.mission.deliveryLat === 'number' &&
          typeof completedAssignment.mission.deliveryLng === 'number'
            ? {
                missionId: completedAssignment.mission.id,
                reference: completedAssignment.mission.reference,
                latitude: completedAssignment.mission.deliveryLat,
                longitude: completedAssignment.mission.deliveryLng,
                completedAt: completedAssignment.mission.deliveryDate,
              }
            : null,
        operatingBase,
      })
      const initialPosition = resolvedPosition.location
      positionByPairRowId.set(source.rowId, initialPosition)
      return adaptPreparedPairForOptimization({
        source,
        availableAt: input.weekStartDate.toISOString(),
        initialPosition,
        timeZone: 'Europe/Luxembourg',
        regulatoryState: source.driver
          ? (() => {
              const declaration = declarationByDriverId.get(source.driver!.id)
              const events = activityByDriverId.get(source.driver!.id) ?? []
              if (declaration && !events.length) {
                return regulatoryStateFromDeclaration(declaration)
              }
              const summary = calculateDriverActivityState({
                events,
                at: regulatoryReferenceAt,
                baseline: declaration
                  ? {
                      referenceAt: declaration.referenceAt,
                      validUntil: declaration.validUntil,
                      weeklyDrivingSeconds: declaration.weeklyDrivingSeconds,
                      dailyDrivingSeconds: declaration.dailyDrivingSeconds,
                      drivingSinceValidBreakSeconds:
                        declaration.drivingSinceValidBreakSeconds,
                    }
                  : null,
              })
              return regulatoryStateFromActivitySummary(declaration ?? null, summary, {
                driverId: source.driver!.id,
                timeZone: declaration?.timeZone ?? 'Europe/Luxembourg',
              })
            })()
          : null,
      })
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))

  const assignmentByMissionId = new Map(
    assignments.map((assignment) => [assignment.missionId, assignment])
  )
  const adaptedMissions = missions.map((source) => {
    const assignment = assignmentByMissionId.get(source.id)
    const pairPosition = assignment?.planningRowId
      ? positionByPairRowId.get(assignment.planningRowId) ?? null
      : null
    const trailerRequirements = missionTrailerRequirements(
      source.requirements,
      source.requiredTruckType
    )
    return {
      ...adaptDispatchMissionForOptimization({
        mission: {
          ...source,
          ...trailerRequirements,
          requiredTrailerId: assignment?.trailerId ?? null,
        },
        startPosition: pairPosition,
        approachDurationSeconds: assignment?.approachDurationSeconds ?? null,
        timeZone: 'Europe/Luxembourg',
        candidateApproachEvaluation: !assignment,
      }),
      forcedPairRowId: assignment?.planningRowId ?? null,
      reportable: source.status === MissionStatus.PENDING,
    }
  })

  let transitions: RouteTransition[] = []
  for (const mission of missions) {
    const assignment = assignmentByMissionId.get(mission.id)
    if (
      !assignment?.planningRowId ||
      typeof assignment.approachDurationSeconds !== 'number' ||
      typeof assignment.approachDistanceMeters !== 'number'
    ) {
      continue
    }
    const from = positionByPairRowId.get(assignment.planningRowId)
    const to = locationFromMission('pickup', mission)
    if (!from || !to) continue
    transitions.push({
      key: routeKey(from.id, to.id),
      from,
      to,
      durationSeconds: assignment.approachDurationSeconds,
      distanceMeters: assignment.approachDistanceMeters,
      source: assignment.approachProvider ? 'GOOGLE_ROUTES' : 'DISPATCH',
      confidence: assignment.approachProvider ? 'MEDIUM' : 'LOW',
      reason: 'INITIAL_APPROACH',
      empty: true,
    })
  }
  for (const pair of pairs) {
    const from = pair.initialPosition
    if (
      !from ||
      typeof from.latitude !== 'number' ||
      typeof from.longitude !== 'number'
    ) {
      continue
    }
    for (const mission of missions) {
      const to = locationFromMission('pickup', mission)
      if (
        !to ||
        typeof to.latitude !== 'number' ||
        typeof to.longitude !== 'number'
      ) {
        continue
      }
      const samePosition =
        Math.abs(from.latitude - to.latitude) < 0.000001 &&
        Math.abs(from.longitude - to.longitude) < 0.000001
      const key = routeKey(from.id, to.id)
      if (
        samePosition &&
        !transitions.some((transition) => transition.key === key)
      ) {
        transitions.push({
          key,
          from,
          to,
          durationSeconds: 0,
          distanceMeters: 0,
          source: 'DISPATCH',
          confidence: 'HIGH',
          reason: 'INITIAL_APPROACH',
          empty: true,
        })
      }
    }
  }

  const priorTrailerState = new Map<
    string,
    { availableAt: Date; position: ReturnType<typeof locationFromMission> }
  >()
  for (const assignment of assignments) {
    if (!assignment.trailerId || includedMissionIds.has(assignment.missionId))
      continue
    const availableAt =
      assignment.plannedEndAt ?? assignment.mission.deliveryDate
    if (!availableAt) continue
    const current = priorTrailerState.get(assignment.trailerId)
    if (current && current.availableAt >= availableAt) continue
    priorTrailerState.set(assignment.trailerId, {
      availableAt,
      position: locationFromMission('delivery', {
        pickupPlaceId: assignment.mission.deliveryPlaceId,
        pickupAddress: assignment.mission.deliveryAddress,
        pickupLat: assignment.mission.deliveryLat,
        pickupLng: assignment.mission.deliveryLng,
      }),
    })
  }
  const adaptedTrailers = trailers.map((item) => {
    const prior = priorTrailerState.get(item.id)
    return adaptTrailerForOptimization({
      id: item.id,
      plateNumber: item.plateNumber,
      status: item.status,
      type: item.type,
      truckId: item.truckId,
      position:
        prior?.position ??
        (item.parkSpot
          ? {
              id: `PARK:${item.parkSpot.code}`,
              label: item.parkSpot.code,
              latitude: operatingBase?.latitude,
              longitude: operatingBase?.longitude,
            }
          : item.status === TrailerStatus.AT_BASE ||
            item.status === TrailerStatus.IN_MAINTENANCE
          ? {
              id: 'BASE',
              label: 'Base',
              latitude: operatingBase?.latitude,
              longitude: operatingBase?.longitude,
            }
          : null),
      availableAt:
        prior?.availableAt.toISOString() ?? input.weekStartDate.toISOString(),
      capacity: item.capacityKg,
      couplingType: item.couplingType,
      compatibleCargoTypes: Array.isArray(item.compatibleCargoTypes)
        ? item.compatibleCargoTypes.filter(
            (value): value is string => typeof value === 'string'
          )
        : null,
    })
  })

  if (input.prepareCandidateRoutes !== false) {
    transitions = await prepareCandidateApproachRoutes({
      pairs,
      missions: adaptedMissions,
      trailers: adaptedTrailers,
      existing: transitions,
    })
  }

  const resourceOccupations = assignments
    .filter((assignment) => !includedMissionIds.has(assignment.missionId))
    .map((assignment) => ({
      missionId: assignment.missionId,
      driverId: assignment.driverId ?? assignment.planningRow?.driverId ?? null,
      truckId: assignment.truckId ?? assignment.planningRow?.truckId ?? null,
      trailerId: assignment.trailerId,
      startsAt: assignment.scheduledDate,
      endsAt: assignment.plannedEndAt ?? assignment.mission.deliveryDate,
    }))

  const material: Omit<
    DispatchOptimizationInput,
    'executionSeed' | 'strategy'
  > = {
    period: {
      startsAt: input.weekStartDate.toISOString(),
      endsAt: periodEnd.toISOString(),
    },
    timeZone: 'Europe/Luxembourg',
    pairs,
    missions: adaptedMissions,
    trailers: adaptedTrailers,
    transitions,
    resourceOccupations,
    unavailableResourceIds: [],
    costs: { ...defaultOptimizationCostParameters },
    profile: euRoadFreightProfileV1,
    configuration: dispatchOptimizationConfigurationV1,
  }
  const fingerprint = fingerprintSnapshot({
    material,
    assignments: assignments.map((item) => ({
      id: item.id,
      missionId: item.missionId,
      planningRowId: item.planningRowId,
      driverId: item.driverId,
      truckId: item.truckId,
      trailerId: item.trailerId,
      plannedEndAt: item.plannedEndAt?.toISOString() ?? null,
      scheduledDate: item.scheduledDate.toISOString(),
      sortOrder: item.sortOrder,
      updatedAt: item.updatedAt.toISOString(),
    })),
    driverActivityRevision: driverActivityEvents.map((event) => ({
      id: event.id,
      driverId: event.driverId,
      type: event.type,
      effectiveAt: event.effectiveAt.toISOString(),
      recordedAt: event.recordedAt.toISOString(),
      correctedEventId: event.correctedEventId,
      isVoided: event.isVoided,
    })),
    regulatoryDeclarationRevision: regulatoryDeclarations.map(
      (declaration) => ({
        id: declaration.id,
        driverId: declaration.driverId,
        referenceAt: declaration.referenceAt.toISOString(),
        validUntil: declaration.validUntil?.toISOString() ?? null,
        updatedAt: declaration.updatedAt.toISOString(),
      })
    ),
  })
  const createdAt = snapshotNow
  const expiresAt = new Date(createdAt.getTime() + snapshotLifetimeMs)
  return {
    id: `simulation:${fingerprint.slice(0, 24)}`,
    fingerprint,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    freshness: 'FRESH',
    input: {
      ...material,
      executionSeed: fingerprint.slice(0, 16),
      strategy: 'BALANCED',
    },
    versions: {
      pairFoundation: 'RUN1.v1',
      regulatoryProfile: euRoadFreightProfileV1.version,
      optimizationConfiguration: dispatchOptimizationConfigurationV1.version,
    },
    sourceCounts: {
      pairs: pairs.length,
      missions: adaptedMissions.length,
      trailers: adaptedTrailers.length,
      transitions: transitions.length,
      existingAssignments: assignments.length,
    },
    missingData: Array.from(
      new Set([
        ...adaptedMissions.flatMap((mission) => mission.missingData),
        ...pairs.flatMap((pair) =>
          pair.regulatoryState.weeklyDrivingSeconds.status === 'UNKNOWN'
            ? ['MISSING_TACHOGRAPH_HISTORY']
            : []
        ),
      ])
    ),
    missionScope,
  }
}

export async function buildAutoPlanningSnapshot(input: Parameters<typeof buildAutoPlanningSnapshotInternal>[0]) {
  return withRouteOperation('Auto-planning snapshot', () => buildAutoPlanningSnapshotInternal(input))
}
