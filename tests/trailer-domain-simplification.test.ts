import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  configuredOperatingBase,
  DEFAULT_OPERATING_BASE,
} from '../lib/dispatch/base-location'
import { decideTrailerRemoval } from '../lib/dispatch/trailer-lifecycle'
import {
  isTrailerAvailableForNewMission,
  resolveTrailerSituation,
} from '../lib/dispatch/trailer-rotation'
import { resolveTrailerPosition } from '../lib/dispatch/trailer-position'
import { normalizeMissionTrailerRequirements } from '../lib/dispatch/mission-trailer-requirements'
import {
  evaluateMissionCompatibility,
  requiredTransitions,
  routeKey,
  trailerChoices,
} from '../lib/dispatch/optimization'
import type {
  DispatchOptimizationInput,
  OptimizationMission,
  OptimizationPair,
  OptimizationTrailer,
  RouteTransition,
} from '../lib/dispatch/optimization'
import {
  createUnknownDriverRegulatoryState,
  euRoadFreightProfileV1,
} from '../lib/dispatch/regulatory'

const base = DEFAULT_OPERATING_BASE
const basePosition = {
  id: 'BASE',
  label: base.label,
  latitude: base.latitude,
  longitude: base.longitude,
}

// Business calculations only receive an explicitly configured base. The
// Sedan value remains an explicit demo fixture, never an implicit tenant base.
const previousLatitude = process.env.DISPATCH_BASE_LATITUDE
const previousLongitude = process.env.DISPATCH_BASE_LONGITUDE
delete process.env.DISPATCH_BASE_LATITUDE
delete process.env.DISPATCH_BASE_LONGITUDE
assert.equal(configuredOperatingBase(), null)
process.env.DISPATCH_BASE_LATITUDE = ''
process.env.DISPATCH_BASE_LONGITUDE = ''
assert.equal(configuredOperatingBase(), null)
process.env.DISPATCH_BASE_LATITUDE = '49.61'
process.env.DISPATCH_BASE_LONGITUDE = '6.13'
assert.deepEqual(configuredOperatingBase(), {
  latitude: 49.61,
  longitude: 6.13,
  label: 'Base d’exploitation',
})
if (previousLatitude === undefined) delete process.env.DISPATCH_BASE_LATITUDE
else process.env.DISPATCH_BASE_LATITUDE = previousLatitude
if (previousLongitude === undefined) delete process.env.DISPATCH_BASE_LONGITUDE
else process.env.DISPATCH_BASE_LONGITUDE = previousLongitude

// A/F — idle empty detached trailers need no ParkSpot to be usable at base.
const idle = resolveTrailerPosition({
  operatingBase: base,
  loadStatus: 'EMPTY',
  hasActiveMission: false,
})
assert.equal(idle.source, 'IDLE_BASE_FALLBACK')
assert.equal(idle.usable, true)
const idleSituation = resolveTrailerSituation({
  loadStatus: 'EMPTY',
  truckId: null,
  activeMission: null,
})
assert.equal(idleSituation.location, 'BASE')
assert.equal(isTrailerAvailableForNewMission(idleSituation), true)

// B — attachment is the strongest location evidence.
const truckPosition = {
  id: 'TRUCK:1',
  label: 'Camion 1',
  latitude: 49.7,
  longitude: 4.9,
}
const attached = resolveTrailerPosition({
  attached: true,
  attachedTruckPosition: truckPosition,
  explicitPosition: {
    id: 'MANUAL',
    label: 'Ancienne position',
    latitude: 50,
    longitude: 5,
  },
  operatingBase: base,
  loadStatus: 'EMPTY',
})
assert.equal(attached.source, 'ATTACHED_TRUCK')
assert.equal(attached.location?.id, truckPosition.id)

// G/H — explicit evidence precedes completed-mission evidence, both precede fallback.
const explicit = resolveTrailerPosition({
  explicitPosition: {
    id: 'MANUAL:1',
    label: 'Client',
    latitude: 50.1,
    longitude: 5.1,
  },
  lastMissionDelivery: {
    id: 'MISSION:1',
    label: 'Livraison',
    latitude: 50.2,
    longitude: 5.2,
  },
  operatingBase: base,
  loadStatus: 'EMPTY',
})
assert.equal(explicit.source, 'MANUAL')
const delivered = resolveTrailerPosition({
  lastMissionDelivery: {
    id: 'MISSION:1',
    label: 'Livraison',
    latitude: 50.2,
    longitude: 5.2,
  },
  operatingBase: base,
  loadStatus: 'EMPTY',
})
assert.equal(delivered.source, 'MISSION_DELIVERY')

