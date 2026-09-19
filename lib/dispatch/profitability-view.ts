/**
 * Couche de présentation de l'onglet Rentabilité.
 *
 * Ce module ne calcule **aucune** valeur financière : il reçoit les montants
 * déjà produits par `computeWeeklyProfitability()` et se contente de les
 * sélectionner, filtrer, chercher et trier. Aucune addition, aucun ratio,
 * aucun arrondi n'est refait ici — c'est la garantie de non-régression.
 */

import {
  matchesSearchTerm,
  normalizeSearchTerm,
} from './smart-search'
import type {
  ProfitabilityGroup,
  ProfitabilityMission,
} from './profitability'

/* ------------------------------------------------------------------ */
/* Vues                                                                */
/* ------------------------------------------------------------------ */

export type ProfitabilityView =
  | 'overview'
  | 'missions'
  | 'drivers'
  | 'trucks'
  | 'trailers'
  | 'clients'

export const profitabilityViews: ProfitabilityView[] = [
  'overview',
  'missions',
  'drivers',
  'trucks',
  'trailers',
  'clients',
]

export const profitabilityViewLabels: Record<ProfitabilityView, string> = {
  overview: 'Vue globale',
  missions: 'Missions',
  drivers: 'Chauffeurs',
  trucks: 'Camions',
  trailers: 'Remorques',
  clients: 'Clients',
}

/** Libellé court du sélecteur mobile, où la largeur est comptée. */
export const profitabilityViewShortLabels: Record<ProfitabilityView, string> = {
  overview: 'Global',
  missions: 'Missions',
  drivers: 'Chauffeurs',
  trucks: 'Camions',
  trailers: 'Remorques',
  clients: 'Clients',
}

export const defaultProfitabilityView: ProfitabilityView = 'overview'

/** Lecture tolérante du paramètre d'URL `group`. */
export function parseProfitabilityView(
  value: string | string[] | undefined | null,
): ProfitabilityView {
  if (typeof value !== 'string') return defaultProfitabilityView
  const normalized = value.trim().toLowerCase()
  return (
    profitabilityViews.find((view) => view === normalized) ??
    defaultProfitabilityView
  )
}

/* ------------------------------------------------------------------ */
/* Recherche                                                           */
/* ------------------------------------------------------------------ */

/**
 * Mêmes règles de normalisation que le Smart Locator (casse, accents,
 * espaces, tirets) : une seule implémentation pour tout le Dispatch.
 */
export { matchesSearchTerm, normalizeSearchTerm }

export function getProfitabilityMissionSearchFields(
  mission: ProfitabilityMission,
) {
  return [
    mission.reference,
    mission.clientReference,
    mission.cmrNumber,
    mission.deliveryNoteNumber,
    mission.clientName,
    mission.pickupCity,
    mission.deliveryCity,
    mission.driverName,
    mission.truckPlateNumber,
    mission.trailerPlateNumber,
  ]
}

export function searchProfitabilityMissions(
  missions: ProfitabilityMission[],
  term: string,
) {
  if (!normalizeSearchTerm(term)) return missions
  return missions.filter((mission) =>
    matchesSearchTerm(term, getProfitabilityMissionSearchFields(mission)),
  )
}

export function searchProfitabilityGroups<T extends ProfitabilityGroup>(
  groups: T[],
  term: string,
  extraFields?: (group: T) => Array<string | null | undefined>,
) {
  if (!normalizeSearchTerm(term)) return groups
  return groups.filter((group) =>
    matchesSearchTerm(term, [group.label, ...(extraFields?.(group) ?? [])]),
  )
}

/* ------------------------------------------------------------------ */
/* Filtre de rentabilité                                               */
/* ------------------------------------------------------------------ */

export type MarginFilter = 'ALL' | 'PROFITABLE' | 'LOW_MARGIN' | 'LOSS'

export const marginFilterOrder: MarginFilter[] = [
  'ALL',
  'PROFITABLE',
  'LOW_MARGIN',
  'LOSS',
]

export const marginFilterLabels: Record<MarginFilter, string> = {
  ALL: 'Toutes',
  PROFITABLE: 'Rentables',
  LOW_MARGIN: 'Faible marge',
  LOSS: 'Déficitaires',
}

/**
 * Le domaine ne définit aucun seuil de « faible marge » : en inventer un
 * serait créer une règle métier. La référence utilisée est donc le taux de
 * marge global de la période elle-même — une ligne rentable mais en dessous
 * de la moyenne de sa propre semaine. « Rentable » et « déficitaire » ne
 * reposent, eux, que sur le signe de la marge déjà calculée.
 */
