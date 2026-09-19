import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../../../lib/auth/authorization'
import { permissions } from '../../../../../lib/auth/permissions'
import {
  buildInvoicePdf,
  getInvoicePdfFilename,
} from '../../../../../lib/dispatch/invoice-pdf'
import { prisma } from '../../../../../lib/prisma'

function getInvoiceId(queryValue: string | string[] | undefined) {
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

  const invoiceId = getInvoiceId(req.query.id)

  if (!invoiceId) {
    return res.status(400).json({ error: 'Invoice id is required' })
  }

  try {
    const invoice = await prisma.invoice.findUnique({
      where: {
        id: invoiceId,
      },
      include: {
        invoiceMissions: {
          orderBy: { sortOrder: 'asc' },
          include: { mission: { select: { pickupDate: true, pickupCity: true, deliveryCity: true } } },
        },
        lines: {
          orderBy: {
            position: 'asc',
          },
        },
      },
    })

    if (!invoice) {
      return res.status(404).json({ error: 'Facture introuvable.' })
    }

    const pdfBuffer = await buildInvoicePdf(invoice)
    const filename = getInvoicePdfFilename(invoice)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`
    )
    res.setHeader('Content-Length', String(pdfBuffer.length))
    return res.status(200).send(pdfBuffer)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Generation PDF impossible.'

    if (
      message.includes('fournisseur') ||
      message.includes('aucune ligne')
    ) {
      return res.status(400).json({ error: message })
    }

    console.error('Invoice PDF generation failed', {
      invoiceId,
      error,
    })
    return res.status(500).json({
      error: 'Impossible de generer le PDF de cette facture.',
    })
  }
}
