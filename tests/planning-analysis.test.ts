import assert from 'node:assert/strict'

import {
  analyticalMission,
  hasAlternativeOccupationConflict,
  positionProvidersForAnalysis,
} from '../lib/dispatch/suggestions/planning-analysis'

const source = {
  id: 'mission-1',
  forcedPairRowId: 'row-current',
  requiredTrailerId: 'trailer-current',
}
const analytical = analyticalMission(source)

assert.equal(analytical.forcedPairRowId, null)
assert.equal(analytical.requiredTrailerId, null)
assert.equal(source.forcedPairRowId, 'row-current')
assert.equal(source.requiredTrailerId, 'trailer-current')
console.info('A/B forced pair scope et auto-planning intact: OK')

assert.deepEqual(positionProvidersForAnalysis(), [
  'DRIVER_PHONE',
  'DEMO_SIMULATED',
])
console.info('E provenances de position lues par l analyse: OK')

assert.deepEqual(analyticalMission(source), analyticalMission(source))
console.info('H transformation analytique deterministe: OK')

const baseNeighbor = {
  missionId: 'occupied',
  pairRowId: 'row-alternative',
  trailerId: null,
  startsAt: '2026-09-16T08:00:00.000Z',
  endsAt: '2026-09-16T16:00:00.000Z',
  pickup: { id: 'A', label: 'A', latitude: 49, longitude: 6 },
  delivery: { id: 'B', label: 'B', latitude: 50, longitude: 7 },
}
for (const [label, startsAt, endsAt] of [
  ['chevauche le début', '2026-09-16T07:00:00.000Z', '2026-09-16T09:00:00.000Z'],
  ['englobe', '2026-09-16T07:00:00.000Z', '2026-09-16T17:00:00.000Z'],
  ['commence pendant', '2026-09-16T09:00:00.000Z', '2026-09-16T12:00:00.000Z'],
] as const) {
  assert.equal(hasAlternativeOccupationConflict({ missionId: 'proposed', pairRowId: 'row-alternative', driverId: 'driver-alt', truckId: 'truck-alt', trailerId: null, startsAt, endsAt, neighbors: [baseNeighbor] }), true, label)
}
assert.equal(hasAlternativeOccupationConflict({ missionId: 'proposed', pairRowId: 'row-other', driverId: 'driver-other', truckId: 'truck-other', trailerId: 'trailer-shared', startsAt: '2026-09-16T09:00:00.000Z', endsAt: '2026-09-16T12:00:00.000Z', neighbors: [{ ...baseNeighbor, trailerId: 'trailer-shared' }] }), true)
console.info('A conflits chauffeur camion remorque sur insertion alternative: OK')
