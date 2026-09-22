import { withTenantApiRoute } from '../../../../lib/auth/authorization'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../../lib/auth/authorization'
import { permissions } from '../../../../lib/auth/permissions'
import {
  applyAutoPlanning,
  AutoPlanningConflictError,
} from '../../../../lib/dispatch/auto-planning/application'
import { optimizationStrategies } from '../../../../lib/dispatch/optimization'
import type { ApplyRequest } from '../../../../lib/dispatch/auto-planning/types'

function parseBody(body: unknown): ApplyRequest | null {
  if (!body || typeof body !== 'object') return null
  const value = body as Record<string, unknown>
  if (
    typeof value.snapshotToken !== 'string' ||
    typeof value.snapshotFingerprint !== 'string' ||
    typeof value.simulationId !== 'string' ||
    typeof value.idempotencyKey !== 'string' ||
    value.idempotencyKey.length < 12 ||
    value.idempotencyKey.length > 120 ||
    typeof value.strategy !== 'string' ||
    !optimizationStrategies.includes(
      value.strategy as typeof optimizationStrategies[number]
    ) ||
    !Array.isArray(value.selectedMissionIds) ||
    value.selectedMissionIds.length > 100 ||
    !value.selectedMissionIds.every((id) => typeof id === 'string') ||
    !Array.isArray(value.confirmedConditionalMissionIds) ||
    value.confirmedConditionalMissionIds.length > 100 ||
    !value.confirmedConditionalMissionIds.every(
      (id) => typeof id === 'string'
    ) ||
    !Array.isArray(value.adjustments) ||
    value.adjustments.length > 100 ||
    !value.adjustments.every(
      (adjustment) =>
        adjustment &&
        typeof adjustment === 'object' &&
        typeof (adjustment as Record<string, unknown>).missionId === 'string' &&
        typeof (adjustment as Record<string, unknown>).pairRowId === 'string' &&
        (typeof (adjustment as Record<string, unknown>).trailerId ===
          'string' ||
          (adjustment as Record<string, unknown>).trailerId === null)
    )
  ) {
    return null
  }
  return value as unknown as ApplyRequest
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const user = await requirePermission(req, res, permissions.dispatchAssign)
  if (!user) return
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }
  const request = parseBody(req.body)
  if (!request) {
    return res.status(400).json({ error: 'Demande d’application invalide' })
  }
  try {
    const result = await applyAutoPlanning({ userId: user.id, request })
    return res.status(200).json(result)
  } catch (error) {
    if (error instanceof AutoPlanningConflictError) {
      return res.status(409).json({
        error: error.message,
        code: error.code,
        stale: [
          'SNAPSHOT_STALE',
          'SIMULATION_EXPIRED',
          'SNAPSHOT_MISMATCH',
        ].includes(error.code),
      })
    }
    console.error('Auto-planning application failed', error)
    return res.status(500).json({
      error: 'Aucune modification n’a été appliquée.',
    })
  }
}

export default withTenantApiRoute(handler)
