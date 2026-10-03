import assert from 'node:assert/strict'

import { getTrailerOperationalPresentation } from '../lib/dispatch/trailer-display'
import {
  buildTrailerActiveMissions,
  resolveCurrentTrailerIdForTruck,
  resolveCurrentTruckIdForTrailer,
} from '../lib/dispatch/trailer-rotation'
import type { Trailer } from '../lib/dispatch/mock-data'

const TRUCK = 'truck-lu-0221'
const TRAILER = 'trailer-re-2001'
const OTHER_TRAILER = 'trailer-re-2002'
const PLATES: Record<string, string> = {
  [TRUCK]: 'LU 0221',
  'truck-lu-0222': 'LU 0222',
}
const plateOf = (id: string) => PLATES[id]

const detached: Trailer = {
  id: TRAILER,
  plateNumber: 'RE 2001',
  type: 'CURTAINSIDER',
  status: 'AT_BASE',
  loadStatus: 'EMPTY',
  truckId: null,
}

/** The placement shape both surfaces feed to the shared builder. */
function placement(trailerId: string, truckId: string) {
  return { trailerId, truckId, driverId: 'driver-jonathan' }
}

// A. An IN_PROGRESS mission makes its trailer the current one for the truck,
// even with no physical attachment recorded.
{
  const active = buildTrailerActiveMissions(
    [{ id: 'm1', reference: 'INT-1234', status: 'IN_PROGRESS' }],
    () => placement(TRAILER, TRUCK)
  )
  assert.equal(active[TRAILER]?.truckId, TRUCK)
  assert.equal(
    resolveCurrentTrailerIdForTruck({
      truckId: TRUCK,
      activeMissionsByTrailerId: active,
      physicalTrailerId: null,
    }),
    TRAILER,
    'the grid must show the trailer of the mission under way'
  )
}

// B. The same scenario gives the trailer its current truck.
{
  const active = buildTrailerActiveMissions(
    [{ id: 'm1', reference: 'INT-1234', status: 'IN_PROGRESS' }],
    () => placement(TRAILER, TRUCK)
  )
  const presentation = getTrailerOperationalPresentation(
    detached,
    active[TRAILER],
    undefined,
    plateOf
  )
  assert.equal(presentation.currentTruckId, TRUCK)
  assert.equal(presentation.currentTruckPlate, 'LU 0221')
  assert.equal(presentation.status.label, 'Engagée')
  assert.equal(
    resolveCurrentTruckIdForTrailer({
      activeMission: active[TRAILER],
      physicalTruckId: null,
    }),
    TRUCK
  )
}

// C. The persisted detached location is never presented as the current one
// while the mission is under way.
{
  const active = buildTrailerActiveMissions(
    [{ id: 'm1', reference: 'INT-1234', status: 'IN_PROGRESS' }],
    () => placement(TRAILER, TRUCK)
  )
  const presentation = getTrailerOperationalPresentation(
    detached,
    active[TRAILER],
    undefined,
    plateOf
  )
  assert.equal(presentation.location, 'IN_TRANSIT')
  assert.equal(presentation.locationLabel, 'En transit')
  assert.notEqual(presentation.locationLabel, 'À la base')
  assert.equal(
    presentation.locationEditable,
    false,
    'an engaged trailer must not offer an editable contradicting location'
  )
  assert.equal(presentation.detachedLocationLabel, 'À la base')
}

// D. A future ASSIGNED mission never becomes the current state.
{
  const active = buildTrailerActiveMissions(
    [{ id: 'm2', reference: 'INT-9999', status: 'ASSIGNED' }],
    () => placement(OTHER_TRAILER, TRUCK)
  )
  assert.deepEqual(Object.keys(active), [])
  assert.equal(
    resolveCurrentTrailerIdForTruck({
      truckId: TRUCK,
      activeMissionsByTrailerId: active,
      physicalTrailerId: null,
    }),
    null,
    'tomorrow’s plan must not populate Remorque actuelle'
  )
  const presentation = getTrailerOperationalPresentation(
    { ...detached, id: OTHER_TRAILER, plateNumber: 'RE 2002' },
    active[OTHER_TRAILER],
    undefined,
    plateOf
  )
  assert.equal(presentation.currentTruckId, null)
  assert.notEqual(presentation.status.label, 'Engagée')
}

