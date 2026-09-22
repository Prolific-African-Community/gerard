import { withTenantApiRoute } from '../../../../lib/auth/authorization'
/**
 * Rotation physique des remorques : décrochage et attelage / reprise.
 *
 * Règle centrale : décrocher une remorque ne termine JAMAIS la mission.
 * L'attelage physique (`Trailer.truckId`) et l'engagement mission
 * (`MissionAssignment.trailerId`) sont deux dimensions distinctes.
 */
import {
  MissionEventType,
  TrailerCustodyState,
  TrailerLoadStatus,
  TrailerStatus,
} from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../../lib/auth/authorization'
import { permissions } from '../../../../lib/auth/permissions'
import { prisma } from '../../../../lib/prisma'
import {
  getMissionToResume,
  resolveTrailerSituation,
} from '../../../../lib/dispatch/trailer-rotation'
import type { TrailerLocation } from '../../../../lib/dispatch/trailer-rotation'

const TERMINAL_MISSION_STATUSES = ['DONE', 'CANCELLED'] as const

const locationValues: TrailerLocation[] = [
  'BASE',
  'CLIENT',
  'IN_TRANSIT',
  'OTHER',
]

type RotationBody = {
  action?: unknown
  trailerId?: unknown
  truckId?: unknown
  driverId?: unknown
  location?: unknown
  loadStatus?: unknown
  note?: unknown
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Charge la remorque avec ce qu'il faut pour dériver sa situation. */
async function loadTrailerContext(trailerId: string) {
  const trailer = await prisma.trailer.findUnique({
    where: { id: trailerId },
    include: {
      truck: { select: { id: true, plateNumber: true } },
      parkSpot: { select: { code: true } },
      assignments: {
        include: {
          mission: { select: { id: true, reference: true, status: true } },
          driver: { select: { id: true, name: true } },
          truck: { select: { id: true, plateNumber: true } },
        },
      },
    },
  })
  if (!trailer) return null

  const activeAssignment = trailer.assignments.find(
    (assignment) =>
      assignment.mission &&
      !TERMINAL_MISSION_STATUSES.includes(
        assignment.mission.status as (typeof TERMINAL_MISSION_STATUSES)[number],
      ),
  )

  const situation = resolveTrailerSituation({
    id: trailer.id,
    plateNumber: trailer.plateNumber,
    truckId: trailer.truckId,
    truckPlate: trailer.truck?.plateNumber ?? null,
    loadStatus: trailer.loadStatus,
    status: trailer.status,
    parkSpotCode: trailer.parkSpot?.code ?? null,
    activeMission: activeAssignment?.mission
      ? {
          missionId: activeAssignment.mission.id,
          missionReference: activeAssignment.mission.reference,
          missionStatus: activeAssignment.mission.status,
          driverId: activeAssignment.driverId,
          driverName: activeAssignment.driver?.name ?? null,
          truckId: activeAssignment.truckId,
          truckPlate: activeAssignment.truck?.plateNumber ?? null,
        }
      : null,
  })

  return { trailer, activeAssignment, situation }
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!(await requirePermission(req, res, permissions.dispatchAssign))) return
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const body = (req.body ?? {}) as RotationBody
  const action = asString(body.action)
  const trailerId = asString(body.trailerId)

  if (!trailerId || (action !== 'DETACH' && action !== 'ATTACH')) {
    return res
      .status(400)
      .json({ error: 'action (DETACH|ATTACH) et trailerId sont requis.' })
  }

  const context = await loadTrailerContext(trailerId)
  if (!context) return res.status(404).json({ error: 'Trailer not found' })

  const { trailer, activeAssignment, situation } = context
  const note = asString(body.note)
  const requestedLocation = asString(body.location) as TrailerLocation | null
  const location =
    requestedLocation && locationValues.includes(requestedLocation)
      ? requestedLocation
      : null
  const requestedLoad = asString(body.loadStatus)
  const nextLoadStatus =
    requestedLoad === 'LOADED'
      ? TrailerLoadStatus.LOADED
      : requestedLoad === 'EMPTY'
        ? TrailerLoadStatus.EMPTY
        : trailer.loadStatus

  try {
    /* ---------------------------- DÉCROCHAGE ---------------------------- */
    if (action === 'DETACH') {
      if (situation.coupling === 'DETACHED') {
        return res
          .status(409)
          .json({ error: 'Cette remorque est déjà décrochée.' })
      }

      const previousTruckId = trailer.truckId

      const updated = await prisma.$transaction(async (tx) => {
        // Le décrochage ne touche QUE l'attelage physique, le chargement et
        // la localisation. La mission et son MissionAssignment sont
        // volontairement laissés intacts.
        const next = await tx.trailer.update({
          where: { id: trailer.id },
          data: {
            truckId: null,
            loadStatus: nextLoadStatus,
            status:
              location === 'BASE' ? TrailerStatus.AT_BASE : trailer.status,
            custodyState:
              nextLoadStatus === TrailerLoadStatus.LOADED
                ? TrailerCustodyState.RELAY_AVAILABLE
                : TrailerCustodyState.EMPTY,
            custodyVersion: { increment: 1 },
          },
        })

        await tx.trailerCustodyEvent.create({
          data: {
            trailerId: trailer.id,
            missionId: activeAssignment?.missionId ?? null,
            fromDriverId: activeAssignment?.driverId ?? null,
            toDriverId: null,
            fromState: trailer.custodyState,
            toState: next.custodyState,
            location: location ?? null,
            note:
              note ??
              `Décrochage${previousTruckId ? ' du tracteur' : ''}. Mission conservée.`,
          },
        })

        // Trace côté mission, sans changer son statut.
        if (activeAssignment?.missionId) {
          await tx.missionEvent.create({
            data: {
              missionId: activeAssignment.missionId,
              trailerId: trailer.id,
              type: MissionEventType.NOTE_ADDED,
              message: 'Remorque décrochée. La mission reste active.',
              metadata: {
                action: 'DETACH',
                trailerPlate: trailer.plateNumber,
                previousTruckId,
                location,
                loadStatus: nextLoadStatus,
              },
            },
          })
        }

        return next
      })

      return res.status(200).json({
        trailer: updated,
        missionKeptActive: activeAssignment?.missionId ?? null,
      })
    }

    /* ------------------------- ATTELAGE / REPRISE ------------------------ */
    const truckId = asString(body.truckId)
    if (!truckId) {
      return res.status(400).json({ error: 'truckId est requis pour atteler.' })
    }
    // Déjà attelée au tracteur demandé : rien à faire, on refuse explicitement
    // plutôt que de produire une mutation vide.
    if (trailer.truckId === truckId) {
      return res.status(409).json({
        error: `Cette remorque est déjà attelée à ${situation.truckPlate ?? 'ce tracteur'}.`,
      })
    }
    // Attelée ailleurs : l'attelage devient un TRANSFERT atomique. Le
    // décrochage de l'ancien tracteur et l'attelage au nouveau se font dans la
    // même transaction, jamais en deux appels séparables.
    const previousTruckId = trailer.truckId
    if (situation.immobilized) {
      return res
        .status(409)
        .json({ error: 'Cette remorque est immobilisée et ne peut pas rouler.' })
    }

    const truck = await prisma.truck.findUnique({ where: { id: truckId } })
    if (!truck) return res.status(404).json({ error: 'Truck not found' })

    // Invariant 1 : un tracteur ne porte qu'une remorque à la fois.
    const alreadyCoupled = await prisma.trailer.findFirst({
      where: { truckId, id: { not: trailer.id } },
      select: { plateNumber: true },
    })
    if (alreadyCoupled) {
      return res.status(409).json({
        error: `Ce tracteur porte déjà la remorque ${alreadyCoupled.plateNumber}.`,
      })
    }

    const driverId = asString(body.driverId)
    const missionToResume = getMissionToResume(situation)

    const result = await prisma.$transaction(async (tx) => {
      const next = await tx.trailer.update({
        where: { id: trailer.id },
        data: {
          truckId,
          status:
            trailer.status === TrailerStatus.AT_BASE
              ? TrailerStatus.ASSIGNED
              : trailer.status,
          custodyState:
            trailer.loadStatus === TrailerLoadStatus.LOADED
              ? TrailerCustodyState.IN_MISSION
              : TrailerCustodyState.EMPTY,
          custodyVersion: { increment: 1 },
        },
      })

      // Invariant 6 : une remorque déjà engagée poursuit SA mission.
      // Aucune mission n'est créée ici, seule l'affectation est transférée.
      if (missionToResume && activeAssignment) {
        await tx.missionAssignment.update({
          where: { id: activeAssignment.id },
          data: {
            truckId,
            ...(driverId ? { driverId } : {}),
          },
        })

        await tx.missionEvent.create({
          data: {
            missionId: missionToResume.missionId,
            trailerId: trailer.id,
            driverId: driverId ?? activeAssignment.driverId,
            truckId,
            type: MissionEventType.NOTE_ADDED,
            message: 'Reprise de la remorque : la mission se poursuit.',
            metadata: {
              action: 'RESUME',
              trailerPlate: trailer.plateNumber,
              previousDriverId: activeAssignment.driverId,
              previousTruckId: activeAssignment.truckId,
            },
          },
        })
      }

      await tx.trailerCustodyEvent.create({
        data: {
          trailerId: trailer.id,
          missionId: missionToResume?.missionId ?? null,
          fromDriverId: activeAssignment?.driverId ?? null,
          toDriverId: driverId ?? null,
          fromState: trailer.custodyState,
          toState: next.custodyState,
          location: null,
          note: missionToResume
            ? `Attelage avec reprise de la mission ${missionToResume.missionReference}.`
            : previousTruckId
              ? (note ?? 'Transfert de la remorque vers un autre tracteur.')
              : (note ?? 'Attelage de la remorque.'),
        },
      })

      return next
    })

    return res.status(200).json({
      trailer: result,
      previousTruckId: previousTruckId ?? null,
      resumedMissionId: missionToResume?.missionId ?? null,
      resumedMissionReference: missionToResume?.missionReference ?? null,
    })
  } catch (error) {
    console.error('Failed to rotate trailer', error)
    return res.status(500).json({ error: 'Failed to rotate trailer' })
  }
}

export default withTenantApiRoute(handler)
