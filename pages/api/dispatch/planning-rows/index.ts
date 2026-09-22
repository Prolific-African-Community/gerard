import { withTenantApiRoute } from '../../../../lib/auth/authorization'
import type { NextApiRequest, NextApiResponse } from 'next'
import { requirePermission } from '../../../../lib/auth/authorization'
import { permissions } from '../../../../lib/auth/permissions'

import { parseWeekStartParam } from '../../../../lib/dispatch/date-utils'
import { prisma } from '../../../../lib/prisma'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (!(await requirePermission(req, res, permissions.dispatchAssign))) return
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!isRecord(req.body) || typeof req.body.weekStart !== 'string') {
    return res.status(400).json({ error: 'Invalid request body' })
  }

  const weekStartDate = parseWeekStartParam(req.body.weekStart)

  if (!weekStartDate) {
    return res.status(400).json({ error: 'Invalid weekStart' })
  }

  try {
    const lastRow = await prisma.planningRow.findFirst({
      where: {
        weekStartDate,
      },
      orderBy: {
        sortOrder: 'desc',
      },
    })

    const row = await prisma.planningRow.create({
      data: {
        weekStartDate,
        sortOrder: (lastRow?.sortOrder ?? -1) + 1,
      },
      include: {
        driver: true,
        truck: true,
        trailer: true,
      },
    })

    return res.status(201).json({ row })
  } catch (error) {
    console.error('Failed to create planning row', error)
    return res.status(500).json({ error: 'Failed to create planning row' })
  }
}

export default withTenantApiRoute(handler)
