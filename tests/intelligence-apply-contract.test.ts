import assert from 'node:assert/strict'

import type { OptimizationCandidate } from '../lib/dispatch/optimization'
import { detectReassignmentEfficiency } from '../lib/dispatch/suggestions/reassignment-efficiency'
import {
  SuggestionApplicationError,
  applyPlanningSuggestion,
} from '../lib/dispatch/suggestions/application'
import { runWithOrganization } from '../lib/auth/organization-context'

// Ce test verrouille le contrat d'application figé par Gerard Intelligence V1.
// Il ne touche aucune donnée métier : seules les gardes atteintes avant le
// premier accès base sont exercées.

function candidate(input: { id: string; emptyKm: number; cost: number; margin: number }) {
  return {
    id: input.id,
    pair: {
      pair: { rowId: `row-${input.id}`, driverId: `driver-${input.id}`, truckId: `truck-${input.id}`, pairLocked: false, assignmentOrigin: 'MANUAL' },
      driverName: `Chauffeur ${input.id}`,
      truckPlateNumber: `CAM-${input.id}`,
    },
    mission: { id: 'mission-1', reference: 'GRD-TEST-1', missingData: [] },
    trailer: null,
    transitions: [{ key: `route-${input.id}`, distanceMeters: input.emptyKm * 1000, durationSeconds: input.emptyKm * 60, source: 'GOOGLE_ROUTES', confidence: 'HIGH' }],
    compatibility: { status: 'COMPATIBLE', codes: ['COMPATIBLE'], messages: [], missingData: [] },
    temporalEvaluation: { status: 'FEASIBLE', possibleStartAt: '2026-09-21T08:00:00.000Z', completedAt: '2026-09-21T10:00:00.000Z', missingData: [] },
    cost: { emptyDistanceKm: input.emptyKm, estimatedCost: input.cost, estimatedMargin: input.margin, currency: 'EUR', assumptions: [] },
    score: 100,
    factors: [{ code: 'ESTIMATED_MARGIN', value: input.margin, weightedValue: input.margin, explanation: 'Marge opérationnelle estimée' }],
    confidence: 'HIGH',
    requiresReturnToBase: false,
    trailerChange: false,
  } as unknown as OptimizationCandidate
}

const current = candidate({ id: 'current', emptyKm: 80, cost: 250, margin: 450 })

function detect(snapshotFingerprint: string) {
  return detectReassignmentEfficiency({
    currentCandidate: current,
    alternatives: [candidate({ id: 'better', emptyKm: 20, cost: 200, margin: 500 })],
    weekStart: '2026-09-21T00:00:00.000Z',
    snapshotFingerprint,
  })
}

// A — l'identité d'une suggestion est liée au snapshot qui l'a produite.
const first = detect('fingerprint-aaaaaaaaaaaaaaaaaaaa')
const second = detect('fingerprint-bbbbbbbbbbbbbbbbbbbb')
assert.ok(first && second)
const suggestion = first
assert.ok(first.id.startsWith('reassignment:'))
assert.ok(first.id.includes('fingerprint-aaaa'.slice(0, 16)))
assert.equal(first.snapshotFingerprint, 'fingerprint-aaaaaaaaaaaaaaaaaaaa')
assert.notEqual(first.id, second.id)
console.log('A identité de suggestion liée au snapshot: OK')

// B — une suggestion applicable exige toujours une confirmation explicite.
assert.equal(first.applicability.requiresExplicitConfirmation, true)
assert.equal(first.applicability.canApply, true)
assert.ok(first.availableActions.includes('APPLY'))
console.log('B confirmation explicite requise par le contrat: OK')

async function main() {
  const { id: suggestionId, snapshotFingerprint } = suggestion
  // C — la frontière tenant est refusée avant toute autre vérification.
  await assert.rejects(
    applyPlanningSuggestion({ userId: 'user-1', suggestionId, weekStart: '2026-09-21', snapshotFingerprint, idempotencyKey: 'key-1' }),
    /ORGANIZATION_CONTEXT_REQUIRED/
  )
  console.log('C application refusée hors contexte organisation: OK')

  // D — dans un contexte valide, une demande incomplète ou non reconnue est
  // rejetée en INVALID avant le moindre accès base.
  const context = {
    organizationId: 'organization-contract',
    organizationRole: 'ORG_ADMIN' as const,
    platformRole: null,
    userId: 'user-1',
  }
  const valid = { userId: 'user-1', suggestionId, weekStart: '2026-09-21', snapshotFingerprint, idempotencyKey: 'key-1' }

  for (const [label, override] of [
    ['semaine', { weekStart: 'pas-une-semaine' }],
    ['suggestionId', { suggestionId: '' }],
    ['snapshotFingerprint', { snapshotFingerprint: '' }],
    ['idempotencyKey', { idempotencyKey: '' }],
    ['préfixe inconnu', { suggestionId: 'autoplanning:mission-1' }],
  ] as const) {
    await runWithOrganization(context, async () => {
      await assert.rejects(
        applyPlanningSuggestion({ ...valid, ...override }),
        (error: unknown) => {
          assert.ok(error instanceof SuggestionApplicationError, `${label} doit produire une SuggestionApplicationError`)
          assert.equal(error.status, 'INVALID')
          return true
        },
        `demande invalide non rejetée : ${label}`
      )
    })
  }
  console.log('D demande d application invalide rejetée sans accès base: OK')

  // E — les statuts d'erreur exposés restent ceux que la route HTTP sait traduire.
  assert.deepEqual(
    (['INVALID', 'STALE', 'CONFLICT'] as const).map((status) => new SuggestionApplicationError(status, 'message').status),
    ['INVALID', 'STALE', 'CONFLICT']
  )
  console.log('E statuts d application exposés stables: OK')
}

void main()
