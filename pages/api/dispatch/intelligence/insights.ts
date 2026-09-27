import type { NextApiRequest, NextApiResponse } from 'next'

import { buildPlanningInsights } from '@prolific/gerard-core/intelligence'
import { withTenantApiRoute } from '../../../../lib/auth/authorization'
import { requireOrganizationModule, requirePermission } from '../../../../lib/auth/authorization'
import { permissions } from '../../../../lib/auth/permissions'
import { parseWeekStartParam } from '../../../../lib/dispatch/date-utils'

/**
 * Surface proactive, strictement en lecture. Aucune écriture, aucun appel au
 * fournisseur de modèle : le contenu est entièrement déterministe.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ status: 'INVALID', error: 'Méthode non autorisée' })
  }
  const user = await requirePermission(req, res, permissions.dispatchView)
  if (!user) return
  if (!(await requireOrganizationModule(req, res, 'INTELLIGENCE'))) return
  const weekStart = parseWeekStartParam(typeof req.body?.weekStart === 'string' ? req.body.weekStart : '')
  if (!weekStart) return res.status(400).json({ status: 'INVALID', error: 'Semaine invalide' })
  try {
    return res.status(200).json({ status: 'OK', ...(await buildPlanningInsights({ weekStart })) })
  } catch (error) {
    console.error('Planning intelligence insights failed', error instanceof Error ? error.message : error)
    return res.status(503).json({ status: 'ERROR', error: 'Gerard n’a pas pu analyser cette semaine.' })
  }
}

export default withTenantApiRoute(handler)
