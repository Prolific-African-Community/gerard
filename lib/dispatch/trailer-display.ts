import { resolveTrailerSituation, isTrailerAvailableForNewMission, trailerLocationLabels } from './trailer-rotation'
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

/** Current operational presentation, never a persisted status mutation. */
export function getTrailerOperationalPresentation(
  trailer: Trailer,
  activeMission?: TrailerActiveMission | null,
  truckPlate?: string | null,
) {
  const situation = resolveTrailerSituation({
    ...trailer, truckPlate, activeMission: activeMission && ['IN_PROGRESS', 'ISSUE'].includes(activeMission.missionStatus?.toUpperCase() ?? '') ? activeMission : null,
    declaredLocation: trailer.currentLocationLat != null && trailer.currentLocationLng != null ? 'OTHER' : null,
  })
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
  return { situation, status, locationLabel: trailerLocationLabels[situation.location], locationEditable: !trailer.truckId }
}