// E. With no active mission, the physical relation is what shows.
{
  const attached: Trailer = { ...detached, truckId: TRUCK }
  const presentation = getTrailerOperationalPresentation(
    attached,
    null,
    'LU 0221',
    plateOf
  )
  assert.equal(presentation.currentTruckId, TRUCK)
  assert.equal(presentation.currentTruckPlate, 'LU 0221')
  assert.equal(presentation.situation.coupling, 'ATTACHED')
  assert.equal(presentation.physicalAttachmentConfirmed, true)
  assert.equal(presentation.couplingLabel, 'Attelée')
  assert.equal(
    resolveCurrentTrailerIdForTruck({
      truckId: TRUCK,
      activeMissionsByTrailerId: {},
      physicalTrailerId: TRAILER,
    }),
    TRAILER
  )
}

// F. A DONE mission stops being a source of current state.
{
  const active = buildTrailerActiveMissions(
    [{ id: 'm1', reference: 'INT-1234', status: 'DONE' }],
    () => placement(TRAILER, TRUCK)
  )
  assert.deepEqual(Object.keys(active), [])
  const presentation = getTrailerOperationalPresentation(
    detached,
    active[TRAILER],
    undefined,
    plateOf
  )
  assert.equal(presentation.currentTruckId, null)
  assert.equal(presentation.locationLabel, 'À la base')
  assert.equal(
    presentation.locationEditable,
    true,
    'once the mission is over, normal editing resumes'
  )
  assert.equal(presentation.couplingLabel, 'Décrochée')
}

// G. An active mission wins over a stale physical relation.
{
  const active = buildTrailerActiveMissions(
    [{ id: 'm1', reference: 'INT-1234', status: 'IN_PROGRESS' }],
    () => placement(TRAILER, TRUCK)
  )
  const stale: Trailer = { ...detached, truckId: 'truck-lu-0222' }
  const presentation = getTrailerOperationalPresentation(
    stale,
    active[TRAILER],
    'LU 0222',
    plateOf
  )
  assert.equal(presentation.currentTruckId, TRUCK)
  assert.equal(presentation.currentTruckPlate, 'LU 0221')
  // The physical truth is still reported, never overwritten.
  assert.equal(presentation.situation.coupling, 'ATTACHED')
  assert.equal(presentation.physicalAttachmentConfirmed, true)
}

// An ISSUE mission is operationally under way, like the rest of the codebase
// already treats it.
{
  const active = buildTrailerActiveMissions(
    [{ id: 'm1', reference: 'INT-1234', status: 'ISSUE' }],
    () => placement(TRAILER, TRUCK)
  )
  assert.equal(active[TRAILER]?.truckId, TRUCK)
}

// H. Desktop and mobile share the precedence: both call the same helpers with
// the same placement shape, so one input gives one answer.
{
  const missions = [{ id: 'm1', reference: 'INT-1234', status: 'IN_PROGRESS' }]
  const desktop = buildTrailerActiveMissions(missions, () =>
    placement(TRAILER, TRUCK)
  )
  const mobile = buildTrailerActiveMissions(missions, () =>
    placement(TRAILER, TRUCK)
  )
  assert.deepEqual(desktop, mobile)
  assert.deepEqual(
    getTrailerOperationalPresentation(detached, desktop[TRAILER], undefined, plateOf)
      .currentTruckPlate,
    getTrailerOperationalPresentation(detached, mobile[TRAILER], undefined, plateOf)
      .currentTruckPlate
  )
}

// The short accessor form still works for callers that only know a trailer id.
{
  const active = buildTrailerActiveMissions(
    [{ id: 'm1', reference: 'INT-1234', status: 'IN_PROGRESS' }],
    () => TRAILER
  )
  assert.equal(active[TRAILER]?.missionReference, 'INT-1234')
  assert.equal(active[TRAILER]?.truckId, null)
}

// No surface may present the contradiction the dispatcher reported.
{
  const active = buildTrailerActiveMissions(
    [{ id: 'm1', reference: 'INT-1234', status: 'IN_PROGRESS' }],
    () => placement(TRAILER, TRUCK)
  )
  const p = getTrailerOperationalPresentation(
    detached,
    active[TRAILER],
    undefined,
    plateOf
  )
  const contradiction =
    p.status.label === 'Engagée' &&
    p.currentTruckPlate === null &&
    p.locationLabel === 'À la base'
  assert.equal(contradiction, false, 'Engagée + aucun camion + à la base')
}

console.log('Current trailer operational display (A-H): OK')
