import { withTenantApiRoute } from '../../../../../lib/auth/authorization'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../../../lib/auth/authorization'
import { permissions } from '../../../../../lib/auth/permissions'
import {
  buildInvoicePdf,
  getInvoicePdfFilename,
} from '../../../../../lib/dispatch/invoice-pdf'
import { prisma } from '../../../../../lib/prisma'
import { resolveOrganizationLogo } from '../../../../../lib/tenant/brand-logo'

function getInvoiceId(queryValue: string | string[] | undefined) {
  return typeof queryValue === 'string' && queryValue.trim().length > 0
    ? queryValue.trim()
    : null
}

async function handler(
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

    // The issuer's own logo; the invoice's legal data is the snapshot already stored on the row.
    const organization = await prisma.organization.findUnique({ where: { id: invoice.organizationId }, select: { logoUrl: true } })
    const logo = await resolveOrganizationLogo(organization?.logoUrl)
    const pdfBuffer = await buildInvoicePdf(invoice, { logo: logo?.bytes ?? null })
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

export default withTenantApiRoute(handler)
