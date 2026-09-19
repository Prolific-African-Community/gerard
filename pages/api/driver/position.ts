import type { NextApiRequest, NextApiResponse } from 'next'

import { requireActiveUser } from '../../../lib/auth/authorization'
import { prisma } from '../../../lib/prisma'

type PositionPayload = {
  latitude: number
  longitude: number
  accuracy?: number | null
  speedKmh?: number | null
  heading?: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getOptionalNumber(value: unknown): number | null | undefined {
  if (typeof value === 'undefined') {
    return undefined
  }

  if (value === null || value === '') {
    return null
  }

  const numberValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
      ? Number(value)
      : Number.NaN

  return Number.isFinite(numberValue) ? numberValue : undefined
}

function parsePayload(body: unknown): PositionPayload | null {
  if (!isRecord(body)) {
    return null
  }

  const latitude = getOptionalNumber(body.latitude)
  const longitude = getOptionalNumber(body.longitude)
  const accuracy = getOptionalNumber(body.accuracy)
  const speedKmh = getOptionalNumber(body.speedKmh)
  const heading = getOptionalNumber(body.heading)

  if (
    typeof latitude !== 'number' ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== 'number' ||
    longitude < -180 ||
    longitude > 180 ||
    (typeof accuracy !== 'undefined' && accuracy !== null && accuracy < 0) ||
    (typeof speedKmh !== 'undefined' && speedKmh !== null && speedKmh < 0) ||
    (typeof heading !== 'undefined' &&
      heading !== null &&
      (heading < 0 || heading > 360))
  ) {
    return null
  }

  return {
    latitude,
    longitude,
    accuracy,
    speedKmh,
    heading,
  }
}

async function getAssignedTruckId(driverId: string) {
  const directTruck = await prisma.truck.findFirst({
    where: {
      driverId,
    },
    orderBy: {
      plateNumber: 'asc',
    },
    select: {
      id: true,
    },
  })

  if (directTruck) {
    return directTruck.id
  }

  const planningRow = await prisma.planningRow.findFirst({
    where: {
      driverId,
      truckId: {
        not: null,
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
    select: {
      truckId: true,
    },
  })

  return planningRow?.truckId ?? null
}

export default async function handler(
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

  if (sessionUser.role !== 'DRIVER' || !sessionUser.driverId) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const payload = parsePayload(req.body)

  if (!payload) {
    return res.status(400).json({ error: 'Invalid position payload' })
  }

  try {
    const truckId = await getAssignedTruckId(sessionUser.driverId)
    const position = await prisma.driverPosition.create({
      data: {
        driverId: sessionUser.driverId,
        truckId,
        latitude: payload.latitude,
        longitude: payload.longitude,
        accuracy: payload.accuracy ?? null,
        speedKmh: payload.speedKmh ?? null,
        heading: payload.heading ?? null,
        provider:
          process.env.NODE_ENV !== 'production' &&
          sessionUser.username === 'marc.denis' &&
          req.body.demoSimulation === true
            ? 'DEMO_SIMULATED'
            : 'DRIVER_PHONE',
        recordedAt: new Date(),
      },
    })

    return res.status(201).json({
      position,
      truckId,
    })
  } catch (error) {
    console.error('Failed to save driver position', {
      driverId: sessionUser.driverId,
      error,
    })
    return res.status(500).json({ error: 'Failed to save driver position' })
  }
}
