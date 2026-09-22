/**
 * Couverture géographique du géocoding Gerard.
 *
 * Ce module ne fait aucun appel réseau : il prépare la requête envoyée à
 * Google (normalisation, détection de pays, stratégie de repli) et arbitre
 * entre les résultats renvoyés. Il est donc entièrement testable hors ligne.
 */
import type { AddressCandidate } from './google'

export type SupportedCountryCode =
  | 'LU'
  | 'FR'
  | 'DE'
  | 'BE'
  | 'NL'
  | 'ES'
  | 'PT'
  | 'IT'
  | 'CH'
  | 'AT'
  | 'PL'
  | 'CZ'

type CountryDefinition = {
  code: SupportedCountryCode
  /** Nom canonique utilisé pour compléter une requête. */
  label: string
  /** Variantes FR / EN / locales reconnues dans une adresse libre. */
  aliases: string[]
  /** Forme du code postal, utilisée pour l'extraction et le scoring. */
  postalCode: RegExp
}

/**
 * Douze pays couverts. L'ordre n'a pas d'importance fonctionnelle : la
 * détection privilégie la correspondance la plus longue.
 */
export const supportedCountries: CountryDefinition[] = [
  {
    code: 'LU',
    label: 'Luxembourg',
    aliases: ['luxembourg', 'luxemburg', 'letzebuerg', 'grand duche de luxembourg'],
    postalCode: /\bL?-?\s?(\d{4})\b/i,
  },
  {
    code: 'FR',
    label: 'France',
    aliases: ['france', 'french republic', 'republique francaise'],
    postalCode: /\b(\d{5})\b/,
  },
  {
    code: 'DE',
    label: 'Germany',
    aliases: ['germany', 'allemagne', 'deutschland', 'brd'],
    postalCode: /\bD?-?\s?(\d{5})\b/i,
  },
  {
    code: 'BE',
    label: 'Belgium',
    aliases: ['belgium', 'belgique', 'belgie', 'belgien'],
    postalCode: /\b(\d{4})\b/,
  },
  {
    code: 'NL',
    label: 'Netherlands',
    aliases: ['netherlands', 'pays bas', 'nederland', 'holland', 'holland nl'],
    postalCode: /\b(\d{4}\s?[A-Z]{2})\b/i,
  },
  {
    code: 'ES',
    label: 'Spain',
    aliases: ['spain', 'espagne', 'espana', 'espanya', 'reino de espana'],
    postalCode: /\b(\d{5})\b/,
  },
  {
    code: 'PT',
    label: 'Portugal',
    aliases: ['portugal', 'portuguesa'],
    postalCode: /\b(\d{4}-\d{3})\b/,
  },
  {
    code: 'IT',
    label: 'Italy',
    aliases: ['italy', 'italie', 'italia'],
    postalCode: /\b(\d{5})\b/,
  },
  {
    code: 'CH',
    label: 'Switzerland',
    aliases: ['switzerland', 'suisse', 'schweiz', 'svizzera', 'helvetia'],
    postalCode: /\bCH?-?\s?(\d{4})\b/i,
  },
  {
    code: 'AT',
    label: 'Austria',
    aliases: ['austria', 'autriche', 'osterreich', 'oesterreich'],
    postalCode: /\bA?-?\s?(\d{4})\b/i,
  },
  {
    code: 'PL',
    label: 'Poland',
    aliases: ['poland', 'pologne', 'polska'],
    postalCode: /\b(\d{2}-\d{3})\b/,
  },
  {
    code: 'CZ',
    label: 'Czechia',
    aliases: [
      'czechia',
      'czech republic',
      'republique tcheque',
      'tchequie',
      'ceska republika',
      'cesko',
    ],
    postalCode: /\b(\d{3}\s?\d{2})\b/,
  },
]

/** Codes région transmis à Google Places (minuscules, format attendu). */
export const supportedRegionCodes: string[] = supportedCountries.map((country) =>
  country.code.toLowerCase(),
)

const countryByCode = new Map<SupportedCountryCode, CountryDefinition>(
  supportedCountries.map((country) => [country.code, country]),
)

export function getCountryDefinition(code: SupportedCountryCode) {
  return countryByCode.get(code) ?? null
}

/** Minuscules sans accents ni ponctuation, pour comparer des libellés. */
export function foldText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Détecte le pays mentionné dans un texte libre.
 *
 * On retient la correspondance la plus longue afin que « Republique tcheque »
 * ne soit pas capté par un alias plus court, et on exige une frontière de mot
 * pour éviter qu'« Italie » soit trouvé dans un nom de rue.
 */
