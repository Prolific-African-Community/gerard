import assert from 'node:assert/strict'

import {
  calculateDriverActivityState,
  type ActivityEventInput,
  type PlannedMissionInput,
} from '../lib/dispatch/regulatory/activity-calculator'
import { buildDriverRegulatoryAssessment } from '../lib/dispatch/regulatory/assessment'

const at = new Date('2026-09-30T18:00:00.000Z')
const baseline = {
  referenceAt: new Date('2026-09-28T00:00:00.000Z'),
  validUntil: new Date('2026-10-05T00:00:00.000Z'),
  weeklyDrivingSeconds: 0,
  dailyDrivingSeconds: 0,
  drivingSinceValidBreakSeconds: 0,
}

function event(id: string, type: ActivityEventInput['type'], effectiveAt: string, overrides: Partial<ActivityEventInput> = {}): ActivityEventInput {
  return { id, type, effectiveAt: new Date(effectiveAt), recordedAt: new Date(effectiveAt), source: 'QA', missionId: null, ...overrides }
}

function calculate(events: ActivityEventInput[], missions: PlannedMissionInput[] = []) {
  return calculateDriverActivityState({ events, missions, at, baseline })
}

function assertNoMissingMissionWarning(summary: ReturnType<typeof calculate>) {
  assert.equal(summary.anomalies.some((value) => value.includes('sans mission connue')), false)
  assert.equal(summary.reliabilityReasons.some((value) => value.includes('sans mission connue')), false)
}

// A — closed by AVAILABLE.
const availableClosed = calculate([
  event('a-start', 'DRIVE_START', '2026-09-30T12:13:10.000Z'),
  event('a-end', 'AVAILABLE', '2026-09-30T12:13:23.000Z'),
])
assert.equal(availableClosed.observedSegments[0].kind, 'DRIVING')
assert.equal(availableClosed.observedSegments[0].durationSeconds, 13)
assert.equal(availableClosed.dailyDrivingSeconds, 13)
assert.equal(availableClosed.openActivity, false)
assert.equal(availableClosed.reliability, 'UP_TO_DATE')
assertNoMissingMissionWarning(availableClosed)

// B — closed by DRIVE_END.
const driveEndClosed = calculate([
  event('b-start', 'DRIVE_START', '2026-09-30T13:00:00.000Z'),
  event('b-end', 'DRIVE_END', '2026-09-30T13:07:00.000Z'),
])
assert.equal(driveEndClosed.dailyDrivingSeconds, 7 * 60)
assert.equal(driveEndClosed.openActivity, false)
assert.equal(driveEndClosed.reliability, 'UP_TO_DATE')
assertNoMissingMissionWarning(driveEndClosed)

// C — still open: no duration invented and confirmation remains required.
const openDrive = calculate([event('c-start', 'DRIVE_START', '2026-09-30T14:00:00.000Z')])
assert.equal(openDrive.openActivity, true)
assert.equal(openDrive.reliability, 'TO_CONFIRM')
assert.equal(openDrive.dailyDrivingSeconds, 0)
assert.ok(openDrive.reliabilityReasons.some((value) => value.includes('ouverte')))

const validMission: PlannedMissionInput = {
  id: 'mission-1', reference: 'GRD-TEST-1',
  startsAt: new Date('2026-09-30T15:00:00.000Z'),
  endsAt: new Date('2026-09-30T16:00:00.000Z'),
  plannedDrivingSeconds: 3600,
}

// D — valid explicit mission reconciliation is unchanged.
const linkedInside = calculate([
  event('d-start', 'DRIVE_START', '2026-09-30T15:05:00.000Z', { missionId: validMission.id }),
  event('d-end', 'DRIVE_END', '2026-09-30T15:35:00.000Z', { missionId: validMission.id }),
], [validMission])
assert.equal(linkedInside.plannedMissions[0].status, 'MATCHED')
assert.deepEqual(linkedInside.plannedMissions[0].associatedEventIds, ['d-start'])
assert.equal(linkedInside.reliability, 'UP_TO_DATE')

// E — explicit mission link outside its window remains anomalous.
const linkedOutside = calculate([
  event('e-start', 'DRIVE_START', '2026-09-30T16:30:00.000Z', { missionId: validMission.id }),
  event('e-end', 'DRIVE_END', '2026-09-30T16:45:00.000Z', { missionId: validMission.id }),
], [validMission])
assert.equal(linkedOutside.reliability, 'TO_CONFIRM')
assert.ok(linkedOutside.anomalies.some((value) => value.includes('hors de son créneau planifié')))

