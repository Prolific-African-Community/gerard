import assert from 'node:assert/strict'
import { buildOptimizationCandidates, defaultOptimizationCostParameters, dispatchOptimizationConfigurationV1, optimizeDispatch, routeKey } from '../lib/dispatch/optimization'
import type { DispatchOptimizationInput, OptimizationMission, OptimizationPair, OptimizationTrailer, RouteTransition } from '../lib/dispatch/optimization'
import { euRoadFreightProfileV1, knownRegulatoryDatum } from '../lib/dispatch/regulatory'

const week = new Date('2031-02-03T00:00:00.000Z')
const weekEnd = new Date('2031-02-10T00:00:00.000Z')
const place = (id: string, latitude: number) => ({ id, latitude, longitude: 6.1 })
const base = place('BASE', 49.6)
const known = <T>(value: T) => knownRegulatoryDatum(value, week.toISOString(), 'DISPATCHER_DECLARATION')
const pair = (index: number, day = 0): OptimizationPair => { const availableAt = new Date(week.getTime() + day * 86400000).toISOString(); return { pair: { rowId: `row-${index}`, driverId: `driver-${index}`, truckId: `truck-${index}`, pairLocked: false, assignmentOrigin: 'AUTOMATIC' }, driverName: `Driver ${index}`, driverStatus: 'ACTIVE', truckPlateNumber: `TRUCK-${index}`, truckStatus: 'AVAILABLE', usualTruckId: `truck-${index}`, exceptionalReplacement: false, availableAt, initialPosition: base, couplingType: 'FIFTH_WHEEL', restrictions: [], regulatoryState: { driverId: `driver-${index}`, timeZone: 'Europe/Luxembourg', observedAt: availableAt, validUntil: weekEnd.toISOString(), drivingSinceValidBreakSeconds: known(0), dailyDrivingSeconds: known(0), weeklyDrivingSeconds: known(0), previousWeekDrivingSeconds: known(0), dailyExtensionsUsedThisWeek: known(0), reducedDailyRestsUsedSinceWeeklyRest: known(0), splitBreakFirstPartSeconds: known(0), splitDailyRestFirstPartSeconds: known(0), lastValidRestEndedAt: known(availableAt), dutyPeriodStartedAt: known(availableAt), currentIsoWeek: known('2031-W06'), weeklyRestDueAt: known<string | null>(null), weeklyRestCompensationDueSeconds: known(0) } } }
const trailer = (id: string, patch: Partial<OptimizationTrailer> = {}): OptimizationTrailer => ({ id, plateNumber: id, status: 'AVAILABLE', type: 'CURTAINSIDER', capacity: 24000, couplingType: 'FIFTH_WHEEL', compatibleCargoTypes: ['GENERAL'], position: base, availableAt: week.toISOString(), attachedTruckId: null, loadStatus: 'EMPTY', restrictions: [], ...patch })
const mission = (index: number, day: number, patch: Partial<OptimizationMission> = {}): OptimizationMission => {
  const at = new Date(week.getTime() + day * 86400000 + 9 * 3600000)
  const pickup = place(`P${index}`, 49.61 + index / 1000)
  const delivery = place(`D${index}`, 49.71 + index / 1000)
  return { id: `mission-${index}`, reference: `QA-TL-${index}`, status: 'PENDING', priority: 20 - index, reportable: false, pickup, delivery, loadedDistanceMeters: 50000, revenueAmount: 500, currency: 'EUR', requiredTrailerType: 'CURTAINSIDER', requiredCapacity: 20000, requiredCargoType: 'GENERAL', requiredCouplingType: 'FIFTH_WHEEL', dependencies: [], missingData: [], confidence: 'HIGH', temporalPlan: { missionId: `mission-${index}`, reference: `QA-TL-${index}`, timeZone: 'Europe/Luxembourg', earliestStartAt: at.toISOString(), startPosition: pickup, endPosition: delivery, missingData: [], steps: [{ id: `LOAD-${index}`, activityType: 'DRIVING', durationSeconds: 3600, source: 'GOOGLE_ROUTES', evidence: 'ESTIMATED', confidence: 'HIGH', from: pickup, to: delivery, notBefore: at.toISOString(), mustStartBy: new Date(at.getTime() + 2 * 3600000).toISOString() }] }, ...patch }
}
function routes(pairs: OptimizationPair[], missions: OptimizationMission[], trailers: OptimizationTrailer[]): RouteTransition[] {
  const points = [...pairs.map((item) => item.initialPosition), ...missions.flatMap((item) => [item.pickup, item.delivery]), ...trailers.flatMap((item) => [item.position, ...(item.timeline?.map((event) => event.positionAfter) ?? [])])].filter((item): item is NonNullable<typeof item> => Boolean(item))
  const unique = Array.from(new Map(points.map((item) => [item.id, item])).values())
  return unique.flatMap((from) => unique.filter((to) => to.id !== from.id).map((to) => { const distanceMeters = Math.round(Math.abs((from.latitude ?? 0) - (to.latitude ?? 0)) * 100000); return { key: routeKey(from.id, to.id), from, to, distanceMeters, durationSeconds: Math.max(60, Math.round(distanceMeters / 20)), source: 'DISPATCH' as const, confidence: 'HIGH' as const, reason: 'INITIAL_APPROACH' as const, empty: true } }))
}
function makeInput(pairs: OptimizationPair[], missions: OptimizationMission[], trailers: OptimizationTrailer[], resourceOccupations: DispatchOptimizationInput['resourceOccupations'] = []): DispatchOptimizationInput { return { executionSeed: 'trailer-timeline', period: { startsAt: week.toISOString(), endsAt: weekEnd.toISOString() }, timeZone: 'Europe/Luxembourg', strategy: 'MAX_PROFITABILITY', pairs, missions, trailers, transitions: routes(pairs, missions, trailers), resourceOccupations, unavailableResourceIds: [], costs: defaultOptimizationCostParameters, profile: euRoadFreightProfileV1, configuration: dispatchOptimizationConfigurationV1 } }

