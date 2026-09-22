import { withTenantApiRoute } from '../../../../lib/auth/authorization'
import {
  AddressResolutionMethod,
  AddressResolutionStatus,
  MissionEventType,
  MissionPreparationStatus,
  Prisma,
} from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../../lib/auth/authorization'
import { permissions } from '../../../../lib/auth/permissions'
import { getGooglePlaceDetails } from '../../../../lib/dispatch/maps/google'
import { prepareMission } from '../../../../lib/dispatch/mission-preparation/service'
import { prisma } from '../../../../lib/prisma'

function parseBody(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const body = value as Record<string, unknown>
  if (
    typeof body.missionId !== 'string' ||
    (body.endpoint !== 'pickup' && body.endpoint !== 'delivery') ||
    typeof body.placeId !== 'string' ||
    !body.placeId.trim()
  ) {
    return null
  }
  return {
    missionId: body.missionId.trim(),
    endpoint: body.endpoint,
    placeId: body.placeId.trim(),
  } as const
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const user = await requirePermission(req, res, permissions.missionsEdit)
  if (!user) return
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }
  const body = parseBody(req.body)
  if (!body) return res.status(400).json({ error: 'Sélection invalide.' })
  const mission = await prisma.mission.findUnique({
    where: { id: body.missionId },
  })
  if (!mission) return res.status(404).json({ error: 'Mission introuvable.' })
  try {
    const place = await getGooglePlaceDetails(body.placeId)
    const prefix = body.endpoint
    await prisma.$transaction([
      prisma.mission.update({
        where: { id: mission.id },
        data: {
          [`${prefix}Address`]: place.formattedAddress,
          [`${prefix}ResolvedAddress`]: place.formattedAddress,
          [`${prefix}PlaceId`]: place.placeId,
          [`${prefix}Lat`]: place.latitude,
          [`${prefix}Lng`]: place.longitude,
          [`${prefix}ResolutionStatus`]: AddressResolutionStatus.CONFIRMED,
          [`${prefix}ResolutionMethod`]: AddressResolutionMethod.MANUAL,
          [`${prefix}ResolutionConfidence`]: 1,
          [`${prefix}ResolvedAt`]: new Date(),
          [`${prefix}ResolutionReason`]:
            'Adresse confirmée manuellement par le dispatcher.',
          routeDistanceMeters: null,
          routeDurationSeconds: null,
          routePolyline: null,
          routeCalculatedAt: null,
          routeProvider: null,
          preparationStatus: MissionPreparationStatus.PENDING,
          preparationMissingData: Prisma.DbNull,
          preparationError: null,
        },
      }),
      prisma.missionEvent.create({
        data: {
          missionId: mission.id,
          actorId: user.id,
          type: MissionEventType.NOTE_ADDED,
          message: `Adresse ${prefix} confirmée manuellement.`,
          metadata: {
            source: 'manual_address_resolution',
            endpoint: prefix,
            placeId: place.placeId,
            formattedAddress: place.formattedAddress,
          },
        },
      }),
    ])
    const prepared = await prepareMission(mission.id, { force: true })
    return res.status(200).json({ mission: prepared })
  } catch (error) {
    console.error('Address confirmation failed', error)
    return res.status(502).json({
      error: 'Impossible de confirmer cette adresse.',
    })
  }
}

export default withTenantApiRoute(handler)
