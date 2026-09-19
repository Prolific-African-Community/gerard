import type { RegulatoryActivitySummary } from './activity-calculator'

export type RegulatoryDisplayState =
  | 'COMPLETE'
  | 'ACTION_REQUIRED'
  | 'NO_ACTIVITY'
  | 'UNAVAILABLE'

export type RegulatoryActionKind =
  | 'END_DRIVE'
  | 'START_DRIVE'
  | 'ADD_REST'
  | 'MARK_AVAILABLE'
  | 'CORRECT_ACTIVITY'
  | 'OPEN_DRIVER'

export type RegulatoryActivityDisplay = {
  type: string
  label: string
  effectiveAt: string
}

export type DriverRegulatoryPresentation = {
  state: RegulatoryDisplayState
  label: 'Complet' | 'Action requise' | 'Aucune activité renseignée' | 'Indisponible'
  detail: string
  consequence: string
  missingData: string | null
  action: {
    kind: RegulatoryActionKind
    label: string
    activityType: string | null
  }
  lastActivity: RegulatoryActivityDisplay | null
}

export const activityBusinessLabels: Record<string, string> = {
  DRIVE_START: 'Conduite commencée',
  DRIVE_END: 'Conduite terminée',
  OTHER_WORK: 'Autre travail',
  BREAK: 'Pause',
  SPLIT_BREAK: 'Coupure',
  DAILY_REST: 'Repos journalier',
  WEEKLY_REST: 'Repos hebdomadaire',
  UNAVAILABLE: 'Indisponibilité',
  AVAILABLE: 'Disponibilité',
}

export const activitySourceLabels: Record<string, string> = {
  DRIVER: 'Déclaré par le chauffeur',
  DISPATCHER_CORRECTION: 'Corrigé par le Dispatch',
  MISSION: 'Issu d’une mission',
  SYSTEM: 'Enregistré par le système',
  QA: 'Donnée de test',
}

function lastActivity(events: readonly {
  type: string
  effectiveAt: Date | string
}[]): RegulatoryActivityDisplay | null {
  const latest = events
    .map((event) => ({
      type: event.type,
      effectiveAt:
        event.effectiveAt instanceof Date
          ? event.effectiveAt
          : new Date(event.effectiveAt),
    }))
    .filter((event) => !Number.isNaN(event.effectiveAt.getTime()))
    .sort(
      (left, right) =>
        right.effectiveAt.getTime() - left.effectiveAt.getTime()
    )[0]
  return latest
    ? {
        type: latest.type,
        label: activityBusinessLabels[latest.type] ?? 'Activité enregistrée',
        effectiveAt: latest.effectiveAt.toISOString(),
      }
    : null
}

export function presentDriverRegulatoryState(input: {
  driverStatus: string
  summary: RegulatoryActivitySummary
  events: readonly { type: string; effectiveAt: Date | string }[]
}): DriverRegulatoryPresentation {
  const latest = lastActivity(input.events)
  const operationallyUnavailable =
    input.driverStatus !== 'ACTIVE' ||
    input.summary.currentStatus === 'UNAVAILABLE'

  if (operationallyUnavailable) {
    return {
      state: 'UNAVAILABLE',
      label: 'Indisponible',
      detail:
        input.driverStatus !== 'ACTIVE'
          ? 'Le chauffeur est déclaré indisponible dans sa fiche.'
          : 'La dernière activité déclare le chauffeur indisponible.',
      consequence:
        'Le chauffeur est exclu des propositions automatiques tant que son indisponibilité demeure.',
      missingData: null,
      action: {
        kind:
          input.summary.currentStatus === 'UNAVAILABLE'
            ? 'MARK_AVAILABLE'
            : 'OPEN_DRIVER',
        label:
          input.summary.currentStatus === 'UNAVAILABLE'
            ? 'Marquer disponible'
            : 'Ouvrir la fiche chauffeur',
        activityType:
          input.summary.currentStatus === 'UNAVAILABLE' ? 'AVAILABLE' : null,
      },
      lastActivity: latest,
    }
  }

  if (!latest) {
    return {
      state: 'NO_ACTIVITY',
      label: 'Aucune activité renseignée',
      detail: 'Aucune activité chauffeur n’est enregistrée sur la période connue.',
      consequence:
        'L’auto-planification conserve une réserve réglementaire et ne suppose aucune durée de conduite.',
      missingData: 'Historique d’activité chauffeur',
      action: {
        kind: 'START_DRIVE',
        label: 'Commencer une conduite',
        activityType: 'DRIVE_START',
      },
      lastActivity: null,
    }
  }

  if (
    input.summary.openActivity &&
    input.summary.currentStatus === 'DRIVE_START'
  ) {
    return {
      state: 'ACTION_REQUIRED',
      label: 'Action requise',
      detail: `Conduite commencée, aucune fin de conduite enregistrée.`,
      consequence:
        'La durée reste inconnue et la proposition automatique est assortie d’une réserve réglementaire.',
      missingData: 'Fin de conduite',
      action: {
        kind: 'END_DRIVE',
        label: 'Terminer la conduite',
        activityType: 'DRIVE_END',
      },
      lastActivity: latest,
    }
  }

  if (
    input.summary.openActivity ||
    input.summary.reliability !== 'UP_TO_DATE'
  ) {
    const reason =
      input.summary.reliabilityReasons[0] ??
      'Les données réglementaires doivent être vérifiées.'
    return {
      state: 'ACTION_REQUIRED',
      label: 'Action requise',
      detail: reason,
      consequence:
        'L’auto-planification conserve une réserve tant que cette donnée n’est pas corrigée.',
      missingData:
        input.summary.openActivity
          ? `Fin de l’activité « ${latest.label} »`
          : input.summary.reliability === 'STALE'
            ? 'État initial arrivé à expiration'
            : input.summary.reliability === 'INCOMPLETE'
              ? 'Début de la période réglementaire non renseigné'
              : 'Chronologie d’activité à vérifier',
      action: {
        kind:
          input.summary.currentStatus === 'BREAK' ||
          input.summary.currentStatus === 'SPLIT_BREAK'
            ? 'ADD_REST'
            : 'CORRECT_ACTIVITY',
        label:
          input.summary.currentStatus === 'BREAK' ||
          input.summary.currentStatus === 'SPLIT_BREAK'
            ? 'Ajouter un repos'
            : 'Corriger l’activité',
        activityType:
          input.summary.currentStatus === 'BREAK' ||
          input.summary.currentStatus === 'SPLIT_BREAK'
            ? 'DAILY_REST'
            : 'AVAILABLE',
      },
      lastActivity: latest,
    }
  }

  return {
    state: 'COMPLETE',
    label: 'Complet',
    detail: 'Les activités connues forment une chronologie réglementaire exploitable.',
    consequence:
      'L’état peut être utilisé par l’auto-planification, sous réserve des autres contraintes.',
    missingData: null,
    action: {
      kind: 'START_DRIVE',
      label: 'Commencer une conduite',
      activityType: 'DRIVE_START',
    },
    lastActivity: latest,
  }
}
