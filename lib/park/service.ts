import {
  MaintenanceRequestStatus,
  ParkMovementAction,
  ParkVehicleType,
  TrailerStatus,
  TrailerType,
  TruckStatus,
  UserRole,
} from '@prisma/client'
import type { Prisma } from '@prisma/client'

import { prisma } from '../prisma'
import { hasPermission, permissions } from '../auth/permissions'
import { zoneLabel } from './site-plan'
import type {
  ParkCapabilities,
  ParkMovementDTO,
  ParkOverviewDTO,
  ParkSpotDTO,
  ParkVehicleDTO,
  ParkVehicleStatus,
} from './types'

/* -------------------------------------------------------------------------- */
/* Règles de statut (documentées)                                             */
/* -------------------------------------------------------------------------- */

/** Statuts camion considérés « en mission opérationnelle ». */
const TRUCK_MISSION_STATUSES: ReadonlySet<TruckStatus> = new Set([
  TruckStatus.EN_ROUTE_TO_PICKUP,
  TruckStatus.AT_PICKUP,
  TruckStatus.ON_MISSION,
  TruckStatus.RETURNING_TO_BASE,
])

/** Interventions de maintenance considérées « actives » (non terminales). */
const ACTIVE_MAINTENANCE_STATUSES: MaintenanceRequestStatus[] = [
  MaintenanceRequestStatus.SUBMITTED,
  MaintenanceRequestStatus.RECEIVED,
  MaintenanceRequestStatus.UNDER_REVIEW,
  MaintenanceRequestStatus.QUOTE_RECEIVED,
  MaintenanceRequestStatus.QUOTE_APPROVED,
  MaintenanceRequestStatus.SCHEDULED,
  MaintenanceRequestStatus.IN_PROGRESS,
]

const TRAILER_TYPE_LABELS: Record<TrailerType, string> = {
  CURTAINSIDER: 'Tautliner',
  FLATBED: 'Plateau',
  REFRIGERATED: 'Frigorifique',
  CONTAINER: 'Porte-conteneur',
  BOX: 'Fourgon',
  OTHER: 'Autre',
}

/**
 * Seuls les véhicules physiquement présents à la Base atteignent cette étape.
 * Une maintenance à la Base reste visible ; une maintenance extérieure est
 * exclue en amont par `truckIsAtBase` / `trailerIsAtBase`.
 */
function computeStatus(input: {
  hasActiveMaintenance: boolean
  vehicleStatusMaintenance: boolean
  onSpot: boolean
}): ParkVehicleStatus {
  if (input.hasActiveMaintenance || input.vehicleStatusMaintenance)
    return 'MAINTENANCE'
  if (input.onSpot) return 'ON_PARK'
  return 'TO_POSITION'
}

function truckIsAtBase(status: TruckStatus): boolean {
  return (
    status === TruckStatus.AT_BASE ||
    status === TruckStatus.IN_MAINTENANCE
  )
}

function trailerIsAtBase(status: TrailerStatus): boolean {
  // La disponibilité opérationnelle et la présence physique sont deux notions
  // distinctes. Ni AVAILABLE, ni la relation au camion ne prouvent une présence
  // sur le site de Sedan.
  return (
    status === TrailerStatus.AT_BASE ||
    status === TrailerStatus.IN_MAINTENANCE
  )
}

