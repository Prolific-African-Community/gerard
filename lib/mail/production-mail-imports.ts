import { Prisma } from '@prisma/client'

import { normalizeClientProfile } from '../dispatch/client-profiles'
import { prisma } from '../prisma'
import { applyImportStates } from './import-preview-state'
import { fetchRecentImapMessages, getImapConfig } from './imap-client'
import { parseMissionEmails } from './mission-email-parser'
import type { MailImportsResponse, MissionImportPreview } from './types'

function persistedPreview(email: Awaited<ReturnType<typeof loadPersistedState>>['sourceEmails'][number]): MissionImportPreview {
  const mission = email.mission
  const previewKey = email.previewKey || email.sourceEmailId || email.id
  return {
    id: previewKey,
    source: 'imap',
    provider: email.provider || 'imap',
    sourceEmailId: email.sourceEmailId,
    previewKey,
    messageId: email.messageId,
    sourceEmailFrom: email.fromName || email.fromAddress || '',
    sourceEmailFromName: email.fromName,
    sourceEmailFromAddress: email.fromAddress,
    sourceEmailToAddresses: Array.isArray(email.toAddresses) ? email.toAddresses.filter((value): value is string => typeof value === 'string') : [],
    sourceEmailCcAddresses: Array.isArray(email.ccAddresses) ? email.ccAddresses.filter((value): value is string => typeof value === 'string') : [],
    sourceEmailSubject: email.subject || '',
    sourceEmailBodyPreview: email.bodyPreview,
    sourceEmailCleanedBodyText: email.cleanedBodyText,
    sourceEmailRawBodyText: email.rawBodyText,
    sourceEmailRawBodyHtml: email.rawBodyHtml,
    receivedAt: (email.receivedAt || email.createdAt).toISOString(),
    confidence: 1,
    parserId: 'persisted',
    parserChain: ['persisted'],
    reference: mission?.reference || previewKey,
    referenceSource: mission ? 'business' : 'generated',
    clientReference: mission?.clientReference || undefined,
    clientName: mission?.clientName || email.fromName || email.fromAddress || 'Inconnu',
    pickupCity: mission?.pickupCity || '',
    deliveryCity: mission?.deliveryCity || '',
    pickupDate: mission?.pickupDate?.toISOString(),
    deliveryDate: mission?.deliveryDate?.toISOString(),
    alreadyCreated: Boolean(mission),
    createdMissionId: mission?.id,
    missionId: mission?.id || null,
    missionReference: mission?.reference || null,
    missionCreatedAt: mission?.createdAt.toISOString() || null,
    assignment: mission?.assignment ? {
      driverName: mission.assignment.driver?.name || null,
      truckPlate: mission.assignment.truck?.plateNumber || null,
      trailerPlate: mission.assignment.trailer?.plateNumber || null,
      scheduledDate: mission.assignment.scheduledDate.toISOString(),
      day: mission.assignment.day,
    } : null,
    ignored: false,
  }
}

async function loadPersistedState() {
  const [sourceEmails, ignoredRows] = await Promise.all([
    prisma.missionSourceEmail.findMany({
      orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        mission: {
          select: {
            id: true, reference: true, clientReference: true, clientName: true,
            pickupCity: true, deliveryCity: true, pickupDate: true, deliveryDate: true,
            createdAt: true,
            assignment: { select: {
              scheduledDate: true, day: true,
              driver: { select: { name: true } },
              truck: { select: { plateNumber: true } },
              trailer: { select: { plateNumber: true } },
            } },
          },
        },
      },
    }),
    prisma.ignoredMailImport.findMany({ orderBy: { ignoredAt: 'desc' } }),
  ])
  return { sourceEmails, ignoredRows }
}

