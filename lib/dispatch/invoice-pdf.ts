import { existsSync } from 'fs'
import path from 'path'

import { InvoiceDirection, InvoiceStatus, Prisma } from '@prisma/client'
import PDFDocument from 'pdfkit'

import {
  calculateInvoiceTotals,
  normalizeInvoiceLines,
} from './invoices'

type DecimalLike = Prisma.Decimal | number | string

type InvoicePdfLine = {
  label: string
  description: string | null
  quantity: DecimalLike
  unitPrice: DecimalLike
  vatRate: DecimalLike
  subtotalAmount: DecimalLike
  vatAmount: DecimalLike
  totalAmount: DecimalLike
  position: number
}

type InvoicePdfData = {
  id: string
  direction: InvoiceDirection
  invoiceNumber: string | null
  status: InvoiceStatus
  issueDate: Date | string | null
  dueDate: Date | string | null
  sellerName: string | null
  sellerAddress: string | null
  sellerVatNumber: string | null
  sellerIban: string | null
  sellerBic: string | null
  sellerBankName: string | null
  sellerBeneficiary: string | null
  buyerName: string | null
  buyerAddress: string | null
  buyerVatNumber: string | null
  buyerEmail: string | null
  missionReference: string | null
  clientReference: string | null
  cmrNumber: string | null
  deliveryNoteNumber: string | null
  missionDescription: string | null
  subtotalAmount: DecimalLike
  vatAmount: DecimalLike
  totalAmount: DecimalLike
  currency: string
  paymentTerms: string | null
  notes: string | null
  lines: InvoicePdfLine[]
  invoiceMissions?: Array<{
    missionReferenceSnapshot: string
    clientReferenceSnapshot: string | null
    cmrNumberSnapshot: string | null
    deliveryNoteNumberSnapshot: string | null
    amountSnapshot: DecimalLike
    currencySnapshot: string
    mission?: { pickupDate: Date | string | null; pickupCity: string | null; deliveryCity: string | null }
  }>
}

const page = {
  margin: 42,
  bottom: 770,
  width: 511,
}

const tableColumns = [
  { key: 'description', label: 'Description', x: 42, width: 238 },
  { key: 'quantity', label: 'Qte', x: 290, width: 38 },
  { key: 'unitPrice', label: 'Prix HT', x: 338, width: 62 },
  { key: 'vatRate', label: 'TVA', x: 410, width: 42 },
  { key: 'subtotal', label: 'Total HT', x: 462, width: 91 },
] as const

export function getInvoicePdfFilename(invoice: {
  id: string
  invoiceNumber: string | null
}) {
  const visibleNumber = invoice.invoiceNumber?.trim() || invoice.id
  const safeNumber = visibleNumber
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `Facture-${safeNumber || 'Gerard'}.pdf`
}

export async function buildInvoicePdf(invoice: InvoicePdfData) {
  if (invoice.direction !== InvoiceDirection.ISSUED) {
    throw new Error('PDF fournisseur non disponible dans cette phase.')
  }

  if (!invoice.lines.length) {
    throw new Error('La facture ne contient aucune ligne.')
  }

  const normalizedLines = normalizeInvoiceLines(invoice.lines)
  const totals = calculateInvoiceTotals(normalizedLines)
  const doc = new PDFDocument({
    bufferPages: true,
    margin: page.margin,
    size: 'A4',
  })
  const chunks: Buffer[] = []

  doc.on('data', (chunk: Buffer) => chunks.push(chunk))

  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () =>
      resolve(Buffer.concat(chunks as unknown as Uint8Array[]))
    )
  })

  drawHeader(doc, invoice)
  drawParties(doc, invoice)
  drawReferences(doc, invoice)
  drawMissionServices(doc, invoice)
  drawLinesTable(doc, normalizedLines)
  drawTotals(doc, totals)
  drawPayment(doc, invoice)
  drawNotes(doc, invoice)
  drawFooters(doc, invoice)

  doc.end()
  return done
}

