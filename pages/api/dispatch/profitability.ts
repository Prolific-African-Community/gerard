import { withTenantApiRoute } from '../../../lib/auth/authorization'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../lib/auth/authorization'
import { permissions } from '../../../lib/auth/permissions'
import {
  computeWeeklyProfitability,
  getBodyMoneyValue,
  getNumberParam,
  getRequestedWeekStartDate,
  saveWeeklyProfitabilityAdjustment,
} from '../../../lib/dispatch/profitability'
import { parseWeekStartParam } from '../../../lib/dispatch/date-utils'

function getBodyWeekStartDate(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  return parseWeekStartParam(value)
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const permission = req.method === 'GET' ? permissions.profitabilityView : permissions.profitabilityManage
  const sessionUser = await requirePermission(req, res, permission)

  if (!sessionUser) {
    return
  }

  if (req.method !== 'GET' && req.method !== 'PATCH' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, PATCH, POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (req.method === 'PATCH' || req.method === 'POST') {
    const weekStartDate = getBodyWeekStartDate(
      req.body?.weekStartDate ?? req.body?.weekStart
    )
    const tollCostAmount = getBodyMoneyValue(req.body?.tollCostAmount)

    if (!weekStartDate) {
      return res.status(400).json({ error: 'Invalid weekStartDate' })
    }

    if (tollCostAmount === null) {
      return res.status(400).json({ error: 'Invalid tollCostAmount' })
    }

    try {
      await saveWeeklyProfitabilityAdjustment({
        weekStartDate,
        tollCostAmount,
      })

      const profitability = await computeWeeklyProfitability({
        weekStartDate,
        fuelPricePerLiter: getNumberParam(req.query.fuelPricePerLiter, 1.65),
        defaultConsumptionL100: getNumberParam(
          req.query.defaultConsumptionL100,
          30
        ),
        defaultDriverHourlyCost: getNumberParam(
          req.query.defaultDriverHourlyCost,
          20
        ),
      })

      return res.status(200).json(profitability)
    } catch (error) {
      console.error('Failed to save profitability adjustment', error)
      return res
        .status(500)
        .json({ error: 'Failed to save profitability adjustment' })
    }
  }

  const weekStartDate = getRequestedWeekStartDate(req.query.weekStart)

  if (!weekStartDate) {
    return res.status(400).json({ error: 'Invalid weekStart' })
  }

  try {
    const profitability = await computeWeeklyProfitability({
      weekStartDate,
      fuelPricePerLiter: getNumberParam(req.query.fuelPricePerLiter, 1.65),
      defaultConsumptionL100: getNumberParam(
        req.query.defaultConsumptionL100,
        30
      ),
      defaultDriverHourlyCost: getNumberParam(
        req.query.defaultDriverHourlyCost,
        20
      ),
    })

    return res.status(200).json(profitability)
  } catch (error) {
    console.error('Failed to compute profitability', error)
    return res.status(500).json({ error: 'Failed to compute profitability' })
  }
}

export default withTenantApiRoute(handler)
