import type { DriverRegulatoryDeclaration } from '@prisma/client'

import type { RegulatoryActivitySummary } from './activity-calculator'
import { euRoadFreightProfileV1 } from './profile'

export type RegulatoryControlStatus =
  | 'CONFORME'
  | 'AVERTISSEMENT'
  | 'BLOQUANT'

export type RegulatoryControlKey =
  | 'DRIVING_AVAILABLE'
  | 'DAILY_REST'
  | 'WEEKLY_LIMIT'
  | 'HISTORY'
  | 'OPEN_ACTIVITY'
  | 'AVAILABILITY'

export type RegulatoryControl = {
  key: RegulatoryControlKey
  label: string
  status: RegulatoryControlStatus
  value: string
  period: string
  source: string
  explanation: string
  planningEffect: string
  action: {
    kind:
      | 'OPEN_INITIAL_STATE'
      | 'END_ACTIVITY'
      | 'ADD_REST'
      | 'MARK_AVAILABLE'
      | 'OPEN_DRIVER'
      | 'NONE'
    label: string
    activityType?: string
  }
}

export type RegulatoryParameter = {
  key: string
  label: string
  value: string
  source: string
  planningEffect: string
}

function duration(seconds: number | null) {
  if (seconds === null) return 'Inconnue'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours} h ${String(minutes).padStart(2, '0')}`
}

function sourceFor(
  summary: RegulatoryActivitySummary,
  declaration: DriverRegulatoryDeclaration | null
) {
  if (summary.observedSegments.length) return 'Activités enregistrées'
  if (declaration) {
    return declaration.source === 'TACHOGRAPH'
      ? 'Tachygraphe'
      : 'Déclaration initiale du Dispatch'
  }
  return 'Aucune source'
}

export function buildRegulatoryParameters(): RegulatoryParameter[] {
  const profile = euRoadFreightProfileV1
  return [
    {
      key: 'TIME_ZONE',
      label: 'Fuseau réglementaire',
      value: profile.timeZone,
      source: `Profil ${profile.id}`,
      planningEffect: 'Définit les jours civils et les semaines ISO.',
    },
    {
      key: 'CONTINUOUS_DRIVING',
      label: 'Conduite continue maximale',
      value: duration(profile.maximumContinuousDrivingSeconds),
      source: profile.legalBasis,
      planningEffect: 'Une pause est insérée avant tout dépassement.',
    },
    {
      key: 'NORMAL_BREAK',
      label: 'Pause normale',
      value: duration(profile.normalBreakSeconds),
      source: profile.legalBasis,
      planningEffect: 'Remet à zéro la conduite continue.',
    },
    {
      key: 'SPLIT_BREAK',
      label: 'Pause fractionnée',
      value: `${duration(
        profile.splitBreakFirstPartMinimumSeconds
      )} puis ${duration(profile.splitBreakSecondPartMinimumSeconds)}`,
      source: profile.legalBasis,
      planningEffect: 'Alternative reconnue à la pause normale.',
    },
    {
      key: 'DAILY_DRIVING',
      label: 'Conduite journalière',
      value: `${duration(profile.normalDailyDrivingSeconds)} · extension ${duration(
        profile.extendedDailyDrivingSeconds
      )}`,
      source: profile.legalBasis,
      planningEffect: 'Une violation démontrée rend la proposition bloquante.',
    },
    {
      key: 'DAILY_EXTENSIONS',
      label: 'Extensions journalières',
      value: `${profile.maximumDailyExtensionsPerWeek} par semaine`,
      source: profile.legalBasis,
      planningEffect: 'Limite l’utilisation des journées à 10 heures.',
    },
    {
      key: 'WEEKLY_DRIVING',
      label: 'Conduite hebdomadaire maximale',
      value: duration(profile.maximumWeeklyDrivingSeconds),
      source: profile.legalBasis,
      planningEffect: 'Une violation démontrée rend la proposition bloquante.',
    },
    {
      key: 'FORTNIGHT_DRIVING',
      label: 'Conduite sur deux semaines',
      value: duration(profile.maximumFortnightDrivingSeconds),
      source: profile.legalBasis,
      planningEffect: 'Additionne la semaine courante et la précédente.',
    },
    {
      key: 'DAILY_REST',
      label: 'Repos journalier',
      value: `${duration(profile.normalDailyRestSeconds)} · réduit ${duration(
        profile.reducedDailyRestSeconds
      )}`,
      source: profile.legalBasis,
      planningEffect: 'Réinitialise la conduite journalière après un repos valide.',
    },
    {
      key: 'WEEKLY_REST',
      label: 'Repos hebdomadaire',
      value: `${duration(profile.normalWeeklyRestSeconds)} · réduit ${duration(
        profile.reducedWeeklyRestMinimumSeconds
      )}`,
      source: profile.legalBasis,
      planningEffect: 'Contrôle l’échéance et les compensations de repos.',
    },
    {
      key: 'DECLARATION_VALIDITY',
      label: 'Validité de l’état initial',
      value: 'Définie explicitement dans la déclaration',
      source: 'Déclaration initiale',
      planningEffect:
        'Une déclaration expirée produit un avertissement, jamais une infraction inventée.',
    },
    {
      key: 'ACTIVITY_WINDOW',
      label: 'Période du journal analysée',
      value: 'Semaine courante et deux semaines précédentes',
      source: 'Journal d’activité chauffeur',
      planningEffect:
        'Couvre les compteurs de la semaine et de la quinzaine sans seuil de fraîcheur caché.',
    },
  ]
}

export function buildDriverRegulatoryAssessment(input: {
  driverStatus: string
  summary: RegulatoryActivitySummary
  declaration: DriverRegulatoryDeclaration | null
  at: Date
}): {
  status: RegulatoryControlStatus
  controls: RegulatoryControl[]
  parameters: RegulatoryParameter[]
} {
  const { summary, declaration, at } = input
  const source = sourceFor(summary, declaration)
  const hasKnownDriving =
    summary.dailyDrivingSeconds !== null &&
    summary.weeklyDrivingSeconds !== null &&
    summary.drivingSinceValidBreakSeconds !== null
  const weeklyViolation =
    summary.weeklyDrivingSeconds !== null &&
    summary.weeklyDrivingSeconds >
      euRoadFreightProfileV1.maximumWeeklyDrivingSeconds
  const operationallyUnavailable =
    input.driverStatus !== 'ACTIVE' ||
    summary.currentStatus === 'UNAVAILABLE'
  const declarationExpired = Boolean(
    declaration?.validUntil &&
      declaration.validUntil.getTime() < at.getTime()
  )
  const controls: RegulatoryControl[] = [
    {
      key: 'DRIVING_AVAILABLE',
      label: 'Conduite disponible',
      status: hasKnownDriving ? 'CONFORME' : 'AVERTISSEMENT',
      value:
        summary.dailyDrivingRemainingSeconds === null
          ? 'Solde journalier inconnu'
          : `${duration(summary.dailyDrivingRemainingSeconds)} restantes`,
      period: 'Journée locale en cours',
      source,
      explanation: hasKnownDriving
        ? 'Les compteurs de conduite observables sont disponibles.'
        : 'Le solde ne peut pas être démontré avec les données actuellement connues.',
      planningEffect: hasKnownDriving
        ? 'Le moteur contrôle les limites à partir de cette valeur.'
        : 'La proposition reste orange et demande une confirmation.',
      action: hasKnownDriving
        ? { kind: 'NONE', label: 'Aucune action' }
        : { kind: 'OPEN_INITIAL_STATE', label: 'Renseigner l’état initial' },
    },
    {
      key: 'DAILY_REST',
      label: 'Repos journalier',
      status: declaration ? 'CONFORME' : 'AVERTISSEMENT',
      value: declaration
        ? new Date(declaration.lastValidRestEndedAt).toLocaleString('fr-FR')
        : 'Dernier repos inconnu',
      period: 'Depuis le dernier repos valide',
      source: declaration ? sourceFor(summary, declaration) : 'Aucune source',
      explanation: declaration
        ? 'La fin du dernier repos valide est renseignée.'
        : 'La continuité du repos journalier ne peut pas être démontrée.',
      planningEffect: declaration
        ? 'Le moteur peut calculer l’amplitude et insérer un repos si nécessaire.'
        : 'La proposition reste orange.',
      action: declaration
        ? { kind: 'ADD_REST', label: 'Ajouter un repos', activityType: 'DAILY_REST' }
        : { kind: 'OPEN_INITIAL_STATE', label: 'Renseigner l’état initial' },
    },
    {
      key: 'WEEKLY_LIMIT',
      label: 'Limite hebdomadaire',
      status: weeklyViolation
        ? 'BLOQUANT'
        : summary.weeklyDrivingSeconds === null
          ? 'AVERTISSEMENT'
          : 'CONFORME',
      value:
        summary.weeklyDrivingSeconds === null
          ? 'Compteur inconnu'
          : `${duration(summary.weeklyDrivingSeconds)} utilisées sur ${duration(
              euRoadFreightProfileV1.maximumWeeklyDrivingSeconds
            )}`,
      period: 'Semaine ISO en cours',
      source,
      explanation: weeklyViolation
        ? 'La limite hebdomadaire connue est déjà dépassée.'
        : summary.weeklyDrivingSeconds === null
          ? 'Le compteur hebdomadaire n’est pas suffisamment documenté.'
          : 'La limite hebdomadaire connue n’est pas dépassée.',
      planningEffect: weeklyViolation
        ? 'Toute nouvelle conduite est bloquée.'
        : summary.weeklyDrivingSeconds === null
          ? 'La proposition reste orange.'
          : 'Le moteur contrôle chaque nouvelle mission.',
      action:
        summary.weeklyDrivingSeconds === null
          ? { kind: 'OPEN_INITIAL_STATE', label: 'Renseigner l’état initial' }
          : { kind: 'NONE', label: 'Aucune action' },
    },
    {
      key: 'HISTORY',
      label: 'Historique connu',
      status:
        summary.reliability === 'UP_TO_DATE'
          ? 'CONFORME'
          : 'AVERTISSEMENT',
      value: declaration
        ? `État initial au ${declaration.referenceAt.toLocaleString('fr-FR')}`
        : `${summary.observedSegments.length} intervalle(s) observé(s)`,
      period: declaration
        ? `${declaration.referenceAt.toLocaleString('fr-FR')} → ${
            declaration.validUntil
              ? declaration.validUntil.toLocaleString('fr-FR')
              : 'sans expiration automatique'
          }`
        : 'Depuis le premier événement connu',
      source,
      explanation:
        summary.reliabilityReasons.join(' ') ||
        'La chronologie connue est exploitable.',
      planningEffect:
        summary.reliability === 'UP_TO_DATE'
          ? 'Aucune réserve liée à la couverture de l’historique.'
          : 'Les données connues sont conservées ; les inconnues restent des avertissements.',
      action:
        !declaration || declarationExpired
          ? {
              kind: 'OPEN_INITIAL_STATE',
              label: declarationExpired
                ? 'Actualiser l’état initial'
                : 'Renseigner l’état initial',
            }
          : { kind: 'NONE', label: 'Aucune action' },
    },
    {
      key: 'OPEN_ACTIVITY',
      label: 'Activité ouverte',
      status: summary.openActivity ? 'AVERTISSEMENT' : 'CONFORME',
      value: summary.openActivity
        ? summary.currentStatus ?? 'Activité non terminée'
        : 'Aucune',
      period: 'Activité la plus récente',
      source: summary.currentStatus ? 'Journal d’activité' : 'Aucune activité',
      explanation: summary.openActivity
        ? 'La durée finale de cette activité reste inconnue.'
        : 'La dernière activité connue est fermée.',
      planningEffect: summary.openActivity
        ? 'La proposition reste orange ; aucune durée n’est inventée.'
        : 'Aucune réserve liée à une activité ouverte.',
      action: summary.openActivity
        ? {
            kind: 'END_ACTIVITY',
            label:
              summary.currentStatus === 'DRIVE_START'
                ? 'Terminer la conduite'
                : 'Terminer l’activité',
            activityType:
              summary.currentStatus === 'DRIVE_START'
                ? 'DRIVE_END'
                : 'AVAILABLE',
          }
        : { kind: 'NONE', label: 'Aucune action' },
    },
    {
      key: 'AVAILABILITY',
      label: 'Disponibilité',
      status: operationallyUnavailable ? 'BLOQUANT' : 'CONFORME',
      value: operationallyUnavailable ? 'Indisponible' : 'Disponible',
      period: 'État actuel',
      source:
        input.driverStatus !== 'ACTIVE'
          ? 'Fiche chauffeur'
          : 'Dernière activité',
      explanation: operationallyUnavailable
        ? 'Le chauffeur est explicitement déclaré indisponible.'
        : 'Aucune indisponibilité explicite n’est connue.',
      planningEffect: operationallyUnavailable
        ? 'Le chauffeur est exclu des propositions.'
        : 'Le chauffeur peut être évalué par le moteur.',
      action: operationallyUnavailable
        ? summary.currentStatus === 'UNAVAILABLE'
          ? {
              kind: 'MARK_AVAILABLE',
              label: 'Marquer disponible',
              activityType: 'AVAILABLE',
            }
          : { kind: 'OPEN_DRIVER', label: 'Ouvrir la fiche chauffeur' }
        : { kind: 'NONE', label: 'Aucune action' },
    },
  ]
  const status = controls.some((control) => control.status === 'BLOQUANT')
    ? 'BLOQUANT'
    : controls.some((control) => control.status === 'AVERTISSEMENT')
      ? 'AVERTISSEMENT'
      : 'CONFORME'
  return { status, controls, parameters: buildRegulatoryParameters() }
}
