import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../../lib/auth/authorization'
import { permissions } from '../../../../lib/auth/permissions'
import { parseWeekStartParam } from '../../../../lib/dispatch/date-utils'
import { ensurePlanningRowsForWeek } from '../../../../lib/dispatch/planning-rows'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requirePermission(req, res, permissions.dispatchAssign))) return
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const weekStartDate = typeof req.body?.weekStart === 'string'
    ? parseWeekStartParam(req.body.weekStart)
    : null
  if (!weekStartDate) {
    return res.status(400).json({ error: 'Invalid weekStart' })
  }

  try {
    return res.status(200).json(await ensurePlanningRowsForWeek(weekStartDate))
  } catch (error) {
    console.error('Failed to initialize planning rows', error)
    return res.status(500).json({ error: 'Failed to initialize planning rows' })
  }
}
