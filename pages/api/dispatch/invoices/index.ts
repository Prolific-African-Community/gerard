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
  parseDecimal,
  normalizeInvoiceLines,
  normalizeNullableText,
  normalizeText,
  serializeInvoice,
  slAutomotiveSupplier,
} from '../../../../lib/dispatch/invoices'
import { prisma } from '../../../../lib/prisma'
import { BillingConfigurationError, getActiveBillingConfig, paymentTermsLabel, requireIssuedInvoiceBillingConfig } from '../../../../lib/tenant/billing-config'

type ErrorResponse = {
  error: string
}

function getQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function parseDirection(value: unknown) {
  return value === InvoiceDirection.RECEIVED
    ? InvoiceDirection.RECEIVED
    : InvoiceDirection.ISSUED
}

function parseStatus(
  value: unknown,
  fallback: InvoiceStatus = InvoiceStatus.DRAFT
) {
  return typeof value === 'string' &&
    Object.values(InvoiceStatus).includes(value as InvoiceStatus)
    ? (value as InvoiceStatus)
    : fallback
}

function defaultStatusForDirection(direction: InvoiceDirection) {
  return direction === InvoiceDirection.RECEIVED
    ? InvoiceStatus.RECEIVED
    : InvoiceStatus.DRAFT
}

function parseDate(value: unknown) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null
  }

  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function normalizeSourcePdfUrl(value: unknown) {
  const url = normalizeNullableText(value)

  if (url?.startsWith('data:')) {
    throw new Error('SOURCE_PDF_DATA_URL')
  }

  return url
}

function getReceivedTotals(body: Record<string, unknown>) {
  const subtotalAmount = parseDecimal(body.subtotalAmount, 0).toDecimalPlaces(2)
  const vatAmount = parseDecimal(body.vatAmount, 0).toDecimalPlaces(2)
  const explicitTotal = parseDecimal(body.totalAmount, -1).toDecimalPlaces(2)
  const totalAmount = explicitTotal.isNegative()
    ? subtotalAmount.plus(vatAmount).toDecimalPlaces(2)
    : explicitTotal

  return {
    subtotalAmount,
    vatAmount,
    totalAmount,
  }
}

function normalizeMissionIds(value: unknown, legacyMissionId: unknown) {
  const values = Array.isArray(value)
    ? value
    : typeof legacyMissionId === 'string'
      ? [legacyMissionId]
      : []
  return Array.from(new Set(values.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())))
}

function missionCurrency(mission: { priceCurrency: string | null }) {
  return mission.priceCurrency?.trim().toUpperCase() || 'EUR'
}

function clientKey(value: string) {
  return value.trim().toLocaleLowerCase()
}

function isBlockingInvoiceStatus(status: InvoiceStatus) {
  return status !== InvoiceStatus.CANCELLED && status !== InvoiceStatus.REJECTED
}

function isTechnicalReference(value: string | null | undefined) {
  return !value || /^cm[a-z0-9]{18,}$/i.test(value)
}

function extractSupplierReference(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (!value) {
      continue
    }

    const match = value.match(/\b(?:EXT|GAR)-[A-Z0-9]{4,}\b/i)

    if (match) {
      return match[0].toUpperCase()
    }
  }

  return null
}

function getSlExternalInvoiceNumber(request: {
  slInvoiceReference: string | null
  providerRequestId: string | null
  externalRequestId: string | null
  issueDescription: string
  invoicePdfUrl: string | null
  quotePdfUrl: string | null
  plateNumber: string
}) {
  const visibleReference = extractSupplierReference(
    request.slInvoiceReference,
    request.providerRequestId,
    request.externalRequestId,
    request.issueDescription,
    request.invoicePdfUrl,
    request.quotePdfUrl
  )

  if (visibleReference) {
    return visibleReference
  }

  for (const value of [
    request.slInvoiceReference,
    request.providerRequestId,
    request.externalRequestId,
  ]) {
    if (value && !isTechnicalReference(value)) {
      return value
    }
  }

  return `SL-${request.plateNumber.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'MAINTENANCE'}`
}

