import assert from 'node:assert/strict'

import {
  hasReachedPickup,
  resolveMissionPlanningDisplayDay,
  weekdayOf,
} from '../lib/dispatch/mission-planning-day'
import type { DispatchDay } from '../lib/dispatch/mock-data'

// Semaine du lundi 5 octobre 2026, convention locale de l'application.
const weekStartDate = new Date(2026, 9, 5)
const MONDAY_PICKUP = '2026-10-05T08:00:00.000Z'
const WEDNESDAY_DELIVERY = '2026-10-07T16:00:00.000Z'
const FRIDAY_DELIVERY = '2026-10-09T16:00:00.000Z'

function displayDay(input: {
  plannedDay?: DispatchDay
  deliveryDate?: string | null
  missionStatus?: string
  truckStatus?: string | null
}) {
  return resolveMissionPlanningDisplayDay({
    plannedDay: input.plannedDay ?? 'monday',
    deliveryDate:
      input.deliveryDate === undefined ? WEDNESDAY_DELIVERY : input.deliveryDate,
    missionStatus: input.missionStatus ?? 'assigned',
    truckStatus: input.truckStatus ?? null,
    weekStartDate,
  })
}

// The week mapping itself must be right before anything else is meaningful.
assert.equal(weekdayOf(MONDAY_PICKUP, 'Europe/Luxembourg'), 'monday')
assert.equal(weekdayOf(WEDNESDAY_DELIVERY, 'Europe/Luxembourg'), 'wednesday')
assert.equal(weekdayOf(FRIDAY_DELIVERY, 'Europe/Luxembourg'), 'friday')

// A. Pickup Monday, delivery Wednesday, pickup not reached -> Monday.
assert.equal(
  displayDay({ missionStatus: 'in_progress', truckStatus: 'EN_ROUTE_TO_PICKUP' }),
  'monday'
)

// B. Same mission once the pickup is reached -> Wednesday.
assert.equal(
  displayDay({ missionStatus: 'in_progress', truckStatus: 'AT_PICKUP' }),
  'wednesday'
)
// And it stays there once loading is done and the driver is rolling.
assert.equal(
  displayDay({ missionStatus: 'in_progress', truckStatus: 'ON_MISSION' }),
  'wednesday'
)

// Case B of the brief: pickup Tuesday, delivery Friday.
assert.equal(
  displayDay({
    plannedDay: 'tuesday',
    deliveryDate: FRIDAY_DELIVERY,
    missionStatus: 'in_progress',
    truckStatus: 'EN_ROUTE_TO_PICKUP',
  }),
  'tuesday'
)
assert.equal(
  displayDay({
    plannedDay: 'tuesday',
    deliveryDate: FRIDAY_DELIVERY,
    missionStatus: 'in_progress',
    truckStatus: 'AT_PICKUP',
  }),
  'friday'
)

// C. Pickup and delivery the same day: no movement, before or after.
for (const truckStatus of ['EN_ROUTE_TO_PICKUP', 'AT_PICKUP', 'ON_MISSION']) {
  assert.equal(
    displayDay({
      deliveryDate: '2026-10-05T18:00:00.000Z',
      missionStatus: 'in_progress',
      truckStatus,
    }),
    'monday',
    `same-day mission must not move (${truckStatus})`
  )
}

// D. IN_PROGRESS alone is never the trigger: driving to the trailer, picking it
// up and driving to the pickup all keep the card on the pickup day.
for (const truckStatus of [null, 'ASSIGNED', 'AVAILABLE', 'EN_ROUTE_TO_PICKUP']) {
  assert.equal(
    displayDay({ missionStatus: 'in_progress', truckStatus }),
    'monday',
    `IN_PROGRESS with truck ${truckStatus} must stay on the pickup day`
  )
}

// E. A future assigned mission stays on its pickup day even if the truck is
// busy at a pickup for the mission it is actually running.
assert.equal(
  displayDay({ missionStatus: 'assigned', truckStatus: 'AT_PICKUP' }),
  'monday'
)
assert.equal(
  displayDay({ missionStatus: 'pending', truckStatus: 'ON_MISSION' }),
  'monday'
)

// F. A finished mission keeps the existing completed behaviour.
assert.equal(
  displayDay({ missionStatus: 'done', truckStatus: 'ON_MISSION' }),
  'monday'
)
assert.equal(
  displayDay({ missionStatus: 'cancelled', truckStatus: 'AT_PICKUP' }),
  'monday'
)

// G + H. The pickup-reached predicate is the single trigger.
assert.equal(
  hasReachedPickup({ missionStatus: 'in_progress', truckStatus: 'AT_PICKUP' }),
  true
)
assert.equal(
  hasReachedPickup({ missionStatus: 'issue', truckStatus: 'ON_MISSION' }),
  true
)
assert.equal(
  hasReachedPickup({
    missionStatus: 'in_progress',
    truckStatus: 'EN_ROUTE_TO_PICKUP',
  }),
  false
)
assert.equal(hasReachedPickup({ missionStatus: 'in_progress' }), false)
assert.equal(
  hasReachedPickup({ missionStatus: 'done', truckStatus: 'AT_PICKUP' }),
  false
)

// A delivery outside the displayed week cannot be rendered: the card stays put
// rather than vanishing from the grid.
assert.equal(
  displayDay({
    deliveryDate: '2026-10-14T10:00:00.000Z',
    missionStatus: 'in_progress',
    truckStatus: 'AT_PICKUP',
  }),
  'monday'
)
// A missing or unusable delivery date behaves the same way.
assert.equal(
  displayDay({
    deliveryDate: null,
    missionStatus: 'in_progress',
    truckStatus: 'AT_PICKUP',
  }),
  'monday'
)
assert.equal(
  displayDay({
    deliveryDate: 'not-a-date',
    missionStatus: 'in_progress',
    truckStatus: 'AT_PICKUP',
  }),
  'monday'
)

// I. The resolver is pure: it reads its input and returns a day. It cannot
// touch an assignment, a resource or a date.
{
  const assignment = Object.freeze({
    assignmentId: 'assignment-1',
    driverId: 'driver-1',
    truckId: 'truck-1',
    trailerId: 'trailer-1',
    plannedDay: 'monday' as DispatchDay,
    pickupDate: MONDAY_PICKUP,
    deliveryDate: WEDNESDAY_DELIVERY,
  })
  const before = JSON.stringify(assignment)
  const day = resolveMissionPlanningDisplayDay({
    plannedDay: assignment.plannedDay,
    deliveryDate: assignment.deliveryDate,
    missionStatus: 'in_progress',
    truckStatus: 'AT_PICKUP',
    weekStartDate,
  })
  assert.equal(day, 'wednesday')
  assert.equal(
    JSON.stringify(assignment),
    before,
    'resolving a display day must not touch the assignment'
  )
}

// J. Desktop and mobile call the same resolver with the same inputs, so one
// situation can only produce one day.
{
  const input = {
    plannedDay: 'monday' as DispatchDay,
    deliveryDate: WEDNESDAY_DELIVERY,
    missionStatus: 'in_progress',
    truckStatus: 'AT_PICKUP',
    weekStartDate,
  }
  assert.equal(
    resolveMissionPlanningDisplayDay(input),
    resolveMissionPlanningDisplayDay(input)
  )
}

console.log('Mission operational day display (A-J): OK')
