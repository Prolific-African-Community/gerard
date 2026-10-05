import type { DispatchDay } from './mock-data'

/**
 * Jour d'affichage d'une mission sur la grille hebdomadaire.
 *
 * La grille montre une mission au jour de son jalon opérationnel courant :
 * tant que l'enlèvement n'est pas atteint elle reste au jour d'enlèvement,
 * une fois atteint elle passe au jour de livraison. C'est une règle de
 * PRÉSENTATION : rien n'est muté, ni `MissionAssignment.day`, ni les dates,
 * ni les ressources. Le moteur continue de raisonner sur les horaires réels.
 *
 * La preuve d'« enlèvement atteint » est l'état opérationnel existant du
 * tracteur, celui que l'action chauffeur `ARRIVE_PICKUP` écrit déjà
 * (`TruckStatus.AT_PICKUP`, puis `ON_MISSION` après `START_DELIVERY`). Aucun
 * nouveau statut, champ, évènement ni bouton n'est introduit.
 */

const dayByWeekdayName: Record<string, DispatchDay> = {
  Mon: 'monday',
  Tue: 'tuesday',
  Wed: 'wednesday',
  Thu: 'thursday',
  Fri: 'friday',
  Sat: 'saturday',
  Sun: 'sunday',
}

/** Statuts tracteur qui prouvent que l'enlèvement a été atteint. */
const PICKUP_REACHED_TRUCK_STATUSES = new Set(['AT_PICKUP', 'ON_MISSION'])

/** Une mission terminée retrouve le comportement historique existant. */
const TERMINAL_MISSION_STATUSES = new Set(['DONE', 'CANCELLED'])

/** Une mission n'est opérationnellement en cours que dans ces états. */
const ACTIVE_MISSION_STATUSES = new Set(['IN_PROGRESS', 'ISSUE'])

function normalize(value: unknown) {
  return typeof value === 'string' ? value.toUpperCase() : ''
}

function validDate(value: Date | string | null | undefined) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * L'enlèvement a-t-il été atteint ?
 *
 * Volontairement indépendant de l'heure courante : un enlèvement prévu à 08:00
 * et atteint à 11:30 ne compte qu'à 11:30. Le dispatcher voit l'état réel, pas
 * une supposition tirée du calendrier.
 */
export function hasReachedPickup(input: {
  missionStatus?: unknown
  truckStatus?: unknown
}) {
  const missionStatus = normalize(input.missionStatus)
  if (!ACTIVE_MISSION_STATUSES.has(missionStatus)) return false
  return PICKUP_REACHED_TRUCK_STATUSES.has(normalize(input.truckStatus))
}

export function weekdayOf(value: Date | string, timeZone: string) {
  const date = validDate(value)
  if (!date) return null
  const name = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone,
  }).format(date)
  return dayByWeekdayName[name] ?? null
}

/**
 * Jour où la grille doit rendre la mission.
 *
 * `plannedDay` est le jour persisté de l'affectation : il reste la référence,
 * et la valeur de repli dès que la livraison n'est pas exploitable.
 */
export function resolveMissionPlanningDisplayDay(input: {
  plannedDay: DispatchDay
  deliveryDate?: Date | string | null
  missionStatus?: unknown
  truckStatus?: unknown
  weekStartDate: Date
  timeZone?: string
}): DispatchDay {
  const missionStatus = normalize(input.missionStatus)
  // Terminée : on ne déplace plus rien, le comportement existant s'applique.
  if (TERMINAL_MISSION_STATUSES.has(missionStatus)) return input.plannedDay
  if (!hasReachedPickup(input)) return input.plannedDay

  const delivery = validDate(input.deliveryDate)
  if (!delivery) return input.plannedDay

  // Une livraison hors de la semaine affichée ne peut pas être rendue : la
  // carte reste sur son jour planifié plutôt que de disparaître.
  const weekStart = input.weekStartDate
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 7)
  if (delivery < weekStart || delivery >= weekEnd) return input.plannedDay

  return (
    weekdayOf(delivery, input.timeZone ?? 'Europe/Luxembourg') ??
    input.plannedDay
  )
}
