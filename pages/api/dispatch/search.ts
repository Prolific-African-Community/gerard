import { MissionStatus } from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../lib/auth/authorization'
import { permissions } from '../../../lib/auth/permissions'
import {
  formatDateParam,
  getWeekStartDate,
  parseWeekStartParam,
} from '../../../lib/dispatch/date-utils'
import {
  buildMissionLocator,
  buildTrailerLocator,
  buildTruckLocator,
  getMissionSearchFields,
  getTrailerSearchFields,
  getTruckSearchFields,
  isSearchTermUsable,
  matchesSearchTerm,
  normalizeSearchTerm,
  SMART_SEARCH_LIMIT,
} from '../../../lib/dispatch/smart-search'
import type {
  MissionLocatorInput,
  SmartSearchResponse,
  TrailerLocatorInput,
  TruckLocatorInput,
} from '../../../lib/dispatch/smart-search'
import { isActiveMission } from '../../../lib/dispatch/trailer-rotation'
import { prisma } from '../../../lib/prisma'

/**
 * Recherche locator du cockpit Dispatch.
 *
 * Trois requêtes fixes : missions préfiltrées en base, flotte camions et
 * flotte remorques. Les deux flottes sont bornées par nature (quelques
 * dizaines de lignes) et sont donc filtrées en mémoire, seule façon d'être
 * réellement tolérant aux espaces et tirets des plaques. Deux requêtes
 * complémentaires — lignes Planning de la semaine, missions actives des
 * remorques retenues — restent groupées : aucun N+1.
 */

/**
 * Statuts terminaux réellement présents dans l'enum Prisma. `isActiveMission()`
 * reste le juge final : ce préfiltre ne fait qu'alléger la requête.
 */
const TERMINAL_MISSION_STATUSES: MissionStatus[] = [
  MissionStatus.DONE,
  MissionStatus.CANCELLED,
]

/** Marge de sécurité : le filtre normalisé resserre ensuite le résultat. */
const MISSION_PREFETCH_FACTOR = 6

function readQueryValue(value: string | string[] | undefined) {
  if (typeof value === 'undefined') return null
  if (Array.isArray(value)) return null
  return value
}

