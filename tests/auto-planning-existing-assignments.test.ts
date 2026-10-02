import assert from 'node:assert/strict'

import {
  defaultOptimizationCostParameters,
  dispatchOptimizationConfigurationV1,
  optimizeDispatch,
  routeKey,
} from '../lib/dispatch/optimization'
import type {
  DispatchOptimizationInput,
  OptimizationMission,
  OptimizationPair,
  OptimizationTrailer,
  RouteTransition,
} from '../lib/dispatch/optimization'
import { resourceStateBefore } from '../lib/dispatch/resource-availability'
import {
  euRoadFreightProfileV1,
  knownRegulatoryDatum,
  unknownRegulatoryDatum,
} from '../lib/dispatch/regulatory'

const weekStart = new Date('2030-09-16T00:00:00.000Z')
const weekEnd = new Date('2030-09-23T00:00:00.000Z')
const notDeclared = 'Valeur absente de la déclaration simplifiée.'
const known = <T>(value: T) =>
  knownRegulatoryDatum(value, weekStart.toISOString(), 'DISPATCHER_DECLARATION')

const base = {
  id: 'BASE',
  latitude: 49.5,
  longitude: 6.0,
  positionSource: 'STATUS_BASE' as const,
  positionConfidence: 'MEDIUM' as const,
  planningEffect: 'DIRECT' as const,
}

// The declaration dispatchers actually fill in: counters known, split-rest
// bookkeeping absent. Every candidate therefore stays conditional, which is
// exactly the case where the occupation check used to be skipped.
const partialState = (driverId: string) => ({
  driverId,
  timeZone: 'Europe/Luxembourg',
  observedAt: weekStart.toISOString(),
  validUntil: null,
  drivingSinceValidBreakSeconds: known(0),
  dailyDrivingSeconds: known(0),
  weeklyDrivingSeconds: known(0),
  previousWeekDrivingSeconds: known(0),
  dailyExtensionsUsedThisWeek: known(0),
  reducedDailyRestsUsedSinceWeeklyRest: unknownRegulatoryDatum<number>(notDeclared),
  splitBreakFirstPartSeconds: unknownRegulatoryDatum<number>(notDeclared),
  splitDailyRestFirstPartSeconds: unknownRegulatoryDatum<number>(notDeclared),
  lastValidRestEndedAt: known(weekStart.toISOString()),
  dutyPeriodStartedAt: unknownRegulatoryDatum<string>(notDeclared),
  currentIsoWeek: known('2030-W38'),
  weeklyRestDueAt: unknownRegulatoryDatum<string | null>(notDeclared),
  weeklyRestCompensationDueSeconds: unknownRegulatoryDatum<number>(notDeclared),
})

function buildPair(index: number): OptimizationPair {
  return {
    pair: {
      rowId: `row-${index}`,
      driverId: `driver-${index}`,
      truckId: `truck-${index}`,
      pairLocked: false,
      assignmentOrigin: 'AUTOMATIC',
    },
    driverName: `Driver ${index}`,
    driverStatus: 'ACTIVE',
    truckPlateNumber: `TRUCK-${index}`,
    truckStatus: 'AT_BASE',
    usualTruckId: `truck-${index}`,
    exceptionalReplacement: false,
    availableAt: weekStart.toISOString(),
    initialPosition: base,
    regulatoryState: partialState(`driver-${index}`),
    couplingType: 'FIFTH_WHEEL',
    restrictions: [],
  }
}

function buildTrailer(index: number): OptimizationTrailer {
  return {
    id: `trailer-${index}`,
    plateNumber: `TRAILER-${index}`,
    status: 'AVAILABLE',
    type: 'CURTAINSIDER',
    capacity: 24000,
    couplingType: 'FIFTH_WHEEL',
    position: base,
    availableAt: weekStart.toISOString(),
    attachedTruckId: `truck-${index}`,
    loadStatus: 'EMPTY',
    restrictions: [],
  }
}

const pickup = { id: 'PICKUP', latitude: 48.8, longitude: 2.3 }
const delivery = { id: 'DELIVERY', latitude: 49.4, longitude: 1.1 }
const manualDelivery = { id: 'MANUAL_DELIVERY', latitude: 48.9, longitude: 2.4 }

