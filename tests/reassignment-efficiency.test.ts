import assert from 'node:assert/strict'

import type { OptimizationCandidate } from '../lib/dispatch/optimization'
import { detectReassignmentEfficiency } from '../lib/dispatch/suggestions/reassignment-efficiency'

function candidate(input: {
  id: string
  missionId?: string
  emptyKm: number
  cost: number | null
  margin: number | null
  score?: number
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW'
  compatibility?: 'COMPATIBLE' | 'INCOMPATIBLE'
  temporalStatus?: 'FEASIBLE' | 'IMPOSSIBLE'
  missingRoute?: boolean
  routeReliable?: boolean
}) {
  const missionId = input.missionId ?? 'mission-1'
  const confidence = input.confidence ?? 'HIGH'
  const missingRoute = input.missingRoute ?? false
  const compatibility = input.compatibility ?? 'COMPATIBLE'
  return {
    id: input.id,
    pair: {
      pair: {
        rowId: `row-${input.id}`,
        driverId: `driver-${input.id}`,
        truckId: `truck-${input.id}`,
        pairLocked: false,
        assignmentOrigin: 'MANUAL',
      },
      driverName: `Chauffeur ${input.id}`,
      truckPlateNumber: `CAM-${input.id}`,
    },
    mission: {
      id: missionId,
      reference: 'GRD-TEST-1',
      missingData: [],
    },
    trailer: null,
    transitions: [
      {
        key: `route-${input.id}`,
        distanceMeters: input.emptyKm * 1000,
        durationSeconds: input.emptyKm * 60,
        source: input.routeReliable === false ? 'UNKNOWN' : 'GOOGLE_ROUTES',
        confidence: input.routeReliable === false ? 'LOW' : 'HIGH',
      },
    ],
    compatibility: {
      status: compatibility,
      codes: missingRoute
        ? ['MISSING_ROUTE']
        : compatibility === 'COMPATIBLE'
          ? ['COMPATIBLE']
          : ['DRIVER_UNAVAILABLE'],
      messages: [],
      missingData: missingRoute ? ['route'] : [],
    },
    temporalEvaluation: {
      status: input.temporalStatus ?? 'FEASIBLE',
      possibleStartAt: '2026-09-21T08:00:00.000Z',
      completedAt: '2026-09-21T10:00:00.000Z',
      missingData: [],
    },
    cost: {
      emptyDistanceKm: input.emptyKm,
      estimatedCost: input.cost,
      estimatedMargin: input.margin,
      currency: 'EUR',
      assumptions: [],
    },
    score: input.score ?? 100,
    factors: [
      {
        code: 'ESTIMATED_MARGIN',
        value: input.margin ?? 0,
        weightedValue: input.margin ?? 0,
        explanation: 'Marge opérationnelle estimée',
      },
    ],
    confidence,
    requiresReturnToBase: false,
    trailerChange: false,
  } as unknown as OptimizationCandidate
}

const current = candidate({
  id: 'current',
  emptyKm: 80,
  cost: 250,
  margin: 450,
})

function detect(alternatives: OptimizationCandidate[]) {
  return detectReassignmentEfficiency({
    currentCandidate: current,
    alternatives,
    weekStart: '2026-09-21T00:00:00.000Z',
    snapshotFingerprint: 'fingerprint-0123456789',
  })
}

// A — suggestion utile.
const useful = detect([
  candidate({ id: 'useful', emptyKm: 20, cost: 200, margin: 500 }),
])
assert.ok(useful)
assert.equal(useful.impact.emptyKm.delta, -60)
assert.equal(useful.impact.estimatedMargin.delta, 50)
assert.deepEqual(useful.availableActions, ['VIEW_REASON', 'SIMULATE', 'APPLY'])
assert.equal(useful.applicability.canApply, true)
console.log('A suggestion utile: OK')

