// Scénarios de classement du modèle multicritère V1.
//
// Tout est déterministe et hors ligne : les candidats sont construits à la main,
// aucun appel réseau, aucune base. Ce test décrit le comportement attendu du
// classement, pas l'implémentation.

import assert from 'node:assert/strict'

import type { OptimizationCandidate } from '../lib/dispatch/optimization'
import { detectReassignmentEfficiency } from '../lib/dispatch/suggestions/reassignment-efficiency'
import {
  compareScoredCandidates,
  continuityRatio,
  reassignmentScoringReferences,
  reassignmentScoringWeights,
  scoreReassignment,
} from '../lib/dispatch/suggestions/scoring'

type CandidateInput = {
  id: string
  emptyKm: number
  cost: number | null
  margin: number | null
  driverId?: string
  truckId?: string
  trailerId?: string | null
  trailerChange?: boolean
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW'
  compatibility?: 'COMPATIBLE' | 'INCOMPATIBLE'
  temporalStatus?: 'FEASIBLE' | 'IMPOSSIBLE'
  routeSource?: string
  routeConfidence?: 'HIGH' | 'MEDIUM' | 'LOW'
  score?: number
}

function candidate(input: CandidateInput) {
  const compatibility = input.compatibility ?? 'COMPATIBLE'
  return {
    id: input.id,
    pair: {
      pair: {
        rowId: `row-${input.id}`,
        driverId: input.driverId ?? `driver-${input.id}`,
        truckId: input.truckId ?? `truck-${input.id}`,
        pairLocked: false,
        assignmentOrigin: 'MANUAL',
      },
      driverName: `Chauffeur ${input.id}`,
      truckPlateNumber: `CAM-${input.id}`,
    },
    mission: { id: 'mission-1', reference: 'GRD-SCORE-1', missingData: [] },
    trailer: input.trailerId === undefined ? null : input.trailerId === null ? null : { id: input.trailerId, plateNumber: `REM-${input.trailerId}` },
    transitions: [{
      key: `route-${input.id}`,
      distanceMeters: input.emptyKm * 1000,
      durationSeconds: input.emptyKm * 60,
      source: input.routeSource ?? 'GOOGLE_ROUTES',
      confidence: input.routeConfidence ?? 'HIGH',
      reason: 'INITIAL_APPROACH',
    }],
    compatibility: {
      status: compatibility,
      codes: compatibility === 'COMPATIBLE' ? ['COMPATIBLE'] : ['DRIVER_UNAVAILABLE'],
      messages: [],
      missingData: [],
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
    factors: [{ code: 'ESTIMATED_MARGIN', value: input.margin ?? 0, weightedValue: input.margin ?? 0, explanation: 'Marge' }],
    confidence: input.confidence ?? 'HIGH',
    requiresReturnToBase: false,
    trailerChange: input.trailerChange ?? false,
  } as unknown as OptimizationCandidate
}

const current = candidate({ id: 'current', emptyKm: 120, cost: 300, margin: 500, driverId: 'driver-a', truckId: 'truck-a' })

function detect(alternatives: OptimizationCandidate[]) {
  return detectReassignmentEfficiency({
    currentCandidate: current,
    alternatives,
    weekStart: '2026-09-21T00:00:00.000Z',
    snapshotFingerprint: 'fingerprint-scoring-0123456789',
  })
}

// Scénario A — un gain de distance nettement supérieur classe en tête.
const scenarioA = detect([
  candidate({ id: 'saves-much', emptyKm: 20, cost: 240, margin: 560 }),
  candidate({ id: 'saves-little', emptyKm: 95, cost: 285, margin: 515 }),
])
assert.equal(scenarioA?.proposedState.candidateId, 'saves-much')
assert.equal(scenarioA?.scoreBreakdown.primaryReason, 'EMPTY_DISTANCE')
assert.equal(scenarioA?.rankedAlternatives[0].candidateId, 'saves-much')
assert.ok(
  scenarioA!.rankedAlternatives[0].score > scenarioA!.rankedAlternatives[1].score,
  'le classement interne doit être strictement ordonné'
)
console.log('A un gain de distance supérieur classe en tête: OK')

// Scénario B — un peu plus de distance gagnée, mais une marge nettement dégradée :
// le score reflète l'arbitrage au lieu de suivre un seul critère.
const scenarioB = detect([
  candidate({ id: 'km-plus-margin-minus', emptyKm: 38, cost: 400, margin: 380 }),
  candidate({ id: 'km-moins-margin-plus', emptyKm: 42, cost: 250, margin: 620 }),
])
assert.equal(scenarioB?.proposedState.candidateId, 'km-moins-margin-plus')
const arbitrage = scenarioB!.rankedAlternatives
assert.ok(arbitrage[0].emptyKmSaving < arbitrage[1].emptyKmSaving, 'le gagnant gagne moins de kilomètres')
assert.ok((arbitrage[0].marginGain ?? 0) > (arbitrage[1].marginGain ?? 0), 'mais il préserve la marge')
console.log('B un gain de distance payé par la marge ne l’emporte pas mécaniquement: OK')

// Scénario C — une marge estimée flatteuse ne renverse pas un avantage
// opérationnel net : la composante économique est amortie.
const flattering = scoreReassignment({
  currentCandidate: current,
  candidate: candidate({ id: 'flatteur', emptyKm: 110, cost: 100, margin: 900 }),
  emptyKmSaving: 10,
  marginGain: 400,
  economicBasis: 'ESTIMATED',
})
const operational = scoreReassignment({
  currentCandidate: current,
  candidate: candidate({ id: 'solide', emptyKm: 15, cost: 260, margin: 540 }),
  emptyKmSaving: 105,
  marginGain: 40,
  economicBasis: 'ESTIMATED',
})
assert.ok(operational.total > flattering.total, 'l’avantage opérationnel mesuré doit rester devant')
const marginComponent = flattering.components.find((item) => item.code === 'MARGIN')!
assert.ok(
  Math.abs(marginComponent.contribution) <= reassignmentScoringWeights.margin * reassignmentScoringReferences.economicDamping.ESTIMATED,
  'la contribution économique est bornée par son amortissement'
)
assert.equal(flattering.economicBasis, 'ESTIMATED')
assert.match(marginComponent.detail, /paramètres de coût par défaut/)
console.log('C une marge estimée flatteuse ne domine pas: OK')

// Scénario D — un candidat invalide est écarté avant tout score, même avec une
// économie apparente excellente.
for (const invalid of [
  candidate({ id: 'incompatible', emptyKm: 1, cost: 10, margin: 990, compatibility: 'INCOMPATIBLE' }),
  candidate({ id: 'infaisable', emptyKm: 1, cost: 10, margin: 990, temporalStatus: 'IMPOSSIBLE' }),
  candidate({ id: 'peu-fiable', emptyKm: 1, cost: 10, margin: 990, confidence: 'LOW' }),
  candidate({ id: 'route-douteuse', emptyKm: 1, cost: 10, margin: 990, routeSource: 'ESTIMATED' }),
]) {
  assert.equal(detect([invalid]), null, `candidat invalide retenu à tort : ${invalid.id}`)
}
console.log('D un candidat invalide est écarté avant tout score: OK')

// Scénario E — une amélioration minuscule ne produit aucune suggestion.
assert.equal(detect([candidate({ id: 'minuscule', emptyKm: 118.7, cost: 299, margin: 501 })]), null)
// Même un gain de temps valorisé au tarif par défaut ne suffit pas seul.
assert.equal(detect([candidate({ id: 'temps-seulement', emptyKm: 115, cost: 275, margin: 525 })]), null)
console.log('E une amélioration non matérielle ne produit rien: OK')

// Scénario F — deux candidats strictement équivalents : départage déterministe
// et stable, indépendant de l'ordre d'entrée.
const tieInput = [
  candidate({ id: 'z-equal', emptyKm: 40, cost: 250, margin: 560 }),
  candidate({ id: 'a-equal', emptyKm: 40, cost: 250, margin: 560 }),
]
assert.equal(detect(tieInput)?.proposedState.candidateId, 'a-equal')
assert.equal(detect([...tieInput].reverse())?.proposedState.candidateId, 'a-equal')
console.log('F égalité départagée de façon stable: OK')

// Scénario G — l'affectation courante est déjà la meilleure.
assert.equal(detect([candidate({ id: 'pire', emptyKm: 200, cost: 420, margin: 380 })]), null)
assert.equal(detect([]), null)
console.log('G aucune suggestion quand l’affectation actuelle est la meilleure: OK')

// Scénario H — économie indisponible : la composante est neutre, l'incertitude
// monte, et rien n'est présenté avec une précision qu'on n'a pas.
const withoutEconomics = scoreReassignment({
  currentCandidate: current,
  candidate: candidate({ id: 'sans-economie', emptyKm: 20, cost: null, margin: null }),
  emptyKmSaving: 100,
  marginGain: null,
  economicBasis: 'UNAVAILABLE',
})
const marginWithout = withoutEconomics.components.find((item) => item.code === 'MARGIN')!
assert.equal(marginWithout.value, 0)
assert.equal(marginWithout.contribution, 0)
assert.match(marginWithout.detail, /indisponible/)
const uncertaintyWithout = withoutEconomics.components.find((item) => item.code === 'UNCERTAINTY')!
const uncertaintyWith = scoreReassignment({
  currentCandidate: current,
  candidate: candidate({ id: 'avec-economie', emptyKm: 20, cost: 240, margin: 560 }),
  emptyKmSaving: 100,
  marginGain: 60,
  economicBasis: 'ESTIMATED',
}).components.find((item) => item.code === 'UNCERTAINTY')!
assert.ok(uncertaintyWithout.value > uncertaintyWith.value, 'l’absence d’économie doit augmenter l’incertitude')
const noEconomicsSuggestion = detect([candidate({ id: 'aucune-economie', emptyKm: 20, cost: null, margin: null })])
assert.ok(noEconomicsSuggestion)
assert.equal(noEconomicsSuggestion.impact.estimatedMargin.delta, null)
assert.equal(noEconomicsSuggestion.scoreBreakdown.economicBasis, 'UNAVAILABLE')
assert.equal(noEconomicsSuggestion.confidence, 'MEDIUM', 'sans économie, la confiance ne peut pas être haute')
console.log('H économie indisponible : composante neutre et incertitude assumée: OK')

// I — la continuité n'exprime que des identités observables.
const sameDriver = candidate({ id: 'meme-chauffeur', emptyKm: 40, cost: 250, margin: 560, driverId: 'driver-a', truckId: 'truck-b' })
const everythingChanges = candidate({ id: 'tout-change', emptyKm: 40, cost: 250, margin: 560, driverId: 'driver-z', truckId: 'truck-z' })
assert.ok(continuityRatio(current, sameDriver) > continuityRatio(current, everythingChanges))
assert.equal(detect([everythingChanges, sameDriver])?.proposedState.candidateId, 'meme-chauffeur')
// Un changement de remorque planifié est une manipulation réelle : il coûte.
const withTrailerChange = candidate({ id: 'change-remorque', emptyKm: 40, cost: 250, margin: 560, driverId: 'driver-a', truckId: 'truck-b', trailerChange: true })
assert.ok(continuityRatio(current, withTrailerChange) < continuityRatio(current, sameDriver))
console.log('I la continuité départage sans inventer de préférence: OK')

// J — le comparateur est un ordre total et déterministe.
const left = { score: scoreReassignment({ currentCandidate: current, candidate: sameDriver, emptyKmSaving: 80, marginGain: 60, economicBasis: 'ESTIMATED' }), emptyKmSaving: 80, marginGain: 60, candidate: sameDriver }
const right = { score: scoreReassignment({ currentCandidate: current, candidate: everythingChanges, emptyKmSaving: 80, marginGain: 60, economicBasis: 'ESTIMATED' }), emptyKmSaving: 80, marginGain: 60, candidate: everythingChanges }
assert.ok(compareScoredCandidates(left, right) < 0)
assert.ok(compareScoredCandidates(right, left) > 0)
assert.equal(compareScoredCandidates(left, left), 0)
console.log('J comparateur total et déterministe: OK')

// K — toute composante reste bornée : aucune grandeur brute ne peut écraser le score.
for (const extreme of [
  { emptyKmSaving: 10_000, marginGain: 1_000_000 },
  { emptyKmSaving: -10_000, marginGain: -1_000_000 },
]) {
  const bounded = scoreReassignment({
    currentCandidate: current,
    candidate: candidate({ id: 'extreme', emptyKm: 1, cost: 1, margin: 1 }),
    emptyKmSaving: extreme.emptyKmSaving,
    marginGain: extreme.marginGain,
    economicBasis: 'ESTIMATED',
  })
  for (const component of bounded.components) {
    assert.ok(Math.abs(component.value) <= 1, `composante ${component.code} non bornée : ${component.value}`)
    assert.ok(Math.abs(component.contribution) <= component.weight, `contribution ${component.code} non bornée`)
  }
  assert.ok(Number.isFinite(bounded.total))
}
console.log('K composantes bornées et score fini: OK')