/** Libère et historise toute place dont le véhicule a quitté la Base. */
export async function synchronizeParkPresence(): Promise<void> {
  const occupiedSpots = await prisma.parkSpot.findMany({
    where: { OR: [{ truckId: { not: null } }, { trailerId: { not: null } }] },
    include: { truck: true, trailer: true },
  })

  const stale = occupiedSpots.flatMap((spot) => {
    const items: Array<{
      field: 'truckId' | 'trailerId'
      vehicleType: ParkVehicleType
      vehicleId: string
      plateNumber: string
      note: string
    }> = []
    if (spot.truck && !truckIsAtBase(spot.truck.status)) {
      items.push({
        field: 'truckId', vehicleType: ParkVehicleType.TRUCK,
        vehicleId: spot.truck.id, plateNumber: spot.truck.plateNumber,
        note: 'Retrait automatique : le camion n’est plus déclaré à la Base.',
      })
    }
    if (spot.trailer && !trailerIsAtBase(spot.trailer.status)) {
      items.push({
        field: 'trailerId', vehicleType: ParkVehicleType.TRAILER,
        vehicleId: spot.trailer.id, plateNumber: spot.trailer.plateNumber,
        note: `Retrait automatique : la remorque n’est plus déclarée à la Base (statut ${spot.trailer.status}).`,
      })
    }
    return items.map((item) => ({ spot, ...item }))
  })

  if (stale.length === 0) return

  await prisma.$transaction(async (tx) => {
    for (const item of stale) {
      const current = await tx.parkSpot.findUnique({ where: { id: item.spot.id } })
      if (!current || current[item.field] !== item.vehicleId) continue
      const otherOccupied = item.field === 'truckId' ? current.trailerId : current.truckId
      await tx.parkSpot.update({
        where: { id: current.id },
        data: {
          [item.field]: null,
          ...(otherOccupied ? {} : { occupiedAt: null, placedById: null, note: null }),
        },
      })
      await tx.parkMovement.create({
        data: {
          vehicleType: item.vehicleType,
          truckId: item.vehicleType === ParkVehicleType.TRUCK ? item.vehicleId : null,
          trailerId: item.vehicleType === ParkVehicleType.TRAILER ? item.vehicleId : null,
          plateNumber: item.plateNumber,
          action: ParkMovementAction.REMOVE,
          fromSpotId: current.id,
          fromSpotCode: current.code,
          actorName: 'Synchronisation Dispatch',
          note: item.note,
        },
      })
    }
  })
}

export function getParkCapabilities(role: UserRole): ParkCapabilities {
  const user = { role, isActive: true }
  return {
    canView: hasPermission(user, permissions.parkView),
    canMove: hasPermission(user, permissions.parkMove),
    canViewHistory: hasPermission(user, permissions.parkHistoryView),
    canViewInspections: hasPermission(user, permissions.parkInspectionView),
    canManageInspections: hasPermission(user, permissions.parkInspectionManage),
  }
}

/* -------------------------------------------------------------------------- */
/* Sérialisation                                                              */
/* -------------------------------------------------------------------------- */

type SpotWithRelations = Prisma.ParkSpotGetPayload<{
  include: { placedBy: true }
}>

function serializeSpot(spot: SpotWithRelations): ParkSpotDTO {
  const placedByName = spot.placedBy
    ? spot.placedBy.firstName.trim()
      ? `${spot.placedBy.firstName} ${spot.placedBy.lastName}`.trim()
      : spot.placedBy.username
    : null
  return {
    id: spot.id,
    code: spot.code,
    zone: spot.zone,
    zoneLabel: zoneLabel(spot.zone),
    label: spot.label,
    type: spot.type,
    posX: spot.posX,
    posY: spot.posY,
    width: spot.width,
    height: spot.height,
    rotation: spot.rotation,
    capacity: spot.capacity,
    isActive: spot.isActive,
    truckId: spot.truckId,
    trailerId: spot.trailerId,
    occupiedAt: spot.occupiedAt ? spot.occupiedAt.toISOString() : null,
    placedByName,
    note: spot.note,
  }
}

function serializeMovement(movement: {
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
  createdAt: Date
}): ParkMovementDTO {
  return {
    id: movement.id,
    vehicleType: movement.vehicleType,
    truckId: movement.truckId,
    trailerId: movement.trailerId,
    plateNumber: movement.plateNumber,
    action: movement.action,
    fromSpotCode: movement.fromSpotCode,
    toSpotCode: movement.toSpotCode,
    actorName: movement.actorName,
    note: movement.note,
    createdAt: movement.createdAt.toISOString(),
  }
}

