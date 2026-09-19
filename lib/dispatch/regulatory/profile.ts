import type {
  RegulatoryDecisionCode,
  RegulatoryProfile,
} from './types'

export const euRoadFreightProfileV1: RegulatoryProfile = Object.freeze({
  id: 'EU_ROAD_FREIGHT_561_2006',
  version: '2024-05-22.v1',
  legalBasis: 'Regulation (EC) No 561/2006, consolidated 2024-05-22',
  territory: 'EU_GENERAL',
  timeZone: 'Europe/Luxembourg',
  enabledDerogations: [],
  maximumContinuousDrivingSeconds: 4.5 * 60 * 60,
  normalBreakSeconds: 45 * 60,
  splitBreakFirstPartMinimumSeconds: 15 * 60,
  splitBreakSecondPartMinimumSeconds: 30 * 60,
  normalDailyDrivingSeconds: 9 * 60 * 60,
  extendedDailyDrivingSeconds: 10 * 60 * 60,
  maximumDailyExtensionsPerWeek: 2,
  maximumWeeklyDrivingSeconds: 56 * 60 * 60,
  maximumFortnightDrivingSeconds: 90 * 60 * 60,
  normalDailyRestSeconds: 11 * 60 * 60,
  reducedDailyRestSeconds: 9 * 60 * 60,
  maximumReducedDailyRestsBetweenWeeklyRests: 3,
  splitDailyRestFirstPartMinimumSeconds: 3 * 60 * 60,
  splitDailyRestSecondPartMinimumSeconds: 9 * 60 * 60,
  normalWeeklyRestSeconds: 45 * 60 * 60,
  reducedWeeklyRestMinimumSeconds: 24 * 60 * 60,
  defaultLoadingSeconds: 60 * 60,
  defaultUnloadingSeconds: 60 * 60,
  defaultTrailerCouplingSeconds: 15 * 60,
  defaultTrailerUncouplingSeconds: 15 * 60,
})

export const regulatoryDecisionMessages: Record<
  RegulatoryDecisionCode,
  string
> = {
  FEASIBLE: 'Mission réalisable avec la chronologie fournie.',
  FEASIBLE_WITH_BREAK: 'Mission réalisable avec insertion d’une pause réglementaire.',
  FEASIBLE_WITH_DAILY_EXTENSION:
    'Mission réalisable en utilisant une extension journalière à 10 heures.',
  FEASIBLE_AFTER_DAILY_REST:
    'Mission réalisable après insertion d’un repos journalier.',
  REQUIRES_NEXT_DAY: 'La mission doit se poursuivre ou démarrer le jour suivant.',
  DRIVING_LIMIT_EXCEEDED: 'La limite journalière de conduite serait dépassée.',
  WEEKLY_LIMIT_EXCEEDED: 'La limite de 56 heures de conduite hebdomadaire serait dépassée.',
  FORTNIGHT_LIMIT_EXCEEDED:
    'La limite de 90 heures de conduite sur deux semaines serait dépassée.',
  INSUFFICIENT_DAILY_REST: 'La durée de repos journalier est insuffisante.',
  TOO_MANY_REDUCED_DAILY_RESTS:
    'Le maximum de trois repos journaliers réduits est déjà atteint.',
  MISSION_TIME_WINDOW_MISSED: 'Le créneau horaire de la mission ne peut pas être respecté.',
  OVERLAPPING_ACTIVITY: 'Deux activités se chevauchent dans la chronologie.',
  INCOHERENT_START_POSITION:
    'La position de départ ne correspond pas à la disponibilité précédente.',
  STALE_DRIVER_STATE: 'L’état réglementaire du chauffeur est trop ancien.',
  MISSING_DRIVER_STATE: 'L’état réglementaire initial du chauffeur est incomplet.',
  MISSING_TACHOGRAPH_HISTORY:
    'L’historique tachygraphe nécessaire au calcul est absent.',
  MISSING_ROUTE_DURATION: 'Une durée d’itinéraire nécessaire est absente.',
  MISSING_POSITION: 'Une position nécessaire au calcul est absente.',
  MISSING_MISSION_TIME: 'L’horaire de la mission est absent ou ambigu.',
  MISSING_WEEKLY_REST_STATE:
    'Les informations de repos hebdomadaire ou de compensation sont absentes.',
  INVALID_SPLIT_BREAK: 'Le fractionnement de pause ne respecte pas la séquence 15 puis 30 minutes.',
  INVALID_TIMELINE: 'La chronologie fournie est invalide.',
}
