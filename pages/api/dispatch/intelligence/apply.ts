import { withTenantApiRoute } from '../../../../lib/auth/authorization'
import type { NextApiRequest, NextApiResponse } from 'next'
import { applyPlanningSuggestion, SuggestionApplicationError, verifyPendingApplyToken } from '@prolific/gerard-core/intelligence'

import { requireOrganizationModule, requirePermission } from '../../../../lib/auth/authorization'
import { permissions } from '../../../../lib/auth/permissions'

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ status: 'INVALID', error: 'Méthode non autorisée' })
  }
  const user = await requirePermission(req, res, permissions.dispatchAssign)
  if (!user) return
  if (!(await requireOrganizationModule(req, res, 'INTELLIGENCE'))) return

  // Une application est toujours la confirmation d'une action émise par le
  // serveur à la simulation. La suggestion, l'empreinte, la semaine et la clé
  // d'idempotence sont relues dans le jeton signé, jamais dans le corps.
  const token = typeof req.body?.token === 'string' ? req.body.token : ''
  const pending = token ? verifyPendingApplyToken(token, user.id) : null
  if (!pending) {
    return res.status(400).json({
      status: 'INVALID',
      error: 'Cette confirmation n’est plus valide. Relancez la simulation avant d’appliquer.',
    })
  }

  try {
    const result = await applyPlanningSuggestion({
      userId: user.id,
      suggestionId: pending.suggestionId,
      weekStart: pending.weekStart,
      snapshotFingerprint: pending.snapshotFingerprint,
      evidenceFingerprint: pending.evidenceFingerprint,
      idempotencyKey: pending.idempotencyKey,
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
    if (error instanceof Error && 'code' in error) {
      // P2034 : écriture concurrente sérialisée. P2002 : la clé d'idempotence
      // existe déjà. Les deux sont des conflits explicites, pas des pannes.
      if (error.code === 'P2034') {
        return res.status(409).json({
          status: 'CONFLICT',
          error: 'Le planning a été modifié simultanément. Relancez l’analyse.',
        })
      }
      if (error.code === 'P2002') {
        return res.status(409).json({
          status: 'CONFLICT',
          error: 'Une application porte déjà cette clé d’idempotence. Relancez la simulation.',
        })
      }
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