/* -------------------------------------------------------------------------- */
/* Vue d'ensemble                                                             */
/* -------------------------------------------------------------------------- */

export async function buildParkOverview(
  role: UserRole
): Promise<ParkOverviewDTO> {
  await synchronizeParkPresence()
  const capabilities = getParkCapabilities(role)

  const [spots, trucks, trailers, activeMaintenance, recentMovements] =
    await Promise.all([
      prisma.parkSpot.findMany({
        include: { placedBy: true },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.truck.findMany({ include: { driver: true } }),
      prisma.trailer.findMany(),
      prisma.maintenanceRequest.findMany({
        where: { status: { in: ACTIVE_MAINTENANCE_STATUSES } },
        select: { truckId: true, trailerId: true },
      }),
      prisma.parkMovement.findMany({
        orderBy: { createdAt: 'desc' },
        take: 15,
      }),
    ])

  const maintenanceTruckIds = new Set(
    activeMaintenance.map((request) => request.truckId).filter(Boolean) as string[]
  )
  const maintenanceTrailerIds = new Set(
    activeMaintenance
      .map((request) => request.trailerId)
      .filter(Boolean) as string[]
  )

  const spotByTruckId = new Map<string, SpotWithRelations>()
  const spotByTrailerId = new Map<string, SpotWithRelations>()
  for (const spot of spots) {
    if (!spot.isActive) continue
    if (spot.truckId) spotByTruckId.set(spot.truckId, spot)
    if (spot.trailerId) spotByTrailerId.set(spot.trailerId, spot)
  }

  const trucksById = new Map(trucks.map((truck) => [truck.id, truck]))
  const trailersByTruckId = new Map(
    trailers
      .filter((trailer) => trailer.truckId)
      .map((trailer) => [trailer.truckId as string, trailer])
  )

  const vehicles: ParkVehicleDTO[] = []

  for (const truck of trucks.filter((item) => truckIsAtBase(item.status))) {
    const spot = spotByTruckId.get(truck.id) ?? null
    const hasActiveMaintenance = maintenanceTruckIds.has(truck.id)
    const linkedTrailer = trailersByTruckId.get(truck.id)
    const status = computeStatus({
      hasActiveMaintenance,
      vehicleStatusMaintenance: truck.status === TruckStatus.IN_MAINTENANCE,
      onSpot: Boolean(spot),
    })
    vehicles.push({
      id: truck.id,
      type: ParkVehicleType.TRUCK,
      plateNumber: truck.plateNumber,
      status,
      spotId: spot?.id ?? null,
      spotCode: spot?.code ?? null,
      driverName: truck.driver?.name ?? null,
      trailerType: null,
      linkedTruckId: null,
      linkedTrailerId:
        linkedTrailer && trailerIsAtBase(linkedTrailer.status)
          ? linkedTrailer.id
          : null,
      linkedPlateNumber:
        linkedTrailer && trailerIsAtBase(linkedTrailer.status)
          ? linkedTrailer.plateNumber
          : null,
      hasActiveMaintenance,
      movable: capabilities.canMove,
    })
  }

  for (const trailer of trailers.filter((item) =>
    trailerIsAtBase(item.status)
  )) {
    const spot = spotByTrailerId.get(trailer.id) ?? null
    const hasActiveMaintenance = maintenanceTrailerIds.has(trailer.id)
    const linkedTruck = trailer.truckId
      ? trucksById.get(trailer.truckId)
      : undefined
    const status = computeStatus({
      hasActiveMaintenance,
      vehicleStatusMaintenance: trailer.status === TrailerStatus.IN_MAINTENANCE,
      onSpot: Boolean(spot),
    })
    vehicles.push({
      id: trailer.id,
      type: ParkVehicleType.TRAILER,
      plateNumber: trailer.plateNumber,
      status,
      spotId: spot?.id ?? null,
      spotCode: spot?.code ?? null,
      driverName: null,
      trailerType: TRAILER_TYPE_LABELS[trailer.type],
      linkedTruckId: trailer.truckId,
      linkedTrailerId: null,
      linkedPlateNumber: linkedTruck?.plateNumber ?? null,
      hasActiveMaintenance,
      movable: capabilities.canMove,
    })
  }

  const activeSpots = spots.filter(
    (spot) => spot.isActive && spot.type === 'PARKING'
  )
  const occupiedSpots = activeSpots.filter(
    (spot) => spot.truckId || spot.trailerId
  ).length
  const trucksOnPark = vehicles.filter(
    (vehicle) => vehicle.type === ParkVehicleType.TRUCK && vehicle.spotId
  ).length
  const trailersOnPark = vehicles.filter(
    (vehicle) => vehicle.type === ParkVehicleType.TRAILER && vehicle.spotId
  ).length

  const kpis = {
    vehiclesOnPark: trucksOnPark + trailersOnPark,
    trucksOnPark,
    trailersOnPark,
    spotsOccupied: occupiedSpots,
    spotsAvailable: activeSpots.length - occupiedSpots,
    spotsTotal: activeSpots.length,
    vehiclesOnMission:
      trucks.filter((truck) => TRUCK_MISSION_STATUSES.has(truck.status)).length +
      trailers.filter((trailer) => {
        const linkedTruck = trailer.truckId
          ? trucksById.get(trailer.truckId)
          : null
        return Boolean(linkedTruck && TRUCK_MISSION_STATUSES.has(linkedTruck.status))
      }).length,
    vehiclesInMaintenance: vehicles.filter(
      (vehicle) => vehicle.status === 'MAINTENANCE'
    ).length,
    vehiclesToPosition: vehicles.filter((vehicle) => !vehicle.spotId).length,
  }

  return {
    spots: activeSpots.map(serializeSpot),
    vehicles: vehicles.sort((a, b) =>
      a.plateNumber.localeCompare(b.plateNumber)
    ),
    kpis,
    capabilities,
    recentHistory: recentMovements.map(serializeMovement),
  }
}

/* -------------------------------------------------------------------------- */
/* Déplacements (transactionnels, contrôlés côté serveur)                     */
/* -------------------------------------------------------------------------- */

export type MoveResult =
  | { ok: true; noop?: boolean }
  | { ok: false; code: 400 | 404 | 409; error: string }

type Actor = { id: string; name: string }

function fieldFor(vehicleType: ParkVehicleType): 'truckId' | 'trailerId' {
  return vehicleType === ParkVehicleType.TRUCK ? 'truckId' : 'trailerId'
}

async function loadVehicle(vehicleType: ParkVehicleType, vehicleId: string) {
  if (vehicleType === ParkVehicleType.TRUCK) {
    const truck = await prisma.truck.findUnique({ where: { id: vehicleId } })
    return truck
      ? { plateNumber: truck.plateNumber, atBase: truckIsAtBase(truck.status) }
      : null
  }
  const trailer = await prisma.trailer.findUnique({
    where: { id: vehicleId },
  })
  return trailer
    ? {
        plateNumber: trailer.plateNumber,
        atBase: trailerIsAtBase(trailer.status),
      }
    : null
}

/** Déplace un véhicule (à positionner → place, ou place → place). */
export async function moveVehicle(params: {
  vehicleType: ParkVehicleType
  vehicleId: string
  toSpotId: string
  note?: string | null
  actor: Actor
}): Promise<MoveResult> {
  const { vehicleType, vehicleId, toSpotId, actor } = params
  const note = params.note?.trim() ? params.note.trim() : null
  const field = fieldFor(vehicleType)

  const vehicle = await loadVehicle(vehicleType, vehicleId)
  if (!vehicle) return { ok: false, code: 404, error: 'Véhicule introuvable.' }
  if (!vehicle.atBase) {
    return {
      ok: false,
      code: 400,
      error:
        vehicleType === ParkVehicleType.TRAILER
          ? 'Cette remorque n’est pas déclarée à la Base.'
          : 'Ce camion n’est pas déclaré à la Base.',
    }
  }

  const targetSpot = await prisma.parkSpot.findUnique({
    where: { id: toSpotId },
  })
  if (!targetSpot) return { ok: false, code: 404, error: 'Emplacement introuvable.' }
  if (!targetSpot.isActive)
    return { ok: false, code: 400, error: 'Cet emplacement est inactif.' }

  try {
    return await prisma.$transaction(async (tx) => {
      const currentSpot = await tx.parkSpot.findFirst({
        where: { [field]: vehicleId },
      })

      if (currentSpot && currentSpot.id === toSpotId) {
        return { ok: true, noop: true } as const
      }

      // Libère l'ancien emplacement AVANT de réserver le nouveau
      // (respecte la contrainte d'unicité truckId/trailerId).
      if (currentSpot) {
        const otherOccupied =
          field === 'truckId' ? currentSpot.trailerId : currentSpot.truckId
        await tx.parkSpot.update({
          where: { id: currentSpot.id },
          data: {
            [field]: null,
            ...(otherOccupied
              ? {}
              : { occupiedAt: null, placedById: null, note: null }),
          },
        })
      }

      // Réserve atomiquement le créneau cible (échoue si déjà pris).
      const claim = await tx.parkSpot.updateMany({
        where: { id: toSpotId, isActive: true, [field]: null },
        data: {
          [field]: vehicleId,
          occupiedAt: new Date(),
          placedById: actor.id,
          ...(note !== null ? { note } : {}),
        },
      })

      if (claim.count === 0) {
        // Rollback : l'ancien emplacement est restauré.
        throw new ParkConflictError(
          vehicleType === ParkVehicleType.TRUCK
            ? 'Un camion occupe déjà cet emplacement.'
            : 'Une remorque occupe déjà cet emplacement.'
        )
      }

      await tx.parkMovement.create({
        data: {
          vehicleType,
          truckId: vehicleType === ParkVehicleType.TRUCK ? vehicleId : null,
          trailerId: vehicleType === ParkVehicleType.TRAILER ? vehicleId : null,
          plateNumber: vehicle.plateNumber,
          action: currentSpot
            ? ParkMovementAction.MOVE
            : ParkMovementAction.PLACE,
          fromSpotId: currentSpot?.id ?? null,
          fromSpotCode: currentSpot?.code ?? null,
          toSpotId: targetSpot.id,
          toSpotCode: targetSpot.code,
          actorId: actor.id,
          actorName: actor.name,
          note,
        },
      })

      return { ok: true } as const
    })
  } catch (error) {
    if (error instanceof ParkConflictError) {
      return { ok: false, code: 409, error: error.message }
    }
    throw error
  }
}

/** Positionne atomiquement un camion et sa remorque attelée sur une place. */
export async function moveEnsemble(params: {
  truckId: string
  toSpotId: string
  note?: string | null
  actor: Actor
}): Promise<MoveResult> {
  const note = params.note?.trim() ? params.note.trim() : null
  const truck = await prisma.truck.findUnique({
    where: { id: params.truckId },
    include: { trailers: true },
  })
  if (!truck) return { ok: false, code: 404, error: 'Camion introuvable.' }
  if (!truckIsAtBase(truck.status)) {
    return { ok: false, code: 400, error: 'Le camion n’est pas déclaré à la Base.' }
  }
  const trailer = truck.trailers.find((item) =>
    trailerIsAtBase(item.status)
  )
  if (!trailer) {
    return { ok: false, code: 400, error: 'Aucune remorque à la Base n’est liée à ce camion.' }
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const [target, truckSpot, trailerSpot] = await Promise.all([
        tx.parkSpot.findUnique({ where: { id: params.toSpotId } }),
        tx.parkSpot.findFirst({ where: { truckId: truck.id } }),
        tx.parkSpot.findFirst({ where: { trailerId: trailer.id } }),
      ])
      if (!target) return { ok: false, code: 404, error: 'Emplacement introuvable.' } as const
      if (!target.isActive)
        return { ok: false, code: 400, error: 'Cet emplacement est inactif.' } as const
      if (
        (target.truckId && target.truckId !== truck.id) ||
        (target.trailerId && target.trailerId !== trailer.id)
      ) {
        throw new ParkConflictError('Cet emplacement ne peut pas accueillir cet ensemble.')
      }
      if (truckSpot?.id === target.id && trailerSpot?.id === target.id) {
        return { ok: true, noop: true } as const
      }

      if (truckSpot && truckSpot.id !== target.id) {
        await tx.parkSpot.update({
          where: { id: truckSpot.id },
          data: {
            truckId: null,
            ...(truckSpot.trailerId ? {} : { occupiedAt: null, placedById: null, note: null }),
          },
        })
      }
      if (trailerSpot && trailerSpot.id !== target.id) {
        await tx.parkSpot.update({
          where: { id: trailerSpot.id },
          data: {
            trailerId: null,
            ...(trailerSpot.truckId ? {} : { occupiedAt: null, placedById: null, note: null }),
          },
        })
      }

      const claim = await tx.parkSpot.updateMany({
        where: {
          id: target.id,
          isActive: true,
          AND: [
            { OR: [{ truckId: null }, { truckId: truck.id }] },
            { OR: [{ trailerId: null }, { trailerId: trailer.id }] },
          ],
        },
        data: {
          truckId: truck.id,
          trailerId: trailer.id,
          occupiedAt: new Date(),
          placedById: params.actor.id,
          ...(note !== null ? { note } : {}),
        },
      })
      if (claim.count === 0) throw new ParkConflictError('Conflit de positionnement simultané.')

      for (const item of [
        { type: ParkVehicleType.TRUCK, id: truck.id, plate: truck.plateNumber, from: truckSpot },
        { type: ParkVehicleType.TRAILER, id: trailer.id, plate: trailer.plateNumber, from: trailerSpot },
      ]) {
        await tx.parkMovement.create({
          data: {
            vehicleType: item.type,
            truckId: item.type === ParkVehicleType.TRUCK ? item.id : null,
            trailerId: item.type === ParkVehicleType.TRAILER ? item.id : null,
            plateNumber: item.plate,
            action: item.from ? ParkMovementAction.MOVE : ParkMovementAction.PLACE,
            fromSpotId: item.from?.id ?? null,
            fromSpotCode: item.from?.code ?? null,
            toSpotId: target.id,
            toSpotCode: target.code,
            actorId: params.actor.id,
            actorName: params.actor.name,
            note,
          },
        })
      }
      return { ok: true } as const
    })
  } catch (error) {
    if (error instanceof ParkConflictError) {
      return { ok: false, code: 409, error: error.message }
    }
    throw error
  }
}