function drawHeader(doc: PDFKit.PDFDocument, invoice: InvoicePdfData) {
  const logoPath = path.join(process.cwd(), 'public', 'logo_gerard_texte.png')

  if (existsSync(logoPath)) {
    doc.image(logoPath, page.margin, 42, {
      fit: [160, 58],
    })
  } else {
    doc
      .font('Helvetica-Bold')
      .fontSize(22)
      .fillColor('#11130f')
      .text(safeText(invoice.sellerName, 'Identité légale manquante'), page.margin, 44)
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#6f766b')
      .text('Transport & Logistique', page.margin, 70)
  }

  doc
    .font('Helvetica-Bold')
    .fontSize(24)
    .fillColor('#11130f')
    .text('FACTURE', 350, 42, { align: 'right', width: 203 })

  if (invoice.status === InvoiceStatus.DRAFT) {
    doc
      .roundedRect(454, 74, 99, 22, 10)
      .fill('#fef3c7')
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#92400e')
      .text('BROUILLON', 454, 81, { align: 'center', width: 99 })
  }

  drawKeyValueBlock(doc, 360, 106, 193, [
    ['N facture', safeText(invoice.invoiceNumber, 'Sans numero')],
    ['Emission', formatDate(invoice.issueDate)],
    ['Echeance', formatDate(invoice.dueDate)],
    ['Statut', statusLabel(invoice.status)],
  ])

  if (invoice.status === InvoiceStatus.DRAFT) {
    doc.save()
    doc
      .rotate(-28, { origin: [297, 420] })
      .font('Helvetica-Bold')
      .fontSize(54)
      .fillColor('#11130f')
      .opacity(0.045)
      .text('BROUILLON', 88, 392, { align: 'center', width: 420 })
    doc.restore()
    doc.opacity(1)
  }

  doc.y = 190
}

function drawParties(doc: PDFKit.PDFDocument, invoice: InvoicePdfData) {
  const y = doc.y
  drawBox(doc, page.margin, y, 246, 'Émetteur', [
    safeText(invoice.sellerName, 'Identité légale manquante'),
    safeText(invoice.sellerAddress, ''),
    `TVA : ${safeText(
      invoice.sellerVatNumber,
      ''
    )}`,
  ])
  drawBox(doc, 307, y, 246, 'Client', [
    safeText(invoice.buyerName, 'Client'),
    safeText(invoice.buyerAddress, 'Adresse non renseignee'),
    invoice.buyerVatNumber ? `TVA : ${invoice.buyerVatNumber}` : '',
    invoice.buyerEmail ? `Email : ${invoice.buyerEmail}` : '',
  ])
  doc.y = Math.max(doc.y, y + 126)
}

function drawReferences(doc: PDFKit.PDFDocument, invoice: InvoicePdfData) {
  ensureSpace(doc, 92)
  const y = doc.y + 10
  drawSectionTitle(doc, 'References mission', y)
  const rows = [
    ['Reference mission', safeText(invoice.missionReference)],
    ['Reference client', safeText(invoice.clientReference)],
    ...(invoice.invoiceMissions && invoice.invoiceMissions.length > 1
      ? []
      : [
          ...(invoice.invoiceMissions?.[0]?.cmrNumberSnapshot ?? invoice.cmrNumber
            ? [['Numero CMR', invoice.invoiceMissions?.[0]?.cmrNumberSnapshot ?? invoice.cmrNumber ?? '']]
            : []),
          ...(invoice.invoiceMissions?.[0]?.deliveryNoteNumberSnapshot ?? invoice.deliveryNoteNumber
            ? [['Bon de livraison', invoice.invoiceMissions?.[0]?.deliveryNoteNumberSnapshot ?? invoice.deliveryNoteNumber ?? '']]
            : []),
        ]),
    ['Description', safeText(invoice.missionDescription)],
  ]

  doc.y = y + 24
  rows.forEach(([label, value]) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor('#6f766b')
      .text(label, page.margin, doc.y, { width: 118 })
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#11130f')
      .text(value, page.margin + 128, doc.y - 10, {
        width: 383,
        lineGap: 2,
      })
    doc.moveDown(0.35)
  })
  doc.y += 8
}

function drawMissionServices(doc: PDFKit.PDFDocument, invoice: InvoicePdfData) {
  const missions = invoice.invoiceMissions ?? []
  if (!missions.length) return
  ensureSpace(doc, 80)
  drawSectionTitle(doc, 'Prestations missions', doc.y + 4)
  doc.y += 24
  missions.forEach((mission) => {
    const route = mission.mission
      ? `${mission.mission.pickupCity ?? 'À compléter'} -> ${mission.mission.deliveryCity ?? 'À compléter'}`
      : 'Trajet snapshot'
    const date = mission.mission?.pickupDate ? formatDate(mission.mission.pickupDate) : '-'
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#11130f')
      .text(
        `${mission.missionReferenceSnapshot}${mission.clientReferenceSnapshot ? `\nClient ${mission.clientReferenceSnapshot}` : ''}`,
        page.margin,
        doc.y,
        { width: 110 }
      )
    doc.font('Helvetica').fontSize(8).fillColor('#4f5549')
      .text(`${mission.cmrNumberSnapshot ? `CMR ${mission.cmrNumberSnapshot} · ` : ''}${mission.deliveryNoteNumberSnapshot ? `BL ${mission.deliveryNoteNumberSnapshot} · ` : ''}${date} · ${route}`, 154, doc.y - 10, { width: 270 })
      .text(money(mission.amountSnapshot), 440, doc.y - 10, { width: 113, align: 'right' })
    doc.moveDown(0.85)
  })
  doc.y += 6
}

