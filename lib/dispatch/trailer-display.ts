import type { TrailerLocation } from './trailer-rotation'
import {
  isActiveMission,
  isTrailerAvailableForNewMission,
  resolveCurrentTruckIdForTrailer,
  resolveTrailerSituation,
  trailerLocationLabels,
} from './trailer-rotation'
import type { TrailerActiveMission } from './trailer-rotation'
import { getVehicleDisplayStatus } from './maintenance-display'
import type {
  Trailer,
  TrailerCargoType,
  TrailerLoadStatus,
} from './mock-data'

export const trailerLoadStatusLabels: Record<TrailerLoadStatus, string> = {
  EMPTY: 'Vide',
  LOADED: 'Chargée',
}

export const trailerCargoTypeLabels: Record<TrailerCargoType, string> = {
  WOOD: 'Bois',
  ALUMINIUM: 'Aluminium',
  STEEL: 'Acier',
  PALLETS: 'Palettes',
  CONSTRUCTION_MATERIALS: 'Matériaux',
  FOOD: 'Alimentaire',
  MACHINERY: 'Machines',
  TEXTILE: 'Textile',
  CHEMICALS: 'Sensible',
  OTHER: 'Autre',
}

const cargoStyles: Record<
  TrailerCargoType | 'EMPTY',
  {
    card: string
    badge: string
    text: string
  }
> = {
  EMPTY: {
    card: 'border-black/10 bg-white/95',
    badge: 'bg-[#F4F5F1] text-[#4f5549]',
    text: 'text-[#6b7065]',
  },
  WOOD: {
    card: 'border-amber-200 bg-amber-50',
    badge: 'bg-amber-200 text-amber-950',
    text: 'text-amber-950',
  },
  ALUMINIUM: {
    card: 'border-zinc-300 bg-zinc-100',
    badge: 'bg-zinc-300 text-zinc-950',
    text: 'text-zinc-950',
  },
  STEEL: {
    card: 'border-slate-300 bg-slate-100',
    badge: 'bg-slate-300 text-slate-950',
    text: 'text-slate-950',
  },
  PALLETS: {
    card: 'border-orange-200 bg-orange-50',
    badge: 'bg-orange-200 text-orange-950',
    text: 'text-orange-950',
  },
  CONSTRUCTION_MATERIALS: {
    card: 'border-orange-300 bg-orange-100',
    badge: 'bg-orange-300 text-orange-950',
    text: 'text-orange-950',
  },
  FOOD: {
    card: 'border-emerald-200 bg-emerald-50',
    badge: 'bg-emerald-200 text-emerald-950',
    text: 'text-emerald-950',
  },
  MACHINERY: {
    card: 'border-neutral-300 bg-neutral-100',
    badge: 'bg-neutral-300 text-neutral-950',
    text: 'text-neutral-950',
  },
  TEXTILE: {
    card: 'border-violet-200 bg-violet-50',
    badge: 'bg-violet-200 text-violet-950',
    text: 'text-violet-950',
  },
  CHEMICALS: {
    card: 'border-red-200 bg-red-50',
    badge: 'bg-red-200 text-red-950',
    text: 'text-red-950',
  },
  OTHER: {
    card: 'border-stone-300 bg-stone-100',
    badge: 'bg-stone-300 text-stone-950',
    text: 'text-stone-950',
  },
}

export function getTrailerCargoStyle(trailer?: Trailer | null) {
  if (!trailer || (trailer.loadStatus ?? 'EMPTY') === 'EMPTY') {
    return cargoStyles.EMPTY
  }

  return cargoStyles[trailer.cargoType ?? 'OTHER']
}

export function getTrailerLoadLabel(trailer: Trailer) {
  return trailerLoadStatusLabels[trailer.loadStatus ?? 'EMPTY']
}

export function getTrailerCargoLabel(trailer: Trailer) {
  if ((trailer.loadStatus ?? 'EMPTY') === 'EMPTY') {
    return null
  }

  return trailerCargoTypeLabels[trailer.cargoType ?? 'OTHER']
}

/**
 * Présentation opérationnelle courante. Ne mute jamais un statut persisté.
 *
 * Quand une mission est EN COURS, c'est elle qui porte la vérité du moment :
 * son tracteur devient le tracteur actuel et la remorque est en transit, même
 * si l'attelage physique n'a pas encore été constaté. `Trailer.truckId` reste
 * la preuve secondaire, et la seule qui compte hors mission active.
 */
export function getTrailerOperationalPresentation(
  trailer: Trailer,
  activeMission?: TrailerActiveMission | null,
  truckPlate?: string | null,
  /** Résolution d'une plaque depuis un identifiant : simple lecture, aucune
   * règle de priorité n'est réécrite par l'appelant. */
  getTruckPlate?: (truckId: string) => string | null | undefined,
) {
  const engaged = isActiveMission(activeMission)
    && ['IN_PROGRESS', 'ISSUE'].includes(activeMission.missionStatus?.toUpperCase() ?? '')
    ? activeMission
    : null
  const currentTruckId = resolveCurrentTruckIdForTrailer({
    activeMission: engaged,
    physicalTruckId: trailer.truckId,
  })
  const currentTruckPlate =
    (currentTruckId ? getTruckPlate?.(currentTruckId) : null) ??
    (currentTruckId && currentTruckId === trailer.truckId ? truckPlate : null) ??
    engaged?.truckPlate ??
    null
  // `situation` garde la vérité PHYSIQUE : son attelage reste `Trailer.truckId`.
  const situation = resolveTrailerSituation({
    ...trailer,
    truckPlate,
    activeMission: engaged,
    declaredLocation: trailer.currentLocationLat != null && trailer.currentLocationLng != null ? 'OTHER' : null,
  })
  // Seule la localisation PRÉSENTÉE suit la mission en cours : sans cela une
  // remorque « Engagée » s'affichait « À la base » avec « Aucun camion ».
  const location: TrailerLocation =
    engaged && currentTruckId ? 'IN_TRANSIT' : situation.location
  const available = isTrailerAvailableForNewMission(situation)
  const label = trailer.status === 'OUT_OF_SERVICE' ? 'Retirée du parc actif'
    : situation.immobilized ? 'Maintenance'
    : situation.activeMission ? 'Engagée'
    : available ? 'Disponible' : 'Indisponible'
  const status = getVehicleDisplayStatus({
    baseStatusLabel: label,
    baseStatusKind: trailer.status === 'OUT_OF_SERVICE' ? 'outOfService'
      : situation.immobilized ? 'maintenance'
      : situation.activeMission ? 'assigned' : available ? 'available' : 'neutral',
    activeMaintenance: trailer.activeMaintenance,
  })
  // L'attelage physique n'est affirmé que si `Trailer.truckId` le prouve ;
  // sinon la remorque est seulement associée au tracteur par la mission.
  const physicalAttachmentConfirmed = Boolean(trailer.truckId)
  const couplingLabel = physicalAttachmentConfirmed
    ? 'Attelée'
    : engaged
      ? 'Attelage physique non confirmé'
      : 'Décrochée'
  return {
    situation,
    status,
    location,
    locationLabel: trailerLocationLabels[location],
    // Une remorque engagée ou attelée ne propose pas de localisation éditable
    // qui contredirait son état courant.
    locationEditable: !trailer.truckId && !engaged,
    activeMission: engaged,
    currentTruckId,
    currentTruckPlate,
    physicalAttachmentConfirmed,
    couplingLabel,
    /** Localisation persistée, valable seulement une fois décrochée. */
    detachedLocationLabel: trailer.currentLocationAddress ?? 'À la base',
  }
}
