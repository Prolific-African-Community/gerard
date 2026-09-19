/**
 * Traduction d'un résultat de recherche en navigation cockpit.
 *
 * La palette ne « connaît » ni le bandeau ni la grille : elle produit une
 * intention (semaine à afficher, onglet du bandeau, filtre à sélectionner,
 * élément à mettre en évidence) que le cockpit applique. La fonction est
 * pure, donc testable sans DOM.
 */

import type { PlanningPoolBucket } from './planning-pool'
import type {
  MissionSearchResult,
  TrailerSearchResult,
  TruckSearchResult,
} from './smart-search'
import type { TrailerFilter } from './trailer-rotation'

export type LocatorTargetKind = 'mission' | 'truck' | 'trailer'

export type LocatorTarget = {
  kind: LocatorTargetKind
  id: string
}

/** Onglets du bandeau inférieur susceptibles d'accueillir un résultat. */
export type LocatorPoolMode = 'missions' | 'trucks' | 'trailers'

export type LocatorNavigation = {
  target: LocatorTarget
  /** Semaine à afficher (`yyyy-mm-dd`), `null` si la semaine ne change pas. */
  weekStart: string | null
  /** Onglet du bandeau à ouvrir, `null` quand la cible est dans la grille. */
  poolMode: LocatorPoolMode | null
  /** Catégorie du bandeau Missions à présélectionner. */
  poolBucket: PlanningPoolBucket | null
  /** Filtre du bandeau Remorques à présélectionner. */
  trailerFilter: TrailerFilter | null
  /** Libellé du bouton principal de la carte locator. */
  actionLabel: string
}

export type SmartSearchResult =
  | MissionSearchResult
  | TruckSearchResult
  | TrailerSearchResult

/** `null` quand la semaine visée est déjà celle qui est affichée. */
function resolveWeekChange(
  weekStart: string | null,
  currentWeekStart: string,
): string | null {
  if (!weekStart) return null
  return weekStart === currentWeekStart ? null : weekStart
}

export function resolveMissionNavigation(
  mission: MissionSearchResult,
  currentWeekStart: string,
): LocatorNavigation {
  if (mission.locationType === 'PLANNING') {
    return {
      target: { kind: 'mission', id: mission.id },
      weekStart: resolveWeekChange(mission.weekStart, currentWeekStart),
      poolMode: null,
      poolBucket: null,
      trailerFilter: null,
      actionLabel: 'Afficher dans le Planning',
    }
  }

  // Pool et historique partagent le même bandeau : seule la catégorie change,
  // et elle vient telle quelle de la classification centrale.
  return {
    target: { kind: 'mission', id: mission.id },
    weekStart: null,
    poolMode: 'missions',
    poolBucket: mission.bucket,
    trailerFilter: null,
    actionLabel:
      mission.locationType === 'HISTORY'
        ? 'Afficher dans l’historique'
        : 'Afficher dans le pool',
  }
}

export function resolveTruckNavigation(
  truck: TruckSearchResult,
  currentWeekStart: string,
): LocatorNavigation {
  if (truck.locationType === 'PLANNING') {
    return {
      target: { kind: 'truck', id: truck.id },
      weekStart: resolveWeekChange(truck.weekStart, currentWeekStart),
      poolMode: null,
      poolBucket: null,
      trailerFilter: null,
      actionLabel: 'Afficher la ligne',
    }
  }

  return {
    target: { kind: 'truck', id: truck.id },
    weekStart: null,
    poolMode: 'trucks',
    poolBucket: null,
    trailerFilter: null,
    actionLabel: 'Afficher le camion',
  }
}

export function resolveTrailerNavigation(
  trailer: TrailerSearchResult,
): LocatorNavigation {
  // Invariant 2 : une remorque attelée est visible sur la ligne de son
  // tracteur. On y renvoie donc plutôt que dans le bandeau.
  if (trailer.coupling === 'ATTACHED' && trailer.truckId) {
    return {
      target: { kind: 'trailer', id: trailer.id },
      weekStart: null,
      poolMode: null,
      poolBucket: null,
      trailerFilter: null,
      actionLabel: 'Afficher la ligne',
    }
  }

  return {
    target: { kind: 'trailer', id: trailer.id },
    weekStart: null,
    poolMode: 'trailers',
    poolBucket: null,
    trailerFilter: trailer.poolFilter,
    actionLabel: 'Afficher la remorque',
  }
}

export function resolveLocatorNavigation(
  result: SmartSearchResult,
  currentWeekStart: string,
): LocatorNavigation {
  if (result.type === 'MISSION') {
    return resolveMissionNavigation(result, currentWeekStart)
  }
  if (result.type === 'TRUCK') {
    return resolveTruckNavigation(result, currentWeekStart)
  }
  return resolveTrailerNavigation(result)
}

/* ------------------------------------------------------------------ */
/* Mise en évidence                                                    */
/* ------------------------------------------------------------------ */

/** Assez long pour que l'œil retrouve la carte, assez court pour disparaître. */
export const LOCATOR_HIGHLIGHT_MS = 2500

/** Nombre de tentatives de résolution après un changement de semaine. */
export const LOCATOR_RESOLVE_ATTEMPTS = 20
export const LOCATOR_RESOLVE_INTERVAL_MS = 120

export const locatorHighlightClassName = 'dispatch-locator-highlight'

const locatorAttributes: Record<LocatorTargetKind, string> = {
  mission: 'data-mission-id',
  truck: 'data-truck-id',
  trailer: 'data-trailer-id',
}

/**
 * Sélecteur bâti sur un attribut stable déjà porté par la carte : la mise en
 * évidence n'écrit jamais dans la donnée.
 */
export function buildLocatorSelector(target: LocatorTarget) {
  const value = target.id.replace(/["\\]/g, '\\$&')
  return `[${locatorAttributes[target.kind]}="${value}"]`
}
