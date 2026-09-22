import { withTenantApiRoute } from '../../../../../lib/auth/authorization'
import { Buffer } from 'buffer'

import { InvoiceDirection } from '@prisma/client'
import { get } from '@vercel/blob'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../../../lib/auth/authorization'
import { permissions } from '../../../../../lib/auth/permissions'
import { prisma } from '../../../../../lib/prisma'

function getInvoiceId(queryValue: string | string[] | undefined) {
  return typeof queryValue === 'string' && queryValue.trim().length > 0
    ? queryValue.trim()
    : null
}

function getSafeFilename(filename: string | null, invoiceId: string) {
  const fallback = `facture-fournisseur-${invoiceId}.pdf`
  const value = filename?.trim() || fallback
  return value.toLowerCase().endsWith('.pdf') ? value : `${value}.pdf`
}

function sendDataUrlPdf(
  sourcePdfUrl: string,
  filename: string,
  res: NextApiResponse
) {
  const match = sourcePdfUrl.match(/^data:application\/pdf;base64,(.+)$/)

  if (!match) {
    return false
  }

  const pdfBuffer = Buffer.from(match[1], 'base64')
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Length', String(pdfBuffer.length))
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`)
  res.status(200).send(pdfBuffer)
  return true
}

async function pipeWebStream(
  stream: ReadableStream<Uint8Array>,
  res: NextApiResponse
) {
  const reader = stream.getReader()

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      if (value) {
        res.write(Buffer.from(value))
      }
    }
  } finally {
    reader.releaseLock()
  }

  res.end()
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
      select: {
        id: true,
        direction: true,
        sourcePdfUrl: true,
        sourcePdfFileName: true,
      },
    })

    if (!invoice) {
      return res.status(404).json({ error: 'Facture introuvable.' })
    }

    if (invoice.direction !== InvoiceDirection.RECEIVED) {
      return res.status(400).json({
        error: 'PDF fournisseur indisponible pour cette facture.',
      })
    }

    if (!invoice.sourcePdfUrl) {
      return res.status(404).json({ error: 'Aucun PDF fournisseur attache.' })
    }

    const filename = getSafeFilename(invoice.sourcePdfFileName, invoice.id)

    if (invoice.sourcePdfUrl.startsWith('data:')) {
      if (sendDataUrlPdf(invoice.sourcePdfUrl, filename, res)) {
        return
      }

      return res.status(400).json({ error: 'PDF fournisseur invalide.' })
    }

    const token = process.env.BLOB_READ_WRITE_TOKEN

    if (token) {
      const blob = await get(invoice.sourcePdfUrl, {
        access: 'private',
        token,
      })

      if (blob?.stream) {
        res.setHeader('Content-Type', 'application/pdf')
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`)
        if (blob.blob.size) {
          res.setHeader('Content-Length', String(blob.blob.size))
        }

        await pipeWebStream(blob.stream as ReadableStream<Uint8Array>, res)
        return
      }
    }

    if (/^https?:\/\//i.test(invoice.sourcePdfUrl)) {
      res.redirect(invoice.sourcePdfUrl)
      return
    }

    return res.status(404).json({ error: 'PDF fournisseur introuvable.' })
  } catch (error) {
    console.error('Supplier invoice PDF read failed', {
      invoiceId,
      error,
    })
    return res.status(500).json({
      error: 'Impossible d ouvrir le PDF fournisseur.',
    })
  }
}

export default withTenantApiRoute(handler)
