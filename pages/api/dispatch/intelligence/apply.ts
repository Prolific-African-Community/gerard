import { withTenantApiRoute } from '../../../../lib/auth/authorization'
import type { NextApiRequest, NextApiResponse } from 'next'
import { applyPlanningSuggestion, SuggestionApplicationError } from '@prolific/gerard-core/intelligence'

import { requireOrganizationModule, requirePermission } from '../../../../lib/auth/authorization'
import { permissions } from '../../../../lib/auth/permissions'

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }
  const user = await requirePermission(req, res, permissions.dispatchAssign)
  if (!user) return
  if (!(await requireOrganizationModule(req, res, 'INTELLIGENCE'))) return
  const suggestionId =
    typeof req.body?.suggestionId === 'string' ? req.body.suggestionId : ''
  const weekStart =
    typeof req.body?.weekStart === 'string' ? req.body.weekStart : ''
  const snapshotFingerprint =
    typeof req.body?.snapshotFingerprint === 'string'
      ? req.body.snapshotFingerprint
      : ''
  const idempotencyKey =
    typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey : ''
  try {
    const result = await applyPlanningSuggestion({
      userId: user.id,
      suggestionId,
      weekStart,
      snapshotFingerprint,
      idempotencyKey,
    })
    return res.status(200).json(result)
  } catch (error) {
    if (error instanceof SuggestionApplicationError) {
      const httpStatus =
        error.status === 'INVALID'
          ? 400
          : error.status === 'STALE' || error.status === 'CONFLICT'
            ? 409
            : 500
      return res.status(httpStatus).json({
        status: error.status,
        error: error.message,
      })
    }
    if (error instanceof Error && 'code' in error && error.code === 'P2034') {
      return res.status(409).json({
        status: 'CONFLICT',
        error: 'Le planning a été modifié simultanément. Relancez l’analyse.',
      })
    }
    console.error(
      'Planning intelligence application failed',
      error instanceof Error ? error.message : error
    )
    return res.status(500).json({
      status: 'INVALID',
      error: 'Gerard n’a pas pu appliquer cette suggestion.',
    })
  }
}

export default withTenantApiRoute(handler)
