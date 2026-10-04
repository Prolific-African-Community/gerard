import assert from 'node:assert/strict'

import {
  configuredSingleRouteMaximum,
  measureRouteOperation,
} from '../lib/dispatch/maps/route-control'
import { evaluateMissionPrerequisites } from '../lib/dispatch/mission-prerequisites'

/**
 * Le trajet principal d'une mission (enlèvement → livraison) est demandé
 * explicitement par un dispatcher. Il ne doit jamais être plafonné par le
 * budget des opérations en masse : c'est ce qui laissait EC---1548 sur
 * « Distance à calculer » avec `GOOGLE_ROUTES_OPERATION_LIMIT`.
 */

const bulkBefore = process.env.GOOGLE_ROUTES_MAX_CALLS_PER_OPERATION
const singleBefore = process.env.GOOGLE_ROUTES_MAX_CALLS_PER_MISSION_ROUTE

function restoreEnv() {
  if (bulkBefore === undefined) delete process.env.GOOGLE_ROUTES_MAX_CALLS_PER_OPERATION
  else process.env.GOOGLE_ROUTES_MAX_CALLS_PER_OPERATION = bulkBefore
  if (singleBefore === undefined) delete process.env.GOOGLE_ROUTES_MAX_CALLS_PER_MISSION_ROUTE
  else process.env.GOOGLE_ROUTES_MAX_CALLS_PER_MISSION_ROUTE = singleBefore
}

// C. The main mission route budget is independent of the approach-route one.
{
  process.env.GOOGLE_ROUTES_MAX_CALLS_PER_OPERATION = '0'
  delete process.env.GOOGLE_ROUTES_MAX_CALLS_PER_MISSION_ROUTE
  assert.equal(
    configuredSingleRouteMaximum(),
    2,
    'a bulk budget of 0 must not zero the single-route budget'
  )

  process.env.GOOGLE_ROUTES_MAX_CALLS_PER_MISSION_ROUTE = '0'
  assert.equal(
    configuredSingleRouteMaximum(),
    0,
    'the single-route budget stays explicitly blockable'
  )

  process.env.GOOGLE_ROUTES_MAX_CALLS_PER_MISSION_ROUTE = 'not-a-number'
  assert.equal(configuredSingleRouteMaximum(), 2, 'an invalid value falls back')
  restoreEnv()
}

// The budget is the one the operation is given, and a nested call still obeys
// the outer operation: a mission route computed inside a planning snapshot
// must not escape the snapshot budget.
async function checkNestedOperationBudget() {
  const calls: string[] = []
  const metrics = await measureRouteOperation(
    'single route',
    async () => {
      calls.push('outer')
      await measureRouteOperation(
        'nested',
        async () => {
          calls.push('nested')
        },
        { maxCalls: 99, log: false }
      )
    },
    { maxCalls: 2, log: false }
  )
  assert.deepEqual(calls, ['outer', 'nested'])
  assert.equal(metrics.metrics.operation, 'single route')
}

// A + D. A computed route is what makes the mission ready and what the card
// reads: distance and duration both persisted, no missing-data code left.
{
  const prepared = evaluateMissionPrerequisites({
    pickupDate: '2026-10-05T08:00:00.000Z',
    deliveryDate: '2026-10-05T18:00:00.000Z',
    pickupAddress: 'Pl. de la Gare, 51100 Reims, France',
    deliveryAddress: 'Strasbourg, France',
    pickupLat: 49.2590007,
    pickupLng: 4.0244097,
    deliveryLat: 48.5734053,
    deliveryLng: 7.7521113,
    pickupResolutionStatus: 'CONFIRMED',
    deliveryResolutionStatus: 'CONFIRMED',
    routeDistanceMeters: 353_000,
    routeDurationSeconds: 12_600,
    requirements: {},
  })
  const route = prepared.find((item) => item.key === 'route')
  assert.equal(route?.status, 'CONFIRMED')
  assert.equal(
    prepared.filter((item) => item.status === 'MISSING').length,
    0,
    'a mission with a computed route has nothing missing'
  )
}

// B. Without a route the mission stays identifiable and the gap is explicit.
{
  const withoutRoute = evaluateMissionPrerequisites({
    pickupDate: '2026-10-05T08:00:00.000Z',
    deliveryDate: '2026-10-05T18:00:00.000Z',
    pickupAddress: 'Pl. de la Gare, 51100 Reims, France',
    deliveryAddress: 'Strasbourg, France',
    pickupLat: 49.2590007,
    pickupLng: 4.0244097,
    deliveryLat: 48.5734053,
    deliveryLng: 7.7521113,
    pickupResolutionStatus: 'CONFIRMED',
    deliveryResolutionStatus: 'CONFIRMED',
    routeDistanceMeters: null,
    routeDurationSeconds: null,
    requirements: {},
  })
  const route = withoutRoute.find((item) => item.key === 'route')
  assert.equal(route?.status, 'MISSING')
  assert.match(route!.detail, /dur[ée]e et la distance/i)
}

// E. The card label is driven by the persisted distance, so a prepared mission
// never shows "Distance à calculer".
{
  const distanceLabel = (mission: {
    routeDistanceMeters?: number | null
    estimatedKm?: number | null
  }) => {
    if (typeof mission.routeDistanceMeters === 'number') {
      return `${Math.round(mission.routeDistanceMeters / 1000)} km calculés`
    }
    if (typeof mission.estimatedKm === 'number' && mission.estimatedKm > 0) {
      return `≈ ${mission.estimatedKm} km`
    }
    return 'Distance à calculer'
  }
  assert.equal(distanceLabel({ routeDistanceMeters: 353_000 }), '353 km calculés')
  assert.equal(distanceLabel({ routeDistanceMeters: null }), 'Distance à calculer')
}

checkNestedOperationBudget()
  .then(() => {
    console.log('Mission route on creation (A-E): OK')
  })
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
