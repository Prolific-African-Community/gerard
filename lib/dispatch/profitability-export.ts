import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'

import type {
  MissingDataItem,
  ProfitabilityGroup,
  ProfitabilityMission,
  ProfitabilityResult,
} from './profitability'

export function formatMoney(value: number) {
  return `${value.toLocaleString('fr-FR', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })} EUR`
}

export function formatRate(value: number | null) {
  if (value === null) {
    return 'n/a'
  }

  return `${(value * 100).toLocaleString('fr-FR', {
    maximumFractionDigits: 1,
  })} %`
}

export function formatExportDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

export async function buildProfitabilityPdf(
  profitability: ProfitabilityResult,
  periodLabel: string
) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 36,
    bufferPages: true,
  })
  const chunks: Buffer[] = []

  doc.on('data', (chunk: Buffer) => chunks.push(chunk))

  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () =>
      resolve(Buffer.concat(chunks as unknown as Uint8Array[]))
    )
  })

  doc
    .fillColor('#11130f')
    .fontSize(20)
    .text('Gerard', { continued: true })
    .fillColor('#6f766b')
    .fontSize(10)
    .text('  Rapport rentabilite operationnelle', { align: 'right' })

  doc.moveDown(0.6)
  doc
    .fontSize(10)
    .fillColor('#4f5549')
    .text(`Periode : ${periodLabel}`)
    .text(`Export : ${new Date().toLocaleString('fr-FR')}`)
    .text(
      `Parametres : carburant ${profitability.parameters.fuelPricePerLiter} EUR/L · consommation ${profitability.parameters.defaultConsumptionL100} L/100 · chauffeur defaut ${profitability.parameters.defaultDriverHourlyCost} EUR/h`
    )

  doc.moveDown()
  addPdfSectionTitle(doc, 'Synthese')
  addPdfKeyValues(doc, [
    ['CA total', formatMoney(profitability.summary.revenueTotal)],
    ['Cout carburant', formatMoney(profitability.summary.fuelCostTotal)],
    ['Cout chauffeur', formatMoney(profitability.summary.driverCostTotal)],
    ['Peages semaine', formatMoney(profitability.summary.tollCostAmount)],
    [
      'Couts operationnels',
      formatMoney(profitability.summary.operatingCostTotal),
    ],
    [
      'Resultat avant peages',
      formatMoney(profitability.summary.grossProfitBeforeTolls),
    ],
    [
      'Resultat net apres peages',
      formatMoney(profitability.summary.netProfitAfterTolls),
    ],
    ['Taux avant peages', formatRate(profitability.summary.marginBeforeTolls)],
    [
      'Taux net apres peages',
      formatRate(profitability.summary.marginAfterTolls),
    ],
    ['Km total', `${profitability.summary.totalKm} km`],
    ['Heures estimees', `${profitability.summary.totalHours} h`],
    ['Missions', String(profitability.summary.missionCount)],
  ])

  doc
    .moveDown(0.5)
    .fontSize(8)
    .fillColor('#6f766b')
    .text(
      'Note : les peages sont saisis globalement au niveau semaine et ne sont pas ventiles par camion, chauffeur ou remorque.'
    )

  addPdfTable(doc, 'Detail par mission', [
    ['Ref', 'Client', 'Trajet', 'CA', 'Km', 'Couts', 'Marge'],
    ...profitability.byMission.map((mission) => [
      mission.reference,
      mission.clientName,
      `${mission.pickupCity} > ${mission.deliveryCity}`,
      formatMoney(mission.revenue),
      `${mission.totalKm}`,
      formatMoney(mission.fuelCost + mission.driverCost),
      formatMoney(mission.operationalMargin),
    ]),
  ])

  addGroupPdfTable(doc, 'Rentabilite par camion', profitability.byTruck)
  addGroupPdfTable(doc, 'Rentabilite par chauffeur', profitability.byDriver)
  addGroupPdfTable(doc, 'Rentabilite par remorque', profitability.byTrailer)

  addPdfTable(doc, 'Donnees a completer', [
    ['Type', 'Mission', 'Donnee'],
    ...profitability.missingData.critical.map((item) => [
      'Critique',
      item.reference,
      item.label,
    ]),
    ...profitability.missingData.optional.map((item) => [
      'Optionnel',
      item.reference,
      item.label,
    ]),
  ])

  const range = doc.bufferedPageRange()
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index)
    doc
      .fontSize(8)
      .fillColor('#9aa090')
      .text(`Page ${index + 1} / ${range.count}`, 36, 806, {
        align: 'right',
      })
  }

  doc.end()
  return done
}

