import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../../lib/auth/authorization'
import { permissions } from '../../../../lib/auth/permissions'
import {
  buildProfitabilityPdf,
  buildProfitabilityWorkbook,
  formatExportDate,
} from '../../../../lib/dispatch/profitability-export'
import {
  computeWeeklyProfitability,
  getNumberParam,
  getRequestedWeekStartDate,
} from '../../../../lib/dispatch/profitability'

function getFormat(value: string | string[] | undefined) {
  return value === 'pdf' || value === 'xlsx' ? value : null
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const sessionUser = await requirePermission(req, res, permissions.profitabilityView)

  if (!sessionUser) {
    return
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const format = getFormat(req.query.format)
  const weekStartDate = getRequestedWeekStartDate(req.query.weekStart)

  if (!format) {
    return res.status(400).json({ error: 'Invalid export format' })
  }

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
    const weekStart = formatExportDate(weekStartDate)
    const periodLabel = `Semaine du ${weekStart}`

    if (format === 'pdf') {
      const buffer = await buildProfitabilityPdf(profitability, periodLabel)

      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="novotralux-rentabilite-${weekStart}.pdf"`
      )
      return res.status(200).send(buffer)
    }

    const buffer = await buildProfitabilityWorkbook(profitability, periodLabel)

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="novotralux-rentabilite-${weekStart}.xlsx"`
    )
    return res.status(200).send(buffer)
  } catch (error) {
    console.error('Failed to export profitability', error)
    return res.status(500).json({ error: 'Failed to export profitability' })
  }
}