export function detectCountry(text: string | null | undefined): SupportedCountryCode | null {
  if (!text) return null
  const folded = ` ${foldText(text)} `
  let best: {
    code: SupportedCountryCode
    position: number
    length: number
  } | null = null

  for (const country of supportedCountries) {
    for (const alias of country.aliases) {
      const needle = ` ${foldText(alias)} `
      const position = folded.lastIndexOf(needle)
      if (position === -1) continue

      // Une adresse se termine par son pays : la mention la plus tardive
      // l'emporte, ce qui évite qu'un odonyme (« rue d'Italie, Paris,
      // France ») soit pris pour le pays. À position égale, l'alias le plus
      // long gagne (« Republique tcheque » plutôt que « tchequie »).
      const isBetter =
        !best ||
        position > best.position ||
        (position === best.position && alias.length > best.length)

      if (isBetter) {
        best = { code: country.code, position, length: alias.length }
      }
    }
  }

  return best?.code ?? null
}

/**
 * Extrait un code postal. Sans pays connu, on n'accepte que les formats non
 * ambigus (PT, PL, NL) : un nombre à 4 ou 5 chiffres seul pourrait être un
 * numéro de rue.
 */
export function extractPostalCode(
  text: string | null | undefined,
  country?: SupportedCountryCode | null,
): string | null {
  if (!text) return null

  if (country) {
    const definition = countryByCode.get(country)
    const match = definition ? definition.postalCode.exec(text) : null
    return match ? match[1].toUpperCase().replace(/\s+/g, ' ').trim() : null
  }

  for (const code of ['PT', 'PL', 'NL'] as const) {
    const definition = countryByCode.get(code)
    const match = definition ? definition.postalCode.exec(text) : null
    if (match) return match[1].toUpperCase().replace(/\s+/g, ' ').trim()
  }

  return null
}

export type AddressParts = {
  /** Rue et numéro, ou adresse complète telle que reçue. */
  address?: string | null
  city?: string | null
  postalCode?: string | null
  /** Nom de société ou de site, utile pour les zones industrielles. */
  siteName?: string | null
  country?: SupportedCountryCode | null
}

/** Assemble des fragments en une requête propre, sans doublon ni virgule vide. */
export function joinAddressParts(parts: Array<string | null | undefined>) {
  const seen = new Set<string>()
  const kept: string[] = []

  for (const part of parts) {
    const trimmed = part?.trim()
    if (!trimmed) continue
    const key = foldText(trimmed)
    if (!key || seen.has(key)) continue
    seen.add(key)
    kept.push(trimmed.replace(/\s+/g, ' '))
  }

  return kept.join(', ')
}

/**
 * Complète les champs manquants en analysant le texte disponible : le pays et
 * le code postal sont très souvent noyés dans l'adresse libre issue des mails.
 */
export function normalizeAddressParts(parts: AddressParts): AddressParts {
  const haystack = [parts.address, parts.city, parts.siteName]
    .filter(Boolean)
    .join(' ')

  const country = parts.country ?? detectCountry(haystack)
  const postalCode =
    parts.postalCode?.trim() || extractPostalCode(haystack, country) || null

  return {
    address: parts.address?.trim() || null,
    city: parts.city?.trim() || null,
    postalCode,
    siteName: parts.siteName?.trim() || null,
    country: country ?? null,
  }
}

/**
 * Retire les mentions de pays d'un texte destiné au scoring textuel.
 *
 * Google répond en anglais (« Italy ») alors que la requête peut être en
 * langue locale (« Italia ») : le token de pays ne peut alors matcher que par
 * accident, typiquement dans un odonyme (« Corso Italia », « Pl. España »),
 * ce qui faisait gagner une rue au lieu de la ville. Le pays reste pris en
 * compte par la restriction de région et par le bonus de pertinence.
 */
export function stripCountryMentions(text: string) {
  let folded = ` ${foldText(text)} `

  for (const country of supportedCountries) {
    for (const alias of country.aliases) {
      const needle = ` ${foldText(alias)} `
      while (folded.includes(needle)) {
        folded = folded.replace(needle, ' ')
      }
    }
  }

  return folded.trim().replace(/\s+/g, ' ')
}

export type GeocodingAttempt = {
  /** Rang de la tentative, 1 étant l'adresse brute. */
  tier: 1 | 2 | 3 | 4
  label: 'raw' | 'address+country' | 'postal+city+country' | 'city+country'
  query: string
}

