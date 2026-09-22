import { withTenantApiRoute } from '../../../lib/auth/authorization'
import {
  AddressResolutionStatus,
  DriverStatus,
  MissionEventType,
  MissionPreparationStatus,
  MissionStatus,
  PlanningDay,
  TruckStatus,
} from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'
import { requirePermission } from '../../../lib/auth/authorization'
import { permissions } from '../../../lib/auth/permissions'

import { prisma } from '../../../lib/prisma'
import {
  evaluateManualConflict,
  getManualMissionMove,
  isSyntheticDateSpan,
  resolveOccupation,
} from '../../../lib/dispatch/manual-mission-assignment'
import type { ManualAssignmentWarning } from '../../../lib/dispatch/manual-mission-assignment'

class MissionIntervalConflictError extends Error {}

type AssignMissionBody = {
  missionId: string
  planningRowId: string
  driverId: string | null
  truckId: string | null
  day: PlanningDay
  scheduledDate: string
  sortOrder: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPlanningDay(value: unknown): value is PlanningDay {
  return (
    typeof value === 'string' &&
    (Object.values(PlanningDay) as string[]).includes(value)
  )
}

function parseBody(body: unknown): AssignMissionBody | null {
  if (!isRecord(body)) {
    return null
  }

  const {
    missionId,
    planningRowId,
    driverId,
    truckId,
    day,
    scheduledDate,
    sortOrder,
  } = body

  if (
    typeof missionId !== 'string' ||
    typeof planningRowId !== 'string' ||
    !(typeof driverId === 'string' || driverId === null) ||
    !(typeof truckId === 'string' || truckId === null) ||
    !isPlanningDay(day) ||
    typeof scheduledDate !== 'string' ||
    typeof sortOrder !== 'number' ||
    !Number.isInteger(sortOrder) ||
    sortOrder < 0
  ) {
    return null
  }

  return {
    missionId,
    planningRowId,
    driverId,
    truckId,
    day,
    scheduledDate,
    sortOrder,
  }
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (!(await requirePermission(req, res, permissions.dispatchAssign))) return
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const body = parseBody(req.body)

  if (!body) {
    return res.status(400).json({ error: 'Invalid request body' })
  }

  const scheduledDate = new Date(body.scheduledDate)

  if (Number.isNaN(scheduledDate.getTime())) {
    return res.status(400).json({ error: 'Invalid scheduledDate' })
  }

  try {
    const [mission, planningRow, driver, truck, existingAssignment] =
      await Promise.all([
        prisma.mission.findUnique({ where: { id: body.missionId } }),
        prisma.planningRow.findUnique({ where: { id: body.planningRowId } }),
        body.driverId
          ? prisma.driver.findUnique({ where: { id: body.driverId } })
          : Promise.resolve(null),
        body.truckId
          ? prisma.truck.findUnique({ where: { id: body.truckId } })
          : Promise.resolve(null),
        prisma.missionAssignment.findUnique({
          where: { missionId: body.missionId },
        }),
      ])

    if (!mission) {
      return res.status(404).json({ error: 'Mission not found' })
    }

    if (!planningRow) {
      return res.status(404).json({ error: 'Planning row not found' })
    }

    if (body.driverId && !driver) {
      return res.status(404).json({ error: 'Driver not found' })
    }

    if (body.truckId && !truck) {
      return res.status(404).json({ error: 'Truck not found' })
    }
    if (driver && driver.status !== DriverStatus.ACTIVE) {
      return res.status(409).json({
        error: 'Ce chauffeur est indisponible sur la période demandée.',
      })
    }
    if (
      truck &&
      ([
        TruckStatus.IN_MAINTENANCE,
        TruckStatus.MAINTENANCE_EXT,
        TruckStatus.OUT_OF_SERVICE,
      ] as TruckStatus[]).includes(truck.status)
    ) {
      return res.status(409).json({
        error: 'Ce tracteur est indisponible sur la période demandée.',
      })
    }
    if (
      planningRow.driverId !== body.driverId ||
      planningRow.truckId !== body.truckId
    ) {
      return res.status(409).json({
        error:
          'La ligne a changé. Actualisez le planning avant de déplacer la mission.',
      })
    }
    if (
      existingAssignment &&
      existingAssignment.planningRowId === body.planningRowId &&
      existingAssignment.driverId === body.driverId &&
      existingAssignment.truckId === body.truckId &&
      existingAssignment.day === body.day &&
      existingAssignment.sortOrder === body.sortOrder &&
      existingAssignment.scheduledDate.getTime() === scheduledDate.getTime()
    ) {
      const unchangedMission = await prisma.mission.findUniqueOrThrow({
        where: { id: body.missionId },
        include: {
          assignment: {
            include: {
              driver: true,
              truck: true,
              trailer: true,
            },
          },
        },
      })
      return res.status(200).json({ mission: unchangedMission })
    }

    // Seule impossibilité chronologique réelle : livrer avant d'avoir chargé.
    if (
      mission.pickupDate &&
      mission.deliveryDate &&
      mission.deliveryDate < mission.pickupDate
    ) {
      return res.status(409).json({
        error:
          'Affectation impossible : la date de livraison précède la date de chargement.',
      })
    }

    const nextStatus =
      mission.status === MissionStatus.PENDING
        ? MissionStatus.ASSIGNED
        : mission.status
    const manualMove = getManualMissionMove({
      scheduledDate,
      pickupDate: mission.pickupDate,
      deliveryDate: mission.deliveryDate,
      routeDurationSeconds: mission.routeDurationSeconds,
    })
    const plannedEndAt = manualMove.plannedEndAt
    const resourceFilters = [
      ...(body.driverId ? [{ driverId: body.driverId }] : []),
      ...(body.truckId ? [{ truckId: body.truckId }] : []),
      ...(existingAssignment?.trailerId
        ? [{ trailerId: existingAssignment.trailerId }]
        : []),
    ]

    const eventType = existingAssignment
      ? existingAssignment.driverId !== body.driverId
        ? MissionEventType.DRIVER_CHANGED
        : existingAssignment.truckId !== body.truckId
        ? MissionEventType.TRUCK_CHANGED
        : MissionEventType.RESCHEDULED
      : MissionEventType.ASSIGNED

    const conflictWarnings: ManualAssignmentWarning[] = []

    // Informations que le dispatcher doit voir sans être empêché d'agir.
    const advisoryWarnings: ManualAssignmentWarning[] = []
    if (
      mission.preparationStatus === MissionPreparationStatus.REVIEW_REQUIRED ||
      mission.preparationStatus === MissionPreparationStatus.FAILED
    ) {
      advisoryWarnings.push({
        code: 'PREPARATION_REVIEW',
        message:
          'Préparation incomplète : adresses et itinéraire restent à vérifier.',
      })
    }
    if (
      mission.pickupResolutionStatus !== AddressResolutionStatus.CONFIRMED &&
      mission.pickupResolutionStatus !== AddressResolutionStatus.AUTO_CONFIRMED
    ) {
      advisoryWarnings.push({
        code: 'ADDRESS_UNCONFIRMED',
        message: 'Adresse de chargement non confirmée.',
      })
    }
    if (
      mission.deliveryResolutionStatus !== AddressResolutionStatus.CONFIRMED &&
      mission.deliveryResolutionStatus !==
        AddressResolutionStatus.AUTO_CONFIRMED
    ) {
      advisoryWarnings.push({
        code: 'ADDRESS_UNCONFIRMED',
        message: 'Adresse de livraison non confirmée.',
      })
    }
    if (
      typeof mission.routeDistanceMeters !== 'number' &&
      typeof mission.estimatedKm !== 'number'
    ) {
      advisoryWarnings.push({
        code: 'UNKNOWN_DISTANCE',
        message: 'Distance inconnue : itinéraire non calculé.',
      })
    }

    const updatedMission = await prisma.$transaction(async (tx) => {
      // MANUAL-FIRST : on ne refuse que ce qui est démontrable. Un
      // chevauchement calculé depuis des dates métier approximatives devient
      // un avertissement, pas un blocage. L'auto-planning reste conservateur.
      const movedOccupation = resolveOccupation({
        scheduledDate,
        plannedEndAt,
        pickupDate: mission.pickupDate,
        deliveryDate: mission.deliveryDate,
        routeDurationSeconds: mission.routeDurationSeconds,
      })

      const resourceAssignments = resourceFilters.length
        ? await tx.missionAssignment.findMany({
            where: {
              missionId: { not: body.missionId },
              OR: resourceFilters,
            },
            select: {
              missionId: true,
              scheduledDate: true,
              plannedEndAt: true,
              mission: {
                select: {
                  reference: true,
                  pickupDate: true,
                  deliveryDate: true,
                  routeDurationSeconds: true,
                },
              },
            },
          })
        : []

      for (const candidate of resourceAssignments) {
        const verdict = evaluateManualConflict({
          movedMissionId: body.missionId,
          existingMissionId: candidate.missionId,
          moved: movedOccupation,
          existing: resolveOccupation({
            scheduledDate: candidate.scheduledDate,
            plannedEndAt: candidate.plannedEndAt,
            pickupDate: candidate.mission.pickupDate,
            deliveryDate: candidate.mission.deliveryDate,
            routeDurationSeconds: candidate.mission.routeDurationSeconds,
          }),
        })

        if (verdict === 'BLOCKING') {
          throw new MissionIntervalConflictError(
            `Affectation impossible : cette ressource est déjà occupée par la mission ${candidate.mission.reference} sur ce créneau.`
          )
        }

        if (verdict === 'POTENTIAL') {
          // Une durée fabriquée à l'import est signalée comme telle : le
          // dispatcher sait alors que le conflit repose sur une hypothèse.
          const approximate = isSyntheticDateSpan(
            candidate.mission.pickupDate,
            candidate.mission.deliveryDate
          )
          conflictWarnings.push({
            code: 'ESTIMATED_TIME_OVERLAP',
            message: approximate
              ? `Conflit potentiel avec la mission ${candidate.mission.reference} — durée d’occupation approximative.`
              : `Conflit potentiel avec la mission ${candidate.mission.reference} — durée d’occupation estimée.`,
            missionId: candidate.missionId,
            missionReference: candidate.mission.reference,
          })
        }
      }
      const targetAssignments = await tx.missionAssignment.findMany({
        where: {
          planningRowId: body.planningRowId,
          day: body.day,
          missionId: { not: body.missionId },
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      })
      const insertionIndex = Math.min(
        body.sortOrder,
        targetAssignments.length
      )

      for (let index = 0; index < targetAssignments.length; index += 1) {
        const assignment = targetAssignments[index]
        await tx.missionAssignment.update({
          where: { id: assignment.id },
          data: {
            sortOrder: index >= insertionIndex ? index + 1 : index,
          },
        })
      }

      await tx.missionAssignment.upsert({
        where: {
          missionId: body.missionId,
        },
        create: {
          missionId: body.missionId,
          planningRowId: body.planningRowId,
          driverId: body.driverId,
          truckId: body.truckId,
          day: body.day,
          scheduledDate,
          plannedEndAt,
          sortOrder: insertionIndex,
        },
        update: {
          planningRowId: body.planningRowId,
          driverId: body.driverId,
          truckId: body.truckId,
          day: body.day,
          scheduledDate,
          plannedEndAt,
          sortOrder: insertionIndex,
        },
      })

      if (
        existingAssignment &&
        (existingAssignment.planningRowId !== body.planningRowId ||
          existingAssignment.day !== body.day)
      ) {
        const previousCellAssignments = await tx.missionAssignment.findMany({
          where: {
            planningRowId: existingAssignment.planningRowId,
            day: existingAssignment.day,
          },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: { id: true },
        })
        for (
          let index = 0;
          index < previousCellAssignments.length;
          index += 1
        ) {
          const assignment = previousCellAssignments[index]
          await tx.missionAssignment.update({
            where: { id: assignment.id },
            data: { sortOrder: index },
          })
        }
      }

      const missionWithAssignment = await tx.mission.update({
        where: {
          id: body.missionId,
        },
        data: {
          status: nextStatus,
        },
        include: {
          assignment: {
            include: {
              driver: true,
              truck: true,
            },
          },
        },
      })

      await tx.missionEvent.create({
        data: {
          missionId: body.missionId,
          driverId: body.driverId,
          truckId: body.truckId,
          type: eventType,
          message: existingAssignment
            ? 'Mission assignment updated from dispatcher board.'
            : 'Mission assigned from dispatcher board.',
          fromStatus: mission.status,
          toStatus: nextStatus,
          metadata: {
            day: body.day,
            scheduledDate: scheduledDate.toISOString(),
            sortOrder: insertionIndex,
            previousAssignment: existingAssignment,
          },
        },
      })

      return missionWithAssignment
    }, { isolationLevel: 'Serializable' })

    // `warnings` reste un tableau de chaînes pour ne pas casser le front
    // existant ; `warningDetails` porte le contrat structuré.
    const warningDetails: ManualAssignmentWarning[] = [
      ...manualMove.warnings.map((message) => ({
        code: 'UNKNOWN_DURATION' as const,
        message,
      })),
      ...conflictWarnings,
      ...advisoryWarnings,
    ]

    return res.status(200).json({
      mission: updatedMission,
      warnings: warningDetails.map((warning) => warning.message),
      warningDetails,
    })
  } catch (error) {
    if (error instanceof MissionIntervalConflictError) {
      return res.status(409).json({ error: error.message })
    }
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'P2034'
    ) {
      return res.status(409).json({
        error: 'Le planning a été modifié simultanément. Réessayez.',
      })
    }
    console.error('Failed to assign mission', error)
    return res.status(500).json({ error: 'Failed to assign mission' })
  }
}

export default withTenantApiRoute(handler)