/** Retire un véhicule de son emplacement et le remet « à positionner ». */
export async function unlocateVehicle(params: {
  vehicleType: ParkVehicleType
  vehicleId: string
  note?: string | null
  actor: Actor
}): Promise<MoveResult> {
  const { vehicleType, vehicleId, actor } = params
  const note = params.note?.trim() ? params.note.trim() : null
  const field = fieldFor(vehicleType)

  const vehicle = await loadVehicle(vehicleType, vehicleId)
  if (!vehicle) return { ok: false, code: 404, error: 'Véhicule introuvable.' }

  return prisma.$transaction(async (tx) => {
    const currentSpot = await tx.parkSpot.findFirst({
      where: { [field]: vehicleId },
    })
    if (!currentSpot) {
      return { ok: false, code: 400, error: 'Ce véhicule est déjà à positionner.' }
    }

    const otherOccupied =
      field === 'truckId' ? currentSpot.trailerId : currentSpot.truckId
    await tx.parkSpot.update({
      where: { id: currentSpot.id },
      data: {
        [field]: null,
        ...(otherOccupied
          ? {}
          : { occupiedAt: null, placedById: null, note: null }),
      },
    })

    await tx.parkMovement.create({
      data: {
        vehicleType,
        truckId: vehicleType === ParkVehicleType.TRUCK ? vehicleId : null,
        trailerId: vehicleType === ParkVehicleType.TRAILER ? vehicleId : null,
        plateNumber: vehicle.plateNumber,
        action: ParkMovementAction.REMOVE,
        fromSpotId: currentSpot.id,
        fromSpotCode: currentSpot.code,
        toSpotId: null,
        toSpotCode: null,
        actorId: actor.id,
        actorName: actor.name,
        note,
      },
    })

    return { ok: true }
  })
}

