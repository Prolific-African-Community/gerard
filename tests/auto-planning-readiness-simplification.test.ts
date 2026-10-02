import assert from 'node:assert/strict'

import {
  isResourcePair,
  summarizePairReadiness,
  summarizeProposalMissingData,
} from '../lib/dispatch/auto-planning/readiness-summary'
import { resolvePairChecklistAction } from '../lib/dispatch/auto-planning/checklist-actions'
import { evaluateMissionPrerequisites } from '../lib/dispatch/mission-prerequisites'
import { resolveDriverPosition } from '../lib/dispatch/driver-position'

const base = {
  latitude: 49.4936489,
  longitude: 5.9839516,
  label: 'Base d’exploitation',
  source: 'ORGANIZATION' as const,
}

const pair = (overrides: Partial<Parameters<typeof summarizePairReadiness>[0]>) =>
  summarizePairReadiness({
    driverId: 'driver-1',
    driverName: 'Jonathan',
    truckPlateNumber: 'LU 0221',
    driverActive: true,
    truckUsable: true,
    missingRegulatoryState: false,
    missingPosition: false,
    regulatoryStatus: 'CONFORME',
    ...overrides,
  })

// A. Three drivers on a week that also holds empty grid lines must produce at
// most three readiness entries, never an anonymous "Chauffeur ? · Camion ?".
const weekRows = [
  { driver: { id: 'd1' }, assignedTruck: { id: 't1' } },
  { driver: { id: 'd2' }, assignedTruck: { id: 't2' } },
  { driver: { id: 'd3' }, assignedTruck: { id: 't3' } },
  { driver: null, assignedTruck: null },
  { driver: null, assignedTruck: null },
  { driver: null, assignedTruck: null },
  { driver: null, assignedTruck: null },
]
const resourceRows = weekRows.filter(isResourcePair)
assert.equal(resourceRows.length, 3, 'empty planning rows are not resources')
for (const row of resourceRows) {
  assert.ok(row.driver || row.assignedTruck)
}

// B. An available driver is never reported unavailable.
const available = pair({})
assert.equal(available.level, 'READY')
assert.equal(available.label, 'Jonathan · LU 0221')
assert.doesNotMatch(available.summary, /indisponible/i)

// A real blocker still reads as blocked, and names the resource.
const onLeave = pair({ driverActive: false })
assert.equal(onLeave.level, 'BLOCKED')
assert.match(onLeave.summary, /indisponible/i)
const truckDown = pair({ truckUsable: false })
assert.equal(truckDown.level, 'BLOCKED')
assert.match(truckDown.summary, /immobilis/i)

// C. A mission with no driver yet is not incomplete data: choosing the driver
// is what the automatic planning does.
const mission = {
  pickupDate: '2026-10-05T10:40:00.000Z',
  deliveryDate: '2026-10-05T18:40:00.000Z',
  pickupAddress: 'Esch-sur-Alzette',
  deliveryAddress: 'Paris',
  pickupLat: 49.6,
  pickupLng: 6.13,
  deliveryLat: 48.84,
  deliveryLng: 2.25,
  pickupResolutionStatus: 'CONFIRMED',
  deliveryResolutionStatus: 'CONFIRMED',
  routeDistanceMeters: 377880,
  routeDurationSeconds: 13995,
  requirements: {},
}
const prerequisites = evaluateMissionPrerequisites(mission)
const driverItem = prerequisites.find((item) => item.key === 'driver')
assert.ok(driverItem)
assert.equal(driverItem!.status, 'NOT_REQUIRED')
assert.equal(
  prerequisites.filter((item) => item.status === 'ACTION_REQUIRED').length,
  0,
  'an unassigned mission must not require action before planning'
)

// D. A tractor explicitly declared at base is a known position, used directly.
const atBase = resolveDriverPosition({
  at: new Date('2026-10-05T08:00:00.000Z'),
  gps: null,
  lastCompletedMission: null,
  operatingBase: base,
  truckAtBase: true,
})
assert.equal(atBase.source, 'STATUS_BASE')
assert.equal(atBase.location?.planningEffect, 'DIRECT')
assert.ok(atBase.usable)
assert.equal(
  pair({ missingPosition: false }).level,
  'READY',
  'an explicit base position raises no warning'
)

// E. The same base used as a fallback, with no declared state, stays a warning.
const inferred = resolveDriverPosition({
  at: new Date('2026-10-05T08:00:00.000Z'),
  gps: null,
  lastCompletedMission: null,
  operatingBase: base,
})
assert.equal(inferred.source, 'OPERATING_BASE')
assert.equal(inferred.location?.planningEffect, 'CONDITIONAL')
assert.equal(pair({ missingPosition: true }).level, 'WARNING')

// F. Internal regulatory field names collapse into a single reservation.
const engineMissingData = [
  'position.operatingBase',
  'regulatory.reducedDailyRestsUsedSinceWeeklyRest',
  'regulatory.splitBreakFirstPartSeconds',
  'regulatory.splitDailyRestFirstPartSeconds',
  'regulatory.dutyPeriodStartedAt',
  'regulatory.weeklyRestDueAt',
  'regulatory.weeklyRestCompensationDueSeconds',
  'MISSING_DRIVER_STATE',
  'MISSING_TACHOGRAPH_HISTORY',
  'MISSING_WEEKLY_REST_STATE',
  'BASE:49.49,5.98=>ChIJ0TjyAdBIlUcRxE1DstEqRTw',
]
const summarized = summarizeProposalMissingData(engineMissingData)
assert.equal(summarized.length, 3, JSON.stringify(summarized))
assert.equal(
  summarized.filter((item) => /glementaire/.test(item)).length,
  1,
  'at most one regulatory reservation'
)
for (const line of summarized) {
  assert.doesNotMatch(
    line,
    /splitBreak|dutyPeriod|weeklyRestDue|reducedDaily|=>/,
    `internal field names must stay out of the planning UI: ${line}`
  )
}

// G. A driver with remaining daily and weekly capacity stays plannable even
// when the declaration history is only partial.
const partialHistory = pair({ regulatoryStatus: 'AVERTISSEMENT' })
assert.equal(partialHistory.level, 'WARNING')
assert.notEqual(partialHistory.level, 'BLOCKED')
assert.match(partialHistory.summary, /pauses et repos/i)

// H. An entry with no actionable target exposes no action at all.
assert.equal(
  resolvePairChecklistAction({
    driverId: null,
    truckId: null,
    missingRegulatoryState: true,
    missingPosition: true,
    unavailable: true,
  }).kind,
  'NONE'
)
assert.equal(
  resolvePairChecklistAction({
    driverId: 'driver-1',
    truckId: 'truck-1',
    missingRegulatoryState: true,
    missingPosition: false,
    unavailable: false,
  }).kind,
  'EDIT_DRIVER_REGULATORY'
)

// I. The human sentence of a conditional proposal exposes no internal key.
const summarySentence = `Proposition à confirmer pour INT-0987 : ${summarizeProposalMissingData(
  engineMissingData
).join(' ')}`
assert.doesNotMatch(
  summarySentence,
  /regulatory\.|position\.|=>|MISSING_/,
  summarySentence
)

console.log('Auto-planning readiness simplification (A-I): OK')
