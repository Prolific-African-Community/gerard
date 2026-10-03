import { resolveTrailerPosition } from './trailer-position'

/**
 * Modèle de rotation des remorques.
 *
 * Le schéma actuel porte déjà les cinq dimensions métier, mais mélangées
 * dans `Trailer.status` et `Trailer.custodyState`. Ce module les **dérive**
 * des champs existants plutôt que d'en ajouter : aucune migration n'est
 * nécessaire et aucun historique n'est perdu.
 *
 *   A. Attelage    ← `Trailer.truckId`
 *   B. Chargement  ← `Trailer.loadStatus`
 *   C. Mission     ← MissionAssignment active portant cette remorque
 *   D. Localisation← `parkSpot` / `status = AT_BASE` / attelage
 *   E. Disponibilité← dérivée des quatre dimensions précédentes
 *
 * `Trailer.status` conserve son rôle pour la seule dimension qu'il décrit
 * correctement : l'indisponibilité opérationnelle (maintenance, hors service).
 */

export type TrailerCoupling = 'ATTACHED' | 'DETACHED'
export type TrailerLoad = 'EMPTY' | 'LOADED'
export type TrailerEngagement = 'AVAILABLE' | 'MISSION_ACTIVE'
export type TrailerLocation =
  | 'BASE'
  | 'CLIENT'
  | 'IN_TRANSIT'
  | 'OTHER'
  | 'UNKNOWN'

/** Statuts qui immobilisent réellement la remorque. */
const IMMOBILIZING_STATUSES = new Set([
  'IN_MAINTENANCE',
  'MAINTENANCE_EXT',
  'OUT_OF_SERVICE',
])

/** Statuts de mission qui ne constituent plus un engagement. */
const TERMINAL_MISSION_STATUSES = new Set(['DONE', 'CANCELLED', 'ARCHIVED'])

export type TrailerActiveMission = {
  missionId: string
  missionReference: string
  missionStatus?: string | null
  driverId?: string | null
  driverName?: string | null
  truckId?: string | null
  truckPlate?: string | null
}

export type TrailerSituationInput = {
  id?: string
  plateNumber?: string
  /** Attelage physique courant. `null` = décrochée. */
  truckId?: string | null
  truckPlate?: string | null
  loadStatus?: string | null
  status?: string | null
  cargoType?: string | null
  cargoDescription?: string | null
  /** Emplacement de parc occupé, preuve de présence à la base. */
  parkSpotCode?: string | null
  /** Localisation explicitement déclarée lors d'un décrochage. */
  declaredLocation?: TrailerLocation | null
  /** Mission réellement en cours portée par cette remorque. */
  activeMission?: TrailerActiveMission | null
}

export type TrailerSituation = {
  coupling: TrailerCoupling
  load: TrailerLoad
  engagement: TrailerEngagement
  location: TrailerLocation
  /** Maintenance ou hors service : la remorque ne peut pas rouler. */
  immobilized: boolean
  activeMission: TrailerActiveMission | null
  truckPlate: string | null
}

/**
 * Une mission ne compte comme engagement que si elle n'est pas terminée.
 * Le décrochage ne termine jamais une mission : la remorque reste engagée.
 */
export function isActiveMission(
  mission: TrailerActiveMission | null | undefined
): mission is TrailerActiveMission {
  if (!mission) return false
  const status = mission.missionStatus?.toUpperCase() ?? 'PENDING'
  return !TERMINAL_MISSION_STATUSES.has(status)
}

export function resolveTrailerSituation(
  input: TrailerSituationInput
): TrailerSituation {
  const coupling: TrailerCoupling = input.truckId ? 'ATTACHED' : 'DETACHED'
  const load: TrailerLoad = input.loadStatus === 'LOADED' ? 'LOADED' : 'EMPTY'
  const activeMission = isActiveMission(input.activeMission)
    ? input.activeMission
    : null
  const engagement: TrailerEngagement = activeMission
    ? 'MISSION_ACTIVE'
    : 'AVAILABLE'

  const locationResolution = resolveTrailerPosition({
    attached: Boolean(input.truckId),
    attachedTruckPosition: input.truckId
      ? {
          id: `TRUCK:${input.truckId}`,
          label: input.truckPlate ?? 'Tracteur',
          latitude: 0,
          longitude: 0,
        }
      : null,
    explicitPosition: input.declaredLocation
      ? {
          id: `DECLARED:${input.declaredLocation}`,
          label: input.declaredLocation,
          latitude: 0,
          longitude: 0,
        }
      : null,
    parkSpotCode: input.parkSpotCode,
    status: input.status,
    operatingBase: { latitude: 0, longitude: 0, label: 'Base' },
    loadStatus: input.loadStatus,
    hasActiveMission: Boolean(activeMission),
  })
  const location: TrailerLocation =
    locationResolution.source === 'ATTACHED_TRUCK'
      ? 'IN_TRANSIT'
      : locationResolution.source === 'MANUAL' && input.declaredLocation
      ? input.declaredLocation
      : ['PARK_SPOT', 'STATUS_BASE', 'IDLE_BASE_FALLBACK'].includes(
          locationResolution.source
        )
      ? 'BASE'
      : 'UNKNOWN'

  return {
    coupling,
    load,
    engagement,
    location,
    immobilized: IMMOBILIZING_STATUSES.has(input.status ?? ''),
    activeMission,
    truckPlate: input.truckId ? input.truckPlate ?? null : null,
  }
}