function drawLinesTable(
  doc: PDFKit.PDFDocument,
  lines: ReturnType<typeof normalizeInvoiceLines>
) {
  ensureSpace(doc, 90)
  drawSectionTitle(doc, 'Lignes facture', doc.y + 4)
  doc.y += 28
  drawTableHeader(doc)

  lines.forEach((line) => {
    const description = [line.label, line.description]
      .filter(Boolean)
      .join('\n')
    const row = {
      description,
      quantity: formatQuantity(line.quantity),
      unitPrice: money(line.unitPrice),
      vatRate: `${formatQuantity(line.vatRate)} %`,
      subtotal: money(line.subtotalAmount),
    }
    const height = getTableRowHeight(doc, row)

    if (doc.y + height > page.bottom) {
      doc.addPage()
      drawTableHeader(doc)
    }

    drawTableRow(doc, row, height)
  })

  doc.y += 12
}

function drawTotals(
  doc: PDFKit.PDFDocument,
  totals: ReturnType<typeof calculateInvoiceTotals>
) {
  ensureSpace(doc, 96)
  const x = 355
  const y = doc.y

  doc.roundedRect(x, y, 198, 86, 14).fill('#f4f5f1')
  drawTotalLine(doc, y + 14, 'Total HT', money(totals.subtotalAmount))
  drawTotalLine(doc, y + 38, 'TVA', money(totals.vatAmount))
  doc
    .moveTo(x + 14, y + 60)
    .lineTo(x + 184, y + 60)
    .strokeColor('#d9ddd2')
    .stroke()
  drawTotalLine(doc, y + 66, 'Total TTC', money(totals.totalAmount), true)
  doc.y = y + 108
}

function drawPayment(doc: PDFKit.PDFDocument, invoice: InvoicePdfData) {
  ensureSpace(doc, 120)
  const y = doc.y
  drawBox(doc, page.margin, y, 246, 'Conditions de paiement', [
    safeText(invoice.paymentTerms, ''),
    `Date d'echeance : ${formatDate(invoice.dueDate)}`,
  ])
  drawBox(doc, 307, y, 246, 'Coordonnees bancaires', [
    `Beneficiaire : ${safeText(
      invoice.sellerBeneficiary,
      invoice.sellerName ?? undefined
    )}`,
    `Banque : ${safeText(
      invoice.sellerBankName,
      ''
    )}`,
    `IBAN : ${safeText(invoice.sellerIban, '')}`,
    `BIC : ${safeText(invoice.sellerBic, '')}`,
    `Reference : ${safeText(invoice.invoiceNumber, invoice.id)}`,
  ])
  doc.y = y + 140
}

function drawNotes(doc: PDFKit.PDFDocument, invoice: InvoicePdfData) {
  if (!invoice.notes) {
    return
  }

  ensureSpace(doc, 74)
  drawSectionTitle(doc, 'Notes', doc.y)
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#4f5549')
    .text(invoice.notes, page.margin, doc.y + 22, {
      width: page.width,
      lineGap: 2,
    })
}

function drawFooters(doc: PDFKit.PDFDocument, invoice: InvoicePdfData) {
  const range = doc.bufferedPageRange()

  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index)
    doc
      .moveTo(page.margin, 774)
      .lineTo(553, 774)
      .strokeColor('#e1e4dc')
      .stroke()
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#8b9186')
      .text(
        `${safeText(
          invoice.sellerName,
          'Identité légale manquante'
        )} - TVA ${safeText(
          invoice.sellerVatNumber,
          ''
        )} - Merci pour votre confiance.`,
        page.margin,
        784,
        { width: 400 }
      )
      .text(`Page ${index + 1} / ${range.count}`, 460, 784, {
        align: 'right',
        width: 93,
      })
  }
}

function drawKeyValueBlock(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  rows: string[][]
) {
  let cursorY = y
  rows.forEach(([label, value]) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor('#7b8075')
      .text(label.toUpperCase(), x, cursorY, { width: 72 })
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#11130f')
      .text(value, x + 76, cursorY - 1, {
        align: 'right',
        width: width - 76,
      })
    cursorY += 18
  })
}