async function syncSlAutomotiveInvoices() {
  const billingConfig = await getActiveBillingConfig()
  const requests = await prisma.maintenanceRequest.findMany({
    where: {
      OR: [
        { invoicePdfUrl: { not: null } },
        { quotePdfUrl: { not: null } },
        { slInvoiceReference: { not: null } },
      ],
    },
    include: {
      interventionLines: true,
    },
  })

  let created = 0

  for (const request of requests) {
    const externalInvoiceNumber = getSlExternalInvoiceNumber(request)
    const existingInvoice = await prisma.invoice.findFirst({
      where: {
        direction: InvoiceDirection.RECEIVED,
        sellerName: slAutomotiveSupplier.sellerName,
        OR: [
          { maintenanceRequestId: request.id },
          { externalInvoiceNumber },
        ],
      },
      select: {
        id: true,
        sourcePdfUrl: true,
        externalInvoiceNumber: true,
      },
    })

    if (existingInvoice) {
      const sourcePdfUrl = request.invoicePdfUrl ?? request.quotePdfUrl
      const shouldUpdateReference = isTechnicalReference(
        existingInvoice.externalInvoiceNumber
      )
      if (sourcePdfUrl && !existingInvoice.sourcePdfUrl) {
        await prisma.invoice.update({
          where: {
            id: existingInvoice.id,
          },
          data: {
            ...(shouldUpdateReference ? { externalInvoiceNumber } : {}),
            sourcePdfUrl,
            sourcePdfFileName: externalInvoiceNumber
              ? `SL-Automotive-${externalInvoiceNumber}.pdf`
              : null,
            sourcePdfMimeType: 'application/pdf',
          },
        })
      } else if (shouldUpdateReference) {
        await prisma.invoice.update({
          where: {
            id: existingInvoice.id,
          },
          data: {
            externalInvoiceNumber,
          },
        })
      }
      continue
    }

    const lineTotal = request.interventionLines.reduce(
      (total, line) => total + line.total,
      0
    )
    const totalAmount = new Prisma.Decimal(
      request.invoiceAmount ?? request.quoteAmount ?? lineTotal ?? 0
    ).toDecimalPlaces(2)
    const status =
      request.status === 'PAID'
        ? InvoiceStatus.PAID
        : ['INVOICED', 'CLOSED'].includes(request.status)
          ? InvoiceStatus.APPROVED
          : InvoiceStatus.RECEIVED

    await prisma.invoice.create({
      data: {
        direction: InvoiceDirection.RECEIVED,
        externalInvoiceNumber,
        status,
        maintenanceRequestId: request.id,
        issueDate: request.updatedAt,
        paidDate: status === InvoiceStatus.PAID ? request.updatedAt : null,
        sellerName: slAutomotiveSupplier.sellerName,
        sellerAddress: slAutomotiveSupplier.sellerAddress,
        sellerVatNumber: slAutomotiveSupplier.sellerVatNumber,
        sellerIban: slAutomotiveSupplier.sellerIban,
        sellerBic: slAutomotiveSupplier.sellerBic,
        sellerBankName: slAutomotiveSupplier.sellerBankName,
        sellerBeneficiary: slAutomotiveSupplier.sellerBeneficiary,
        buyerName: billingConfig?.legalName ?? 'Organisation destinataire',
        buyerAddress: billingConfig?.legalAddress ?? null,
        buyerVatNumber: billingConfig?.vatNumber ?? null,
        missionDescription: `${request.plateNumber} - ${request.issueDescription}`,
        subtotalAmount: totalAmount,
        vatAmount: new Prisma.Decimal(0),
        totalAmount,
        paidAmount:
          status === InvoiceStatus.PAID ? totalAmount : new Prisma.Decimal(0),
        currency: 'EUR',
        notes: 'Importee depuis maintenance SL Automotive',
        sourcePdfUrl: request.invoicePdfUrl ?? request.quotePdfUrl,
        sourcePdfFileName: externalInvoiceNumber
          ? `SL-Automotive-${externalInvoiceNumber}.pdf`
          : null,
        sourcePdfMimeType:
          request.invoicePdfUrl || request.quotePdfUrl ? 'application/pdf' : null,
      },
    })
    created += 1
  }

  return created
}

