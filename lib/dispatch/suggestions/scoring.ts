import type { OptimizationCandidate } from '../optimization'

/**
 * Modèle de classement V1 des réaffectations.
 *
 * Deux étages strictement séparés :
 *
 * - les CONTRAINTES DURES décident si un candidat a le droit d'exister. Elles
 *   sont appliquées en amont (`hasUsableAlternative`), jamais compensées ici.
 * - les CRITÈRES SOUPLES, ci-dessous, classent des candidats déjà valides.
 *
 * Chaque composante est normalisée dans [-1, 1] (ou [0, 1] pour la continuité et
 * l'incertitude) avant d'être pondérée : aucune grandeur brute, euro ou
 * kilomètre, ne peut écraser les autres.
 */

export const reassignmentScoringWeights = Object.freeze({
  /** Le gain opérationnel mesuré reste le signal dominant. */
  emptyDistance: 1,
  /** L'économie est une estimation : elle pèse structurellement moins. */
  margin: 0.5,
  /** Départager deux options équivalentes en faveur de la moins perturbante. */
  continuity: 0.2,
  /** Pénalité appliquée à ce qui repose sur des données moins sûres. */
  uncertainty: 0.25,
})

export const reassignmentScoringReferences = Object.freeze({
  /**
   * Dénominateur plancher du ratio de kilomètres à vide. Sous ce seuil,
   * l'approche est déjà courte et un gain relatif n'a plus de sens.
   */
  minimumEmptyKmBasis: 25,
  /** Montant de référence qui sature la composante économique. */
  marginReferenceAmount: 150,
  /**
   * Amortissement de la composante économique selon la nature des données.
   * Aujourd'hui Gerard ne dispose que de paramètres de coût par défaut : une
   * marge estimée ne vaut jamais une marge mesurée.
   */
  economicDamping: Object.freeze({ MEASURED: 1, ESTIMATED: 0.6, UNAVAILABLE: 0 }),
  /** Gain composite minimal pour qu'une réaffectation mérite d'être proposée. */
  minimumScoreImprovement: 0.15,
})

export type EconomicBasis = 'MEASURED' | 'ESTIMATED' | 'UNAVAILABLE'

export type ReassignmentScoreComponent = {
  code: 'EMPTY_DISTANCE' | 'MARGIN' | 'CONTINUITY' | 'UNCERTAINTY'
  label: string
  /** Valeur normalisée, avant pondération. */
  value: number
  weight: number
  /** Contribution signée au score total. */
  contribution: number
  /** Formulation factuelle, dérivée des mêmes chiffres que la contribution. */
  detail: string
}

export type ReassignmentScore = {
  total: number
  components: ReassignmentScoreComponent[]
  economicBasis: EconomicBasis
  /** Composante qui porte la plus grande contribution positive. */
  primaryReason: ReassignmentScoreComponent['code'] | null
}

export type ReassignmentScoreInput = {
  currentCandidate: OptimizationCandidate
  candidate: OptimizationCandidate
  emptyKmSaving: number
  marginGain: number | null
  economicBasis: EconomicBasis
  weights?: typeof reassignmentScoringWeights
  references?: typeof reassignmentScoringReferences
}

function clamp(value: number, minimum = -1, maximum = 1) {
  if (!Number.isFinite(value)) return 0
  return Math.min(maximum, Math.max(minimum, value))
}

function round(value: number) {
  // Le score est comparé et affiché : on le fige à une précision stable plutôt
  // que de laisser traîner des écarts de virgule flottante entre deux calculs.
  return Math.round(value * 1e6) / 1e6
}

/**
 * Part des ressources conservées entre l'affectation actuelle et la proposition.
 * Uniquement des identités observables : chauffeur, camion, remorque. Aucune
 * préférence inventée.
 */
export function continuityRatio(currentCandidate: OptimizationCandidate, candidate: OptimizationCandidate) {
  const preserved = [
    currentCandidate.pair.pair.driverId === candidate.pair.pair.driverId,
    currentCandidate.pair.pair.truckId === candidate.pair.pair.truckId,
    (currentCandidate.trailer?.id ?? null) === (candidate.trailer?.id ?? null),
  ].filter(Boolean).length
  const ratio = preserved / 3
  // Un changement de remorque planifié est une manipulation réelle sur le terrain.
  return clamp(candidate.trailerChange ? ratio - 1 / 3 : ratio, 0, 1)
}

/**
 * Incertitude résiduelle d'un candidat déjà valide : sources de route moins
 * sûres, confiance d'optimisation dégradée, économie estimée ou absente.
 */