// B — gain trop faible.
assert.equal(
  detect([candidate({ id: 'small', emptyKm: 78.5, cost: 249, margin: 451 })]),
  null
)
console.log('B gain trop faible: OK')

// C — candidat incompatible.
assert.equal(
  detect([
    candidate({
      id: 'incompatible',
      emptyKm: 10,
      cost: 180,
      margin: 520,
      compatibility: 'INCOMPATIBLE',
    }),
  ]),
  null
)
console.log('C candidat incompatible: OK')

// D — temporalité impossible.
assert.equal(
  detect([
    candidate({
      id: 'impossible',
      emptyKm: 10,
      cost: 180,
      margin: 520,
      temporalStatus: 'IMPOSSIBLE',
    }),
  ]),
  null
)
console.log('D temporalité impossible: OK')

// E — route critique manquante.
assert.equal(
  detect([
    candidate({
      id: 'missing-route',
      emptyKm: 10,
      cost: 180,
      margin: 520,
      missingRoute: true,
    }),
  ]),
  null
)
console.log('E route critique manquante: OK')

// F — économie inconnue et gain kilométrique non fiable.
assert.equal(
  detect([
    candidate({
      id: 'unknown-economics',
      emptyKm: 10,
      cost: null,
      margin: null,
      routeReliable: false,
    }),
  ]),
  null
)
console.log('F économie et kilomètres non fiables: OK')

// G — confiance inférieure.
assert.equal(
  detect([
    candidate({
      id: 'lower-confidence',
      emptyKm: 10,
      cost: 180,
      margin: 520,
      confidence: 'MEDIUM',
    }),
  ]),
  null
)
console.log('G confiance inférieure: OK')

// H — la marge prime, puis coût, kilomètres, score.
const ranked = detect([
  candidate({ id: 'more-km', emptyKm: 5, cost: 190, margin: 490 }),
  candidate({ id: 'more-margin', emptyKm: 30, cost: 195, margin: 510 }),
])
assert.equal(ranked?.proposedState.candidateId, 'more-margin')
console.log('H classement déterministe: OK')

// I — égalité parfaite résolue par l’identifiant.
const tied = detect([
  candidate({ id: 'z-candidate', emptyKm: 20, cost: 200, margin: 500 }),
  candidate({ id: 'a-candidate', emptyKm: 20, cost: 200, margin: 500 }),
])
assert.equal(tied?.proposedState.candidateId, 'a-candidate')
console.log('I égalité stable: OK')

// J — aucune mutation des entrées.
const immutableCurrent = candidate({
  id: 'immutable-current',
  emptyKm: 80,
  cost: 250,
  margin: 450,
})
const immutableAlternatives = [
  candidate({ id: 'immutable-alt', emptyKm: 20, cost: 200, margin: 500 }),
]
const beforeCurrent = structuredClone(immutableCurrent)
const beforeAlternatives = structuredClone(immutableAlternatives)
detectReassignmentEfficiency({
  currentCandidate: immutableCurrent,
  alternatives: immutableAlternatives,
  weekStart: '2026-09-21T00:00:00.000Z',
  snapshotFingerprint: 'immutable-fingerprint',
})
assert.deepEqual(immutableCurrent, beforeCurrent)
assert.deepEqual(immutableAlternatives, beforeAlternatives)
console.log('J aucune mutation: OK')

// K — une application Custom peut relever les seuils via la policy documentée.
assert.equal(detectReassignmentEfficiency({
  currentCandidate: current,
  alternatives: [candidate({ id: 'custom-threshold', emptyKm: 20, cost: 200, margin: 500 })],
  weekStart: '2026-09-21T00:00:00.000Z',
  snapshotFingerprint: 'custom-policy-fingerprint',
  scoringPolicy: { minimumEmptyKmSaving: 100, minimumCostSaving: 100, minimumMarginGain: 100 },
}), null)
console.log('K policy de scoring Custom contrôlée: OK')