async function generateInvoiceNumber(tx: Prisma.TransactionClient, date: Date, configuredPrefix: string | null) {
  const year = date.getFullYear()
  const prefix = configuredPrefix ? `${configuredPrefix}-${year}-` : `${year}-`
  const lastInvoice = await tx.invoice.findFirst({
    where: {
      invoiceNumber: {
        startsWith: prefix,
      },
    },
    orderBy: {
      invoiceNumber: 'desc',
    },
    select: {
      invoiceNumber: true,
    },
  })
  const lastSequence = lastInvoice?.invoiceNumber
    ? Number(lastInvoice.invoiceNumber.slice(prefix.length))
    : 0
  const nextSequence = Number.isFinite(lastSequence) ? lastSequence + 1 : 1

  return `${prefix}${String(nextSequence).padStart(4, '0')}`
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const direction = getQueryValue(req.query.direction)
  const status = getQueryValue(req.query.status)
  const search = getQueryValue(req.query.search)?.trim()
  const missionId = getQueryValue(req.query.missionId)?.trim()
  const dateFrom = parseDate(getQueryValue(req.query.dateFrom))
  const dateTo = parseDate(getQueryValue(req.query.dateTo))

  const where: Prisma.InvoiceWhereInput = {}

  if (direction === InvoiceDirection.RECEIVED) {
    await syncSlAutomotiveInvoices()
  }

  if (
    direction === InvoiceDirection.ISSUED ||
    direction === InvoiceDirection.RECEIVED
  ) {
    where.direction = direction
  }

  if (status && Object.values(InvoiceStatus).includes(status as InvoiceStatus)) {
    where.status = status as InvoiceStatus
  }

  if (missionId) {
    where.OR = [
      { missionId },
      { invoiceMissions: { some: { missionId } } },
    ]
  }

  if (dateFrom || dateTo) {
    where.issueDate = {
      ...(dateFrom ? { gte: dateFrom } : {}),
      ...(dateTo ? { lte: dateTo } : {}),
    }
  }

  if (search) {
    const searchConditions: Prisma.InvoiceWhereInput[] = [
      { invoiceNumber: { contains: search, mode: 'insensitive' } },
      { externalInvoiceNumber: { contains: search, mode: 'insensitive' } },
      { buyerName: { contains: search, mode: 'insensitive' } },
      { sellerName: { contains: search, mode: 'insensitive' } },
      { missionReference: { contains: search, mode: 'insensitive' } },
      { clientReference: { contains: search, mode: 'insensitive' } },
      { cmrNumber: { contains: search, mode: 'insensitive' } },
      { deliveryNoteNumber: { contains: search, mode: 'insensitive' } },
      { invoiceMissions: { some: { missionReferenceSnapshot: { contains: search, mode: 'insensitive' } } } },
      { invoiceMissions: { some: { clientReferenceSnapshot: { contains: search, mode: 'insensitive' } } } },
      { invoiceMissions: { some: { cmrNumberSnapshot: { contains: search, mode: 'insensitive' } } } },
      { invoiceMissions: { some: { deliveryNoteNumberSnapshot: { contains: search, mode: 'insensitive' } } } },
      { missionDescription: { contains: search, mode: 'insensitive' } },
      { notes: { contains: search, mode: 'insensitive' } },
      {
        lines: {
          some: {
            OR: [
              { label: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
            ],
          },
        },
      },
    ]
    where.AND = [...(where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : []), { OR: searchConditions }]
  }

  const invoices = await prisma.invoice.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }],
    include: {
      mission: {
        select: {
          id: true,
          reference: true,
          clientName: true,
          clientReference: true,
          cmrNumber: true,
          deliveryNoteNumber: true,
        },
      },
      invoiceMissions: {
        orderBy: { sortOrder: 'asc' },
        include: { mission: { select: { id: true, reference: true, clientName: true, pickupDate: true, pickupCity: true, deliveryCity: true, cmrNumber: true, deliveryNoteNumber: true } } },
      },
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
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const direction = parseDirection(body.direction)
  const billingConfig = await getActiveBillingConfig()
  const issuedBilling = direction === InvoiceDirection.ISSUED
    ? requireIssuedInvoiceBillingConfig(billingConfig)
    : billingConfig
  const issueDate = parseDate(body.issueDate) ?? new Date()
  const dueDate = parseDate(body.dueDate)
  const paidDate = parseDate(body.paidDate)
  const missionIds = normalizeMissionIds(body.missionIds, body.missionId)
  const missionId = missionIds[0] ?? normalizeText(body.missionId)
  const maintenanceRequestId = normalizeText(body.maintenanceRequestId)
  const selectedMissions = missionIds.length
    ? await prisma.mission.findMany({ where: { id: { in: missionIds } } })
    : []
  if (selectedMissions.length !== missionIds.length) {
    return res.status(400).json({ error: 'Une des missions sélectionnées est introuvable.' })
  }
  const mission = selectedMissions[0] ?? null
  const maintenanceRequest = maintenanceRequestId
    ? await prisma.maintenanceRequest.findUnique({
        where: { id: maintenanceRequestId },
      })
    : null
  const submittedLines = normalizeInvoiceLines(body.lines)
  const selectedCurrency = mission ? missionCurrency(mission) : 'EUR'
  if (selectedMissions.some((item) => clientKey(item.clientName ?? '') !== clientKey(mission?.clientName ?? ''))) {
    return res.status(409).json({ error: 'Une facture groupée ne peut contenir que des missions du même client.' })
  }
  if (selectedMissions.some((item) => missionCurrency(item) !== selectedCurrency)) {
    return res.status(409).json({ error: 'Une facture groupée ne peut contenir qu’une seule devise.' })
  }
  if (missionIds.length) {
    const alreadyInvoiced = await prisma.invoiceMission.findFirst({
      where: { missionId: { in: missionIds }, invoice: { status: { notIn: [InvoiceStatus.CANCELLED, InvoiceStatus.REJECTED] } } },
      include: { invoice: { select: { invoiceNumber: true, status: true } } },
    })
    const legacyAlreadyInvoiced = await prisma.invoice.findFirst({
      where: { missionId: { in: missionIds }, status: { notIn: [InvoiceStatus.CANCELLED, InvoiceStatus.REJECTED] } },
      select: { invoiceNumber: true, status: true },
    })
    const conflict = alreadyInvoiced?.invoice ?? legacyAlreadyInvoiced
    if (conflict) {
      return res.status(409).json({ error: `Une mission sélectionnée est déjà liée à la facture ${conflict.invoiceNumber ?? 'existante'} (${conflict.status}).` })
    }
  }
  const missionLines = selectedMissions.map((item, index) => ({
    label: 'Transport mission',
    description: `${item.reference} · ${item.pickupCity} -> ${item.deliveryCity}${item.cmrNumber ? ` · CMR ${item.cmrNumber}` : ''}${item.deliveryNoteNumber ? ` · BL ${item.deliveryNoteNumber}` : ''}${typeof item.priceAmount === 'number' ? '' : ' · Prix à définir'}`,
    quantity: 1,
    unitPrice: item.priceAmount ?? 0,
    vatRate: 17,
    position: index,
  }))
  const adjustmentLines = submittedLines.filter((line) => line.label !== 'Transport mission')
  const lines = normalizeInvoiceLines([...missionLines, ...adjustmentLines])

  if (direction === InvoiceDirection.ISSUED && !lines.length) {
    return res.status(400).json({
      error: 'Ajoutez au moins une ligne de facture.',
    })
  }

  const hasNegativeLine = lines.some((line) => line.totalAmount.isNegative())

  if (hasNegativeLine && body.allowNegativeLines !== true) {
    return res.status(400).json({
      error: 'Les lignes negatives doivent etre confirmees explicitement.',
    })
  }

  const totals =
    direction === InvoiceDirection.RECEIVED && !lines.length
      ? getReceivedTotals(body)
      : calculateInvoiceTotals(lines)

  if (totals.totalAmount.isNegative()) {
    return res.status(400).json({
      error: 'Le total facture ne peut pas etre negatif.',
    })
  }

  const invoice = await prisma.$transaction(async (tx) => {
    const invoiceNumber =
      normalizeText(body.invoiceNumber) ??
      (direction === InvoiceDirection.ISSUED
        ? await generateInvoiceNumber(tx, issueDate, issuedBilling?.invoicePrefix ?? null)
        : null)
    const requestedStatus = parseStatus(
      body.status,
      defaultStatusForDirection(direction)
    )

    return tx.invoice.create({
      data: {
        direction,
        invoiceNumber,
        externalInvoiceNumber: normalizeNullableText(
          body.externalInvoiceNumber
        ),
        status: requestedStatus,
        missionId: selectedMissions.length === 1 ? mission?.id ?? null : null,
        maintenanceRequestId: maintenanceRequest?.id ?? null,
        issueDate,
        dueDate,
        paidDate:
          requestedStatus === InvoiceStatus.PAID && !paidDate
            ? new Date()
            : paidDate,
        sellerName:
          normalizeText(body.sellerName) ??
          (direction === InvoiceDirection.RECEIVED
            ? slAutomotiveSupplier.sellerName
            : issuedBilling!.legalName),
        sellerAddress:
          normalizeNullableText(body.sellerAddress) ??
          (direction === InvoiceDirection.RECEIVED
            ? slAutomotiveSupplier.sellerAddress
            : issuedBilling?.legalAddress ?? null),
        sellerVatNumber:
          normalizeNullableText(body.sellerVatNumber) ??
          (direction === InvoiceDirection.RECEIVED
            ? slAutomotiveSupplier.sellerVatNumber
            : issuedBilling?.vatNumber ?? null),
        sellerIban:
          normalizeNullableText(body.sellerIban) ??
          (direction === InvoiceDirection.RECEIVED
            ? slAutomotiveSupplier.sellerIban
            : issuedBilling?.iban ?? null),
        sellerBic:
          normalizeNullableText(body.sellerBic) ??
          (direction === InvoiceDirection.RECEIVED
            ? slAutomotiveSupplier.sellerBic
            : issuedBilling?.bic ?? null),
        sellerBankName:
          normalizeNullableText(body.sellerBankName) ??
          (direction === InvoiceDirection.RECEIVED
            ? slAutomotiveSupplier.sellerBankName
            : issuedBilling?.bankName ?? null),
        sellerBeneficiary:
          normalizeNullableText(body.sellerBeneficiary) ??
          (direction === InvoiceDirection.RECEIVED
            ? slAutomotiveSupplier.sellerBeneficiary
            : issuedBilling?.beneficiary ?? null),
        buyerName:
          normalizeText(body.buyerName) ??
          (direction === InvoiceDirection.RECEIVED
            ? billingConfig?.legalName ?? 'Organisation destinataire'
            : mission?.clientName ?? 'Client'),
        buyerAddress:
          normalizeNullableText(body.buyerAddress) ??
          (direction === InvoiceDirection.RECEIVED
            ? billingConfig?.legalAddress ?? null
            : null),
        buyerVatNumber:
          normalizeNullableText(body.buyerVatNumber) ??
          (direction === InvoiceDirection.RECEIVED
            ? billingConfig?.vatNumber ?? null
            : null),
        buyerEmail: normalizeNullableText(body.buyerEmail),
        missionReference:
          normalizeNullableText(body.missionReference) ??
          mission?.reference ??
          null,
        clientReference:
          normalizeNullableText(body.clientReference) ??
          mission?.clientReference ??
          null,
        cmrNumber:
          normalizeNullableText(body.cmrNumber) ??
          (selectedMissions.length === 1 ? mission?.cmrNumber : null) ??
          null,
        deliveryNoteNumber:
          normalizeNullableText(body.deliveryNoteNumber) ??
          (selectedMissions.length === 1 ? mission?.deliveryNoteNumber : null) ??
          null,
        missionDescription:
          normalizeNullableText(body.missionDescription) ??
          (maintenanceRequest
            ? `${maintenanceRequest.plateNumber} - ${maintenanceRequest.issueDescription}`
            : null) ??
          (mission
            ? `${mission.pickupCity} -> ${mission.deliveryCity}`
            : null),
        subtotalAmount: totals.subtotalAmount,
        vatAmount: totals.vatAmount,
        totalAmount: totals.totalAmount,
        paidAmount:
          requestedStatus === InvoiceStatus.PAID
            ? totals.totalAmount
            : parseDecimal(body.paidAmount, 0).toDecimalPlaces(2),
        currency: selectedCurrency,
        paymentTerms:
          normalizeNullableText(body.paymentTerms) ??
          (direction === InvoiceDirection.ISSUED
            ? mission?.paymentTerms ?? paymentTermsLabel(issuedBilling?.paymentTermsDays ?? null)
            : null),
        notes: normalizeNullableText(body.notes),
        sourcePdfUrl: normalizeSourcePdfUrl(body.sourcePdfUrl),
        sourcePdfFileName: normalizeNullableText(body.sourcePdfFileName),
        sourcePdfMimeType: normalizeNullableText(body.sourcePdfMimeType),
        lines: {
          create: lines.map((line) => ({
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
        invoiceMissions: {
          create: selectedMissions.map((item, index) => ({
            missionId: item.id,
            missionReferenceSnapshot: item.reference,
            clientReferenceSnapshot: item.clientReference,
            cmrNumberSnapshot: item.cmrNumber,
            deliveryNoteNumberSnapshot: item.deliveryNoteNumber,
            amountSnapshot: item.priceAmount ?? 0,
            currencySnapshot: missionCurrency(item),
            sortOrder: index,
          })),
        },
      },
      include: {
        mission: true,
        lines: {
          orderBy: {
            position: 'asc',
          },
        },
        invoiceMissions: { orderBy: { sortOrder: 'asc' } },
      },
    })
  })

  return res.status(201).json({
    invoice: serializeInvoice(invoice),
  })
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<unknown | ErrorResponse>
) {
  const permission = req.method === 'GET' ? permissions.invoicesView : permissions.invoicesManage
  if (!(await requirePermission(req, res, permission))) {
    return
  }

  try {
    if (req.method === 'GET') {
      return await handleGet(req, res)
    }

    if (req.method === 'POST') {
      return await handlePost(req, res)
    }

    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    if (error instanceof BillingConfigurationError) return res.status(error.statusCode).json({ error: error.message })
    if (error instanceof Error && error.message === 'SOURCE_PDF_DATA_URL') {
      return res.status(400).json({
        error: 'Le PDF fournisseur doit etre charge via la route upload.',
      })
    }

    console.error('Invoice API failed', error)
    return res.status(500).json({
      error: 'Impossible de traiter la demande facture.',
    })
  }
}

export default withTenantApiRoute(handler)