export async function updateSpotNote(params: {
  spotId: string
  note: string | null
  actor: Actor
}): Promise<MoveResult> {
  const note = params.note?.trim() ? params.note.trim() : null
  const spot = await prisma.parkSpot.findUnique({
    where: { id: params.spotId },
    include: { truck: true, trailer: true },
  })
  if (!spot) return { ok: false, code: 404, error: 'Emplacement introuvable.' }
  if (!spot.isActive)
    return { ok: false, code: 400, error: 'Cet emplacement est inactif.' }

  await prisma.$transaction(async (tx) => {
    await tx.parkSpot.update({ where: { id: spot.id }, data: { note } })
    const occupants = [
      ...(spot.truck
        ? [{ type: ParkVehicleType.TRUCK, id: spot.truck.id, plate: spot.truck.plateNumber }]
        : []),
      ...(spot.trailer
        ? [{ type: ParkVehicleType.TRAILER, id: spot.trailer.id, plate: spot.trailer.plateNumber }]
        : []),
    ]
    for (const occupant of occupants) {
      await tx.parkMovement.create({
        data: {
          vehicleType: occupant.type,
          truckId: occupant.type === ParkVehicleType.TRUCK ? occupant.id : null,
          trailerId: occupant.type === ParkVehicleType.TRAILER ? occupant.id : null,
          plateNumber: occupant.plate,
          action: ParkMovementAction.MOVE,
          fromSpotId: spot.id,
          fromSpotCode: spot.code,
          toSpotId: spot.id,
          toSpotCode: spot.code,
          actorId: params.actor.id,
          actorName: params.actor.name,
          note,
        },
      })
    }
  })
  return { ok: true }
}

class ParkConflictError extends Error {}

/* -------------------------------------------------------------------------- */
/* Historique                                                                 */
/* -------------------------------------------------------------------------- */

export async function queryParkHistory(filters: {
  vehicleId?: string
  spotId?: string
  actorId?: string
  action?: ParkMovementAction
  limit?: number
}): Promise<ParkMovementDTO[]> {
  const where: Prisma.ParkMovementWhereInput = {}
  if (filters.vehicleId) {
    where.OR = [
      { truckId: filters.vehicleId },
      { trailerId: filters.vehicleId },
    ]
  }
  if (filters.spotId) {
    where.OR = [
      ...(where.OR ?? []),
      { fromSpotId: filters.spotId },
      { toSpotId: filters.spotId },
    ]
  }
  if (filters.actorId) where.actorId = filters.actorId
  if (filters.action) where.action = filters.action

  const movements = await prisma.parkMovement.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(filters.limit ?? 100, 300),
  })
  return movements.map(serializeMovement)
}