/**
 * Stratégie de repli, de la plus précise à la plus permissive.
 *
 * La tentative 1 reprend exactement la requête historique : le comportement
 * déjà validé pour le Luxembourg, la France et l'Allemagne est préservé, les
 * repliements ne servent que lorsqu'elle échoue.
 */
export function buildGeocodingAttempts(input: AddressParts): GeocodingAttempt[] {
  const parts = normalizeAddressParts(input)
  const countryLabel = parts.country
    ? (countryByCode.get(parts.country)?.label ?? null)
    : null

  const attempts: GeocodingAttempt[] = []
  const push = (
    tier: GeocodingAttempt['tier'],
    label: GeocodingAttempt['label'],
    query: string,
  ) => {
    const trimmed = query.trim()
    if (trimmed.length < 3) return
    if (attempts.some((attempt) => foldText(attempt.query) === foldText(trimmed))) {
      return
    }
    attempts.push({ tier, label, query: trimmed })
  }

  push(1, 'raw', joinAddressParts([parts.siteName, parts.address, parts.city]))
  push(
    2,
    'address+country',
    joinAddressParts([parts.address, parts.city, countryLabel]),
  )
  push(
    3,
    'postal+city+country',
    joinAddressParts([parts.postalCode, parts.city, countryLabel]),
  )
  push(4, 'city+country', joinAddressParts([parts.city, countryLabel]))

  return attempts
}

/* ------------------------------------------------------------------ */
/* Arbitrage entre plusieurs résultats Google                          */
/* ------------------------------------------------------------------ */

function addressSegments(candidate: AddressCandidate) {
  return candidate.formattedAddress
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean)
}

/**
 * Un résultat qui ne contient qu'un ou deux fragments (« Espagne »,
 * « Lombardie, Italie ») est trop générique pour servir de point de chargement.
 */
export function isGenericResult(candidate: AddressCandidate) {
  return addressSegments(candidate).length <= 2
}

/**
 * Résultat réduit au pays ou à une région (« Italie ») : jamais exploitable,
 * quelle que soit la précision demandée.
 */
export function isCountryLevelResult(candidate: AddressCandidate) {
  return addressSegments(candidate).length <= 1
}

/**
 * Résultat de niveau ville (« Milano MI, Italy ») : réponse attendue quand la
 * mission ne fournit qu'une ville, imprécise quand une rue est demandée.
 */
export function isCityLevelResult(candidate: AddressCandidate) {
  return addressSegments(candidate).length === 2
}

export function candidateMatchesCountry(
  candidate: AddressCandidate,
  country: SupportedCountryCode | null,
) {
  if (!country) return false
  return detectCountry(candidate.formattedAddress) === country
}

export function candidateMatchesPostalCode(
  candidate: AddressCandidate,
  postalCode: string | null,
) {
  if (!postalCode) return false
  return foldText(candidate.formattedAddress).includes(foldText(postalCode))
}

export function candidateMatchesCity(
  candidate: AddressCandidate,
  city: string | null,
) {
  if (!city?.trim()) return false
  const folded = foldText(candidate.formattedAddress)
  const cityFolded = foldText(city)
  if (!cityFolded) return false
  return folded.includes(cityFolded)
}

/**
 * Correspondance exacte sur un segment d'adresse, code postal éventuel retiré.
 *
 * « Milano » doit l'emporter sur « Milano Marittima », et « Sedan » sur
 * « Sedan-3 » : une inclusion de sous-chaîne ne suffit pas à départager.
 */
export function candidateMatchesCityExactly(
  candidate: AddressCandidate,
  city: string | null,
) {
  if (!city?.trim()) return false
  const cityFolded = foldText(city)
  if (!cityFolded) return false

  return candidate.formattedAddress
    .split(',')
    .map((segment) => foldText(segment.replace(/\d{4}[- ]?\d{0,3}/g, '')))
    .some((segment) => segment === cityFolded)
}

/**
 * Similarité graduée entre la ville demandée et les segments du résultat.
 *
 * Google localise ses réponses : « Milano » revient en « Milan ». Une simple
 * inclusion de sous-chaîne fait alors gagner « Milano Marittima » sur la vraie
 * ville. On préfère donc le segment dont la longueur est la plus proche de la
 * ville demandée, ce qui privilégie une variante de nom sur une commune
 * homonyme plus longue.
 *
 * Retourne 0 (aucun rapport) à 1 (identique).
 */
