import { withTenantApiRoute } from '../../../../lib/auth/authorization'
import type { NextApiRequest, NextApiResponse } from 'next'
import { analyzePlanningForSuggestions, buildPendingApplyAction, describeSuggestion } from '@prolific/gerard-core/intelligence'
import { requireOrganizationModule, requirePermission } from '../../../../lib/auth/authorization'
import { hasPermission, permissions } from '../../../../lib/auth/permissions'
import { parseWeekStartParam } from '../../../../lib/dispatch/date-utils'

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ status: 'INVALID', error: 'Méthode non autorisée' })
  }
  const user = await requirePermission(req, res, permissions.dispatchView)
  if (!user) return
  if (!(await requireOrganizationModule(req, res, 'INTELLIGENCE'))) return
  const rawWeekStart = typeof req.body?.weekStart === 'string' ? req.body.weekStart : ''
  const weekStart = parseWeekStartParam(rawWeekStart)
  const missionId = typeof req.body?.missionId === 'string' ? req.body.missionId : null
  const proposedPairRowId = typeof req.body?.proposedPairRowId === 'string' ? req.body.proposedPairRowId : null
  if (!weekStart || !missionId || !proposedPairRowId) return res.status(400).json({ status: 'INVALID', error: 'Simulation invalide' })
  try {
    const analysis = await analyzePlanningForSuggestions(weekStart)
    const suggestion = analysis.suggestions.find((item) => item.affectedMissionIds.includes(missionId) && item.proposedState.pairRowId === proposedPairRowId)
    if (!suggestion) {
      return res.status(200).json({ status: 'STALE', analyzedAt: analysis.analyzedAt, snapshotFingerprint: analysis.snapshotFingerprint })
    }
    // L'action d'application est émise ici, par le serveur, sur la suggestion
    // qu'il vient de revalider. Sans permission d'affectation, la simulation
    // reste une lecture et ne propose aucune action.
    const pendingApply = hasPermission(user, permissions.dispatchAssign)
      ? buildPendingApplyAction({
          userId: user.id,
          weekStart: rawWeekStart,
          suggestionId: suggestion.id,
          snapshotFingerprint: suggestion.snapshotFingerprint,
          evidenceFingerprint: suggestion.evidenceFingerprint,
          missionReference: suggestion.currentState.missionReference,
          summary: describeSuggestion(suggestion),
        })
      : null
    return res.status(200).json({
      status: 'VALID',
      suggestion,
      analyzedAt: analysis.analyzedAt,
      snapshotFingerprint: analysis.snapshotFingerprint,
      pendingApply,
    })
  } catch (error) {
    // Une simulation qui échoue ne doit jamais ressembler à une simulation valide.
    console.error('Planning intelligence simulation failed', error instanceof Error ? error.message : error)
    return res.status(503).json({ status: 'ERROR', error: 'Gerard n’a pas pu revérifier cette suggestion.' })
  }
}

export default withTenantApiRoute(handler)
