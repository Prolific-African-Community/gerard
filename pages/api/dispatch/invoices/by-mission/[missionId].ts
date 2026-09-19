import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../../../lib/auth/authorization'
import { permissions } from '../../../../../lib/auth/permissions'
import { serializeInvoice } from '../../../../../lib/dispatch/invoices'
import { prisma } from '../../../../../lib/prisma'

function getMissionId(queryValue: string | string[] | undefined) {
  return typeof queryValue === 'string' && queryValue.trim().length > 0
    ? queryValue.trim()
    : null
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (!(await requirePermission(req, res, permissions.invoicesView))) {
    return
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const missionId = getMissionId(req.query.missionId)

  if (!missionId) {
    return res.status(400).json({ error: 'Mission id is required' })
  }

  try {
    const invoices = await prisma.invoice.findMany({
      where: {
        OR: [
          { missionId },
          { invoiceMissions: { some: { missionId } } },
        ],
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        invoiceMissions: { orderBy: { sortOrder: 'asc' } },
        lines: {
          orderBy: {
            position: 'asc',
          },
        },
      },
    })

    return res.status(200).json({
      invoices: serializeInvoice(invoices),
    })
  } catch (error) {
    console.error('Mission invoices API failed', {
      missionId,
      error,
    })

    return res.status(500).json({
      error: 'Impossible de charger les factures liees a cette mission.',
    })
  }
}
