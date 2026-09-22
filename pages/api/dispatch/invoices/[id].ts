import { withTenantApiRoute } from '../../../../lib/auth/authorization'
import {
  InvoiceDirection,
  InvoiceStatus,
  Prisma,
} from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../../lib/auth/authorization'
import { permissions } from '../../../../lib/auth/permissions'
import {
  calculateInvoiceTotals,
  normalizeInvoiceLines,
  normalizeNullableText,
  normalizeText,
  parseDecimal,
  serializeInvoice,
} from '../../../../lib/dispatch/invoices'
import { prisma } from '../../../../lib/prisma'

function getInvoiceId(queryValue: string | string[] | undefined) {
  return typeof queryValue === 'string' && queryValue.trim().length > 0
    ? queryValue.trim()
    : null
}

function parseDate(value: unknown) {
  if (value === null || value === '') {
    return null
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : undefined
}

function parseStatus(value: unknown) {
  return typeof value === 'string' &&
    Object.values(InvoiceStatus).includes(value as InvoiceStatus)
    ? (value as InvoiceStatus)
    : undefined
}

function parseDirection(value: unknown) {
  return value === InvoiceDirection.ISSUED ||
    value === InvoiceDirection.RECEIVED
    ? value
    : undefined
}

function normalizeSourcePdfUrl(value: unknown) {
  const url = normalizeNullableText(value)

  if (url?.startsWith('data:')) {
    throw new Error('SOURCE_PDF_DATA_URL')
  }

  return url
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date)
  nextDate.setDate(nextDate.getDate() + days)
  return nextDate
}

function parseMissionIds(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())))
    : undefined
}

function missionCurrency(mission: { priceCurrency: string | null }) {
  return mission.priceCurrency?.trim().toUpperCase() || 'EUR'
}

function getReceivedTotals(body: Record<string, unknown>, currentInvoice: {
  subtotalAmount: Prisma.Decimal
  vatAmount: Prisma.Decimal
  totalAmount: Prisma.Decimal
}) {
  const subtotalAmount = Object.prototype.hasOwnProperty.call(
    body,
    'subtotalAmount'
  )
    ? parseDecimal(body.subtotalAmount, 0).toDecimalPlaces(2)
    : currentInvoice.subtotalAmount
  const vatAmount = Object.prototype.hasOwnProperty.call(body, 'vatAmount')
    ? parseDecimal(body.vatAmount, 0).toDecimalPlaces(2)
    : currentInvoice.vatAmount
  const totalAmount = Object.prototype.hasOwnProperty.call(body, 'totalAmount')
    ? parseDecimal(body.totalAmount, 0).toDecimalPlaces(2)
    : subtotalAmount.plus(vatAmount).toDecimalPlaces(2)

  return {
    subtotalAmount,
    vatAmount,
    totalAmount,
  }
}

async function recordSettlement(
  invoiceId: string,
  body: Record<string, unknown>,
  currentInvoice: {
    direction: InvoiceDirection
    status: InvoiceStatus
    totalAmount: Prisma.Decimal
    paidAmount: Prisma.Decimal
    paidDate: Date | null
  },
  expectedDirection: InvoiceDirection,
  res: NextApiResponse
) {
  if (currentInvoice.direction !== expectedDirection) {
    return res.status(400).json({
      error:
        expectedDirection === InvoiceDirection.RECEIVED
          ? 'Paiement fournisseur reserve aux factures recues.'
          : 'Encaissement client reserve aux factures emises.',
    })
  }

  const settlementAmount = parseDecimal(body.amount, -1).toDecimalPlaces(2)

  if (settlementAmount.isNegative()) {
    return res.status(400).json({
      error:
        expectedDirection === InvoiceDirection.RECEIVED
          ? 'Le montant paye doit etre positif.'
          : 'Le montant recu doit etre positif.',
    })
  }

  const balanceAmount = Prisma.Decimal.max(
    currentInvoice.totalAmount.minus(currentInvoice.paidAmount),
    new Prisma.Decimal(0)
  ).toDecimalPlaces(2)

  if (balanceAmount.equals(0)) {
    return res.status(400).json({
      error: 'Cette facture est deja soldee.',
    })
  }

  const appliedAmount = Prisma.Decimal.min(settlementAmount, balanceAmount)
  const paidAmount = currentInvoice.paidAmount.plus(appliedAmount).toDecimalPlaces(2)
  const nextBalanceAmount = Prisma.Decimal.max(
    currentInvoice.totalAmount.minus(paidAmount),
    new Prisma.Decimal(0)
  ).toDecimalPlaces(2)
  const isFullyPaid = nextBalanceAmount.equals(0)

  const invoice = await prisma.invoice.update({
    where: {
      id: invoiceId,
    },
    data: {
      paidAmount,
      status: isFullyPaid ? InvoiceStatus.PAID : currentInvoice.status,
      paidDate: isFullyPaid ? currentInvoice.paidDate ?? new Date() : currentInvoice.paidDate,
    },
    include: {
      mission: true,
      invoiceMissions: { orderBy: { sortOrder: 'asc' } },
      lines: {
        orderBy: {
          position: 'asc',
        },
      },
    },
  })

  return res.status(200).json({
    invoice: serializeInvoice(invoice),
  })
}

