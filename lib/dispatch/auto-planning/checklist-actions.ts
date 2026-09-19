/**
 * Détermination pure de l'action contextuelle d'un blocage de la checklist de
 * planification automatique. Séparée du composant React pour être testable :
 * chaque test vérifie que l'action pointe vers l'identifiant exact de la
 * ressource responsable (correctif final §3 et §10).
 *
 * Aucune décision métier n'est calculée ici : on se contente de router le
 * dispatcher vers la bonne fiche. Le moteur reste seul juge de la faisabilité.
 */
import type { ReasonActionKind } from '../reason-labels'

export type PairChecklistState = {
  driverId: string | null
  truckId: string | null
  missingRegulatoryState: boolean
  missingPosition: boolean
  unavailable: boolean
}

export type ChecklistAction =
  | { kind: 'EDIT_DRIVER_REGULATORY'; action: ReasonActionKind; driverId: string }
  | { kind: 'CHECK_POSITION'; action: ReasonActionKind; truckId: string }
  | { kind: 'CHECK_AVAILABILITY'; action: ReasonActionKind; truckId: string }
  | { kind: 'NONE'; action: null }

/**
 * Ordre de priorité : réglementaire (fiche chauffeur), puis position (fiche
 * camion : statut / télémétrie), puis
 * disponibilité (fiche camion). Une action n'est proposée que si l'identifiant
 * exact de la ressource est connu.
 */
export function resolvePairChecklistAction(
  pair: PairChecklistState
): ChecklistAction {
  if (pair.missingRegulatoryState && pair.driverId) {
    return {
      kind: 'EDIT_DRIVER_REGULATORY',
      action: 'EDIT_DRIVER_REGULATORY',
      driverId: pair.driverId,
    }
  }
  if (pair.missingPosition && pair.truckId) {
    return {
      kind: 'CHECK_POSITION',
      action: 'RERUN_PREPARATION',
      truckId: pair.truckId,
    }
  }
  if (pair.unavailable && pair.truckId) {
    return {
      kind: 'CHECK_AVAILABILITY',
      action: 'CHECK_AVAILABILITY',
      truckId: pair.truckId,
    }
  }
  return { kind: 'NONE', action: null }
}

/**
 * Une mission non affectée est-elle corrigeable en ouvrant la mission
 * (horaires / adresse) ? Retourne le libellé d'action attendu, ou null.
 */
export function resolveMissionChecklistAction(item: {
  category: string
  codes?: readonly string[]
}): 'EDIT_MISSION_SCHEDULE' | 'REVIEW_ADDRESS' | null {
  const scheduleCategories = new Set([
    'DEFERRED',
    'TIME_WINDOW_IMPOSSIBLE',
  ])
  const scheduleCodes = new Set([
    'MISSION_TIME_WINDOW_MISSED',
    'MISSING_MISSION_TIME',
    'TEMPORALLY_INFEASIBLE',
    'RESOURCE_TIME_CONFLICT',
  ])
  const addressCodes = new Set(['PICKUP_ADDRESS', 'DELIVERY_ADDRESS'])
  const codes = item.codes ?? []
  if (scheduleCategories.has(item.category)) return 'EDIT_MISSION_SCHEDULE'
  if (codes.some((code) => scheduleCodes.has(code))) {
    return 'EDIT_MISSION_SCHEDULE'
  }
  if (codes.some((code) => addressCodes.has(code))) return 'REVIEW_ADDRESS'
  return null
}
