import { withTenantApiRoute } from '../../../../lib/auth/authorization'
import type { NextApiRequest, NextApiResponse } from 'next'
import { analyzePlanningForSuggestions } from '@prolific/gerard-core/intelligence'
import { requireOrganizationModule, requirePermission } from '../../../../lib/auth/authorization'
import { permissions } from '../../../../lib/auth/permissions'
import { parseWeekStartParam } from '../../../../lib/dispatch/date-utils'

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })
  const user = await requirePermission(req, res, permissions.dispatchView)
  if (!user) return
  if (!(await requireOrganizationModule(req, res, 'INTELLIGENCE'))) return
  const weekStart = parseWeekStartParam(typeof req.body?.weekStart === 'string' ? req.body.weekStart : '')
  const missionId = typeof req.body?.missionId === 'string' ? req.body.missionId : null
  const proposedPairRowId = typeof req.body?.proposedPairRowId === 'string' ? req.body.proposedPairRowId : null
  if (!weekStart || !missionId || !proposedPairRowId) return res.status(400).json({ status: 'INVALID', error: 'Simulation invalide' })
  try {
    const analysis = await analyzePlanningForSuggestions(weekStart)
    const suggestion = analysis.suggestions.find((item) => item.affectedMissionIds.includes(missionId) && item.proposedState.pairRowId === proposedPairRowId)
    return res.status(200).json(suggestion ? { status: 'VALID', suggestion, analyzedAt: analysis.analyzedAt, snapshotFingerprint: analysis.snapshotFingerprint } : { status: 'STALE', analyzedAt: analysis.analyzedAt, snapshotFingerprint: analysis.snapshotFingerprint })
  } catch (error) {
    // Une simulation qui échoue ne doit jamais ressembler à une simulation valide.
    console.error('Planning intelligence simulation failed', error instanceof Error ? error.message : error)
    return res.status(503).json({ status: 'ERROR', error: 'Gerard n’a pas pu revérifier cette suggestion.' })
  }
}

export default withTenantApiRoute(handler)
