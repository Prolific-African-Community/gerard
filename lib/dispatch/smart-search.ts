/**
 * Recherche « locator » du cockpit Dispatch.
 *
 * Ce module ne classe rien de neuf : il **compose** les classifications déjà
 * en place pour répondre à une seule question — « où se trouve actuellement
 * cet élément ? ».
 *
 *   Missions  ← `classifyPlanningPoolMission()` (planning-pool.ts)
 *   Remorques ← `resolveTrailerSituation()` / `matchesTrailerFilter()`
 *   Camions   ← ligne PlanningRow réelle + `Truck.status`
 *
 * Aucun statut métier supplémentaire n'est introduit : les buckets, filtres
 * remorques et libellés proviennent tous des tables existantes.
 */

import {
  formatDateParam,
  getWeekEndDate,
  getWeekStartDate,
} from './date-utils'
import { dayLabels, dispatchDays } from './mock-data'
import type { DispatchDay } from './mock-data'
import {
  classifyPlanningPoolMission,
  getPlanningBucketNote,
  planningBucketCardLabels,
  toDate,
} from './planning-pool'
import type { PlanningPoolBucket } from './planning-pool'
import { trailerTypeLabels, truckStatusLabels } from './technical-attributes'
import {
  isTrailerAvailableForNewMission,
  matchesTrailerFilter,
  resolveTrailerSituation,
  summarizeTrailerSituation,
  trailerCouplingLabels,
  trailerLoadLabels,
  trailerLocationLabels,
} from './trailer-rotation'
import type {
  TrailerFilter,
  TrailerSituation,
  TrailerSituationInput,
} from './trailer-rotation'

/** Deux caractères suffisent : en dessous, le bruit dépasse l'utilité. */
export const SMART_SEARCH_MIN_LENGTH = 2
/** Frappe au clavier : une requête par pause, pas une par touche. */
export const SMART_SEARCH_DEBOUNCE_MS = 200
/** Palette compacte : au-delà, ce n'est plus un locator mais une liste. */
export const SMART_SEARCH_LIMIT = 8

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g')

/**
 * `AX 59 ZQ`, `ax-59-zq` et `AX59ZQ` désignent la même plaque. Accents,
 * casse et séparateurs sont donc supprimés avant toute comparaison.
 */