/* ------------------------------------------------------------------ */
/* Invariants                                                          */
/* ------------------------------------------------------------------ */

/**
 * Invariant 4 : une remorque chargée ou engagée sur une mission active n'est
 * jamais « disponible », même déclarée À la Base.
 */
export function isTrailerAvailableForNewMission(situation: TrailerSituation) {
  return (
    !situation.immobilized &&
    situation.engagement === 'AVAILABLE' &&
    situation.load === 'EMPTY'
  )
}

/**
 * Invariant 2 : une remorque n'apparaît dans la colonne Remorque d'une ligne
 * Planning que si elle est physiquement attelée au tracteur de cette ligne.
 */
export function isTrailerVisibleOnPlanningRow(
  trailer: { truckId?: string | null } | null | undefined,
  rowTruckId: string | null | undefined
) {
  if (!trailer) return false
  if (!trailer.truckId) return false
  if (!rowTruckId) return false
  return trailer.truckId === rowTruckId
}

/**
 * Invariant 6 : atteler une remorque déjà engagée continue la mission
 * existante. Retourne la mission à reprendre, ou `null` si l'attelage est
 * une simple prise de remorque libre.
 */
export function getMissionToResume(situation: TrailerSituation) {
  return situation.engagement === 'MISSION_ACTIVE'
    ? situation.activeMission
    : null
}

/* ------------------------------------------------------------------ */
/* Filtres du pool                                                     */
/* ------------------------------------------------------------------ */

export type TrailerFilter =
  | 'ALL'
  | 'AVAILABLE'
  | 'LOADED'
  | 'ON_MISSION'
  | 'DETACHED'
  | 'AT_BASE'
  | 'MAINTENANCE'

export const trailerFilterOrder: TrailerFilter[] = [
  'ALL',
  'AVAILABLE',
  'LOADED',
  'ON_MISSION',
  'DETACHED',
  'AT_BASE',
  'MAINTENANCE',
]

export const trailerFilterLabels: Record<TrailerFilter, string> = {
  ALL: 'Toutes',
  AVAILABLE: 'Disponibles',
  LOADED: 'Chargées',
  ON_MISSION: 'En mission',
  DETACHED: 'Décrochées',
  AT_BASE: 'À la base',
  MAINTENANCE: 'Maintenance',
}

/** Les filtres sont dérivés : aucun n'est un statut persisté supplémentaire. */
export function matchesTrailerFilter(
  situation: TrailerSituation,
  filter: TrailerFilter
) {
  switch (filter) {
    case 'ALL':
      return true
    case 'AVAILABLE':
      return isTrailerAvailableForNewMission(situation)
    case 'LOADED':
      return situation.load === 'LOADED'
    case 'ON_MISSION':
      return situation.engagement === 'MISSION_ACTIVE'
    case 'DETACHED':
      return situation.coupling === 'DETACHED'
    case 'AT_BASE':
      return situation.location === 'BASE'
    case 'MAINTENANCE':
      return situation.immobilized
  }
}

export function countTrailerFilters<T>(
  entries: Array<{ situation: TrailerSituation; item: T }>
) {
  const counts = {} as Record<TrailerFilter, number>
  for (const filter of trailerFilterOrder) {
    counts[filter] = entries.filter((entry) =>
      matchesTrailerFilter(entry.situation, filter)
    ).length
  }
  return counts
}

/* ------------------------------------------------------------------ */
/* Présentation                                                        */
/* ------------------------------------------------------------------ */

export const trailerCouplingLabels: Record<TrailerCoupling, string> = {
  ATTACHED: 'Attelée',
  DETACHED: 'Décrochée',
}