function withIgnoredRows(previews: MissionImportPreview[], ignoredRows: Awaited<ReturnType<typeof loadPersistedState>>['ignoredRows']) {
  const byPreviewKey = new Map(previews.map((item) => [item.id, item]))
  for (const ignored of ignoredRows) {
    const existing = byPreviewKey.get(ignored.previewKey)
    if (existing) {
      existing.ignored = true
      existing.ignoredAt = ignored.ignoredAt.toISOString()
      continue
    }
    const preview: MissionImportPreview = {
      id: ignored.previewKey,
      source: 'imap', provider: ignored.provider || 'imap', sourceEmailId: ignored.sourceEmailId,
      previewKey: ignored.previewKey, messageId: ignored.messageId,
      sourceEmailFrom: ignored.fromAddress || '', sourceEmailFromAddress: ignored.fromAddress,
      sourceEmailSubject: ignored.subject || '', receivedAt: ignored.ignoredAt.toISOString(),
      confidence: 0, parserId: 'persisted-ignored', parserChain: ['persisted'],
      reference: ignored.clientReference || ignored.previewKey, referenceSource: 'generated',
      clientReference: ignored.clientReference || undefined,
      clientName: ignored.fromAddress || 'Inconnu', pickupCity: '', deliveryCity: '',
      importState: 'PENDING', attentionReasons: ['missingFields'],
      missionId: null, assignment: null, ignored: true, ignoredAt: ignored.ignoredAt.toISOString(),
    }
    previews.push(preview)
    byPreviewKey.set(preview.id, preview)
  }
  return previews
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

async function hydrateLivePreviews(previews: MissionImportPreview[]) {
  const conditions: Prisma.MissionWhereInput[] = []
  const references = unique(previews.filter((item) => item.referenceSource !== 'subject').map((item) => item.reference))
  const sourceEmailIds = unique(previews.map((item) => item.sourceEmailId))
  const clientReferences = unique(previews.map((item) => item.clientReference))
  if (references.length) conditions.push({ reference: { in: references } })
  if (sourceEmailIds.length) conditions.push({ sourceEmailId: { in: sourceEmailIds } })
  if (clientReferences.length) conditions.push({ clientReference: { in: clientReferences } })
  if (!conditions.length) return previews

  const missions = await prisma.mission.findMany({
    where: { OR: conditions },
    select: {
      id: true, reference: true, sourceEmailId: true, clientReference: true, createdAt: true,
      assignment: { select: {
        scheduledDate: true, day: true,
        driver: { select: { name: true } }, truck: { select: { plateNumber: true } }, trailer: { select: { plateNumber: true } },
      } },
    },
  })
  const byReference = new Map(missions.map((mission) => [mission.reference, mission]))
  const bySource = new Map(missions.filter((mission) => mission.sourceEmailId).map((mission) => [mission.sourceEmailId as string, mission]))
  const byClientReference = new Map(missions.filter((mission) => mission.clientReference).map((mission) => [mission.clientReference as string, mission]))
  return previews.map((item) => {
    const mission = bySource.get(item.sourceEmailId) || (item.clientReference ? byClientReference.get(item.clientReference) : undefined) || (item.referenceSource !== 'subject' ? byReference.get(item.reference) : undefined)
    return {
      ...item,
      alreadyCreated: Boolean(mission),
      createdMissionId: mission?.id,
      missionId: mission?.id || null,
      missionReference: mission?.reference || null,
      missionCreatedAt: mission?.createdAt.toISOString() || null,
      assignment: mission?.assignment ? {
        driverName: mission.assignment.driver?.name || null,
        truckPlate: mission.assignment.truck?.plateNumber || null,
        trailerPlate: mission.assignment.trailer?.plateNumber || null,
        scheduledDate: mission.assignment.scheduledDate.toISOString(), day: mission.assignment.day,
      } : null,
    }
  })
}

export function mergeMailPreviews(live: MissionImportPreview[], persisted: MissionImportPreview[]) {
  const merged = new Map<string, MissionImportPreview>()
  for (const item of persisted) merged.set(item.id, item)
  for (const item of live) merged.set(item.id, { ...merged.get(item.id), ...item })
  return Array.from(merged.values())
}

export async function loadProductionMailImports(): Promise<MailImportsResponse> {
  const { sourceEmails, ignoredRows } = await loadPersistedState()
  const persisted = withIgnoredRows(sourceEmails.map(persistedPreview), ignoredRows)

  try {
    const config = await getImapConfig()
    const emails = await fetchRecentImapMessages(config)
    const clientProfiles = (await prisma.clientProfile.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } })).map((profile) => normalizeClientProfile({ ...profile, createdAt: profile.createdAt.toISOString(), updatedAt: profile.updatedAt.toISOString() } as Record<string, unknown>))
    const live = await hydrateLivePreviews(parseMissionEmails(emails, clientProfiles))
    return { provider: 'imap', connected: true, imports: applyImportStates(withIgnoredRows(mergeMailPreviews(live, persisted), ignoredRows)) }
  } catch (error) {
    const message = error instanceof Error && ['IntegrationUnavailableError', 'IntegrationSecretError', 'ImapImportError'].includes(error.name)
      ? error.message
      : 'Connexion mail impossible'
    return { provider: 'imap', connected: false, imports: applyImportStates(persisted), error: message }
  }
}
