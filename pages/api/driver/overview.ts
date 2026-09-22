import { withTenantApiRoute } from '../../../lib/auth/authorization'
import { MissionStatus } from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requireActiveUser, requireOrganizationModule } from '../../../lib/auth/authorization'
import { prisma } from '../../../lib/prisma'

function getMissionPriority(status: MissionStatus) {
  if (status === MissionStatus.ISSUE) {
    return 0
  }

  if (status === MissionStatus.IN_PROGRESS) {
    return 1
  }

  if (status === MissionStatus.ASSIGNED) {
    return 2
  }

  if (status === MissionStatus.PENDING) {
    return 3
  }

  return 4
}

function mapMissionAssignment(
  assignment: NonNullable<
    Awaited<ReturnType<typeof getDriverAssignments>>
  >[number]
) {
  return {
    id: assignment.mission.id,
    assignmentId: assignment.id,
    reference: assignment.mission.reference,
    clientName: assignment.mission.clientName,
    pickupCity: assignment.mission.pickupCity,
    pickupAddress: assignment.mission.pickupAddress,
    pickupLat: assignment.mission.pickupLat,
    pickupLng: assignment.mission.pickupLng,
    deliveryCity: assignment.mission.deliveryCity,
    deliveryAddress: assignment.mission.deliveryAddress,
    deliveryLat: assignment.mission.deliveryLat,
    deliveryLng: assignment.mission.deliveryLng,
    pickupDate: assignment.mission.pickupDate,
    deliveryDate: assignment.mission.deliveryDate,
    status: assignment.mission.status,
    clientReference: assignment.mission.clientReference,
    requiredTruckType: assignment.mission.requiredTruckType,
    priceAmount: assignment.mission.priceAmount,
    priceCurrency: assignment.mission.priceCurrency,
    paymentTerms: assignment.mission.paymentTerms,
    preAnnouncementRequired: assignment.mission.preAnnouncementRequired,
    preAnnouncementSent: assignment.mission.preAnnouncementSent,
    notes: assignment.mission.notes,
    requirements: assignment.mission.requirements,
    contacts: assignment.mission.contacts,
    billingInfo: assignment.mission.billingInfo,
    routeDistanceMeters: assignment.mission.routeDistanceMeters,
    routeDurationSeconds: assignment.mission.routeDurationSeconds,
    scheduledDate: assignment.scheduledDate,
    day: assignment.day,
  }
}

function getDriverAssignments(driverId: string) {
  return prisma.missionAssignment.findMany({
    where: {
      OR: [
        {
          driverId,
        },
        {
          planningRow: {
            driverId,
          },
        },
      ],
    },
    orderBy: [
      {
        scheduledDate: 'asc',
      },
      {
        sortOrder: 'asc',
      },
    ],
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
}

function getAssignmentTimestamp(
  assignment: NonNullable<
    Awaited<ReturnType<typeof getDriverAssignments>>
  >[number]
) {
  return (
    assignment.scheduledDate ??
    assignment.mission.pickupDate ??
    assignment.mission.createdAt
  ).getTime()
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
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

  try {
    const [driver, assignments] = await Promise.all([
      prisma.driver.findUnique({
        where: {
          id: sessionUser.driverId,
        },
        select: {
          id: true,
          name: true,
          phone: true,
          status: true,
          usualTruck: true,
        },
      }),
      getDriverAssignments(sessionUser.driverId),
    ])

    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' })
    }

    const activeCandidates = assignments
      .filter(
        (assignment) =>
          assignment.mission.status !== MissionStatus.DONE &&
          assignment.mission.status !== MissionStatus.CANCELLED
      )
      .sort((firstAssignment, secondAssignment) => {
        const priorityDiff =
          getMissionPriority(firstAssignment.mission.status) -
          getMissionPriority(secondAssignment.mission.status)

        if (priorityDiff !== 0) {
          return priorityDiff
        }

        const timestampDiff =
          getAssignmentTimestamp(firstAssignment) -
          getAssignmentTimestamp(secondAssignment)

        if (timestampDiff !== 0) {
          return timestampDiff
        }

        if (firstAssignment.sortOrder !== secondAssignment.sortOrder) {
          return firstAssignment.sortOrder - secondAssignment.sortOrder
        }

        return (
          firstAssignment.mission.createdAt.getTime() -
          secondAssignment.mission.createdAt.getTime()
        )
      })

    const activeAssignment = activeCandidates[0] ?? null
    const truck =
      activeAssignment?.planningRow?.truck ??
      activeAssignment?.truck ??
      driver.usualTruck ??
      null
    const trailer = truck
      ? await prisma.trailer.findFirst({
          where: {
            truckId: truck.id,
          },
          orderBy: {
            plateNumber: 'asc',
          },
        })
      : null

    return res.status(200).json({
      driver: {
        id: driver.id,
        name: driver.name,
        phone: driver.phone,
        status: driver.status,
      },
      truck: truck
        ? {
            id: truck.id,
            plateNumber: truck.plateNumber,
            brand: truck.brand,
            model: truck.model,
            status: truck.status,
          }
        : null,
      trailer: trailer
        ? {
            id: trailer.id,
            plateNumber: trailer.plateNumber,
            type: trailer.type,
            status: trailer.status,
          }
        : null,
      activeMission: activeAssignment
        ? mapMissionAssignment(activeAssignment)
        : null,
      upcomingMissions: activeCandidates
        .slice(activeAssignment ? 1 : 0, activeAssignment ? 6 : 5)
        .map(mapMissionAssignment),
    })
  } catch (error) {
    console.error('Failed to load driver overview', {
      driverId: sessionUser.driverId,
      error,
    })
    return res.status(500).json({ error: 'Failed to load driver overview' })
  }
}

export default withTenantApiRoute(handler)
