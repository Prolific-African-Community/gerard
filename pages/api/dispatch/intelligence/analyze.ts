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
  if (!weekStart) return res.status(400).json({ error: 'Semaine invalide' })
  try {
    return res.status(200).json(await analyzePlanningForSuggestions(weekStart))
  } catch (error) {
    console.error('Planning intelligence analysis failed', error instanceof Error ? error.message : error)
    return res.status(500).json({ error: 'Gerard n’a pas pu analyser cette semaine.' })
  }
}

export default withTenantApiRoute(handler)