export const trailerLoadLabels: Record<TrailerLoad, string> = {
  EMPTY: 'Vide',
  LOADED: 'Chargée',
}

export const trailerLocationLabels: Record<TrailerLocation, string> = {
  BASE: 'À la base',
  CLIENT: 'Chez le client',
  IN_TRANSIT: 'En transit',
  OTHER: 'Autre',
  UNKNOWN: 'Inconnue',
}

/**
 * Résumé de situation en une ligne, sans jamais laisser croire qu'une
 * remorque chargée en mission est disponible.
 */
export function summarizeTrailerSituation(situation: TrailerSituation) {
  const parts: string[] = [trailerLoadLabels[situation.load]]

  if (situation.engagement === 'MISSION_ACTIVE' && situation.activeMission) {
    parts.push(`Mission ${situation.activeMission.missionReference}`)
  } else if (isTrailerAvailableForNewMission(situation)) {
    parts.push('Disponible')
  }

  parts.push(trailerLocationLabels[situation.location])

  if (situation.coupling === 'ATTACHED' && situation.truckPlate) {
    parts.push(`Attelée à ${situation.truckPlate}`)
  } else if (situation.coupling === 'DETACHED') {
    parts.push('Décrochée')
  }

  if (situation.immobilized) parts.push('Immobilisée')

  return parts.join(' · ')
}

/** Actions cohérentes avec la situation courante. */
export function getTrailerActions(situation: TrailerSituation) {
  return {
    canDetach: situation.coupling === 'ATTACHED',
    canAttach: situation.coupling === 'DETACHED' && !situation.immobilized,
    canMarkEmpty: situation.load === 'LOADED',
    canChangeLocation: situation.coupling === 'DETACHED',
    canOpenMission: situation.engagement === 'MISSION_ACTIVE',
    /** Reprendre la mission déjà portée par la remorque. */
    resumesMission:
      situation.coupling === 'DETACHED' &&
      situation.engagement === 'MISSION_ACTIVE',
  }
}

/* ------------------------------------------------------------------ */
/* Lisibilité de l'historique                                          */
/* ------------------------------------------------------------------ */

export type TrailerRotationEventDescription = {
  /** Libellé métier affiché à la place du type technique. */
  label: string
  message: string
}