export function normalizeSearchTerm(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/** Vrai dès qu'un des champs contient le terme normalisé. */
export function matchesSearchTerm(
  term: string,
  fields: Array<string | null | undefined>,
): boolean {
  const normalized = normalizeSearchTerm(term)
  if (!normalized) return false
  return fields.some((field) => normalizeSearchTerm(field).includes(normalized))
}

/**
 * En dessous du minimum, la recherche n'est déclenchée que si le terme est
 * une référence exacte connue de l'appelant.
 */
export function isSearchTermUsable(term: string): boolean {
  return normalizeSearchTerm(term).length >= SMART_SEARCH_MIN_LENGTH
}

/* ------------------------------------------------------------------ */
/* Repères temporels                                                   */
/* ------------------------------------------------------------------ */

export type WeekRelation = 'CURRENT' | 'PREVIOUS' | 'NEXT' | 'OTHER'

const MS_PER_WEEK = 7 * 86_400_000

export function getDispatchDayFromDate(date: Date): DispatchDay {
  // getDay() : 0 = dimanche. La grille commence le lundi.
  const weekday = date.getDay()
  return dispatchDays[weekday === 0 ? 6 : weekday - 1]
}

export function formatShortDate(date: Date) {
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${day}/${month}`
}

export function formatFullDate(date: Date) {
  return `${formatShortDate(date)}/${date.getFullYear()}`
}

export function describeWeekRelation(
  weekStartDate: Date,
  referenceWeekStartDate: Date,
): { relation: WeekRelation; label: string } {
  const offset = Math.round(
    (weekStartDate.getTime() - referenceWeekStartDate.getTime()) / MS_PER_WEEK,
  )

  if (offset === 0) return { relation: 'CURRENT', label: 'Semaine affichée' }
  if (offset === 1) return { relation: 'NEXT', label: 'Semaine suivante' }
  if (offset === -1) {
    return { relation: 'PREVIOUS', label: 'Semaine précédente' }
  }

  return {
    relation: 'OTHER',
    label: `Semaine du ${formatShortDate(weekStartDate)}`,
  }
}

/* ------------------------------------------------------------------ */
/* Locator Mission                                                     */
/* ------------------------------------------------------------------ */

export type SmartSearchLocationType = 'PLANNING' | 'POOL' | 'HISTORY'

export type MissionLocatorAssignment = {
  id?: string | null
  scheduledDate?: Date | string | null
  plannedEndAt?: Date | string | null
  planningRowId?: string | null
  driverId?: string | null
  driverName?: string | null
  truckId?: string | null
  truckPlate?: string | null
  trailerId?: string | null
  trailerPlate?: string | null
}

export type MissionLocatorInput = {
  id: string
  reference: string
  clientReference?: string | null
  clientName?: string | null
  cmrNumber?: string | null
  deliveryNoteNumber?: string | null
  pickupCity?: string | null
  deliveryCity?: string | null
  status?: string | null
  preparationStatus?: string | null
  pickupDate?: Date | string | null
  deliveryDate?: Date | string | null
  assignment?: MissionLocatorAssignment | null
}

export type MissionSearchResult = {
  type: 'MISSION'
  id: string
  reference: string
  clientReference: string | null
  clientName: string | null
  cmrNumber: string | null
  deliveryNoteNumber: string | null
  pickupCity: string | null
  deliveryCity: string | null
  locationType: SmartSearchLocationType
  /** Catégorie issue du bandeau central, jamais recalculée ici. */
  bucket: PlanningPoolBucket
  bucketLabel: string
  /** Ligne principale : « Planifiée mardi 25/08 », « Dans le pool »… */
  situationLabel: string
  /** Précision secondaire : ampleur du retard, raison de vérification… */
  note: string | null
  weekStart: string | null
  weekRelation: WeekRelation | null
  weekRelationLabel: string | null
  day: DispatchDay | null
  dayLabel: string | null
  scheduledDate: string | null
  /** Renseigné uniquement quand la mission s'étend sur plusieurs jours. */
  spanLabel: string | null
  planningRowId: string | null
  driverId: string | null
  driverName: string | null
  truckId: string | null
  truckPlate: string | null
  trailerId: string | null
  trailerPlate: string | null
}

/** Champs réellement interrogeables pour une mission. */
export function getMissionSearchFields(mission: MissionLocatorInput) {
  return [
    mission.reference,
    mission.clientReference,
    mission.cmrNumber,
    mission.deliveryNoteNumber,
    mission.clientName,
    mission.pickupCity,
    mission.deliveryCity,
  ]
}

function isSameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

function buildMissionSituationLabel(input: {
  locationType: SmartSearchLocationType
  day: DispatchDay | null
  scheduledDate: Date | null
}) {
  if (input.locationType === 'PLANNING') {
    if (!input.scheduledDate || !input.day) {
      // Affectation réelle sans date exploitable : on ne fabrique pas un jour.
      return 'Affectée · jour à confirmer'
    }
    return `Planifiée ${dayLabels[input.day].toLowerCase()} ${formatShortDate(
      input.scheduledDate,
    )}`
  }

  if (input.locationType === 'HISTORY') return 'Dans l’historique'

  return 'Dans le pool'
}

export function buildMissionLocator(
  mission: MissionLocatorInput,
  referenceWeekStartDate: Date,
): MissionSearchResult {
  const poolInput = {
    status: mission.status,
    preparationStatus: mission.preparationStatus,
    pickupDate: mission.pickupDate,
    deliveryDate: mission.deliveryDate,
    assignment: mission.assignment ?? null,
    weekStart: referenceWeekStartDate,
    weekEnd: getWeekEndDate(referenceWeekStartDate),
  }

  const bucket = classifyPlanningPoolMission(poolInput)
  const locationType: SmartSearchLocationType =
    bucket === 'SCHEDULED'
      ? 'PLANNING'
      : bucket === 'HISTORY'
        ? 'HISTORY'
        : 'POOL'

  const scheduledDate =
    locationType === 'PLANNING'
      ? toDate(mission.assignment?.scheduledDate)
      : null
  const plannedEndAt = toDate(mission.assignment?.plannedEndAt)

  const weekStartDate = scheduledDate ? getWeekStartDate(scheduledDate) : null
  const weekDescription = weekStartDate
    ? describeWeekRelation(weekStartDate, referenceWeekStartDate)
    : null
  const day = scheduledDate ? getDispatchDayFromDate(scheduledDate) : null

  return {
    type: 'MISSION',
    id: mission.id,
    reference: mission.reference,
    clientReference: mission.clientReference ?? null,
    clientName: mission.clientName ?? null,
    cmrNumber: mission.cmrNumber ?? null,
    deliveryNoteNumber: mission.deliveryNoteNumber ?? null,
    pickupCity: mission.pickupCity ?? null,
    deliveryCity: mission.deliveryCity ?? null,
    locationType,
    bucket,
    bucketLabel: planningBucketCardLabels[bucket],
    situationLabel: buildMissionSituationLabel({
      locationType,
      day,
      scheduledDate,
    }),
    note: getPlanningBucketNote(poolInput, bucket, referenceWeekStartDate),
    weekStart: weekStartDate ? formatDateParam(weekStartDate) : null,
    weekRelation: weekDescription?.relation ?? null,
    weekRelationLabel: weekDescription?.label ?? null,
    day,
    dayLabel: day ? dayLabels[day] : null,
    scheduledDate: scheduledDate ? scheduledDate.toISOString() : null,
    spanLabel:
      scheduledDate && plannedEndAt && !isSameDay(scheduledDate, plannedEndAt)
        ? `Jusqu’au ${formatShortDate(plannedEndAt)}`
        : null,
    planningRowId: mission.assignment?.planningRowId ?? null,
    driverId: mission.assignment?.driverId ?? null,
    driverName: mission.assignment?.driverName ?? null,
    truckId: mission.assignment?.truckId ?? null,
    truckPlate: mission.assignment?.truckPlate ?? null,
    trailerId: mission.assignment?.trailerId ?? null,
    trailerPlate: mission.assignment?.trailerPlate ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* Locator Camion                                                      */
/* ------------------------------------------------------------------ */

export type TruckLocatorInput = {
  id: string
  plateNumber: string
  model?: string | null
  brand?: string | null
  status?: string | null
  /** Ligne Planning réellement présente dans la semaine consultée. */
  planningRow?: {
    id: string
    weekStartDate: Date | string
    driverId?: string | null
    driverName?: string | null
  } | null
  /** Chauffeur habituel, utilisé seulement à défaut de ligne Planning. */
  driverId?: string | null
  driverName?: string | null
  /** Remorque physiquement attelée (Trailer.truckId). */
  trailerId?: string | null
  trailerPlate?: string | null
}

export type TruckSearchResult = {
  type: 'TRUCK'
  id: string
  plateNumber: string
  model: string | null
  status: string
  statusLabel: string
  locationType: 'PLANNING' | 'POOL'
  planningRowId: string | null
  weekStart: string | null
  weekRelation: WeekRelation | null
  planningLabel: string
  driverId: string | null
  driverLabel: string
  trailerId: string | null
  trailerLabel: string
}

export function getTruckSearchFields(truck: TruckLocatorInput) {
  return [
    truck.plateNumber,
    truck.model,
    truck.brand,
    truck.planningRow?.driverName ?? truck.driverName,
  ]
}

export function buildTruckLocator(
  truck: TruckLocatorInput,
  referenceWeekStartDate: Date,
): TruckSearchResult {
  const rowWeekStart = truck.planningRow
    ? toDate(truck.planningRow.weekStartDate)
    : null
  const weekDescription = rowWeekStart
    ? describeWeekRelation(rowWeekStart, referenceWeekStartDate)
    : null
  const driverName = truck.planningRow
    ? truck.planningRow.driverName ?? null
    : truck.driverName ?? null
  const status = truck.status ?? 'AVAILABLE'

  return {
    type: 'TRUCK',
    id: truck.id,
    plateNumber: truck.plateNumber,
    model: truck.model ?? null,
    status,
    statusLabel:
      truckStatusLabels[status as keyof typeof truckStatusLabels] ?? status,
    locationType: truck.planningRow ? 'PLANNING' : 'POOL',
    planningRowId: truck.planningRow?.id ?? null,
    weekStart: rowWeekStart ? formatDateParam(rowWeekStart) : null,
    weekRelation: weekDescription?.relation ?? null,
    planningLabel: truck.planningRow
      ? [
          driverName ?? 'Aucun chauffeur affecté',
          rowWeekStart ? `semaine du ${formatShortDate(rowWeekStart)}` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : 'Non présent dans la grille cette semaine',
    driverId: truck.planningRow?.driverId ?? truck.driverId ?? null,
    driverLabel: driverName ?? 'Aucun chauffeur affecté',
    trailerId: truck.trailerId ?? null,
    trailerLabel: truck.trailerPlate ?? 'Aucune remorque attelée',
  }
}

/* ------------------------------------------------------------------ */
/* Locator Remorque                                                    */
/* ------------------------------------------------------------------ */

export type TrailerLocatorInput = TrailerSituationInput & {
  id: string
  plateNumber: string
  type?: string | null
  /** Chauffeur du camion tracteur, quand la remorque est attelée. */
  driverName?: string | null
}

export type TrailerSearchResult = {
  type: 'TRAILER'
  id: string
  plateNumber: string
  typeLabel: string | null
  /** Les quatre dimensions déjà implémentées, dans leur ordre d'affichage. */
  situationLines: string[]
  /** Résumé une ligne partagé avec les cartes du bandeau. */
  summary: string
  /** Filtre du bandeau Remorques à sélectionner pour retrouver la carte. */
  poolFilter: TrailerFilter
  coupling: TrailerSituation['coupling']
  load: TrailerSituation['load']
  engagement: TrailerSituation['engagement']
  location: TrailerSituation['location']
  immobilized: boolean
  truckId: string | null
  truckPlate: string | null
  driverName: string | null
  missionId: string | null
  missionReference: string | null
}

export function getTrailerSearchFields(trailer: TrailerLocatorInput) {
  return [
    trailer.plateNumber,
    trailer.type,
    trailer.type
      ? trailerTypeLabels[trailer.type as keyof typeof trailerTypeLabels]
      : null,
  ]
}

/**
 * Filtre du bandeau qui contient réellement la carte. L'ordre reflète la
 * dimension la plus discriminante : immobilisation, mission, chargement,
 * disponibilité, puis attelage. `matchesTrailerFilter()` reste l'unique juge.
 */
export function resolveTrailerPoolFilter(
  situation: TrailerSituation,
): TrailerFilter {
  const priority: TrailerFilter[] = [
    'MAINTENANCE',
    'ON_MISSION',
    'LOADED',
    'AVAILABLE',
    'DETACHED',
    'AT_BASE',
  ]

  const match = priority.find((filter) => matchesTrailerFilter(situation, filter))

  return match ?? 'ALL'
}

export function buildTrailerLocator(
  trailer: TrailerLocatorInput,
): TrailerSearchResult {
  const situation = resolveTrailerSituation(trailer)

  const situationLines: string[] = [trailerLoadLabels[situation.load]]

  if (situation.engagement === 'MISSION_ACTIVE' && situation.activeMission) {
    situationLines.push(`Mission ${situation.activeMission.missionReference}`)
  } else if (isTrailerAvailableForNewMission(situation)) {
    situationLines.push('Disponible')
  }

  situationLines.push(trailerLocationLabels[situation.location])

  if (situation.coupling === 'ATTACHED' && situation.truckPlate) {
    situationLines.push(`Attelée à ${situation.truckPlate}`)
  } else {
    situationLines.push(trailerCouplingLabels[situation.coupling])
  }

  if (situation.immobilized) situationLines.push('Immobilisée')

  return {
    type: 'TRAILER',
    id: trailer.id,
    plateNumber: trailer.plateNumber,
    typeLabel: trailer.type
      ? trailerTypeLabels[trailer.type as keyof typeof trailerTypeLabels] ??
        trailer.type
      : null,
    situationLines,
    summary: summarizeTrailerSituation(situation),
    poolFilter: resolveTrailerPoolFilter(situation),
    coupling: situation.coupling,
    load: situation.load,
    engagement: situation.engagement,
    location: situation.location,
    immobilized: situation.immobilized,
    truckId: trailer.truckId ?? null,
    truckPlate: situation.truckPlate,
    driverName:
      situation.coupling === 'ATTACHED' ? trailer.driverName ?? null : null,
    missionId: situation.activeMission?.missionId ?? null,
    missionReference: situation.activeMission?.missionReference ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* Réponse                                                             */
/* ------------------------------------------------------------------ */

export type SmartSearchResponse = {
  query: string
  weekStart: string
  missions: MissionSearchResult[]
  trucks: TruckSearchResult[]
  trailers: TrailerSearchResult[]
}

export function isSmartSearchEmpty(response: SmartSearchResponse | null) {
  if (!response) return true
  return (
    response.missions.length === 0 &&
    response.trucks.length === 0 &&
    response.trailers.length === 0
  )
}