function buildMissionWhere(term: string) {
  // Deux variantes suffisent à couvrir « 2602857 » et « 2602 857 » : la
  // tolérance fine aux séparateurs est appliquée ensuite en mémoire.
  const variants = Array.from(
    new Set([term.trim(), normalizeSearchTerm(term)].filter(Boolean))
  )

  const fields = [
    'reference',
    'clientReference',
    'cmrNumber',
    'deliveryNoteNumber',
    'clientName',
    'pickupCity',
    'deliveryCity',
  ] as const

  return {
    OR: variants.flatMap((variant) =>
      fields.map((field) => ({
        [field]: { contains: variant, mode: 'insensitive' as const },
      }))
    ),
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SmartSearchResponse | { error: string }>
) {
  const user = await requirePermission(req, res, permissions.dispatchView)
  if (!user) return

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const rawQuery = readQueryValue(req.query.q) ?? ''
  const weekStartParam = readQueryValue(req.query.weekStart)
  const weekStartDate = weekStartParam
    ? parseWeekStartParam(weekStartParam)
    : getWeekStartDate()

  if (!weekStartDate) {
    return res.status(400).json({ error: 'Invalid weekStart' })
  }

  const emptyResponse: SmartSearchResponse = {
    query: rawQuery,
    weekStart: formatDateParam(weekStartDate),
    missions: [],
    trucks: [],
    trailers: [],
  }

  // En dessous du minimum, on ne sollicite pas la base : la palette reste
  // muette plutôt que de renvoyer la moitié du parc.
  if (!isSearchTermUsable(rawQuery)) {
    return res.status(200).json(emptyResponse)
  }

  try {
    const [missionRows, truckRows, trailerRows] = await Promise.all([
      prisma.mission.findMany({
        where: buildMissionWhere(rawQuery),
        orderBy: { createdAt: 'desc' },
        take: SMART_SEARCH_LIMIT * MISSION_PREFETCH_FACTOR,
        select: {
          id: true,
          reference: true,
          clientReference: true,
          clientName: true,
          cmrNumber: true,
          deliveryNoteNumber: true,
          pickupCity: true,
          deliveryCity: true,
          pickupDate: true,
          deliveryDate: true,
          status: true,
          preparationStatus: true,
          assignment: {
            select: {
              id: true,
              scheduledDate: true,
              plannedEndAt: true,
              planningRowId: true,
              driverId: true,
              truckId: true,
              trailerId: true,
              driver: { select: { name: true } },
              truck: { select: { plateNumber: true } },
              trailer: { select: { plateNumber: true } },
            },
          },
        },
      }),

      prisma.truck.findMany({
        orderBy: { plateNumber: 'asc' },
        select: {
          id: true,
          plateNumber: true,
          model: true,
          brand: true,
          status: true,
          driverId: true,
          driver: { select: { name: true } },
          trailers: { select: { id: true, plateNumber: true } },
        },
      }),

      prisma.trailer.findMany({
        orderBy: { plateNumber: 'asc' },
        select: {
          id: true,
          plateNumber: true,
          type: true,
          status: true,
          loadStatus: true,
          cargoType: true,
          cargoDescription: true,
          truckId: true,
          truck: {
            select: { plateNumber: true, driver: { select: { name: true } } },
          },
          // Emplacement de parc occupé : preuve de présence à la base.
          parkSpot: { select: { code: true } },
        },
      }),
    ])

    const matchedTrucks = truckRows
      .filter((truck) =>
        matchesSearchTerm(
          rawQuery,
          getTruckSearchFields({
            id: truck.id,
            plateNumber: truck.plateNumber,
            model: truck.model,
            brand: truck.brand,
            driverName: truck.driver?.name ?? null,
          })
        )
      )
      .slice(0, SMART_SEARCH_LIMIT)

    const matchedTrailers = trailerRows
      .filter((trailer) =>
        matchesSearchTerm(
          rawQuery,
          getTrailerSearchFields({
            id: trailer.id,
            plateNumber: trailer.plateNumber,
            type: trailer.type,
          })
        )
      )
      .slice(0, SMART_SEARCH_LIMIT)

    // Deux requêtes groupées, jamais une par résultat.
    const [planningRows, trailerAssignments] = await Promise.all([
      matchedTrucks.length
        ? prisma.planningRow.findMany({
            where: {
              weekStartDate,
              truckId: { in: matchedTrucks.map((truck) => truck.id) },
            },
            select: {
              id: true,
              weekStartDate: true,
              truckId: true,
              driverId: true,
              driver: { select: { name: true } },
            },
          })
        : Promise.resolve([]),

      matchedTrailers.length
        ? prisma.missionAssignment.findMany({
            where: {
              trailerId: { in: matchedTrailers.map((trailer) => trailer.id) },
              mission: { status: { notIn: TERMINAL_MISSION_STATUSES } },
            },
            orderBy: { scheduledDate: 'desc' },
            select: {
              trailerId: true,
              driverId: true,
              truckId: true,
              mission: {
                select: { id: true, reference: true, status: true },
              },
              driver: { select: { name: true } },
              truck: { select: { plateNumber: true } },
            },
          })
        : Promise.resolve([]),
    ])

    const planningRowByTruckId = new Map(
      planningRows
        .filter((row) => row.truckId)
        .map((row) => [row.truckId as string, row])
    )

    const activeMissionByTrailerId = new Map<
      string,
      NonNullable<TrailerLocatorInput['activeMission']>
    >()
    for (const assignment of trailerAssignments) {
      if (!assignment.trailerId || !assignment.mission) continue
      if (activeMissionByTrailerId.has(assignment.trailerId)) continue
      const candidate = {
        missionId: assignment.mission.id,
        missionReference: assignment.mission.reference,
        missionStatus: assignment.mission.status,
        driverId: assignment.driverId,
        driverName: assignment.driver?.name ?? null,
        truckId: assignment.truckId,
        truckPlate: assignment.truck?.plateNumber ?? null,
      }
      if (!isActiveMission(candidate)) continue
      activeMissionByTrailerId.set(assignment.trailerId, candidate)
    }

    const missions = missionRows
      .map((mission): MissionLocatorInput => ({
        id: mission.id,
        reference: mission.reference,
        clientReference: mission.clientReference,
        clientName: mission.clientName,
        cmrNumber: mission.cmrNumber,
        deliveryNoteNumber: mission.deliveryNoteNumber,
        pickupCity: mission.pickupCity,
        deliveryCity: mission.deliveryCity,
        status: mission.status,
        preparationStatus: mission.preparationStatus,
        pickupDate: mission.pickupDate,
        deliveryDate: mission.deliveryDate,
        assignment: mission.assignment
          ? {
              id: mission.assignment.id,
              scheduledDate: mission.assignment.scheduledDate,
              plannedEndAt: mission.assignment.plannedEndAt,
              planningRowId: mission.assignment.planningRowId,
              driverId: mission.assignment.driverId,
              driverName: mission.assignment.driver?.name ?? null,
              truckId: mission.assignment.truckId,
              truckPlate: mission.assignment.truck?.plateNumber ?? null,
              trailerId: mission.assignment.trailerId,
              trailerPlate: mission.assignment.trailer?.plateNumber ?? null,
            }
          : null,
      }))
      .filter((mission) =>
        matchesSearchTerm(rawQuery, getMissionSearchFields(mission))
      )
      .slice(0, SMART_SEARCH_LIMIT)
      .map((mission) => buildMissionLocator(mission, weekStartDate))

    const trucks = matchedTrucks.map((truck) => {
      const row = planningRowByTruckId.get(truck.id)
      const input: TruckLocatorInput = {
        id: truck.id,
        plateNumber: truck.plateNumber,
        model: truck.model,
        brand: truck.brand,
        status: truck.status,
        driverId: truck.driverId,
        driverName: truck.driver?.name ?? null,
        planningRow: row
          ? {
              id: row.id,
              weekStartDate: row.weekStartDate,
              driverId: row.driverId,
              driverName: row.driver?.name ?? null,
            }
          : null,
        // Attelage PHYSIQUE courant : Trailer.truckId, pas la remorque prévue.
        trailerId: truck.trailers[0]?.id ?? null,
        trailerPlate: truck.trailers[0]?.plateNumber ?? null,
      }

      return buildTruckLocator(input, weekStartDate)
    })

    const trailers = matchedTrailers.map((trailer) =>
      buildTrailerLocator({
        id: trailer.id,
        plateNumber: trailer.plateNumber,
        type: trailer.type,
        status: trailer.status,
        loadStatus: trailer.loadStatus,
        cargoType: trailer.cargoType,
        cargoDescription: trailer.cargoDescription,
        parkSpotCode: trailer.parkSpot?.code ?? null,
        truckId: trailer.truckId,
        truckPlate: trailer.truck?.plateNumber ?? null,
        driverName: trailer.truck?.driver?.name ?? null,
        activeMission: activeMissionByTrailerId.get(trailer.id) ?? null,
      })
    )

    return res.status(200).json({
      query: rawQuery,
      weekStart: formatDateParam(weekStartDate),
      missions,
      trucks,
      trailers,
    })
  } catch (error) {
    console.error('Failed to run dispatch search', error)
    return res.status(500).json({ error: 'Failed to run dispatch search' })
  }
}
