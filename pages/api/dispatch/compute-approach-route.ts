import { withTenantApiRoute } from '../../../lib/auth/authorization'
import type { NextApiRequest, NextApiResponse } from 'next'
import { requirePermission } from '../../../lib/auth/authorization'
import { permissions } from '../../../lib/auth/permissions'

import { prisma } from '../../../lib/prisma'
import { computeGoogleRoute } from '../../../lib/dispatch/maps/google'

type ApproachRouteResponse = {
  assignmentId: string
  missionId: string
  truckId: string
  distanceMeters: number
  distanceKm: number
  durationSeconds: number
  durationLabel: string
  polyline: string
  cached: boolean
}

type GoogleRoute = {
  duration?: string
  distanceMeters?: number
  polyline?: {
    encodedPolyline?: string
  }
}

type GoogleRoutesResponse = {
  routes?: GoogleRoute[]
}

function getErrorDetails(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isRequestBody(value: unknown): value is {
  assignmentId: string
  forceRefresh?: boolean
} {
  if (!value || typeof value !== 'object') {
    return false
  }

  const body = value as Record<string, unknown>

  return (
    typeof body.assignmentId === 'string' &&
    body.assignmentId.trim().length > 0 &&
    (typeof body.forceRefresh === 'undefined' ||
      typeof body.forceRefresh === 'boolean')
  )
}

function parseGoogleDuration(duration: string | undefined) {
  if (!duration) {
    return null
  }

  const seconds = Math.round(Number.parseFloat(duration.replace('s', '')))

  return Number.isFinite(seconds) ? seconds : null
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)

  if (hours <= 0) {
    return `${minutes} min`
  }

  return `${hours} h ${String(minutes).padStart(2, '0')}`
}

function buildRouteResponse({
  assignmentId,
  missionId,
  truckId,
  distanceMeters,
  durationSeconds,
  polyline,
  cached,
}: {
  assignmentId: string
  missionId: string
  truckId: string
  distanceMeters: number
  durationSeconds: number
  polyline: string
  cached: boolean
}): ApproachRouteResponse {
  return {
    assignmentId,
    missionId,
    truckId,
    distanceMeters,
    distanceKm: Math.round(distanceMeters / 1000),
    durationSeconds,
    durationLabel: formatDuration(durationSeconds),
    polyline,
    cached,
  }
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (!(await requirePermission(req, res, permissions.dispatchAssign))) return
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({
      error: 'Method not allowed',
    })
  }

  if (!isRequestBody(req.body)) {
    return res.status(400).json({
      error: 'Invalid request body',
      reason: 'invalid_body',
      details: req.body,
    })
  }

  const assignmentId = req.body.assignmentId.trim()
  const forceRefresh = req.body.forceRefresh === true

  try {
    const assignment = await prisma.missionAssignment.findUnique({
      where: {
        id: assignmentId,
      },
      include: {
        mission: true,
        truck: true,
        driver: true,
      },
    })

    if (!assignment) {
      console.error('Approach route failed: missing assignment', {
        assignmentId,
      })

      return res.status(404).json({
        error: 'Assignment not found',
        reason: 'missing_assignment',
        assignmentId,
      })
    }

    if (!assignment.truckId) {
      console.error('Approach route failed: missing truckId', {
        assignmentId,
        missionId: assignment.missionId,
      })

      return res.status(400).json({
        error: 'Assignment has no truck',
        reason: 'missing_truck_id',
        assignmentId,
        missionId: assignment.missionId,
        truckId: assignment.truckId,
      })
    }

    if (
      typeof assignment.mission.pickupLat !== 'number' ||
      typeof assignment.mission.pickupLng !== 'number'
    ) {
      console.error('Approach route failed: missing pickup coordinates', {
        assignmentId,
        truckId: assignment.truckId,
        missionId: assignment.missionId,
        pickupLat: assignment.mission.pickupLat,
        pickupLng: assignment.mission.pickupLng,
      })

      return res.status(400).json({
        error: 'Missing pickup coordinates',
        reason: 'missing_pickup_coordinates',
        assignmentId,
        truckId: assignment.truckId,
        missionId: assignment.missionId,
        details: {
          pickupLat: assignment.mission.pickupLat,
          pickupLng: assignment.mission.pickupLng,
        },
      })
    }

    if (
      !forceRefresh &&
      typeof assignment.approachDistanceMeters === 'number' &&
      typeof assignment.approachDurationSeconds === 'number' &&
      typeof assignment.approachPolyline === 'string' &&
      assignment.approachPolyline.length > 0
    ) {
      return res.status(200).json(
        buildRouteResponse({
          assignmentId: assignment.id,
          missionId: assignment.missionId,
          truckId: assignment.truckId,
          distanceMeters: assignment.approachDistanceMeters,
          durationSeconds: assignment.approachDurationSeconds,
          polyline: assignment.approachPolyline,
          cached: true,
        })
      )
    }

    const truckPosition = await prisma.driverPosition.findFirst({
      where: {
        truckId: assignment.truckId,
      },
      orderBy: {
        recordedAt: 'desc',
      },
    })

    if (!truckPosition) {
      console.error('Approach route failed: missing truck position', {
        assignmentId,
        truckId: assignment.truckId,
        missionId: assignment.missionId,
      })

      return res.status(400).json({
        error: 'No truck position',
        reason: 'missing_truck_position',
        assignmentId,
        truckId: assignment.truckId,
        missionId: assignment.missionId,
      })
    }

    const route = await computeGoogleRoute({
      origin: { latitude: truckPosition.latitude, longitude: truckPosition.longitude },
      destination: {
        latitude: assignment.mission.pickupLat,
        longitude: assignment.mission.pickupLng,
      },
    })
    const { distanceMeters, durationSeconds, polyline } = route

    await prisma.missionAssignment.update({
      where: {
        id: assignment.id,
      },
      data: {
        approachDistanceMeters: distanceMeters,
        approachDurationSeconds: durationSeconds,
        approachPolyline: polyline,
        approachCalculatedAt: new Date(),
        approachProvider: 'GOOGLE_ROUTES',
      },
    })

    return res.status(200).json(
      buildRouteResponse({
        assignmentId: assignment.id,
        missionId: assignment.missionId,
        truckId: assignment.truckId,
        distanceMeters,
        durationSeconds,
        polyline,
        cached: false,
      })
    )
  } catch (error) {
    console.error('Failed to compute approach route', {
      assignmentId,
      details: error,
    })

    return res.status(500).json({
      error: 'Failed to compute approach route',
      reason: 'server_error',
      assignmentId,
      details: getErrorDetails(error),
    })
  }
}

export default withTenantApiRoute(handler)
