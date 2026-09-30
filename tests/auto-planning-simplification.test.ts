import assert from 'node:assert/strict'
import { classifyPlanningMissions } from '../lib/dispatch/auto-planning/mission-scope'
import { optimizeDispatch, dispatchOptimizationConfigurationV1, defaultOptimizationCostParameters, routeKey } from '../lib/dispatch/optimization'
import type { DispatchOptimizationInput, OptimizationMission, OptimizationPair, OptimizationTrailer, RouteTransition } from '../lib/dispatch/optimization'
import { euRoadFreightProfileV1, knownRegulatoryDatum } from '../lib/dispatch/regulatory'
import { translateReasonCode } from '../lib/dispatch/reason-labels'

const weekStart = new Date('2030-09-16T00:00:00.000Z')
const weekEnd = new Date('2030-09-23T00:00:00.000Z')
const base = { id: 'BASE', latitude: 49.6, longitude: 6.1, positionSource: 'OPERATING_BASE' as const, positionConfidence: 'HIGH' as const, planningEffect: 'DIRECT' as const }
const known = <T>(value: T) => knownRegulatoryDatum(value, weekStart.toISOString(), 'DISPATCHER_DECLARATION')
const state = (driverId: string) => ({ driverId, timeZone: 'Europe/Luxembourg', observedAt: weekStart.toISOString(), validUntil: weekEnd.toISOString(), drivingSinceValidBreakSeconds: known(0), dailyDrivingSeconds: known(0), weeklyDrivingSeconds: known(0), previousWeekDrivingSeconds: known(0), dailyExtensionsUsedThisWeek: known(0), reducedDailyRestsUsedSinceWeeklyRest: known(0), splitBreakFirstPartSeconds: known(0), splitDailyRestFirstPartSeconds: known(0), lastValidRestEndedAt: known(weekStart.toISOString()), dutyPeriodStartedAt: known(weekStart.toISOString()), currentIsoWeek: known('2030-W38'), weeklyRestDueAt: known<string | null>(null), weeklyRestCompensationDueSeconds: known(0) })

const pairs: OptimizationPair[] = Array.from({ length: 3 }, (_, index) => ({ pair: { rowId: `row-${index}`, driverId: `driver-${index}`, truckId: `truck-${index}`, pairLocked: false, assignmentOrigin: 'AUTOMATIC' }, driverName: `Driver ${index}`, driverStatus: 'ACTIVE', truckPlateNumber: `TRUCK-${index}`, truckStatus: 'AVAILABLE', usualTruckId: `truck-${index}`, exceptionalReplacement: false, availableAt: weekStart.toISOString(), initialPosition: base, regulatoryState: state(`driver-${index}`), couplingType: 'FIFTH_WHEEL', restrictions: [] }))
const trailers: OptimizationTrailer[] = Array.from({ length: 3 }, (_, index) => ({ id: `trailer-${index}`, plateNumber: `TRAILER-${index}`, status: 'AVAILABLE', type: 'CURTAINSIDER', capacity: 24000, couplingType: 'FIFTH_WHEEL', position: base, availableAt: weekStart.toISOString(), attachedTruckId: `truck-${index}`, loadStatus: 'EMPTY', restrictions: [] }))
const missions: OptimizationMission[] = Array.from({ length: 6 }, (_, index) => {
  const start = new Date(weekStart.getTime() + (index + 1) * 3 * 3600_000)
  const pickup = { id: `pickup-${index}`, latitude: 49.6, longitude: 6.1 }
  const delivery = { id: `delivery-${index}`, latitude: 49.7, longitude: 6.2 }
  return { id: `mission-${index}`, reference: `QA-${index}`, status: 'PENDING', priority: 10 - index, reportable: false, pickup, delivery, loadedDistanceMeters: 20_000, revenueAmount: 300, currency: 'EUR', requiredTrailerType: 'CURTAINSIDER', requiredCouplingType: 'FIFTH_WHEEL', dependencies: [], missingData: [], confidence: 'HIGH', temporalPlan: { missionId: `mission-${index}`, reference: `QA-${index}`, timeZone: 'Europe/Luxembourg', earliestStartAt: start.toISOString(), startPosition: pickup, endPosition: delivery, missingData: [], steps: [{ id: `loaded-${index}`, activityType: 'DRIVING', durationSeconds: 1800, source: 'GOOGLE_ROUTES', evidence: 'ESTIMATED', confidence: 'HIGH', from: pickup, to: delivery, notBefore: start.toISOString(), mustStartBy: new Date(start.getTime() + 3600_000).toISOString() }] } }
})
const transitions: RouteTransition[] = []
for (const from of [base, ...missions.map((mission) => mission.delivery!)]) for (const mission of missions) transitions.push({ key: routeKey(from.id, mission.pickup!.id), from, to: mission.pickup!, distanceMeters: 0, durationSeconds: 0, source: 'DISPATCH', confidence: 'HIGH', reason: 'INITIAL_APPROACH', empty: true })
const input: DispatchOptimizationInput = { executionSeed: 'qa-six', period: { startsAt: weekStart.toISOString(), endsAt: weekEnd.toISOString() }, timeZone: 'Europe/Luxembourg', strategy: 'MAX_COVERAGE', pairs, missions, trailers, transitions, unavailableResourceIds: [], costs: defaultOptimizationCostParameters, profile: euRoadFreightProfileV1, configuration: dispatchOptimizationConfigurationV1 }
const result = optimizeDispatch(input)
assert.equal(result.metrics.confirmedMissions, 6, JSON.stringify([...result.impossibleMissions, ...result.unassignedMissions], null, 2))
assert.ok(result.confirmedProposals.some((proposal) => proposal.missions.length > 1), 'resources must be reused sequentially')

const scope = classifyPlanningMissions({ missions: [{ id: 'inside', reference: 'IN', status: 'PENDING', pickupDate: '2030-09-16T08:00:00.000Z' }, { id: 'outside', reference: 'OUT', status: 'PENDING', pickupDate: '2030-09-24T08:00:00.000Z' }], periodStart: weekStart, periodEnd: weekEnd, includeExistingForced: false })
assert.deepEqual(scope.visibleMissionIds, ['inside'])
assert.match(scope.exclusions[0].reason, /2030-09-24/)
assert.notEqual(translateReasonCode('UNEXPECTED_INTERNAL_CODE').title, 'Raison technique non reconnue')
console.log('A-AB auto-planning simplification core regressions: OK')