function readString(source: Record<string, unknown>, key: string) {
  const value = source[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * Traduit un MissionEvent technique en phrase métier.
 *
 * Les rotations sont journalisées via `NOTE_ADDED` faute de type dédié dans
 * l'enum Prisma : exposer « Note ajoutée » masquerait l'action réelle.
 * Retourne `null` quand l'événement n'est pas une rotation de remorque.
 */
export function describeTrailerRotationEvent(
  metadata: unknown
): TrailerRotationEventDescription | null {
  if (typeof metadata !== 'object' || metadata === null) return null
  const source = metadata as Record<string, unknown>
  const action = readString(source, 'action')
  if (action !== 'DETACH' && action !== 'RESUME') return null

  const plate = readString(source, 'trailerPlate') ?? 'La remorque'
  const location = readString(source, 'location')
  const driverName = readString(source, 'driverName')
  const truckPlate = readString(source, 'truckPlate')

  if (action === 'DETACH') {
    const where = location
      ? ` ${
          trailerLocationLabels[location as TrailerLocation]?.toLowerCase() ??
          location
        }`
      : ''
    return {
      label: 'Remorque décrochée',
      message: `Remorque ${plate} décrochée${where}.`,
    }
  }

  const by = [driverName, truckPlate].filter(Boolean).join(' / ')
  return {
    label: 'Mission reprise',
    message: `Mission reprise avec ${plate}${by ? ` par ${by}` : ''}.`,
  }
}

export type TrailerCustodyMovement = {
  id: string
  occurredAt: string
  note?: string | null
  location?: string | null
  fromDriverName?: string | null
  toDriverName?: string | null
  missionReference?: string | null
  truckPlate?: string | null
}

/** Ligne compacte pour la section « Derniers mouvements ». */
export function formatTrailerMovement(movement: TrailerCustodyMovement) {
  const parts: string[] = []

  if (movement.note) parts.push(movement.note)
  if (movement.missionReference) {
    parts.push(`Mission ${movement.missionReference}`)
  }
  if (movement.truckPlate) parts.push(movement.truckPlate)

  const driver = movement.toDriverName ?? movement.fromDriverName
  if (driver) parts.push(driver)

  if (movement.location) {
    parts.push(
      trailerLocationLabels[movement.location as TrailerLocation] ??
        movement.location
    )
  }

  return parts.join(' · ')
}

/* ------------------------------------------------------------------ */
/* Dérivation partagée desktop / mobile                                */
/* ------------------------------------------------------------------ */

/** Statut retenu quand la représentation de mission ne porte pas `status`. */
export const UNKNOWN_MISSION_STATUS = 'UNKNOWN'

/**
 * Normalise un statut de mission quelle que soit sa casse ou son absence.
 *
 * Le Planning manipule des statuts en minuscules (`'done'`) et l'API des
 * statuts Prisma en majuscules (`'DONE'`) ; certaines représentations
 * allégées n'en portent aucun. Aucune garantie de type ne peut donc être
 * faite au runtime : `.toUpperCase()` doit toujours être gardé.
 */
export function normalizeMissionStatus(status: unknown): string {
  return typeof status === 'string' && status.trim()
    ? status.trim().toUpperCase()
    : UNKNOWN_MISSION_STATUS
}

export function isTerminalMissionStatus(status: unknown) {
  return TERMINAL_MISSION_STATUSES.has(normalizeMissionStatus(status))
}

export type TrailerMissionSource = {
  id: string
  reference: string
  /** Volontairement `unknown` : aucune source ne garantit ce champ. */
  status?: unknown
}

/**
 * Affectation telle que les surfaces la connaissent. La forme courte (un
 * identifiant de remorque) reste acceptée pour les appels qui n'ont que cela.
 */
export type TrailerMissionAssignment =
  | string
  | {
      trailerId?: string | null
      driverId?: string | null
      truckId?: string | null
    }

/**
 * Construit la table remorque → mission active, partagée par le desktop et le
 * mobile.
 *
 * Seule une mission commencée (ou en incident) porte l'engagement courant.
 * Une affectation future ne change jamais la situation physique actuelle.
 */
export function buildTrailerActiveMissions<T extends TrailerMissionSource>(
  missions: readonly T[],
  getAssignment: (mission: T) => TrailerMissionAssignment | null | undefined
): Record<string, TrailerActiveMission> {
  const byTrailer: Record<string, TrailerActiveMission> = {}

  for (const mission of missions) {
    const assignment = getAssignment(mission)
    const trailerId =
      typeof assignment === 'string' ? assignment : assignment?.trailerId
    if (!trailerId) continue

    // L'affectation seule ne prouve pas que l'exécution a commencé.
    if (!['IN_PROGRESS', 'ISSUE'].includes(normalizeMissionStatus(mission.status))) continue

    byTrailer[trailerId] = {
      missionId: mission.id,
      missionReference: mission.reference,
      missionStatus: normalizeMissionStatus(mission.status),
      // Le couple qui exécute la mission en cours : c'est lui qui fait foi
      // pour la présentation « actuelle », l'attelage physique pouvant ne pas
      // avoir encore été constaté.
      driverId: typeof assignment === 'string' ? null : assignment?.driverId ?? null,
      truckId: typeof assignment === 'string' ? null : assignment?.truckId ?? null,
    }
  }

  return byTrailer
}

/**
 * Remorque « actuelle » d'un tracteur, pour la présentation seulement.
 *
 * Ordre de preuve :
 *   1. la remorque de la mission EN COURS de ce tracteur ;
 *   2. l'attelage physique persisté (`Trailer.truckId`) ;
 *   3. aucune.
 *
 * Une affectation future ne remonte jamais ici : `activeMissionsByTrailerId`
 * ne contient que des missions commencées. Rien n'est muté : constater
 * l'attelage physique reste un acte d'exploitation distinct.
 */
export function resolveCurrentTrailerIdForTruck(input: {
  truckId: string | null | undefined
  activeMissionsByTrailerId: Record<string, TrailerActiveMission>
  physicalTrailerId?: string | null
}) {
  if (!input.truckId) return null
  for (const [trailerId, mission] of Object.entries(
    input.activeMissionsByTrailerId
  )) {
    if (mission.truckId && mission.truckId === input.truckId) return trailerId
  }
  return input.physicalTrailerId ?? null
}

/**
 * Tracteur « actuel » d'une remorque, même ordre de preuve que ci-dessus.
 */
export function resolveCurrentTruckIdForTrailer(input: {
  activeMission?: TrailerActiveMission | null
  physicalTruckId?: string | null
}) {
  if (isActiveMission(input.activeMission) && input.activeMission.truckId) {
    return input.activeMission.truckId
  }
  return input.physicalTruckId ?? null
}