export function matchesMarginFilter(
  item: { margin: number; marginRate: number | null },
  filter: MarginFilter,
  referenceRate: number | null,
): boolean {
  switch (filter) {
    case 'ALL':
      return true
    case 'LOSS':
      return item.margin < 0
    case 'PROFITABLE':
      return item.margin >= 0
    case 'LOW_MARGIN':
      if (item.margin < 0) return false
      if (referenceRate === null || item.marginRate === null) return false
      return item.marginRate < referenceRate
  }
}

/** Projection commune mission / agrégat, sans recalcul. */
export function toMarginSubject(
  item: ProfitabilityMission | ProfitabilityGroup,
): { margin: number; marginRate: number | null } {
  return 'operationalMargin' in item
    ? { margin: item.operationalMargin, marginRate: item.marginRate }
    : { margin: item.operationalMarginTotal, marginRate: item.marginRate }
}

export function filterByMargin<
  T extends ProfitabilityMission | ProfitabilityGroup,
>(items: T[], filter: MarginFilter, referenceRate: number | null): T[] {
  if (filter === 'ALL') return items
  return items.filter((item) =>
    matchesMarginFilter(toMarginSubject(item), filter, referenceRate),
  )
}

/* ------------------------------------------------------------------ */
/* Tri                                                                 */
/* ------------------------------------------------------------------ */

export type MissionSortKey =
  | 'date'
  | 'reference'
  | 'revenue'
  | 'margin'
  | 'marginRate'

export type GroupSortKey =
  | 'label'
  | 'missionCount'
  | 'revenue'
  | 'margin'
  | 'marginRate'

export const missionSortOrder: MissionSortKey[] = [
  'date',
  'reference',
  'revenue',
  'margin',
  'marginRate',
]

export const groupSortOrder: GroupSortKey[] = [
  'label',
  'missionCount',
  'revenue',
  'margin',
  'marginRate',
]

export const missionSortLabels: Record<MissionSortKey, string> = {
  date: 'Date',
  reference: 'Référence',
  revenue: 'CA',
  margin: 'Marge',
  marginRate: 'Taux',
}

export const groupSortLabels: Record<GroupSortKey, string> = {
  label: 'Nom',
  missionCount: 'Missions',
  revenue: 'CA',
  margin: 'Marge',
  marginRate: 'Taux',
}

/** Tri par défaut de chaque vue : l'ordre le plus lisible, et stable. */
export const defaultMissionSort: MissionSortKey = 'date'
export const defaultGroupSort: GroupSortKey = 'revenue'

/**
 * Un taux absent (`null`, faute de CA) n'est pas zéro : il est classé en
 * dernier quel que soit le sens du tri, pour ne pas se faire passer pour la
 * pire ou la meilleure ligne.
 */
function compareNullableRate(left: number | null, right: number | null) {
  if (left === right) return 0
  if (left === null) return 1
  if (right === null) return -1
  return right - left
}

export function sortProfitabilityMissions(
  missions: ProfitabilityMission[],
  key: MissionSortKey,
): ProfitabilityMission[] {
  const sorted = [...missions]

  sorted.sort((left, right) => {
    switch (key) {
      case 'date': {
        const comparison = (left.scheduledDate ?? '').localeCompare(
          right.scheduledDate ?? '',
        )
        if (comparison !== 0) return comparison
        break
      }
      case 'reference':
        return (
          left.reference.localeCompare(right.reference, 'fr') ||
          left.missionId.localeCompare(right.missionId)
        )
      case 'revenue': {
        const comparison = right.revenue - left.revenue
        if (comparison !== 0) return comparison
        break
      }
      case 'margin': {
        const comparison = right.operationalMargin - left.operationalMargin
        if (comparison !== 0) return comparison
        break
      }
      case 'marginRate': {
        const comparison = compareNullableRate(left.marginRate, right.marginRate)
        if (comparison !== 0) return comparison
        break
      }
    }

    // Départage déterministe : deux exécutions donnent le même ordre.
    return (
      left.reference.localeCompare(right.reference, 'fr') ||
      left.missionId.localeCompare(right.missionId)
    )
  })

  return sorted
}