function buildMission(
  id: string,
  reference: string,
  startAt: string,
  windowHours = 10
): OptimizationMission {
  const start = new Date(startAt)
  return {
    id,
    reference,
    status: 'PENDING',
    priority: 5,
    reportable: false,
    pickup,
    delivery,
    loadedDistanceMeters: 135_000,
    revenueAmount: 900,
    currency: 'EUR',
    requiredTrailerType: 'CURTAINSIDER',
    requiredCouplingType: 'FIFTH_WHEEL',
    dependencies: [],
    missingData: [],
    confidence: 'HIGH',
    temporalPlan: {
      missionId: id,
      reference,
      timeZone: 'Europe/Luxembourg',
      earliestStartAt: start.toISOString(),
      startPosition: null,
      endPosition: delivery,
      missingData: [],
      requiresReturnToBase: false,
      steps: [
        {
          id: 'LOADING',
          activityType: 'OTHER_WORK',
          durationSeconds: 1800,
          source: 'SYSTEM_DEFAULT',
          evidence: 'ESTIMATED',
          confidence: 'LOW',
          from: pickup,
          to: pickup,
          notBefore: start.toISOString(),
        },
        {
          id: 'LOADED_ROUTE',
          activityType: 'DRIVING',
          durationSeconds: 5_400,
          source: 'GOOGLE_ROUTES',
          evidence: 'ESTIMATED',
          confidence: 'MEDIUM',
          from: pickup,
          to: delivery,
          mustEndBy: new Date(
            start.getTime() + windowHours * 3600_000
          ).toISOString(),
        },
      ],
    },
  }
}

function buildInput(options: {
  missions: OptimizationMission[]
  pairs: OptimizationPair[]
  trailers: OptimizationTrailer[]
  occupations?: DispatchOptimizationInput['resourceOccupations']
}): DispatchOptimizationInput {
  const transitions: RouteTransition[] = []
  const origins = [base, delivery, manualDelivery]
  for (const from of origins) {
    for (const to of [pickup]) {
      if (from.id === to.id) continue
      transitions.push({
        key: routeKey(from.id, to.id),
        from,
        to,
        distanceMeters: 120_000,
        durationSeconds: 3_600,
        source: 'GOOGLE_ROUTES',
        confidence: 'HIGH',
        reason: 'INITIAL_APPROACH',
        empty: true,
      })
    }
  }
  return {
    executionSeed: 'qa-existing',
    period: { startsAt: weekStart.toISOString(), endsAt: weekEnd.toISOString() },
    timeZone: 'Europe/Luxembourg',
    strategy: 'BALANCED',
    pairs: options.pairs,
    missions: options.missions,
    trailers: options.trailers,
    transitions,
    unavailableResourceIds: [],
    resourceOccupations: options.occupations ?? [],
    costs: defaultOptimizationCostParameters,
    profile: euRoadFreightProfileV1,
    configuration: dispatchOptimizationConfigurationV1,
  }
}

const planned = (result: ReturnType<typeof optimizeDispatch>) =>
  [...result.confirmedProposals, ...result.conditionalProposals].flatMap(
    (proposal) =>
      proposal.missions.map((mission) => ({
        reference: mission.reference,
        rowId: proposal.pair.rowId,
        window: mission.plannedWindow,
      }))
  )

// A manual mission occupying driver-0 and truck-0 on Monday morning.
const manualOccupation = {
  missionId: 'manual-1',
  reference: 'MAN-1',
  driverId: 'driver-0',
  truckId: 'truck-0',
  trailerId: null,
  startsAt: '2030-09-16T04:00:00.000Z',
  endsAt: '2030-09-16T12:00:00.000Z',
  endPosition: manualDelivery,
}

// A. A manual Monday assignment plus a later Monday mission: the later mission
// is still planned, never a zero result.
{
  const result = optimizeDispatch(
    buildInput({
      missions: [buildMission('m-late', 'LATE', '2030-09-16T16:00:00.000Z')],
      pairs: [buildPair(0)],
      trailers: [buildTrailer(0)],
      occupations: [manualOccupation],
    })
  )
  const items = planned(result)
  assert.equal(items.length, 1, JSON.stringify(result.unassignedMissions))
  assert.equal(items[0].reference, 'LATE')
  assert.equal(result.impossibleMissions.length, 0)
}

// B. A mission overlapping the manual window is rejected for that pair only,
// and lands on the second pair instead.
{
  const result = optimizeDispatch(
    buildInput({
      missions: [
        buildMission('m-overlap', 'OVERLAP', '2030-09-16T05:00:00.000Z'),
      ],
      pairs: [buildPair(0), buildPair(1)],
      trailers: [buildTrailer(0), buildTrailer(1)],
      occupations: [manualOccupation],
    })
  )
  const items = planned(result)
  assert.equal(items.length, 1)
  assert.notEqual(
    items[0].rowId,
    'row-0',
    'the occupied pair must not be proposed on top of its manual mission'
  )
}

// With only the occupied pair available, the overlap is the only casualty and
// it is reported with a resource conflict code, not a generic failure.
{
  const result = optimizeDispatch(
    buildInput({
      missions: [
        buildMission('m-overlap', 'OVERLAP', '2030-09-16T05:00:00.000Z'),
      ],
      pairs: [buildPair(0)],
      trailers: [buildTrailer(0)],
      occupations: [manualOccupation],
    })
  )
  assert.equal(planned(result).length, 0)
  const rejected = [
    ...result.impossibleMissions,
    ...result.deferredMissions,
    ...result.unassignedMissions,
  ]
  assert.equal(rejected.length, 1)
  assert.ok(
    rejected[0].codes.includes('RESOURCE_TIME_CONFLICT') ||
      rejected[0].codes.includes('DRIVER_TIME_CONFLICT'),
    JSON.stringify(rejected[0].codes)
  )
}