export function uncertaintyRatio(input: {
  currentCandidate: OptimizationCandidate
  candidate: OptimizationCandidate
  economicBasis: EconomicBasis
}) {
  const routes = [...input.currentCandidate.transitions, ...input.candidate.transitions]
  const softRoutes = routes.filter((route) => route.source !== 'GOOGLE_ROUTES' || route.confidence !== 'HIGH')
  const routePenalty = routes.length ? softRoutes.length / routes.length : 1
  const confidencePenalty = [input.currentCandidate.confidence, input.candidate.confidence]
    .filter((value) => value !== 'HIGH').length / 2
  const economicPenalty = input.economicBasis === 'MEASURED' ? 0 : input.economicBasis === 'ESTIMATED' ? 0.5 : 1
  return clamp((routePenalty + confidencePenalty + economicPenalty) / 3, 0, 1)
}

export function scoreReassignment(input: ReassignmentScoreInput): ReassignmentScore {
  const weights = input.weights ?? reassignmentScoringWeights
  const references = input.references ?? reassignmentScoringReferences

  const emptyKmBasis = Math.max(
    input.currentCandidate.cost.emptyDistanceKm,
    references.minimumEmptyKmBasis
  )
  const emptyDistanceValue = clamp(input.emptyKmSaving / emptyKmBasis)

  const damping = references.economicDamping[input.economicBasis]
  const marginValue = input.marginGain === null
    ? 0
    : clamp(input.marginGain / references.marginReferenceAmount) * damping

  const continuityValue = continuityRatio(input.currentCandidate, input.candidate)
  const uncertaintyValue = uncertaintyRatio({
    currentCandidate: input.currentCandidate,
    candidate: input.candidate,
    economicBasis: input.economicBasis,
  })

  const components: ReassignmentScoreComponent[] = [
    {
      code: 'EMPTY_DISTANCE',
      label: 'Kilomètres à vide',
      value: round(emptyDistanceValue),
      weight: weights.emptyDistance,
      contribution: round(emptyDistanceValue * weights.emptyDistance),
      detail: input.emptyKmSaving >= 0
        ? `${input.emptyKmSaving.toFixed(1)} km à vide en moins sur une approche de ${input.currentCandidate.cost.emptyDistanceKm.toFixed(1)} km.`
        : `${Math.abs(input.emptyKmSaving).toFixed(1)} km à vide en plus.`,
    },
    {
      code: 'MARGIN',
      label: 'Marge opérationnelle',
      value: round(marginValue),
      weight: weights.margin,
      contribution: round(marginValue * weights.margin),
      detail: input.marginGain === null
        ? 'Comparaison économique indisponible : cette composante est neutre.'
        : `${input.marginGain >= 0 ? '+' : ''}${input.marginGain.toFixed(2)} ${input.candidate.cost.currency} de marge ${input.economicBasis === 'ESTIMATED' ? 'estimée à partir des paramètres de coût par défaut' : 'mesurée'}.`,
    },
    {
      code: 'CONTINUITY',
      label: 'Continuité opérationnelle',
      value: round(continuityValue),
      weight: weights.continuity,
      contribution: round(continuityValue * weights.continuity),
      detail: continuityValue >= 1
        ? 'Aucune ressource ne change.'
        : continuityValue > 0
          ? 'Une partie de l’attelage actuel est conservée.'
          : 'Chauffeur, camion et remorque changent.',
    },
    {
      code: 'UNCERTAINTY',
      label: 'Incertitude des données',
      value: round(uncertaintyValue),
      weight: weights.uncertainty,
      contribution: round(-uncertaintyValue * weights.uncertainty),
      detail: uncertaintyValue === 0
        ? 'Routes et économie reposent sur des données complètes.'
        : 'Une partie des entrées est estimée : le score en tient compte.',
    },
  ]

  const total = round(components.reduce((sum, component) => sum + component.contribution, 0))
  const best = components
    .filter((component) => component.code !== 'UNCERTAINTY' && component.contribution > 0)
    .sort((left, right) => right.contribution - left.contribution)[0]

  return { total, components, economicBasis: input.economicBasis, primaryReason: best?.code ?? null }
}

/**
 * Ordre déterministe et total. Le score décide ; les départages suivants
 * existent pour que deux exécutions identiques rendent toujours le même
 * classement, jamais pour rattraper une différence de score.
 */
export function compareScoredCandidates(
  left: { score: ReassignmentScore; emptyKmSaving: number; marginGain: number | null; candidate: OptimizationCandidate },
  right: { score: ReassignmentScore; emptyKmSaving: number; marginGain: number | null; candidate: OptimizationCandidate }
) {
  if (left.score.total !== right.score.total) return right.score.total - left.score.total
  if (left.emptyKmSaving !== right.emptyKmSaving) return right.emptyKmSaving - left.emptyKmSaving
  const leftMargin = left.marginGain ?? Number.NEGATIVE_INFINITY
  const rightMargin = right.marginGain ?? Number.NEGATIVE_INFINITY
  if (leftMargin !== rightMargin) return rightMargin - leftMargin
  if (left.candidate.score !== right.candidate.score) return right.candidate.score - left.candidate.score
  return left.candidate.id.localeCompare(right.candidate.id)
}
