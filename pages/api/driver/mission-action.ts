import { withTenantApiRoute } from '../../../lib/auth/authorization'
import { MissionEventType, MissionStatus, TruckStatus } from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requireActiveUser, requireOrganizationModule } from '../../../lib/auth/authorization'
import { prisma } from '../../../lib/prisma'
import { synchronizeParkPresence } from '../../../lib/park/service'

type DriverMissionAction =
  | 'START_MISSION'
  | 'ARRIVE_PICKUP'
  | 'START_DELIVERY'
  | 'COMPLETE_MISSION'
  | 'REPORT_ISSUE'

const driverMissionActions: DriverMissionAction[] = [
  'START_MISSION',
  'ARRIVE_PICKUP',
  'START_DELIVERY',
  'COMPLETE_MISSION',
  'REPORT_ISSUE',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isDriverMissionAction(value: unknown): value is DriverMissionAction {
  return (
    typeof value === 'string' &&
    driverMissionActions.includes(value as DriverMissionAction)
  )
}

function getActionLabel(action: DriverMissionAction) {
  const labels: Record<DriverMissionAction, string> = {
    START_MISSION: 'Mission démarrée par le chauffeur.',
    ARRIVE_PICKUP: 'Chauffeur arrivé au pickup.',
    START_DELIVERY: 'Départ livraison confirmé par le chauffeur.',
    COMPLETE_MISSION: 'Mission terminée par le chauffeur.',
    REPORT_ISSUE: 'Problème signalé par le chauffeur.',
  }

  return labels[action]
}

function getMissionEventType(action: DriverMissionAction) {
  if (action === 'COMPLETE_MISSION') {
    return MissionEventType.COMPLETED
  }

  if (action === 'REPORT_ISSUE') {
    return MissionEventType.ISSUE_REPORTED
  }

  return MissionEventType.STATUS_CHANGED
}

function getNextMissionStatus(
  action: DriverMissionAction,
  currentStatus: MissionStatus
) {
  if (action === 'START_MISSION') {
    return MissionStatus.IN_PROGRESS
  }

  if (action === 'COMPLETE_MISSION') {
    return MissionStatus.DONE
  }

  if (action === 'REPORT_ISSUE') {
    return MissionStatus.ISSUE
  }

  return currentStatus
}

function getNextTruckStatus(action: DriverMissionAction) {
  if (action === 'START_MISSION') {
    return TruckStatus.EN_ROUTE_TO_PICKUP
  }

  if (action === 'ARRIVE_PICKUP') {
    return TruckStatus.AT_PICKUP
  }

  if (action === 'START_DELIVERY') {
    return TruckStatus.ON_MISSION
  }

  if (action === 'COMPLETE_MISSION') {
    return TruckStatus.AVAILABLE
  }

  return null
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const sessionUser = await requireActiveUser(req, res)

  if (!sessionUser) {
    return
  }
  if (!(await requireOrganizationModule(req, res, 'PLANNING'))) return

  if (sessionUser.role !== 'DRIVER' || !sessionUser.driverId) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  if (
    !isRecord(req.body) ||
    typeof req.body.missionId !== 'string' ||
    !isDriverMissionAction(req.body.action)
  ) {
    return res.status(400).json({ error: 'Invalid request body' })
  }

  const missionId = req.body.missionId
  const action = req.body.action

  try {
    const assignment = await prisma.missionAssignment.findFirst({
      where: {
        missionId,
        OR: [
          {
            driverId: sessionUser.driverId,
          },
          {
            planningRow: {
              driverId: sessionUser.driverId,
            },
          },
        ],
      },
      include: {
        mission: true,
        truck: true,
        planningRow: {
          include: {
            truck: true,
          },
        },
      },
    })

    if (!assignment) {
      return res.status(404).json({ error: 'Mission not found' })
    }

    const truck = assignment.planningRow?.truck ?? assignment.truck ?? null
    const nextMissionStatus = getNextMissionStatus(
      action,
      assignment.mission.status
    )
    const nextTruckStatus = getNextTruckStatus(action)

    const result = await prisma.$transaction(async (tx) => {
      let updatedMission = assignment.mission
      let updatedTruck = truck

      if (assignment.mission.status !== nextMissionStatus) {
        updatedMission = await tx.mission.update({
          where: {
            id: assignment.missionId,
          },
          data: {
            status: nextMissionStatus,
          },
        })

        await tx.missionEvent.create({
          data: {
            missionId: assignment.missionId,
            actorId: sessionUser.id,
            driverId: sessionUser.driverId,
            truckId: truck?.id ?? null,
            type: getMissionEventType(action),
            message: getActionLabel(action),
            fromStatus: assignment.mission.status,
            toStatus: nextMissionStatus,
            metadata: {
              source: 'driver_app',
              action,
            },
          },
        })
      }

      if (truck && nextTruckStatus && truck.status !== nextTruckStatus) {
        updatedTruck = await tx.truck.update({
          where: {
            id: truck.id,
          },
          data: {
            status: nextTruckStatus,
            statusUpdatedAt: new Date(),
          },
        })

        await tx.truckEvent.create({
          data: {
            truckId: truck.id,
            actorId: sessionUser.id,
            fromStatus: truck.status,
            toStatus: nextTruckStatus,
            message: getActionLabel(action),
            metadata: {
              source: 'driver_app',
              missionId: assignment.missionId,
              action,
            },
          },
        })
      }

      return {
        mission: updatedMission,
        truck: updatedTruck,
      }
    })

    await synchronizeParkPresence()

    return res.status(200).json({
      ok: true,
      mission: result.mission,
      truck: result.truck,
    })
  } catch (error) {
    console.error('Failed to apply driver mission action', {
      driverId: sessionUser.driverId,
      missionId,
      action,
      error,
    })
    return res.status(500).json({ error: 'Failed to apply mission action' })
  }
}

export default withTenantApiRoute(handler)