// Sequential reuse advances trailer position and availability without mutating physical attachment.
const three = [mission(1, 0, { forcedPairRowId: 'row-0' }), mission(2, 1, { forcedPairRowId: 'row-1' }), mission(3, 2, { forcedPairRowId: 'row-2' })]
const threeInput = makeInput([pair(0, 0), pair(1, 1), pair(2, 2)], three, [trailer('R1', { attachedTruckId: 'truck-0' })])
const threeResult = optimizeDispatch(structuredClone(threeInput))
assert.equal(threeResult.metrics.confirmedMissions, 3, JSON.stringify([...threeResult.impossibleMissions, ...threeResult.unassignedMissions], null, 2))
assert.deepEqual(threeResult.confirmedProposals.flatMap((proposal) => proposal.missions.map((item) => item.trailerId)), ['R1', 'R1', 'R1'])
assert.equal(threeResult.trailerFinalStates[0].position?.id, 'D3')
assert.equal(threeInput.trailers[0].attachedTruckId, 'truck-0')

// An overlap is blocked by the shared interval checker.
const overlapping = mission(4, 0)
const overlapCandidate = buildOptimizationCandidates(makeInput([pair(0)], [overlapping], [trailer('R2')], [{ missionId: 'busy', driverId: null, truckId: null, trailerId: 'R2', startsAt: overlapping.temporalPlan.earliestStartAt!, endsAt: new Date(new Date(overlapping.temporalPlan.earliestStartAt!).getTime() + 4 * 3600000).toISOString() }]), overlapping)[0]
assert.ok(overlapCandidate.compatibility.codes.includes('TRAILER_TIME_CONFLICT'))

// A known active mission releases a loaded trailer at its delivery; an idle loaded trailer stays unavailable.
const tuesday = mission(5, 1)
const active = trailer('R-active', { loadStatus: 'LOADED', forcedMissionId: 'active', timeline: [{ missionId: 'active', truckId: 'truck-0', startsAt: '2031-02-03T08:00:00.000Z', endsAt: '2031-02-03T18:00:00.000Z', positionAfter: place('ACTIVE-DELIVERY', 49.75) }] })
const released = buildOptimizationCandidates(makeInput([pair(0, 1)], [tuesday], [active]), tuesday)[0]
assert.equal(released.compatibility.status, 'COMPATIBLE')
assert.equal(released.trailer?.position?.id, 'ACTIVE-DELIVERY')
const idleLoaded = buildOptimizationCandidates(makeInput([pair(0, 1)], [tuesday], [trailer('R-idle', { loadStatus: 'LOADED' })]), tuesday)
assert.equal(idleLoaded.length, 0)

// Geography and attachment affect route cost naturally.
const routeMission = mission(6, 1)
const ranked = buildOptimizationCandidates(makeInput([pair(0, 1)], [routeMission], [trailer('far', { position: place('FAR', 50.8) }), trailer('close', { position: place('CLOSE', 49.605) })]), routeMission)
assert.equal(ranked[0].trailer?.id, 'close')
const attachedCandidate = buildOptimizationCandidates(makeInput([pair(0, 1)], [routeMission], [trailer('attached', { attachedTruckId: 'truck-0' })]), routeMission)[0]
assert.equal(attachedCandidate.trailerChange, false)
assert.equal(attachedCandidate.transitions.some((item) => item.reason === 'TRAILER_PICKUP'), false)

// Primary 3x3x6 acceptance: one trailer is reused at least three times and switches trucks.
const six = [mission(10, 0, { forcedPairRowId: 'row-0' }), mission(11, 0.12, { forcedPairRowId: 'row-0' }), mission(12, 1, { forcedPairRowId: 'row-1' }), mission(13, 1.12, { forcedPairRowId: 'row-1' }), mission(14, 2, { forcedPairRowId: 'row-2' }), mission(15, 2.12, { forcedPairRowId: 'row-2' })]
const acceptanceInput = makeInput([pair(0, 0), pair(1, 1), pair(2, 2)], six, [trailer('RA', { attachedTruckId: 'truck-0' }), trailer('RB', { position: place('REMOTE', 49.9) }), trailer('RC')])
const acceptance = optimizeDispatch(structuredClone(acceptanceInput))
assert.equal(acceptance.metrics.confirmedMissions, 6, JSON.stringify([...acceptance.impossibleMissions, ...acceptance.unassignedMissions], null, 2))
const accepted = acceptance.confirmedProposals.flatMap((proposal) => proposal.missions.map((item) => ({ trailerId: item.trailerId, truckId: proposal.pair.truckId })))
const count = new Map<string, number>(); const trucks = new Map<string, Set<string>>()
for (const item of accepted) { if (!item.trailerId) continue; count.set(item.trailerId, (count.get(item.trailerId) ?? 0) + 1); const set = trucks.get(item.trailerId) ?? new Set<string>(); set.add(item.truckId); trucks.set(item.trailerId, set) }
assert.ok(Math.max(...Array.from(count.values())) >= 3)
assert.ok(Array.from(trucks.values()).some((set) => set.size > 1))
assert.equal(acceptanceInput.trailers[0].attachedTruckId, 'truck-0')

console.log('A-R trailer timeline and 3x3x6 acceptance: OK')
