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
import {
  euRoadFreightProfileV1,
  knownRegulatoryDatum,
  unknownRegulatoryDatum,
} from '../lib/dispatch/regulatory'

const notDeclared = 'Valeur absente de la déclaration simplifiée.'

const weekStart = new Date('2030-09-16T00:00:00.000Z')
const weekEnd = new Date('2030-09-23T00:00:00.000Z')
const base = {
  id: 'BASE',
  latitude: 49.5,
  longitude: 6.0,
  positionSource: 'OPERATING_BASE' as const,
  positionConfidence: 'HIGH' as const,
  planningEffect: 'DIRECT' as const,
}
const known = <T>(value: T) =>
  knownRegulatoryDatum(value, weekStart.toISOString(), 'DISPATCHER_DECLARATION')

// The declaration the dispatchers actually fill in: the counters are known,
// the split-rest bookkeeping is not. That is an orange state, not a blocker.
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

const pairs: OptimizationPair[] = Array.from({ length: 2 }, (_, index) => ({
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
  truckStatus: 'AVAILABLE',
  usualTruckId: `truck-${index}`,
  exceptionalReplacement: false,
  availableAt: weekStart.toISOString(),
  initialPosition: base,
  regulatoryState: partialState(`driver-${index}`),
  couplingType: 'FIFTH_WHEEL',
  restrictions: [],
}))

const trailers: OptimizationTrailer[] = Array.from({ length: 2 }, (_, index) => ({
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
}))

// Two missions, each tight enough that the four-hour approach only fits if the
// crew is allowed to leave the base before the pickup window opens.
const approachSeconds = 4 * 3600
function buildMission(index: number, startAt: string): OptimizationMission {
  const pickup = { id: `pickup-${index}`, latitude: 48.8, longitude: 2.3 }
  const delivery = { id: `delivery-${index}`, latitude: 49.4, longitude: 1.1 }
  const start = new Date(startAt)
  return {
    id: `mission-${index}`,
    reference: `QA-${index}`,
    status: 'PENDING',
    priority: 10 - index,
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
      missionId: `mission-${index}`,
      reference: `QA-${index}`,
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
          durationSeconds: 3600,
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
          // Four hours after the pickup opens: unreachable if the approach is
          // forced to start at the pickup hour, comfortable otherwise.
          mustEndBy: new Date(start.getTime() + 4 * 3600_000).toISOString(),
        },
      ],
    },
  }
}

const missions = [
  buildMission(0, '2030-09-17T10:00:00.000Z'),
  buildMission(1, '2030-09-17T12:00:00.000Z'),
]

const transitions: RouteTransition[] = []
for (const from of [base, ...missions.map((mission) => mission.delivery!)]) {
  for (const mission of missions) {
    if (from.id === mission.pickup!.id) continue
    transitions.push({
      key: routeKey(from.id, mission.pickup!.id),
      from,
      to: mission.pickup!,
      distanceMeters: 340_000,
      durationSeconds: approachSeconds,
      source: 'GOOGLE_ROUTES',
      confidence: 'HIGH',
      reason: 'INITIAL_APPROACH',
      empty: true,
    })
  }
}

const input: DispatchOptimizationInput = {
  executionSeed: 'qa-approach',
  period: { startsAt: weekStart.toISOString(), endsAt: weekEnd.toISOString() },
  timeZone: 'Europe/Luxembourg',
  strategy: 'BALANCED',
  pairs,
  missions,
  trailers,
  transitions,
  unavailableResourceIds: [],
  costs: defaultOptimizationCostParameters,
  profile: euRoadFreightProfileV1,
  configuration: dispatchOptimizationConfigurationV1,
}

const result = optimizeDispatch(input)
const proposals = [...result.confirmedProposals, ...result.conditionalProposals]
const planned = proposals.flatMap((proposal) => proposal.missions)

// A. The approach must be allowed to start before the pickup window opens.
assert.equal(
  result.impossibleMissions.length,
  0,
  `no mission may be impossible: ${JSON.stringify(result.impossibleMissions, null, 2)}`
)
assert.equal(planned.length, 2, 'both missions must be planned')

// B. An incomplete regulatory declaration stays orange, never a blocker.
assert.equal(result.metrics.conditionalMissions, 2)

// C. A conditional assignment occupies its crew and its trailer: two missions
// that overlap in time cannot land on the same pair or the same trailer.
assert.equal(proposals.length, 2, 'the second pair must be used')
assert.equal(
  new Set(planned.map((mission) => mission.trailerId)).size,
  2,
  'overlapping missions must not share a trailer'
)

// D. Every planned mission exposes a deterministic occupation window.
for (const mission of planned) {
  assert.ok(
    mission.plannedWindow,
    `${mission.reference} must expose a planned window`
  )
  assert.ok(
    new Date(mission.plannedWindow!.startsAt) <
      new Date(mission.plannedWindow!.endsAt)
  )
}

console.log('auto-planning approach departure and conditional occupation: OK')
