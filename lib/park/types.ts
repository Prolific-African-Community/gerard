import type { ParkMovementAction, ParkSpotType, ParkVehicleType } from '@prisma/client'

/**
 * Statut fonctionnel d'un véhicule sur le module Parc.
 * Seuls les véhicules physiquement présents à la Base sont sérialisés.
 * `TO_POSITION` est un état normal : le véhicule est sur site mais aucune
 * place physique ne lui a encore été attribuée.
 */
export type ParkVehicleStatus =
  | 'ON_PARK'
  | 'MAINTENANCE'
  | 'TO_POSITION'

export const PARK_STATUS_LABELS: Record<ParkVehicleStatus, string> = {
  ON_PARK: 'Positionné',
  MAINTENANCE: 'Maintenance à la Base',
  TO_POSITION: 'À positionner',
}

export type ParkVehicleDTO = {
  id: string
  type: ParkVehicleType
  plateNumber: string
  status: ParkVehicleStatus
  /** Code de l'emplacement occupé, si le véhicule est sur le parc. */
  spotId: string | null
  spotCode: string | null
  /** Camion : chauffeur associé. */
  driverName: string | null
  /** Remorque : type de remorque lisible. */
  trailerType: string | null
  /** Relation d'attelage existante, utilisée pour présenter les ensembles. */
  linkedTruckId: string | null
  linkedTrailerId: string | null
  linkedPlateNumber: string | null
  /** Vrai s'il existe une intervention de maintenance active. */
  hasActiveMaintenance: boolean
  /** Emplacement déplaçable par l'utilisateur courant (droits + non verrouillé). */
  movable: boolean
}

export type ParkSpotDTO = {
  id: string
  code: string
  zone: string
  zoneLabel: string
  label: string
  type: ParkSpotType
  posX: number
  posY: number
  width: number
  height: number
  rotation: number
  capacity: number
  isActive: boolean
  truckId: string | null
  trailerId: string | null
  occupiedAt: string | null
  placedByName: string | null
  note: string | null
}

export type ParkKpis = {
  vehiclesOnPark: number
  trucksOnPark: number
  trailersOnPark: number
  spotsOccupied: number
  spotsAvailable: number
  spotsTotal: number
  vehiclesOnMission: number
  vehiclesInMaintenance: number
  vehiclesToPosition: number
}

export type ParkMovementDTO = {
  id: string
  vehicleType: ParkVehicleType
  truckId: string | null
  trailerId: string | null
  plateNumber: string
  action: ParkMovementAction
  fromSpotCode: string | null
  toSpotCode: string | null
  actorName: string | null
  note: string | null
  createdAt: string
}

export type ParkCapabilities = {
  canView: boolean
  canMove: boolean
  canViewHistory: boolean
  canViewInspections: boolean
  canManageInspections: boolean
}

export type ParkOverviewDTO = {
  spots: ParkSpotDTO[]
  vehicles: ParkVehicleDTO[]
  kpis: ParkKpis
  capabilities: ParkCapabilities
  recentHistory: ParkMovementDTO[]
}
