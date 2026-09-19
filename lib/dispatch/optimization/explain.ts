import type {
  OptimizationCandidate,
  OptimizationExplanation,
} from './types'

export function explainOptimizationDecision(
  candidate: OptimizationCandidate,
  alternatives: OptimizationCandidate[] = []
): OptimizationExplanation {
  const positives = candidate.factors
    .filter((factor) => factor.weightedValue > 0)
    .map((factor) => `${factor.explanation} (+${factor.weightedValue.toFixed(1)})`)
  const penalties = candidate.factors
    .filter((factor) => factor.weightedValue < 0)
    .map((factor) => `${factor.explanation} (${factor.weightedValue.toFixed(1)})`)
  const missingData = Array.from(
    new Set([
      ...candidate.compatibility.missingData,
      ...(candidate.temporalEvaluation?.missingData ?? []),
    ])
  )
  const emptyKm =
    candidate.transitions.reduce(
      (sum, transition) => sum + transition.distanceMeters,
      0
    ) / 1000
  const economicSummary =
    candidate.cost.estimatedCost === null
      ? 'coût total et marge inconnus'
      : `coût estimé ${candidate.cost.estimatedCost.toFixed(2)} ${
          candidate.cost.currency
        }, marge estimée ${candidate.cost.estimatedMargin?.toFixed(2) ?? 'inconnue'} ${
          candidate.cost.currency
        }`
  return {
    positives,
    penalties,
    satisfiedConstraints: candidate.compatibility.codes.includes('COMPATIBLE')
      ? ['Compatibilité métier confirmée', 'Chronologie réglementaire validée']
      : ['Proposition conditionnelle explicitement séparée'],
    eliminatedAlternatives: Array.from(
      new Set(
        alternatives.flatMap((alternative) =>
          alternative.compatibility.status === 'INCOMPATIBLE'
            ? alternative.compatibility.codes
            : []
        )
      )
    ),
    assumptions: candidate.cost.assumptions,
    missingData,
    alternatives: alternatives
      .filter((alternative) => alternative.id !== candidate.id)
      .slice(0, 3)
      .map((alternative) => ({
        pairRowId: alternative.pair.pair.rowId,
        score: alternative.score,
        reason: alternative.compatibility.messages[0] ?? 'Score inférieur',
      })),
    summary:
      candidate.compatibility.status === 'INDETERMINATE'
        ? `Proposition à confirmer pour ${candidate.mission.reference} : ${missingData.join(', ')}.`
        : `Mission ${candidate.mission.reference} proposée au couple ${candidate.pair.driverName} / ${candidate.pair.truckPlateNumber}, avec ${emptyKm.toFixed(1)} km à vide, ${candidate.cost.approachDurationHours.toFixed(2)} h d’approche, ${economicSummary}.`,
  }
}
