import { withTenantApiRoute } from '../../../lib/auth/authorization'
// DEMO UNIQUEMENT — route de secours locale pour la boite de traitement Gerard.
// Les imports mail reels sont desactives (MAIL_IMPORT_PROVIDER="disabled").
// Ne sert QUE des donnees fictives, et refuse de repondre en production.
import type { NextApiRequest, NextApiResponse } from 'next'

import { getCurrentUser } from '../../../lib/auth/authorization'
import { prisma } from '../../../lib/prisma'
import { applyImportStates } from '../../../lib/mail/import-preview-state'
import type { MailImportsResponse, MissionImportPreview } from '../../../lib/mail/types'

const iso = (d: string) => new Date(d).toISOString()

const base = {
  source: 'imap' as const,
  provider: 'imap',
  priceCurrency: 'EUR',
  paymentTerms: '30 jours fin de mois',
  requiredTruckType: 'CURTAINSIDER',
  parserChain: ['gerard-demo'],
  referenceSource: 'business' as const,
}

const imports: MissionImportPreview[] = [
  {
    ...base,
    id: 'demo-import-01',
    sourceEmailId: 'demo-mail-01',
    parserId: 'gerard-demo',
    confidence: 0.97,
    receivedAt: iso('2026-09-14T07:12:00Z'),
    sourceEmailFrom: 'Translog Nord <dispatch@translog-nord.demo>',
    sourceEmailFromName: 'Translog Nord',
    sourceEmailFromAddress: 'dispatch@translog-nord.demo',
    sourceEmailSubject: 'Ordre de transport TLN-4471 — Charleroi / Reims',
    sourceEmailBodyPreview: 'Chargement le 18/09 a 08h00, livraison le meme jour.',
    reference: 'TLN-4471',
    clientName: 'Translog Nord',
    clientReference: 'TLN-4471',
    pickupCity: 'Charleroi',
    deliveryCity: 'Reims',
    pickupDate: iso('2026-09-18T06:00:00Z'),
    deliveryDate: iso('2026-09-18T13:00:00Z'),
    estimatedKm: 284,
    priceAmount: 1320,
    importState: 'ASSIGNED',
    attentionReasons: [],
    missionReference: 'GRD-260918-12',
    alreadyCreated: true,
  },
  {
    ...base,
    id: 'demo-import-02',
    sourceEmailId: 'demo-mail-02',
    parserId: 'gerard-demo',
    confidence: 0.94,
    receivedAt: iso('2026-09-14T08:40:00Z'),
    sourceEmailFrom: 'Atlas Freight <ops@atlasfreight.demo>',
    sourceEmailFromName: 'Atlas Freight',
    sourceEmailFromAddress: 'ops@atlasfreight.demo',
    sourceEmailSubject: 'Confirmation AF-2290 — Liege / Lille',
    sourceEmailBodyPreview: 'Bache obligatoire, hayon non requis.',
    reference: 'AF-2290',
    clientName: 'Atlas Freight',
    clientReference: 'AF-2290',
    pickupCity: 'Liege',
    deliveryCity: 'Lille',
    pickupDate: iso('2026-09-18T05:30:00Z'),
    deliveryDate: iso('2026-09-18T11:00:00Z'),
    estimatedKm: 213,
    priceAmount: 940,
    importState: 'CREATED',
    attentionReasons: [],
    missionReference: 'GRD-260918-13',
    alreadyCreated: true,
  },
  {
    ...base,
    id: 'demo-import-03',
    sourceEmailId: 'demo-mail-03',
    parserId: 'gerard-demo',
    confidence: 0.91,
    receivedAt: iso('2026-09-14T09:05:00Z'),
    sourceEmailFrom: 'Helios Transport <planning@helios-transport.demo>',
    sourceEmailFromName: 'Helios Transport',
    sourceEmailFromAddress: 'planning@helios-transport.demo',
    sourceEmailSubject: 'Nouvelle expedition HT-8814 — Namur / Luxembourg',
    sourceEmailBodyPreview: 'Creneau de chargement 06h00 - 08h00.',
    reference: 'HT-8814',
    clientName: 'Helios Transport',
    clientReference: 'HT-8814',
    pickupCity: 'Namur',
    deliveryCity: 'Luxembourg',
    pickupDate: iso('2026-09-18T04:00:00Z'),
    deliveryDate: iso('2026-09-18T09:30:00Z'),
    estimatedKm: 169,
    priceAmount: 780,
    importState: 'NEW',
    attentionReasons: [],
  },
  {
    ...base,
    id: 'demo-import-04',
    sourceEmailId: 'demo-mail-04',
    parserId: 'gerard-demo',
    confidence: 0.72,
    receivedAt: iso('2026-09-14T09:31:00Z'),
    sourceEmailFrom: 'Delta Routes <commandes@delta-routes.demo>',
    sourceEmailFromName: 'Delta Routes',
    sourceEmailFromAddress: 'commandes@delta-routes.demo',
    sourceEmailSubject: 'DR-1157 — Charleroi / Metz — a confirmer',
    sourceEmailBodyPreview: 'Heure de livraison a preciser par le client.',
    reference: 'DR-1157',
    clientName: 'Delta Routes',
    clientReference: 'DR-1157',
    pickupCity: 'Charleroi',
    deliveryCity: 'Metz',
    pickupDate: iso('2026-09-18T06:30:00Z'),
    deliveryDate: iso('2026-09-18T13:00:00Z'),
    estimatedKm: 227,
    priceAmount: 1060,
    importState: 'NEW',
    attentionReasons: [],
  },
  {
    ...base,
    id: 'demo-import-05',
    sourceEmailId: 'demo-mail-05',
    parserId: 'gerard-demo',
    confidence: 0.88,
    receivedAt: iso('2026-09-14T10:02:00Z'),
    sourceEmailFrom: 'Euromove Cargo <expedition@euromove-cargo.demo>',
    sourceEmailFromName: 'Euromove Cargo',
    sourceEmailFromAddress: 'expedition@euromove-cargo.demo',
    sourceEmailSubject: 'EMC-6033 — Sedan / Reims',
    sourceEmailBodyPreview: 'Palettes consignees, retour a vide accepte.',
    reference: 'EMC-6033',
    clientName: 'Euromove Cargo',
    clientReference: 'EMC-6033',
    pickupCity: 'Sedan',
    deliveryCity: 'Reims',
    pickupDate: iso('2026-09-18T07:00:00Z'),
    deliveryDate: iso('2026-09-18T12:00:00Z'),
    estimatedKm: 101,
    priceAmount: 610,
    importState: 'NEW',
    attentionReasons: [],
  },
  ...[
    ['06', 'BC-4208', 'Belgicargo', 'Mons', 'Lille', '2026-09-21T06:00:00Z', '2026-09-21T12:00:00Z', 870, 119, '12 palettes de produits secs, quai dechargement requis.'],
    ['07', 'AM-7832', 'Ardennes Messagerie', 'Sedan', 'Liege', '2026-09-22T05:30:00Z', '2026-09-22T13:30:00Z', 1090, 183, '18 palettes, chargement lateral sous bache.'],
    ['08', 'RT-3106', 'Rhin Transit', 'Metz', 'Namur', '2026-09-23T06:30:00Z', '2026-09-23T14:00:00Z', 1220, 225, 'Materiel emballe, sangles obligatoires.'],
    ['09', 'NF-5520', 'Nord Fret', 'Reims', 'Charleroi', '2026-09-24T07:00:00Z', '2026-09-24T14:00:00Z', 960, 174, '10 palettes non gerbables, livraison sur rendez-vous.'],
    ['10', 'LC-9024', 'Lux Cargo', 'Luxembourg', 'Sedan', '2026-09-25T05:00:00Z', '2026-09-25T12:30:00Z', 1120, 201, 'Pieces industrielles, arrimage a verifier au chargement.'],
    ['11', 'EM-7145', 'EuroMarchandises', 'Liege', 'Metz', '2026-09-28T06:00:00Z', '2026-09-28T14:00:00Z', 1380, 247, '14 palettes, livraison avant 16h.'],
    ['12', 'TC-2981', 'TransCargo Est', 'Charleville-Mezieres', 'Luxembourg', '2026-09-29T06:30:00Z', '2026-09-29T14:30:00Z', 1270, 211, 'Marchandises generales, documents CMR a remettre.'],
  ].map(([number, reference, clientName, pickupCity, deliveryCity, pickupDate, deliveryDate, priceAmount, estimatedKm, notes]) => ({
    ...base,
    id: `demo-import-${number}`,
    sourceEmailId: `demo-mail-${number}`,
    parserId: 'gerard-demo',
    confidence: 0.94,
    receivedAt: iso('2026-09-18T09:00:00Z'),
    sourceEmailFrom: `${clientName} <dispatch@transport.demo>`,
    sourceEmailFromName: String(clientName),
    sourceEmailFromAddress: 'dispatch@transport.demo',
    sourceEmailSubject: `Ordre de transport ${reference} — ${pickupCity} / ${deliveryCity}`,
    sourceEmailBodyPreview: String(notes),
    reference: String(reference),
    clientName: String(clientName),
    clientReference: String(reference),
    pickupCity: String(pickupCity),
    deliveryCity: String(deliveryCity),
    pickupDate: iso(String(pickupDate)),
    deliveryDate: iso(String(deliveryDate)),
    estimatedKm: Number(estimatedKm),
    priceAmount: Number(priceAmount),
    notes: String(notes),
    importState: 'NEW' as const,
    attentionReasons: [],
  })),
]