export function sortProfitabilityGroups<T extends ProfitabilityGroup>(
  groups: T[],
  key: GroupSortKey,
): T[] {
  const sorted = [...groups]

  sorted.sort((left, right) => {
    switch (key) {
      case 'label':
        break
      case 'missionCount': {
        const comparison = right.missionCount - left.missionCount
        if (comparison !== 0) return comparison
        break
      }
      case 'revenue': {
        const comparison = right.revenueTotal - left.revenueTotal
        if (comparison !== 0) return comparison
        break
      }
      case 'margin': {
        const comparison =
          right.operationalMarginTotal - left.operationalMarginTotal
        if (comparison !== 0) return comparison
        break
      }
      case 'marginRate': {
        const comparison = compareNullableRate(left.marginRate, right.marginRate)
        if (comparison !== 0) return comparison
        break
      }
    }

    return (
      left.label.localeCompare(right.label, 'fr') ||
      left.id.localeCompare(right.id)
    )
  })

  return sorted
}

/* ------------------------------------------------------------------ */
/* Navigation croisée                                                  */
/* ------------------------------------------------------------------ */

export type CrossDimension = 'driver' | 'truck' | 'trailer' | 'client'

export type CrossNavigation = {
  view: ProfitabilityView
  /** Terme injecté dans la recherche de la vue cible. */
  search: string
  /** Identifiant de l'agrégat à mettre en évidence, quand il existe. */
  focusId: string | null
}

const crossDimensionViews: Record<CrossDimension, ProfitabilityView> = {
  driver: 'drivers',
  truck: 'trucks',
  trailer: 'trailers',
  client: 'clients',
}

/**
 * Un clic sur une ressource d'une ligne Mission bascule vers sa vue et y
 * pré-remplit la recherche. `null` quand la mission ne porte pas la ressource :
 * on ne navigue pas vers une vue vide.
 */
export function resolveCrossNavigation(
  mission: ProfitabilityMission,
  dimension: CrossDimension,
): CrossNavigation | null {
  const value =
    dimension === 'driver'
      ? mission.driverName
      : dimension === 'truck'
        ? mission.truckPlateNumber
        : dimension === 'trailer'
          ? mission.trailerPlateNumber
          : mission.clientName

  if (!value) return null

  const focusId =
    dimension === 'driver'
      ? mission.driverId
      : dimension === 'truck'
        ? mission.truckId
        : dimension === 'trailer'
          ? mission.trailerId
          : mission.clientName

  return {
    view: crossDimensionViews[dimension],
    search: value,
    focusId: focusId ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* Pipeline complet                                                    */
/* ------------------------------------------------------------------ */

export type MissionViewState = {
  search: string
  marginFilter: MarginFilter
  sortKey: MissionSortKey
  /** Restriction client optionnelle de la vue Missions. */
  clientKey: string | null
}

export function selectMissions(
  missions: ProfitabilityMission[],
  state: MissionViewState,
  referenceRate: number | null,
): ProfitabilityMission[] {
  const byClient = state.clientKey
    ? missions.filter((mission) => mission.clientName === state.clientKey)
    : missions

  return sortProfitabilityMissions(
    filterByMargin(
      searchProfitabilityMissions(byClient, state.search),
      state.marginFilter,
      referenceRate,
    ),
    state.sortKey,
  )
}

export function selectGroups<T extends ProfitabilityGroup>(
  groups: T[],
  state: {
    search: string
    marginFilter: MarginFilter
    sortKey: GroupSortKey
  },
  referenceRate: number | null,
  extraFields?: (group: T) => Array<string | null | undefined>,
): T[] {
  return sortProfitabilityGroups(
    filterByMargin(
      searchProfitabilityGroups(groups, state.search, extraFields),
      state.marginFilter,
      referenceRate,
    ),
    state.sortKey,
  )
}

/** Liste des clients distincts, pour le filtre de la vue Missions. */
export function listMissionClients(missions: ProfitabilityMission[]) {
  return Array.from(new Set(missions.map((mission) => mission.clientName))).sort(
    (left, right) => left.localeCompare(right, 'fr'),
  )
}

/** Meilleur et moins bon élément d'une dimension, sans recalcul de marge. */
export function getExtremes<T extends ProfitabilityGroup>(groups: T[]) {
  if (groups.length === 0) return { best: null, worst: null }
  const sorted = sortProfitabilityGroups(groups, 'margin')
  return {
    best: sorted[0] ?? null,
    worst: sorted[sorted.length - 1] ?? null,
  }
}