async function recordPayment(
  invoiceId: string,
  body: Record<string, unknown>,
  currentInvoice: {
    direction: InvoiceDirection
    status: InvoiceStatus
    totalAmount: Prisma.Decimal
    paidAmount: Prisma.Decimal
    paidDate: Date | null
  },
  res: NextApiResponse
) {
  return recordSettlement(
    invoiceId,
    body,
    currentInvoice,
    InvoiceDirection.RECEIVED,
    res
  )
}

async function recordReceipt(
  invoiceId: string,
  body: Record<string, unknown>,
  currentInvoice: {
    direction: InvoiceDirection
    status: InvoiceStatus
    totalAmount: Prisma.Decimal
    paidAmount: Prisma.Decimal
    paidDate: Date | null
  },
  res: NextApiResponse
) {
  return recordSettlement(
    invoiceId,
    body,
    currentInvoice,
    InvoiceDirection.ISSUED,
    res
  )
}

async function handleGet(invoiceId: string, res: NextApiResponse) {
  const invoice = await prisma.invoice.findUnique({
    where: {
      id: invoiceId,
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

  if (!invoice) {
    return res.status(404).json({ error: 'Facture introuvable.' })
  }

  return res.status(200).json({
    invoice: serializeInvoice(invoice),
  })
}

async function handlePatch(
  invoiceId: string,
  req: NextApiRequest,
  res: NextApiResponse
) {
  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const currentInvoice = await prisma.invoice.findUnique({
    where: {
      id: invoiceId,
    },
    include: {
      lines: true,
      invoiceMissions: true,
    },
  })

  if (!currentInvoice) {
    return res.status(404).json({ error: 'Facture introuvable.' })
  }

  if ((body as Record<string, unknown>).action === 'recordPayment') {
    return recordPayment(
      invoiceId,
      body as Record<string, unknown>,
      currentInvoice,
      res
    )
  }

  if ((body as Record<string, unknown>).action === 'recordReceipt') {
    return recordReceipt(
      invoiceId,
      body as Record<string, unknown>,
      currentInvoice,
      res
    )
  }

  const normalizedLines = Object.prototype.hasOwnProperty.call(body, 'lines')
    ? normalizeInvoiceLines(body.lines)
    : currentInvoice.lines.map((line) => ({
        id: line.id,
        label: line.label,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        vatRate: line.vatRate,
        subtotalAmount: line.subtotalAmount,
        vatAmount: line.vatAmount,
        totalAmount: line.totalAmount,
        position: line.position,
      }))

  const requestedMissionIds = parseMissionIds((body as Record<string, unknown>).missionIds)
  const selectedMissions = requestedMissionIds
    ? await prisma.mission.findMany({ where: { id: { in: requestedMissionIds } } })
    : null
  if (selectedMissions && selectedMissions.length !== requestedMissionIds!.length) {
    return res.status(400).json({ error: 'Une des missions sélectionnées est introuvable.' })
  }
  if (selectedMissions?.length) {
    const client = (selectedMissions[0].clientName ?? '').trim().toLowerCase()
    const currency = missionCurrency(selectedMissions[0])
    if (selectedMissions.some((mission) => (mission.clientName ?? '').trim().toLowerCase() !== client)) {
      return res.status(409).json({ error: 'Une facture groupée ne peut contenir que des missions du même client.' })
    }
    if (selectedMissions.some((mission) => missionCurrency(mission) !== currency)) {
      return res.status(409).json({ error: 'Une facture groupée ne peut contenir qu’une seule devise.' })
    }
    const alreadyLinked = await prisma.invoiceMission.findFirst({
      where: { missionId: { in: requestedMissionIds }, invoiceId: { not: invoiceId }, invoice: { status: { notIn: [InvoiceStatus.CANCELLED, InvoiceStatus.REJECTED] } } },
    })
    if (alreadyLinked) return res.status(409).json({ error: 'Une mission sélectionnée est déjà facturée.' })
  }

  const nextDirection = parseDirection(body.direction) ?? currentInvoice.direction

  if (nextDirection === InvoiceDirection.ISSUED && !normalizedLines.length) {
    return res.status(400).json({
      error: 'Ajoutez au moins une ligne de facture.',
    })
  }

  if (
    normalizedLines.some((line) => line.totalAmount.isNegative()) &&
    body.allowNegativeLines !== true
  ) {
    return res.status(400).json({
      error: 'Les lignes negatives doivent etre confirmees explicitement.',
    })
  }

  const totals =
    nextDirection === InvoiceDirection.RECEIVED &&
    !Object.prototype.hasOwnProperty.call(body, 'lines')
      ? getReceivedTotals(body as Record<string, unknown>, currentInvoice)
      : calculateInvoiceTotals(normalizedLines)

  if (totals.totalAmount.isNegative()) {
    return res.status(400).json({
      error: 'Le total facture ne peut pas etre negatif.',
    })
  }

  const issueDate = parseDate(body.issueDate)
  const dueDate = parseDate(body.dueDate)
  const paidDate = parseDate(body.paidDate)
  const status = parseStatus(body.status)
  const direction = parseDirection(body.direction)
  if (status === InvoiceStatus.PAID && currentInvoice.status !== InvoiceStatus.PAID) {
    return res.status(400).json({
      error:
        currentInvoice.direction === InvoiceDirection.RECEIVED
          ? 'Confirmez le montant paye avant de solder la facture.'
          : 'Confirmez le montant recu avant de solder la facture.',
    })
  }

  const resolvedIssueDate =
    status === InvoiceStatus.ISSUED &&
    (issueDate === null || (issueDate === undefined && !currentInvoice.issueDate))
      ? new Date()
      : issueDate
  const resolvedDueDate =
    status === InvoiceStatus.ISSUED &&
    (dueDate === null || (dueDate === undefined && !currentInvoice.dueDate))
      ? addDays(
          resolvedIssueDate instanceof Date
            ? resolvedIssueDate
            : currentInvoice.issueDate ?? new Date(),
          30
        )
      : dueDate
  const resolvedPaidDate =
    status === InvoiceStatus.PAID &&
    (paidDate === null || (paidDate === undefined && !currentInvoice.paidDate))
      ? new Date()
      : paidDate
  const data: Prisma.InvoiceUpdateInput = {
    ...(direction ? { direction } : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'invoiceNumber')
      ? { invoiceNumber: normalizeNullableText(body.invoiceNumber) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'externalInvoiceNumber')
      ? {
          externalInvoiceNumber: normalizeNullableText(
            body.externalInvoiceNumber
          ),
        }
      : {}),
    ...(status ? { status } : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'maintenanceRequestId')
      ? { maintenanceRequestId: normalizeNullableText(body.maintenanceRequestId) }
      : {}),
    ...(resolvedIssueDate !== undefined ? { issueDate: resolvedIssueDate } : {}),
    ...(resolvedDueDate !== undefined ? { dueDate: resolvedDueDate } : {}),
    ...(resolvedPaidDate !== undefined ? { paidDate: resolvedPaidDate } : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'sellerName')
      ? { sellerName: normalizeText(body.sellerName) ?? currentInvoice.sellerName }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'sellerAddress')
      ? { sellerAddress: normalizeNullableText(body.sellerAddress) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'sellerVatNumber')
      ? { sellerVatNumber: normalizeNullableText(body.sellerVatNumber) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'sellerIban')
      ? { sellerIban: normalizeNullableText(body.sellerIban) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'sellerBic')
      ? { sellerBic: normalizeNullableText(body.sellerBic) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'sellerBankName')
      ? { sellerBankName: normalizeNullableText(body.sellerBankName) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'sellerBeneficiary')
      ? { sellerBeneficiary: normalizeNullableText(body.sellerBeneficiary) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'buyerName')
      ? { buyerName: normalizeText(body.buyerName) ?? currentInvoice.buyerName }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'buyerAddress')
      ? { buyerAddress: normalizeNullableText(body.buyerAddress) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'buyerVatNumber')
      ? { buyerVatNumber: normalizeNullableText(body.buyerVatNumber) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'buyerEmail')
      ? { buyerEmail: normalizeNullableText(body.buyerEmail) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'missionReference')
      ? { missionReference: normalizeNullableText(body.missionReference) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'clientReference')
      ? { clientReference: normalizeNullableText(body.clientReference) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'deliveryNoteNumber')
      ? { deliveryNoteNumber: normalizeNullableText(body.deliveryNoteNumber) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'missionDescription')
      ? { missionDescription: normalizeNullableText(body.missionDescription) }
      : {}),
    ...(selectedMissions
      ? {
          missionId: selectedMissions.length === 1 ? selectedMissions[0].id : null,
          cmrNumber:
            selectedMissions.length === 1 ? selectedMissions[0].cmrNumber : null,
          deliveryNoteNumber:
            selectedMissions.length === 1
              ? selectedMissions[0].deliveryNoteNumber
              : null,
          currency: selectedMissions.length
            ? missionCurrency(selectedMissions[0])
            : currentInvoice.currency,
        }
      : {}),
    subtotalAmount: totals.subtotalAmount,
    vatAmount: totals.vatAmount,
    totalAmount: totals.totalAmount,
    currency: selectedMissions?.length
      ? missionCurrency(selectedMissions[0])
      : currentInvoice.currency,
    ...(Object.prototype.hasOwnProperty.call(body, 'paymentTerms')
      ? { paymentTerms: normalizeNullableText(body.paymentTerms) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'notes')
      ? { notes: normalizeNullableText(body.notes) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'sourcePdfUrl')
      ? { sourcePdfUrl: normalizeSourcePdfUrl(body.sourcePdfUrl) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'sourcePdfFileName')
      ? { sourcePdfFileName: normalizeNullableText(body.sourcePdfFileName) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'sourcePdfMimeType')
      ? { sourcePdfMimeType: normalizeNullableText(body.sourcePdfMimeType) }
      : {}),
  }

  const invoice = await prisma.$transaction(async (tx) => {
    if (
      nextDirection === InvoiceDirection.ISSUED ||
      Object.prototype.hasOwnProperty.call(body, 'lines')
    ) {
      await tx.invoiceLine.deleteMany({
        where: {
          invoiceId,
        },
      })
    }

    return tx.invoice.update({
      where: {
        id: invoiceId,
      },
      data: {
        ...data,
        ...(nextDirection === InvoiceDirection.ISSUED ||
        Object.prototype.hasOwnProperty.call(body, 'lines')
          ? {
              lines: {
                create: normalizedLines.map((line) => ({
                  label: line.label,
                  description: line.description,
                  quantity: line.quantity,
                  unitPrice: line.unitPrice,
                  vatRate: line.vatRate,
                  subtotalAmount: line.subtotalAmount,
                  vatAmount: line.vatAmount,
                  totalAmount: line.totalAmount,
                  position: line.position,
                })),
              },
            }
          : {}),
        ...(selectedMissions
          ? {
              invoiceMissions: {
                deleteMany: {},
                create: selectedMissions.map((mission, index) => ({
                  missionId: mission.id,
                  missionReferenceSnapshot: mission.reference,
                  clientReferenceSnapshot: mission.clientReference,
                  cmrNumberSnapshot: mission.cmrNumber,
                  deliveryNoteNumberSnapshot: mission.deliveryNoteNumber,
                  amountSnapshot: mission.priceAmount ?? 0,
                  currencySnapshot: missionCurrency(mission),
                  sortOrder: index,
                })),
              },
            }
          : {}),
      },
      include: {
        mission: true,
        invoiceMissions: { orderBy: { sortOrder: 'asc' } },
        lines: {
          orderBy: {
            position: 'asc',
          },
        },
      },
    })
  })

  return res.status(200).json({
    invoice: serializeInvoice(invoice),
  })
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const permission = req.method === 'GET' ? permissions.invoicesView : permissions.invoicesManage
  if (!(await requirePermission(req, res, permission))) {
    return
  }

  const invoiceId = getInvoiceId(req.query.id)

  if (!invoiceId) {
    return res.status(400).json({ error: 'Invoice id is required' })
  }

  try {
    if (req.method === 'GET') {
      return await handleGet(invoiceId, res)
    }

    if (req.method === 'PATCH') {
      return await handlePatch(invoiceId, req, res)
    }

    res.setHeader('Allow', 'GET, PATCH')
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    if (error instanceof Error && error.message === 'SOURCE_PDF_DATA_URL') {
      return res.status(400).json({
        error: 'Le PDF fournisseur doit etre charge via la route upload.',
      })
    }

    console.error('Invoice detail API failed', {
      invoiceId,
      error,
    })
    return res.status(500).json({
      error: 'Impossible de traiter cette facture.',
    })
  }
}

export default withTenantApiRoute(handler)