// C/D — loaded or engaged trailers never silently fall back to base.
assert.equal(
  resolveTrailerPosition({
    operatingBase: base,
    loadStatus: 'LOADED',
    hasActiveMission: false,
  }).usable,
  false
)
assert.equal(
  resolveTrailerPosition({
    operatingBase: base,
    loadStatus: 'EMPTY',
    hasActiveMission: true,
  }).usable,
  false
)

const pair: OptimizationPair = {
  pair: {
    rowId: 'row',
    driverId: 'driver',
    truckId: 'truck',
    pairLocked: false,
    assignmentOrigin: 'MANUAL',
  },
  driverName: 'Driver',
  driverStatus: 'AVAILABLE',
  truckPlateNumber: 'TRUCK',
  truckStatus: 'AVAILABLE',
  usualTruckId: 'truck',
  exceptionalReplacement: false,
  availableAt: '2030-01-01T08:00:00.000Z',
  initialPosition: basePosition,
  regulatoryState: createUnknownDriverRegulatoryState({
    driverId: 'driver',
    timeZone: 'Europe/Luxembourg',
    observedAt: '2030-01-01T08:00:00.000Z',
  }),
  couplingType: null,
  restrictions: [],
}
const mission: OptimizationMission = {
  id: 'mission',
  reference: 'MISSION',
  status: 'PENDING',
  priority: 0,
  reportable: true,
  temporalPlan: {
    missionId: 'mission',
    timeZone: 'Europe/Luxembourg',
    earliestStartAt: '2030-01-01T08:00:00.000Z',
    startPosition: basePosition,
    endPosition: basePosition,
    steps: [],
    missingData: [],
  },
  pickup: { id: 'PICKUP', latitude: 50, longitude: 5 },
  delivery: { id: 'DELIVERY', latitude: 51, longitude: 6 },
  loadedDistanceMeters: 1000,
  revenueAmount: 100,
  currency: 'EUR',
  dependencies: [],
  missingData: [],
  confidence: 'HIGH',
}
function trailer(
  overrides: Partial<OptimizationTrailer> = {}
): OptimizationTrailer {
  return {
    id: 'trailer',
    plateNumber: 'TRAILER',
    status: 'AVAILABLE',
    type: 'BOX',
    position: basePosition,
    availableAt: pair.availableAt,
    attachedTruckId: null,
    restrictions: [],
    ...overrides,
  }
}
const loadedCompatibility = evaluateMissionCompatibility({
  pair,
  mission,
  trailer: trailer({ loadStatus: 'LOADED' }),
})
assert.equal(loadedCompatibility.codes.includes('TRAILER_UNAVAILABLE'), true)
const engagedOther = evaluateMissionCompatibility({
  pair,
  mission,
  trailer: trailer({ loadStatus: 'EMPTY', forcedMissionId: 'other' }),
})
assert.equal(engagedOther.codes.includes('TRAILER_UNAVAILABLE'), true)
const engagedSame = evaluateMissionCompatibility({
  pair,
  mission,
  trailer: trailer({ loadStatus: 'LOADED', forcedMissionId: mission.id }),
})
assert.equal(engagedSame.codes.includes('TRAILER_UNAVAILABLE'), false)

// M — candidate generation retains a valid detached trailer and removes stale blockers.
const trailerMission = { ...mission, requiredTrailerType: 'BOX' }
assert.deepEqual(
  trailerChoices(trailerMission, [
    trailer({ id: 'detached-empty', loadStatus: 'EMPTY' }),
    trailer({ id: 'loaded', loadStatus: 'LOADED' }),
    trailer({ id: 'engaged', loadStatus: 'EMPTY', forcedMissionId: 'other' }),
  ]).map((item) => item?.id),
  ['detached-empty']
)

// Run 2 — an explicit mission trailer is a hard mission-level constraint.
const manuallyConstrainedMission = {
  ...trailerMission,
  requiredTrailerId: 'manual-trailer',
}
assert.deepEqual(
  trailerChoices(manuallyConstrainedMission, [
    trailer({ id: 'automatic-best' }),
    trailer({ id: 'manual-trailer' }),
  ]).map((item) => item?.id),
  ['manual-trailer']
)
const wrongManualTrailer = evaluateMissionCompatibility({
  pair,
  mission: manuallyConstrainedMission,
  trailer: trailer({ id: 'automatic-best' }),
})
assert.equal(
  wrongManualTrailer.codes.includes('REQUIRED_TRAILER_MISSING'),
  true
)
assert.deepEqual(
  normalizeMissionTrailerRequirements({ requiredTrailerId: ' manual-trailer ' }),
  { ok: true, value: { requiredTrailerId: 'manual-trailer' } }
)
assert.deepEqual(
  normalizeMissionTrailerRequirements({ requiredTrailerId: '' }),
  { ok: true, value: { requiredTrailerId: null } }
)

