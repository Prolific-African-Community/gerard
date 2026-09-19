import { Prisma } from '@prisma/client'

export const defaultIssuedInvoiceSeller = {
  sellerName: 'NOVOTRALUX S.À R.L.',
  sellerAddress: '21 Stawelerstrooss\n9964, Huldange,\nLuxembourg',
  sellerVatNumber: 'LU31249718',
  sellerIban: 'LU00 0000 0000 0000 0000',
  sellerBic: 'BILLLULLXXX',
  sellerBankName: 'BIL',
  sellerBeneficiary: 'NOVOTRALUX S.À R.L.',
  paymentTerms: 'Paiement à 30 jours',
}

export const defaultReceivedInvoiceBuyer = {
  buyerName: defaultIssuedInvoiceSeller.sellerName,
  buyerAddress: defaultIssuedInvoiceSeller.sellerAddress,
  buyerVatNumber: defaultIssuedInvoiceSeller.sellerVatNumber,
}

export const slAutomotiveSupplier = {
  sellerName: 'SL Automotive',
  sellerAddress: 'À compléter',
  sellerVatNumber: 'À compléter',
  sellerIban: 'À compléter',
  sellerBic: 'À compléter',
  sellerBankName: 'À compléter',
  sellerBeneficiary: 'SL Automotive',
}

export type InvoiceLineInput = {
  id?: string
  label?: unknown
  description?: unknown
  quantity?: unknown
  unitPrice?: unknown
  vatRate?: unknown
  position?: unknown
}

export type NormalizedInvoiceLine = {
  id?: string
  label: string
  description: string | null
  quantity: Prisma.Decimal
  unitPrice: Prisma.Decimal
  vatRate: Prisma.Decimal
  subtotalAmount: Prisma.Decimal
  vatAmount: Prisma.Decimal
  totalAmount: Prisma.Decimal
  position: number
}

export function normalizeText(value: unknown) {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmedValue = value.trim()
  return trimmedValue.length > 0 ? trimmedValue : undefined
}

export function normalizeNullableText(value: unknown) {
  return normalizeText(value) ?? null
}

export function parseDecimal(value: unknown, fallback: string | number) {
  if (value instanceof Prisma.Decimal) {
    return value
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Prisma.Decimal(value)
  }

  if (typeof value === 'string') {
    const normalizedValue = value.replace(/\s/g, '').replace(',', '.').trim()

    if (normalizedValue.length > 0) {
      try {
        return new Prisma.Decimal(normalizedValue)
      } catch {
        return new Prisma.Decimal(fallback)
      }
    }
  }

  return new Prisma.Decimal(fallback)
}

export function normalizeInvoiceLines(lines: unknown) {
  if (!Array.isArray(lines)) {
    return []
  }

  return lines.map((line, index) => {
    const candidate =
      line && typeof line === 'object' ? (line as InvoiceLineInput) : {}
    const quantity = parseDecimal(candidate.quantity, 1)
    const unitPrice = parseDecimal(candidate.unitPrice, 0)
    const vatRate = parseDecimal(candidate.vatRate, 17)
    const subtotalAmount = quantity.mul(unitPrice).toDecimalPlaces(2)
    const vatAmount = subtotalAmount.mul(vatRate).div(100).toDecimalPlaces(2)
    const totalAmount = subtotalAmount.plus(vatAmount).toDecimalPlaces(2)
    const rawPosition =
      typeof candidate.position === 'number' &&
      Number.isFinite(candidate.position)
        ? Math.trunc(candidate.position)
        : index

    return {
      id: typeof candidate.id === 'string' ? candidate.id : undefined,
      label: normalizeText(candidate.label) ?? 'Ligne de facture',
      description: normalizeNullableText(candidate.description),
      quantity,
      unitPrice,
      vatRate,
      subtotalAmount,
      vatAmount,
      totalAmount,
      position: rawPosition,
    }
  })
}

export function calculateInvoiceTotals(lines: NormalizedInvoiceLine[]) {
  return lines.reduce(
    (totals, line) => ({
      subtotalAmount: totals.subtotalAmount.plus(line.subtotalAmount),
      vatAmount: totals.vatAmount.plus(line.vatAmount),
      totalAmount: totals.totalAmount.plus(line.totalAmount),
    }),
    {
      subtotalAmount: new Prisma.Decimal(0),
      vatAmount: new Prisma.Decimal(0),
      totalAmount: new Prisma.Decimal(0),
    }
  )
}

export function serializeDecimal(value: Prisma.Decimal | number | string) {
  return Number(value.toString())
}

function withPaymentAmounts(invoice: unknown) {
  if (
    invoice &&
    typeof invoice === 'object' &&
    !Array.isArray(invoice) &&
    (typeof (invoice as { totalAmount?: unknown }).totalAmount === 'number' ||
      typeof (invoice as { totalAmount?: unknown }).totalAmount === 'string')
  ) {
    const candidate = invoice as {
      subtotalAmount?: number | string
      vatAmount?: number | string
      totalAmount: number | string
      paidAmount?: number | string
      balanceAmount?: number
      remainingAmount?: number
      amountToReceive?: number
      direction?: string
      status?: string
    }
    const subtotalAmount = Number(candidate.subtotalAmount ?? 0)
    const vatAmount = Number(candidate.vatAmount ?? 0)
    const totalAmount = Number(candidate.totalAmount)
    const paidAmount =
      typeof candidate.paidAmount === 'number' ||
      typeof candidate.paidAmount === 'string'
        ? Number(candidate.paidAmount)
        : 0
    const effectivePaidAmount =
      candidate.status === 'PAID' && paidAmount === 0
        ? totalAmount
        : paidAmount

    candidate.subtotalAmount = subtotalAmount
    candidate.vatAmount = vatAmount
    candidate.totalAmount = totalAmount
    candidate.paidAmount = effectivePaidAmount
    candidate.balanceAmount = Math.max(totalAmount - effectivePaidAmount, 0)
    candidate.remainingAmount =
      candidate.direction === 'RECEIVED' ? candidate.balanceAmount : 0
    candidate.amountToReceive =
      candidate.direction === 'ISSUED' ? candidate.balanceAmount : 0
  }

  return invoice
}

export function serializeInvoice<T>(invoice: T) {
  const serialized = JSON.parse(
    JSON.stringify(invoice, (_key, value) => {
      if (value && typeof value === 'object' && value.constructor?.name === 'Decimal') {
        return Number(value.toString())
      }

      return value
    })
  )

  if (Array.isArray(serialized)) {
    serialized.forEach(withPaymentAmounts)
  } else {
    withPaymentAmounts(serialized)
  }

  return serialized
}
