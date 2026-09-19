import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../../lib/auth/authorization'
import { permissions } from '../../../../lib/auth/permissions'
import { prepareMission } from '../../../../lib/dispatch/mission-preparation/service'
import { prisma } from '../../../../lib/prisma'

const maximumBatchSize = 10

function parseBody(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const body = value as Record<string, unknown>
  if (
    !Array.isArray(body.missionIds) ||
    body.missionIds.length < 1 ||
    body.missionIds.length > maximumBatchSize ||
    body.missionIds.some(
      (missionId) => typeof missionId !== 'string' || !missionId.trim()
    )
  ) {
    return null
  }
  return {
    missionIds: Array.from(
      new Set(body.missionIds.map((missionId) => String(missionId).trim()))
    ),
    force: body.force === true,
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (!(await requirePermission(req, res, permissions.missionsEdit))) return
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }
  const body = parseBody(req.body)
  if (!body) {
    return res.status(400).json({ error: 'Liste de missions invalide.' })
  }
  const existing = await prisma.mission.findMany({
    where: { id: { in: body.missionIds } },
    select: { id: true },
  })
  const existingIds = new Set(existing.map((mission) => mission.id))
  const results: Array<{
    missionId: string
    status: 'PREPARED' | 'FAILED' | 'NOT_FOUND'
    preparationStatus?: string
    error?: string
  }> = []
  for (const missionId of body.missionIds) {
    if (!existingIds.has(missionId)) {
      results.push({ missionId, status: 'NOT_FOUND' })
      continue
    }
    try {
      const mission = await prepareMission(missionId, { force: body.force })
      results.push({
        missionId,
        status: 'PREPARED',
        preparationStatus: mission.preparationStatus,
      })
    } catch (error) {
      results.push({
        missionId,
        status: 'FAILED',
        error:
          error instanceof Error
            ? error.message
            : 'MISSION_PREPARATION_FAILED',
      })
    }
  }
  return res.status(200).json({ results })
}