// E — maintenance remains a hard blocker.
const maintenance = evaluateMissionCompatibility({
  pair,
  mission,
  trailer: trailer({ status: 'IN_MAINTENANCE' }),
})
assert.equal(maintenance.codes.includes('TRAILER_UNAVAILABLE'), true)

// I/J/K/L — only active dependencies block; history never turns Delete into archive.
const emptyFacts = {
  attachedTruckPlate: null,
  activeMissionReferences: [],
  activeMaintenanceCount: 0,
  activePlanningCount: 0,
  historicalAssignmentCount: 0,
  custodyEventCount: 0,
  maintenanceCount: 0,
  inspectionCount: 0,
  movementCount: 0,
  missionEventCount: 0,
  historicalPlanningCount: 0,
}
assert.equal(decideTrailerRemoval(emptyFacts).action, 'DELETE')
assert.equal(
  decideTrailerRemoval({ ...emptyFacts, activeMissionReferences: ['GRD-1'] })
    .action,
  'BLOCK'
)
assert.match(
  decideTrailerRemoval({ ...emptyFacts, activeMaintenanceCount: 1 }).reason!,
  /maintenance active/
)
assert.equal(
  decideTrailerRemoval({ ...emptyFacts, historicalAssignmentCount: 12 }).action,
  'DELETE'
)
assert.equal(
  decideTrailerRemoval({ ...emptyFacts, custodyEventCount: 2 }).action,
  'DELETE'
)

// N/O — detached needs truck→trailer→pickup; already attached skips pickup leg.
const toTrailer: RouteTransition = {
  key: routeKey('BASE', 'TRAILER_POS'),
  from: basePosition,
  to: { id: 'TRAILER_POS', latitude: 49.8, longitude: 4.9 },
  distanceMeters: 10_000,
  durationSeconds: 600,
  source: 'DISPATCH',
  confidence: 'HIGH',
  reason: 'TRAILER_PICKUP',
  empty: true,
}
const toPickup: RouteTransition = {
  key: routeKey('TRAILER_POS', 'PICKUP'),
  from: toTrailer.to,
  to: mission.pickup!,
  distanceMeters: 20_000,
  durationSeconds: 1200,
  source: 'DISPATCH',
  confidence: 'HIGH',
  reason: 'BASE_TO_PICKUP',
  empty: true,
}
const direct: RouteTransition = {
  key: routeKey('BASE', 'PICKUP'),
  from: basePosition,
  to: mission.pickup!,
  distanceMeters: 25_000,
  durationSeconds: 1500,
  source: 'DISPATCH',
  confidence: 'HIGH',
  reason: 'INITIAL_APPROACH',
  empty: true,
}
const optimization = {
  transitions: [toTrailer, toPickup, direct],
  profile: euRoadFreightProfileV1,
} as DispatchOptimizationInput
const detachedRoutes = requiredTransitions({
  optimization,
  pair,
  mission,
  trailer: trailer({ position: toTrailer.to }),
  currentPositionId: 'BASE',
})
assert.equal(detachedRoutes.trailerChange, true)
assert.equal(detachedRoutes.routes.length, 2)
const attachedRoutes = requiredTransitions({
  optimization,
  pair,
  mission,
  trailer: trailer({ attachedTruckId: 'truck' }),
  currentPositionId: 'BASE',
})
assert.equal(attachedRoutes.trailerChange, false)
assert.deepEqual(
  attachedRoutes.routes.map((item) => item.key),
  [direct.key]
)

// Editing an automatically assigned mission must keep its request automatic.
// The applied trailer is operational output, not a persisted manual constraint.
const missionDetailSource = readFileSync(
  new URL('../components/dispatch/MissionDetailPanel.tsx', import.meta.url),
  'utf8'
)
assert.match(
  missionDetailSource,
  /plannedTrailerId:\s*getJsonString\(requirements, "requiredTrailerId"\) \?\? ""/
)
assert.doesNotMatch(
  missionDetailSource,
  /getEditFormState\(mission,\s*plannedTrailerId\)/
)

console.log('A-P trailer domain simplification rules: OK')
