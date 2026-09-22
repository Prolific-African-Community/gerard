import { withTenantApiRoute } from '../../../../../lib/auth/authorization'
import { createReadStream } from 'fs'
import path from 'path'

import { InvoiceDirection } from '@prisma/client'
import { put } from '@vercel/blob'
import formidable from 'formidable'
import type { File } from 'formidable'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../../../lib/auth/authorization'
import { requireActiveOrganizationId } from '../../../../../lib/auth/organization-context'
import { permissions } from '../../../../../lib/auth/permissions'
import { serializeInvoice } from '../../../../../lib/dispatch/invoices'
import { prisma } from '../../../../../lib/prisma'
import { tenantInvoiceBlobPath } from '../../../../../lib/tenant/billing-config'

export const config = {
  api: {
    bodyParser: false,
  },
}

const maxPdfSizeBytes = 10 * 1024 * 1024

type ErrorResponse = {
  error: string
}

function getInvoiceId(queryValue: string | string[] | undefined) {
  return typeof queryValue === 'string' && queryValue.trim().length > 0
    ? queryValue.trim()
    : null
}

function sanitizePdfFilename(filename: string | null | undefined) {
  const fallback = 'facture-fournisseur.pdf'
  const rawFilename = filename?.trim() || fallback
  const extension = path.extname(rawFilename).toLowerCase()
  const basename = path.basename(rawFilename, extension || undefined)
  const safeBasename =
    basename
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'facture-fournisseur'

  return `${safeBasename}.pdf`
}

function getUploadedFile(files: formidable.Files<string>) {
  const field = files.file
  return Array.isArray(field) ? field[0] : field
}

function parseForm(req: NextApiRequest) {
  const form = formidable({
    maxFiles: 1,
    multiples: false,
    maxFileSize: maxPdfSizeBytes,
    filter: (part) => {
      return (
        part.name === 'file' &&
        (part.mimetype === 'application/pdf' ||
          Boolean(part.originalFilename?.toLowerCase().endsWith('.pdf')))
      )
    },
  })

  return new Promise<File>((resolve, reject) => {
    form.parse(req, (error, _fields, files) => {
      if (error) {
        reject(error)
        return
      }

      const file = getUploadedFile(files)

      if (!file) {
        reject(new Error('PDF_MISSING'))
        return
      }

      resolve(file)
    })
  })
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ErrorResponse | { invoice: unknown }>
) {
  if (!(await requirePermission(req, res, permissions.invoicesManage))) {
    return
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN

  if (!token) {
    return res.status(500).json({
      error: 'Stockage PDF non configure.',
    })
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
    })

    if (!invoice) {
      return res.status(404).json({ error: 'Facture introuvable.' })
    }

    if (invoice.direction !== InvoiceDirection.RECEIVED) {
      return res.status(400).json({
        error: 'Upload PDF reserve aux factures fournisseurs recues.',
      })
    }

    const file = await parseForm(req)
    const originalFilename = sanitizePdfFilename(file.originalFilename)
    const mimetype = file.mimetype ?? 'application/pdf'

    if (
      mimetype !== 'application/pdf' ||
      !originalFilename.toLowerCase().endsWith('.pdf')
    ) {
      return res.status(400).json({ error: 'Le fichier doit etre un PDF.' })
    }

    if (file.size > maxPdfSizeBytes) {
      return res.status(400).json({
        error: 'Le PDF ne doit pas depasser 10 MB.',
      })
    }

    const pathname = tenantInvoiceBlobPath(requireActiveOrganizationId(), invoiceId, originalFilename)
    const blob = await put(pathname, createReadStream(file.filepath), {
      access: 'private',
      contentType: 'application/pdf',
      token,
    })

    const updatedInvoice = await prisma.invoice.update({
      where: {
        id: invoiceId,
      },
      data: {
        sourcePdfUrl: blob.url,
        sourcePdfFileName: originalFilename,
        sourcePdfMimeType: 'application/pdf',
      },
      include: {
        mission: true,
        lines: {
          orderBy: {
            position: 'asc',
          },
        },
      },
    })

    return res.status(200).json({
      invoice: serializeInvoice(updatedInvoice),
    })
  } catch (error) {
    console.error('Supplier invoice PDF upload failed', {
      invoiceId,
      error,
    })

    if (error instanceof Error && error.message === 'PDF_MISSING') {
      return res.status(400).json({ error: 'Ajoutez un fichier PDF.' })
    }

    return res.status(500).json({
      error: 'Impossible de charger le PDF fournisseur.',
    })
  }
}

export default withTenantApiRoute(handler)