function drawBox(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  title: string,
  lines: string[]
) {
  doc.roundedRect(x, y, width, 112, 14).fill('#ffffff')
  doc.roundedRect(x, y, width, 112, 14).strokeColor('#e1e4dc').stroke()
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor('#6f766b')
    .text(title.toUpperCase(), x + 14, y + 13, { width: width - 28 })
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor('#11130f')
    .text(safeText(lines[0]), x + 14, y + 34, {
      width: width - 28,
      lineGap: 2,
    })
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor('#4f5549')
    .text(
      lines
        .slice(1)
        .filter((line) => line.trim().length > 0)
        .join('\n'),
      x + 14,
      doc.y + 3,
      { width: width - 28, lineGap: 2 }
    )
}

function drawSectionTitle(doc: PDFKit.PDFDocument, title: string, y: number) {
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor('#11130f')
    .text(title, page.margin, y)
  doc
    .moveTo(page.margin, y + 17)
    .lineTo(553, y + 17)
    .strokeColor('#d9ddd2')
    .stroke()
}

function drawTableHeader(doc: PDFKit.PDFDocument) {
  const y = doc.y
  doc.roundedRect(page.margin, y, page.width, 25, 9).fill('#11130f')
  tableColumns.forEach((column) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(7.8)
      .fillColor('#ffffff')
      .text(column.label, column.x + 6, y + 8, {
        align:
          column.key === 'description'
            ? 'left'
            : column.key === 'quantity'
              ? 'center'
              : 'right',
        width: column.width - 12,
      })
  })
  doc.y = y + 31
}

function getTableRowHeight(
  doc: PDFKit.PDFDocument,
  row: Record<string, string>
) {
  doc.font('Helvetica').fontSize(8.2)
  const descriptionHeight = doc.heightOfString(row.description, {
    width: tableColumns[0].width - 12,
    lineGap: 2,
  })

  return Math.max(38, descriptionHeight + 18)
}

function drawTableRow(
  doc: PDFKit.PDFDocument,
  row: Record<string, string>,
  height: number
) {
  const y = doc.y
  doc.rect(page.margin, y, page.width, height).fill('#ffffff')
  doc.rect(page.margin, y, page.width, height).strokeColor('#e7eadf').stroke()

  tableColumns.forEach((column) => {
    const align =
      column.key === 'description'
        ? 'left'
        : column.key === 'quantity'
          ? 'center'
          : 'right'
    doc
      .font(column.key === 'description' ? 'Helvetica' : 'Helvetica-Bold')
      .fontSize(column.key === 'description' ? 8.2 : 8)
      .fillColor(column.key === 'description' ? '#11130f' : '#34372f')
      .text(row[column.key], column.x + 6, y + 10, {
        align,
        lineGap: 2,
        width: column.width - 12,
      })
  })

  doc.y = y + height
}

function drawTotalLine(
  doc: PDFKit.PDFDocument,
  y: number,
  label: string,
  value: string,
  strong = false
) {
  doc
    .font(strong ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(strong ? 12 : 9)
    .fillColor(strong ? '#11130f' : '#4f5549')
    .text(label, 370, y, { width: 76 })
    .font('Helvetica-Bold')
    .text(value, 440, y, { align: 'right', width: 96 })
}

function ensureSpace(doc: PDFKit.PDFDocument, height: number) {
  if (doc.y + height > page.bottom) {
    doc.addPage()
    doc.y = page.margin
  }
}

function safeText(value: unknown, fallback = '-') {
  if (typeof value !== 'string') {
    return fallback
  }

  const trimmedValue = value.trim()
  return trimmedValue.length > 0 ? trimmedValue : fallback
}

function decimalNumber(value: DecimalLike) {
  return Number(value.toString())
}

function money(value: DecimalLike) {
  return new Intl.NumberFormat('fr-LU', {
    currency: 'EUR',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: 'currency',
  }).format(decimalNumber(value))
}

function formatQuantity(value: DecimalLike) {
  return decimalNumber(value).toLocaleString('fr-LU', {
    maximumFractionDigits: 3,
    minimumFractionDigits: 0,
  })
}

function formatDate(value: Date | string | null) {
  if (!value) {
    return '-'
  }

  const date = value instanceof Date ? value : new Date(value)

  if (!Number.isFinite(date.getTime())) {
    return '-'
  }

  return new Intl.DateTimeFormat('fr-LU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function statusLabel(status: InvoiceStatus) {
  const labels: Record<InvoiceStatus, string> = {
    APPROVED: 'Validee',
    CANCELLED: 'Annulee',
    DRAFT: 'Brouillon',
    ISSUED: 'Emise',
    OVERDUE: 'En retard',
    PAID: 'Payee',
    RECEIVED: 'Recue',
    REJECTED: 'Rejetee',
    TO_REVIEW: 'A verifier',
  }

  return labels[status]
}