// C. A Tuesday mission starts from the position the manual Monday mission left
// the crew at, not from the base.
{
  const state = resourceStateBefore({
    occupations: [manualOccupation],
    driverId: 'driver-0',
    truckId: 'truck-0',
    before: '2030-09-17T08:00:00.000Z',
  })
  assert.ok(state)
  assert.equal(state!.availableAt, '2030-09-16T12:00:00.000Z')
  assert.equal(state!.position?.id, 'MANUAL_DELIVERY')
  assert.equal(state!.reference, 'MAN-1')

  const result = optimizeDispatch(
    buildInput({
      missions: [buildMission('m-tue', 'TUE', '2030-09-17T08:00:00.000Z')],
      pairs: [buildPair(0)],
      trailers: [buildTrailer(0)],
      occupations: [manualOccupation],
    })
  )
  assert.equal(planned(result).length, 1)
}

// A resource with no prior assignment keeps its own initial state.
assert.equal(
  resourceStateBefore({
    occupations: [manualOccupation],
    driverId: 'driver-9',
    truckId: 'truck-9',
    before: '2030-09-17T08:00:00.000Z',
  }),
  null
)

// D. A trailer held by a manual assignment is reusable once that assignment is
// over, and blocked only while it overlaps.
{
  const trailerOccupation = { ...manualOccupation, trailerId: 'trailer-0' }
  const after = optimizeDispatch(
    buildInput({
      missions: [buildMission('m-after', 'AFTER', '2030-09-16T18:00:00.000Z')],
      pairs: [buildPair(0)],
      trailers: [buildTrailer(0)],
      occupations: [trailerOccupation],
    })
  )
  assert.equal(planned(after).length, 1, 'the trailer is free after completion')

  const during = optimizeDispatch(
    buildInput({
      missions: [
        buildMission('m-during', 'DURING', '2030-09-16T05:00:00.000Z'),
      ],
      pairs: [buildPair(0)],
      trailers: [buildTrailer(0)],
      occupations: [trailerOccupation],
    })
  )
  assert.equal(planned(during).length, 0, 'the trailer is busy during')
}

// E. Manual assignments on two drivers still leave the third usable, and the
// gaps on the busy pairs remain fillable.
{
  const result = optimizeDispatch(
    buildInput({
      missions: [
        buildMission('m1', 'M1', '2030-09-16T16:00:00.000Z'),
        buildMission('m2', 'M2', '2030-09-17T08:00:00.000Z'),
        buildMission('m3', 'M3', '2030-09-18T08:00:00.000Z'),
      ],
      pairs: [buildPair(0), buildPair(1), buildPair(2)],
      trailers: [buildTrailer(0), buildTrailer(1), buildTrailer(2)],
      occupations: [
        manualOccupation,
        {
          ...manualOccupation,
          missionId: 'manual-2',
          reference: 'MAN-2',
          driverId: 'driver-1',
          truckId: 'truck-1',
        },
      ],
    })
  )
  const items = planned(result)
  assert.equal(items.length, 3, JSON.stringify(result.unassignedMissions))
  assert.ok(
    items.some((item) => item.rowId === 'row-2'),
    'the untouched pair must be used'
  )
}

// F. One impossible mission does not sink the rest of the batch.
{
  const impossible = buildMission(
    'm-bad',
    'BAD',
    '2030-09-16T05:00:00.000Z',
    1
  )
  const result = optimizeDispatch(
    buildInput({
      missions: [
        impossible,
        buildMission('m-ok1', 'OK1', '2030-09-17T08:00:00.000Z'),
        buildMission('m-ok2', 'OK2', '2030-09-18T08:00:00.000Z'),
      ],
      pairs: [buildPair(0)],
      trailers: [buildTrailer(0)],
      occupations: [manualOccupation],
    })
  )
  const items = planned(result)
  assert.equal(items.length, 2, JSON.stringify(result.unassignedMissions))
  assert.ok(items.every((item) => item.reference !== 'BAD'))
}

// G. Every rejection names a code the UI can turn into a precise sentence:
// no outcome is left without one.
{
  const result = optimizeDispatch(
    buildInput({
      missions: [
        buildMission('m-overlap', 'OVERLAP', '2030-09-16T05:00:00.000Z'),
      ],
      pairs: [buildPair(0)],
      trailers: [buildTrailer(0)],
      occupations: [manualOccupation],
    })
  )
  for (const item of [
    ...result.impossibleMissions,
    ...result.deferredMissions,
    ...result.unassignedMissions,
  ]) {
    assert.ok(item.codes.length > 0, `${item.reference} must carry a code`)
    assert.ok(item.reference, 'a rejection must name its mission')
  }
}

console.log('Auto-planning around existing assignments (A-G): OK')
