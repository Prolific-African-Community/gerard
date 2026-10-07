import type { GerardSuggestion } from '../suggestions/types'

const confidenceLabels = { HIGH: 'haute', MEDIUM: 'moyenne' } as const

/**
 * L'explication dérive du score réellement calculé : elle nomme la composante
 * qui a emporté la décision, puis les autres contributions. Aucun récit n'est
 * reconstruit à partir des seuls chiffres d'impact.
 */
export function describeSuggestion(suggestion: GerardSuggestion) {
  const breakdown = suggestion.scoreBreakdown
  const opening = `${suggestion.proposedState.driverName} remplacerait ${suggestion.currentState.driverName} sur ${suggestion.currentState.missionReference}.`
  if (!breakdown) {
    return `${opening} Gain estimé : ${Math.max(0, -suggestion.impact.emptyKm.delta).toFixed(1)} km à vide et ${Math.max(0, suggestion.impact.estimatedMargin.delta ?? 0).toFixed(2)} € de marge. Confiance ${confidenceLabels[suggestion.confidence]}.`
  }
  const byCode = new Map(breakdown.components.map((component) => [component.code, component]))
  const primary = breakdown.primaryReason ? byCode.get(breakdown.primaryReason) : null
  const secondary = breakdown.components
    .filter((component) => component.code !== breakdown.primaryReason && component.code !== 'UNCERTAINTY' && component.contribution > 0)
    .sort((left, right) => right.contribution - left.contribution)[0]
  // Le détail de la composante économique dit déjà d'où viennent les chiffres :
  // on ne répète la mise en garde que si elle n'a pas déjà été formulée.
  const marginShown = primary?.code === 'MARGIN' || secondary?.code === 'MARGIN'
  const economics = breakdown.economicBasis === 'UNAVAILABLE'
    ? 'La comparaison économique n’est pas disponible.'
    : marginShown
      ? null
      : 'Les données économiques sont estimées à partir des paramètres de coût par défaut.'
  return [
    opening,
    primary ? `Principalement parce qu’elle agit sur : ${primary.label.toLocaleLowerCase('fr-FR')}. ${primary.detail}` : 'Aucune composante ne ressort nettement.',
    secondary ? secondary.detail : null,
    economics,
    `Confiance des données : ${confidenceLabels[suggestion.confidence]}.`,
  ].filter(Boolean).join(' ')
}