// F — voided and superseded starts keep existing activeEvents semantics.
const corrected = calculate([
  event('f-base', 'AVAILABLE', '2026-09-30T08:00:00.000Z'),
  event('f-voided', 'DRIVE_START', '2026-09-30T09:00:00.000Z', { isVoided: true }),
  event('f-available', 'AVAILABLE', '2026-09-30T10:00:00.000Z'),
  event('f-original', 'DRIVE_START', '2026-09-30T11:00:00.000Z'),
  event('f-correction', 'DRIVE_START', '2026-09-30T11:15:00.000Z', { correctedEventId: 'f-original' }),
  event('f-end', 'AVAILABLE', '2026-09-30T11:30:00.000Z'),
])
assert.equal(corrected.observedSegments.some((segment) => segment.eventId === 'f-voided'), false)
assert.equal(corrected.observedSegments.some((segment) => segment.eventId === 'f-original'), false)
assert.equal(corrected.dailyDrivingSeconds, 15 * 60)
assert.equal(corrected.reliability, 'UP_TO_DATE')

// G — several closed unlinked drives accumulate without a permanent warning.
const multiple = calculate([
  event('g-start-1', 'DRIVE_START', '2026-09-30T09:00:00.000Z'),
  event('g-end-1', 'AVAILABLE', '2026-09-30T09:05:00.000Z'),
  event('g-start-2', 'DRIVE_START', '2026-09-30T10:00:00.000Z'),
  event('g-end-2', 'DRIVE_END', '2026-09-30T10:07:00.000Z'),
])
assert.equal(multiple.dailyDrivingSeconds, 12 * 60)
assert.equal(multiple.reliability, 'UP_TO_DATE')
assertNoMissingMissionWarning(multiple)

// H — Ronaldo-like sequence ends AVAILABLE and retains all observed driving.
const ronaldo = calculate([
  event('h-1', 'DRIVE_START', '2026-09-30T08:00:00.000Z'),
  event('h-2', 'AVAILABLE', '2026-09-30T08:10:00.000Z'),
  event('h-3', 'DRIVE_START', '2026-09-30T09:00:00.000Z'),
  event('h-4', 'DRIVE_END', '2026-09-30T09:20:00.000Z'),
  event('h-5', 'DRIVE_START', '2026-09-30T10:00:00.000Z'),
  event('h-6', 'AVAILABLE', '2026-09-30T10:30:00.000Z'),
  event('h-7', 'BREAK', '2026-09-30T11:00:00.000Z'),
  event('h-8', 'AVAILABLE', '2026-09-30T11:45:00.000Z'),
])
assert.equal(ronaldo.dailyDrivingSeconds, 60 * 60)
assert.equal(ronaldo.currentStatus, 'AVAILABLE')
assert.equal(ronaldo.openActivity, false)
assert.equal(ronaldo.reliability, 'UP_TO_DATE')
assertNoMissingMissionWarning(ronaldo)

const assessment = buildDriverRegulatoryAssessment({
  driverStatus: 'ACTIVE', summary: ronaldo,
  declaration: {
    ...baseline, id: 'declaration', organizationId: 'organization', driverId: 'driver',
    timeZone: 'Europe/Luxembourg', previousWeekDrivingSeconds: 0,
    lastValidRestEndedAt: baseline.referenceAt, dutyPeriodStartedAt: baseline.referenceAt,
    dailyExtensionsUsedThisWeek: 0, reducedDailyRestsUsedSinceWeeklyRest: 0,
    splitBreakFirstPartSeconds: 0, splitDailyRestFirstPartSeconds: 0,
    currentIsoWeek: '2026-W40', weeklyRestDueAt: null,
    weeklyRestCompensationDueSeconds: 0, source: 'QA', createdByUserId: null,
    notes: null, knownFields: null,
    createdAt: baseline.referenceAt, updatedAt: baseline.referenceAt,
  },
  at,
})
assert.equal(assessment.controls.find((control) => control.key === 'HISTORY')?.status, 'CONFORME')

console.log('A-H regulatory closed unlinked driving regression: OK')
