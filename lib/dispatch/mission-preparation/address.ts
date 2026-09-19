import type { AddressCandidate } from '../maps/google'

export const automaticAddressConfidenceThreshold = 0.84
export const ambiguousAddressScoreGap = 0.15
export const minimumReviewableAddressConfidence = 0.5

export type AddressResolution =
  | {
      status: 'AUTO_CONFIRMED'
      method: 'GOOGLE_PLACES'
      confidence: number
      reason: string
      candidate: AddressCandidate
      alternatives: AddressCandidate[]
    }
  | {
      status: 'REVIEW_REQUIRED'
      method: 'GOOGLE_PLACES'
      confidence: number
      reason: string
      candidate: AddressCandidate | null
      alternatives: AddressCandidate[]
    }
  | {
      status: 'FAILED'
      method: 'GOOGLE_PLACES'
      confidence: number
      reason: string
      candidate: null
      alternatives: AddressCandidate[]
    }

export function normalizeAddressText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function addressTokens(value: string) {
  return new Set(
    normalizeAddressText(value)
      .split(' ')
      .filter((token) => token.length >= 2)
  )
}

export function scoreAddressCandidate(
  source: string,
  candidate: AddressCandidate
) {
  const sourceTokens = addressTokens(source)
  const candidateTokens = addressTokens(candidate.formattedAddress)
  if (!sourceTokens.size || !candidateTokens.size) return 0
  let common = 0
  for (const token of Array.from(sourceTokens)) {
    if (candidateTokens.has(token)) common += 1
  }
  const coverage = common / sourceTokens.size
  const precision = common / candidateTokens.size
  return Math.max(0, Math.min(1, coverage * 0.7 + precision * 0.3))
}

export function chooseAddressCandidate(
  source: string,
  candidates: AddressCandidate[],
  /**
   * Bonus de pertinence géographique (pays, code postal, ville, niveau de
   * précision). Il départage les candidats dont le score textuel est proche
   * ou identique. Sans ce paramètre le comportement est inchangé.
   */
  relevanceBonus: (candidate: AddressCandidate) => number = () => 0
): AddressResolution {
  const ranked = candidates
    .map((candidate) => {
      const textScore = scoreAddressCandidate(source, candidate)
      // Le classement utilise le score combiné non borné, sans quoi plusieurs
      // candidats plafonnés à 1 deviendraient indépartageables ; la confiance
      // publiée reste, elle, bornée à [0,1].
      return {
        candidate,
        rankScore: textScore + relevanceBonus(candidate),
        score: Math.max(0, Math.min(1, textScore + relevanceBonus(candidate))),
      }
    })
    .sort(
      (left, right) =>
        right.rankScore - left.rankScore ||
        left.candidate.placeId.localeCompare(right.candidate.placeId)
    )
  const first = ranked[0]
  if (!first) {
    return {
      status: 'FAILED',
      method: 'GOOGLE_PLACES',
      confidence: 0,
      reason: 'Aucune correspondance cartographique trouvée.',
      candidate: null,
      alternatives: [],
    }
  }
  const second = ranked[1]
  const gap = first.rankScore - (second?.rankScore ?? 0)
  const alternatives = ranked.map((item) => item.candidate)
  if (
    first.score >= automaticAddressConfidenceThreshold &&
    (!second || gap >= ambiguousAddressScoreGap)
  ) {
    return {
      status: 'AUTO_CONFIRMED',
      method: 'GOOGLE_PLACES',
      confidence: first.score,
      reason: 'Correspondance unique avec une confiance forte.',
      candidate: first.candidate,
      alternatives,
    }
  }
  if (first.score >= minimumReviewableAddressConfidence) {
    return {
      status: 'REVIEW_REQUIRED',
      method: 'GOOGLE_PLACES',
      confidence: first.score,
      reason:
        second && gap < ambiguousAddressScoreGap
          ? 'Plusieurs adresses plausibles nécessitent une validation.'
          : 'La correspondance proposée doit être confirmée.',
      candidate: first.candidate,
      alternatives,
    }
  }
  return {
    status: 'FAILED',
    method: 'GOOGLE_PLACES',
    confidence: first.score,
    reason: 'Aucune correspondance suffisamment fiable.',
    candidate: null,
    alternatives,
  }
}