async function handler(req: NextApiRequest, res: NextApiResponse<MailImportsResponse>) {
  if (process.env.NODE_ENV === 'production') {
    res.status(404).end()
    return
  }
  const user = await getCurrentUser(req)
  if (!user || !user.isActive) {
    res.status(401).end()
    return
  }
  const existing = await prisma.mission.findMany({
    where: { OR: [
      { sourceEmailId: { in: imports.map((item) => item.sourceEmailId) } },
      { reference: { in: imports.map((item) => item.missionReference).filter((value): value is string => Boolean(value)) } },
    ] },
    select: { id: true, reference: true, sourceEmailId: true, assignment: { select: { id: true } }, createdAt: true },
  })
  const bySource = new Map(existing.filter((mission) => mission.sourceEmailId).map((mission) => [mission.sourceEmailId, mission]))
  const byReference = new Map(existing.map((mission) => [mission.reference, mission]))
  const hydrated = imports.map((item) => {
    const mission = bySource.get(item.sourceEmailId) ?? (item.missionReference ? byReference.get(item.missionReference) : undefined)
    return {
      ...item,
      alreadyCreated: Boolean(mission),
      missionId: mission?.id ?? null,
      createdMissionId: mission?.id,
      missionReference: mission?.reference ?? null,
      missionCreatedAt: mission?.createdAt.toISOString() ?? null,
      assignment: mission?.assignment ? {} : null,
    }
  })
  res.status(200).json({ provider: 'imap', connected: true, imports: applyImportStates(hydrated) })
}

export default withTenantApiRoute(handler)