export async function buildProfitabilityWorkbook(
  profitability: ProfitabilityResult,
  periodLabel: string
) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Gerard Dispatch'
  workbook.created = new Date()

  const summarySheet = workbook.addWorksheet('Synthese')
  summarySheet.addRows([
    ['Gerard - Rapport rentabilite operationnelle'],
    ['Periode', periodLabel],
    ['Export', new Date().toLocaleString('fr-FR')],
    [],
    ['Parametre', 'Valeur'],
    ['Prix carburant EUR/L', profitability.parameters.fuelPricePerLiter],
    ['Consommation L/100', profitability.parameters.defaultConsumptionL100],
    [
      'Cout chauffeur defaut EUR/h',
      profitability.parameters.defaultDriverHourlyCost,
    ],
    [],
    ['Indicateur', 'Valeur'],
    ['CA total', profitability.summary.revenueTotal],
    ['Cout carburant', profitability.summary.fuelCostTotal],
    ['Cout chauffeur', profitability.summary.driverCostTotal],
    ['Peages semaine', profitability.summary.tollCostAmount],
    ['Couts operationnels', profitability.summary.operatingCostTotal],
    ['Resultat avant peages', profitability.summary.grossProfitBeforeTolls],
    ['Resultat net apres peages', profitability.summary.netProfitAfterTolls],
    ['Taux avant peages', profitability.summary.marginBeforeTolls],
    ['Taux net apres peages', profitability.summary.marginAfterTolls],
    ['Km total', profitability.summary.totalKm],
    ['Heures estimees', profitability.summary.totalHours],
    ['Missions', profitability.summary.missionCount],
    [],
    [
      'Note',
      'Peages saisis globalement, non ventiles par camion/chauffeur/remorque.',
    ],
  ])
  polishSheet(summarySheet)

  const missionsSheet = workbook.addWorksheet('Missions')
  missionsSheet.addRow([
    'Reference',
    'Client',
    'Trajet',
    'Chauffeur',
    'Camion',
    'Remorque',
    'CA',
    'Km mission',
    'Km approche',
    'Km retour base',
    'Km total',
    'Heures total',
    'Cout carburant',
    'Cout chauffeur',
    'Marge',
    'Taux marge',
    'Donnees manquantes',
  ])
  profitability.byMission.forEach((mission) => {
    missionsSheet.addRow([
      mission.reference,
      mission.clientName,
      `${mission.pickupCity} > ${mission.deliveryCity}`,
      mission.driverName ?? '',
      mission.truckPlateNumber ?? '',
      mission.trailerPlateNumber ?? '',
      mission.revenue,
      mission.missionKm,
      mission.approachKm,
      mission.returnToBaseKm,
      mission.totalKm,
      mission.totalHours,
      mission.fuelCost,
      mission.driverCost,
      mission.operationalMargin,
      mission.marginRate,
      [...mission.missingFields, ...mission.optionalMissingFields].join(', '),
    ])
  })
  polishSheet(missionsSheet)

  addGroupSheet(workbook, 'Camions', profitability.byTruck)
  addGroupSheet(workbook, 'Chauffeurs', profitability.byDriver)
  addGroupSheet(workbook, 'Remorques', profitability.byTrailer)
  addMissingSheet(
    workbook,
    profitability.missingData.critical,
    profitability.missingData.optional
  )

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
}

function addPdfSectionTitle(doc: PDFKit.PDFDocument, title: string) {
  doc.moveDown(0.8)
  doc.fillColor('#11130f').fontSize(13).text(title)
  doc.moveDown(0.4)
}

function addPdfKeyValues(doc: PDFKit.PDFDocument, rows: string[][]) {
  rows.forEach(([label, value]) => {
    doc
      .fontSize(10)
      .fillColor('#6f766b')
      .text(label, { continued: true, width: 170 })
      .fillColor('#11130f')
      .text(value)
  })
}

function addPdfTable(doc: PDFKit.PDFDocument, title: string, rows: string[][]) {
  addPdfSectionTitle(doc, title)

  if (rows.length <= 1) {
    doc.fontSize(9).fillColor('#6f766b').text('Aucune donnee.')
    return
  }

  rows.slice(0, 28).forEach((row, index) => {
    const isHeader = index === 0
    doc
      .fontSize(isHeader ? 8 : 7)
      .fillColor(isHeader ? '#11130f' : '#4f5549')
      .text(row.join('  |  '), {
        width: 520,
        lineGap: 2,
      })
  })
}

function addGroupPdfTable(
  doc: PDFKit.PDFDocument,
  title: string,
  groups: ProfitabilityGroup[]
) {
  addPdfTable(doc, title, [
    ['Ressource', 'Missions', 'CA', 'Km', 'Marge', 'Taux'],
    ...groups.map((group) => [
      group.label,
      String(group.missionCount),
      formatMoney(group.revenueTotal),
      String(group.totalKm),
      formatMoney(group.operationalMarginTotal),
      formatRate(group.marginRate),
    ]),
  ])
}

function addGroupSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  groups: ProfitabilityGroup[]
) {
  const sheet = workbook.addWorksheet(name)
  sheet.addRow([
    'Ressource',
    'Missions',
    'CA',
    'Km total',
    'Heures',
    'Cout carburant',
    'Cout chauffeur',
    'Marge',
    'Taux marge',
  ])
  groups.forEach((group) => {
    sheet.addRow([
      group.label,
      group.missionCount,
      group.revenueTotal,
      group.totalKm,
      group.totalHours,
      group.fuelCostTotal,
      group.driverCostTotal,
      group.operationalMarginTotal,
      group.marginRate,
    ])
  })
  polishSheet(sheet)
}

function addMissingSheet(
  workbook: ExcelJS.Workbook,
  critical: MissingDataItem[],
  optional: MissingDataItem[]
) {
  const sheet = workbook.addWorksheet('Donnees_a_completer')
  sheet.addRow(['Type', 'Mission', 'Champ', 'Libelle'])
  critical.forEach((item) =>
    sheet.addRow(['Critique', item.reference, item.field, item.label])
  )
  optional.forEach((item) =>
    sheet.addRow(['Optionnel', item.reference, item.field, item.label])
  )
  polishSheet(sheet)
}

function polishSheet(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = {
    from: 'A1',
    to: `${String.fromCharCode(64 + Math.max(1, sheet.columnCount))}1`,
  }
  sheet.getRow(1).font = { bold: true }
  sheet.columns.forEach((column) => {
    const values = column.values ?? []

    column.width = Math.min(
      34,
      Math.max(
        12,
        ...values.map((value) =>
          value === null || typeof value === 'undefined'
            ? 0
            : String(value).length + 2
        )
      )
    )
  })
}
