import type { NextApiRequest, NextApiResponse } from 'next'
import { requirePermission } from '../../../lib/auth/authorization'
import { permissions } from '../../../lib/auth/permissions'

import { NOVOTRALUX_BASE } from '../../../lib/dispatch/base-location'
import { prisma } from '../../../lib/prisma'

type ReturnToBaseRouteResponse = {
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

function isRequestBody(value: unknown): value is {
  truckId: string
  forceRefresh?: boolean
} {
  if (!value || typeof value !== 'object') {
    return false
  }

  const body = value as Record<string, unknown>

  return (
    typeof body.truckId === 'string' &&
    body.truckId.trim().length > 0 &&
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
  truckId,
  distanceMeters,
  durationSeconds,
  polyline,
  cached,
}: {
  truckId: string
  distanceMeters: number
  durationSeconds: number
  polyline: string
  cached: boolean
}): ReturnToBaseRouteResponse {
  return {
    truckId,
    distanceMeters,
    distanceKm: Math.round(distanceMeters / 1000),
    durationSeconds,
    durationLabel: formatDuration(durationSeconds),
    polyline,
    cached,
  }
}

export default async function handler(
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
    })
  }

  const truckId = req.body.truckId.trim()
  const forceRefresh = req.body.forceRefresh === true

  try {
    const truck = await prisma.truck.findUnique({
      where: {
        id: truckId,
      },
    })

    if (!truck) {
      return res.status(404).json({
        error: 'Truck not found',
      })
    }

    if (
      !forceRefresh &&
      typeof truck.returnToBaseDistanceMeters === 'number' &&
      typeof truck.returnToBaseDurationSeconds === 'number' &&
      typeof truck.returnToBasePolyline === 'string' &&
      truck.returnToBasePolyline.length > 0
    ) {
      return res.status(200).json(
        buildRouteResponse({
          truckId: truck.id,
          distanceMeters: truck.returnToBaseDistanceMeters,
          durationSeconds: truck.returnToBaseDurationSeconds,
          polyline: truck.returnToBasePolyline,
          cached: true,
        })
      )
    }

    const truckPosition = await prisma.driverPosition.findFirst({
      where: {
        truckId,
      },
      orderBy: {
        recordedAt: 'desc',
      },
    })

    if (!truckPosition) {
      return res.status(400).json({
        error: 'No truck position',
        truckId,
      })
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY

    if (!apiKey) {
      return res.status(500).json({
        error: 'GOOGLE_MAPS_API_KEY is missing',
      })
    }

    const googleResponse = await fetch(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask':
            'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
        },
        body: JSON.stringify({
          origin: {
            location: {
              latLng: {
                latitude: truckPosition.latitude,
                longitude: truckPosition.longitude,
              },
            },
          },
          destination: {
            location: {
              latLng: {
                latitude: NOVOTRALUX_BASE.lat,
                longitude: NOVOTRALUX_BASE.lng,
              },
            },
          },
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_AWARE',
          computeAlternativeRoutes: false,
          languageCode: 'fr-FR',
          units: 'METRIC',
        }),
      }
    )

    if (!googleResponse.ok) {
      const errorPayload = await googleResponse.text()

      console.error('Google return-to-base route request failed', {
        status: googleResponse.status,
        payload: errorPayload,
        truckId,
      })

      return res.status(500).json({
        error: 'Google Routes request failed',
        status: googleResponse.status,
        details: errorPayload,
      })
    }

    const routeData = (await googleResponse.json()) as GoogleRoutesResponse
    const route = routeData.routes?.[0]
    const distanceMeters = route?.distanceMeters
    const durationSeconds = parseGoogleDuration(route?.duration)
    const polyline = route?.polyline?.encodedPolyline

    if (
      typeof distanceMeters !== 'number' ||
      typeof durationSeconds !== 'number' ||
      typeof polyline !== 'string' ||
      polyline.length === 0
    ) {
      return res.status(500).json({
        error: 'Invalid Google Routes response',
      })
    }

    await prisma.truck.update({
      where: {
        id: truck.id,
      },
      data: {
        returnToBaseDistanceMeters: distanceMeters,
        returnToBaseDurationSeconds: durationSeconds,
        returnToBasePolyline: polyline,
        returnToBaseCalculatedAt: new Date(),
        returnToBaseProvider: 'GOOGLE_ROUTES',
      },
    })

    return res.status(200).json(
      buildRouteResponse({
        truckId: truck.id,
        distanceMeters,
        durationSeconds,
        polyline,
        cached: false,
      })
    )
  } catch (error) {
    console.error('Failed to compute return-to-base route', error)

    return res.status(500).json({
      error: 'Failed to compute return-to-base route',
    })
  }
}