export function cityMatchScore(
  candidate: AddressCandidate,
  city: string | null | undefined,
) {
  const cityFolded = foldText(city ?? '')
  if (!cityFolded) return 0

  let best = 0
  for (const rawSegment of candidate.formattedAddress.split(',')) {
    // Le code postal éventuel est retiré : « 48015 Milano Marittima ».
    const segment = foldText(rawSegment.replace(/\d{4}[- ]?\d{0,3}/g, ''))
    if (!segment) continue

    if (segment === cityFolded) return 1

    const isPrefixRelated =
      segment.startsWith(cityFolded) || cityFolded.startsWith(segment)
    if (isPrefixRelated) {
      const longest = Math.max(segment.length, cityFolded.length)
      const difference = Math.abs(segment.length - cityFolded.length)
      best = Math.max(best, 1 - difference / longest)
      continue
    }

    if (segment.includes(cityFolded)) best = Math.max(best, 0.4)
  }

  return best
}

export type CandidateRanking = {
  candidate: AddressCandidate
  score: number
  reasons: string[]
}

/**
 * Score de pertinence géographique, appliqué en complément du score textuel
 * existant. Priorités : même pays, puis code postal, puis ville ; les
 * résultats trop génériques sont pénalisés.
 */
export function scoreCandidateRelevance(
  candidate: AddressCandidate,
  parts: AddressParts,
): CandidateRanking {
  const reasons: string[] = []
  let score = 0

  if (candidateMatchesCountry(candidate, parts.country ?? null)) {
    score += 0.5
    reasons.push('pays')
  } else if (parts.country) {
    // Mauvais pays : pénalité forte, c'est la cause d'erreur la plus grave.
    score -= 0.6
    reasons.push('pays différent')
  }

  if (candidateMatchesPostalCode(candidate, parts.postalCode ?? null)) {
    score += 0.3
    reasons.push('code postal')
  }

  const cityScore = cityMatchScore(candidate, parts.city ?? null)
  if (cityScore > 0) {
    score += 0.35 * cityScore
    reasons.push(cityScore === 1 ? 'ville exacte' : 'ville approchante')
  }

  // Un résultat réduit au pays n'est jamais exploitable.
  if (isCountryLevelResult(candidate)) {
    score -= 0.5
    reasons.push('niveau pays')
  } else if (isCityLevelResult(candidate)) {
    // Une réponse ville est attendue quand la mission ne fournit qu'une ville ;
    // la pénaliser faisait gagner une rue homonyme (« Corso Italia » pour
    // « Milano, Italia »).
    if (parts.address) {
      score -= 0.25
      reasons.push('moins précis que demandé')
    } else {
      score += 0.2
      reasons.push('niveau ville')
    }
  }

  return { candidate, score, reasons }
}

/** Classe les résultats du plus pertinent au moins pertinent. */
export function rankCandidates(
  candidates: AddressCandidate[],
  parts: AddressParts,
): CandidateRanking[] {
  return candidates
    .map((candidate) => scoreCandidateRelevance(candidate, parts))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.candidate.placeId.localeCompare(right.candidate.placeId),
    )
}

/**
 * Écarte les résultats situés dans un autre pays que celui explicitement
 * détecté. Si le filtre ne laisse rien, on rend la liste d'origine plutôt que
 * de renvoyer un échec : mieux vaut un résultat à valider que pas de résultat.
 */
export function filterCandidatesByCountry(
  candidates: AddressCandidate[],
  country: SupportedCountryCode | null,
) {
  if (!country) return candidates
  const sameCountry = candidates.filter((candidate) =>
    candidateMatchesCountry(candidate, country),
  )
  return sameCountry.length > 0 ? sameCountry : candidates
}

/* ------------------------------------------------------------------ */
/* Journalisation                                                      */
/* ------------------------------------------------------------------ */

export type GeocodingTrace = {
  attempt: GeocodingAttempt
  country: SupportedCountryCode | null
  resultCount: number
  chosen?: string | null
  failureReason?: string | null
}

function isDevEnvironment() {
  return process.env.NODE_ENV !== 'production'
}

/** Logs lisibles, actifs hors production uniquement. */
export function logGeocodingTrace(trace: GeocodingTrace) {
  if (!isDevEnvironment()) return
  console.info(
    '[geocoding]',
    [
      `tentative=${trace.attempt.tier}/${trace.attempt.label}`,
      `pays=${trace.country ?? 'inconnu'}`,
      `requête="${trace.attempt.query}"`,
      `résultats=${trace.resultCount}`,
      trace.chosen ? `retenu="${trace.chosen}"` : null,
      trace.failureReason ? `échec=${trace.failureReason}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
  )
}
