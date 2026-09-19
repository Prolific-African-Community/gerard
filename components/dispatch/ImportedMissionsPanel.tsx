'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import type { CreateMissionFormData } from './CreateMissionPanel'
import { SourceEmailModal } from './SourceEmailModal'
import { ImportCard } from './imports/ImportCard'
import { ImportEditDrawer } from './imports/ImportEditDrawer'
import { RefreshIcon, SearchIcon } from './imports/ImportIcons'
import type {
  ImportMissionCreationResult,
  ImportState,
  MailImportsResponse,
  MissionImportPreview,
  MissionSourceEmailResponse,
} from '../../lib/mail/types'
import {
  createEditableMissionImport,
  mergeRequiredTrailerType,
  normalizeMissionReference,
} from '../../lib/mail/editable-import'
import type { EditableMissionImport } from '../../lib/mail/editable-import'
import type { LocalImportDraft } from '../../lib/mail/import-preview-state'
import { applyLocalEdits } from '../../lib/mail/import-preview-state'
import {
  countByState,
  filterImports,
  groupByClient,
  importStateLabels,
  importStateOrder,
  listClients,
  selectByState,
  sortByReceivedDesc,
} from '../../lib/mail/import-presentation'

type ImportedMissionsPanelProps = {
  isOpen: boolean
  onClose: () => void
  onCreateMission: (
    data: CreateMissionFormData,
  ) => Promise<ImportMissionCreationResult | void>
  /** Droit imports.manage : sans lui le panneau reste en lecture seule. */
  canManageImports?: boolean
  /** Incrémenté par le Planning : déclenche une resynchronisation. */
  syncVersion?: number
  /** Ouvre la mission dans le Planning (fiche mission). */
  onOpenMission?: (missionId: string) => void
}

const emptyStates: Record<ImportState, { title: string; hint: string }> = {
  NEW: {
    title: 'Tout est traité',
    hint: 'Aucun nouvel e-mail à examiner.',
  },
  PENDING: {
    title: 'Rien en attente',
    hint: 'Les imports nécessitant une intervention apparaîtront ici.',
  },
  CREATED: {
    title: 'Aucune mission récemment créée',
    hint: 'Les missions créées depuis un e-mail apparaîtront ici jusqu’à leur affectation.',
  },
  ASSIGNED: {
    title: 'Aucune mission assignée dans cette sélection',
    hint: 'Les missions affectées dans le Planning apparaîtront ici.',
  },
}

function buildSourceEmail(
  item: MissionImportPreview,
): MissionSourceEmailResponse {
  return {
    source: 'IMAP_MAIL',
    provider: item.provider,
    sourceEmailId: item.sourceEmailId,
    messageId: item.messageId,
    previewKey: item.previewKey ?? item.id,
    subject: item.sourceEmailSubject,
    fromName: item.sourceEmailFromName ?? null,
    fromAddress: item.sourceEmailFromAddress ?? item.sourceEmailFrom ?? null,
    toAddresses: item.sourceEmailToAddresses ?? [],
    ccAddresses: item.sourceEmailCcAddresses ?? [],
    receivedAt: item.receivedAt,
    bodyPreview: item.sourceEmailBodyPreview ?? null,
    cleanedBodyText: item.sourceEmailCleanedBodyText ?? null,
    rawBodyText: item.sourceEmailRawBodyText ?? null,
    rawBodyHtml: item.sourceEmailRawBodyHtml ?? null,
  }
}

function toCreatePayload(
  item: EditableMissionImport,
): CreateMissionFormData {
  const validPickup = hasValidCoordinatePair(item.pickupLat, item.pickupLng)
  const validDelivery = hasValidCoordinatePair(
    item.deliveryLat,
    item.deliveryLng,
  )

  return {
    reference: item.parserId === 'gerard-demo'
      ? `GRD-${item.pickupDate?.slice(2, 10).replaceAll('-', '') ?? 'DEMO'}-D${item.sourceEmailId.slice(-2)}`
      : normalizeMissionReference(item.reference),
    title: item.title,
    clientName: item.clientName,
    pickupCity: item.pickupCity,
    deliveryCity: item.deliveryCity,
    pickupAddress: item.pickupAddress,
    deliveryAddress: item.deliveryAddress,
    pickupLat: validPickup ? item.pickupLat : undefined,
    pickupLng: validPickup ? item.pickupLng : undefined,
    deliveryLat: validDelivery ? item.deliveryLat : undefined,
    deliveryLng: validDelivery ? item.deliveryLng : undefined,
    estimatedKm: item.estimatedKm,
    routeDistanceMeters: item.routeDistanceMeters,
    routeDurationSeconds: item.routeDurationSeconds,
    clientReference: item.clientReference,
    cmrNumber: item.cmrNumber,
    deliveryNoteNumber: item.deliveryNoteNumber,
    pickupDate: item.pickupDate,
    deliveryDate: item.deliveryDate,
    requiredTruckType: item.requiredTruckType,
    requiredTrailerType: item.requiredTrailerType,
    priceAmount: item.priceAmount,
    priceCurrency: item.priceCurrency,
    paymentTerms: item.paymentTerms,
    preAnnouncementRequired: item.preAnnouncementRequired,
    preAnnouncementSent: item.preAnnouncementSent,
    preAnnouncementSentAt: item.preAnnouncementSentAt,
    requirements: mergeRequiredTrailerType(
      item.requirements,
      item.requiredTrailerType,
    ),
    contacts: {
      ...(item.contacts ?? {}),
      pickupContactName: item.pickupContact,
      pickupPhone: item.pickupPhone,
      pickupEmail: item.pickupEmail,
      deliveryContactName: item.deliveryContact,
      deliveryPhone: item.deliveryPhone,
      deliveryEmail: item.deliveryEmail,
    },
    billingInfo: item.billingInfo,
    sourceEmailId: item.sourceEmailId,
    sourceEmailFrom: item.sourceEmailFrom,
    sourceEmailSubject: item.sourceEmailSubject,
    sourceEmail: buildSourceEmail(item),
    importMetadata: {
      parserId: item.parserId,
      parserChain: item.parserChain,
      editedFields: item.editedFields,
    },
    notes: item.notes,
  } as CreateMissionFormData
}

function hasValidCoordinatePair(lat: unknown, lng: unknown) {
  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return false
  }
  return !(lat === 0 && lng === 0)
}

export function ImportedMissionsPanel({
  isOpen,
  onClose,
  onCreateMission,
  canManageImports = true,
  syncVersion = 0,
  onOpenMission,
}: ImportedMissionsPanelProps) {
  const [rawImports, setRawImports] = useState<MissionImportPreview[]>([])
  const [connected, setConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [activeState, setActiveState] = useState<ImportState>('NEW')
  const [showIgnored, setShowIgnored] = useState(false)
  const [search, setSearch] = useState('')
  const [clientFilter, setClientFilter] = useState<string>('')

  const [drafts, setDrafts] = useState<Record<string, LocalImportDraft>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [sourceEmail, setSourceEmail] =
    useState<MissionSourceEmailResponse | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch('/api/dispatch/mail-imports')
      if (!response.ok) {
        throw new Error(`Mail imports API returned ${response.status}`)
      }

      const data = (await response.json()) as MailImportsResponse
      setRawImports(data.imports)
      setConnected(data.connected)
      setError(data.error ?? null)
    } catch (loadError) {
      console.error('Unable to load IMAP imports', loadError)
      setRawImports([])
      setConnected(false)
      setError('Connexion mail impossible')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    void load()
  }, [isOpen, load, syncVersion])

  // Une affectation faite dans le Planning se reflète au retour sur l'onglet.
  useEffect(() => {
    if (!isOpen) return
    const handleFocus = () => void load()
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [isOpen, load])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !editingId) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, editingId, onClose])

  const items = useMemo(
    () => applyLocalEdits(rawImports, drafts),
    [rawImports, drafts],
  )
  const counts = useMemo(() => countByState(items), [items])
  const clients = useMemo(() => listClients(items), [items])

  const filtered = useMemo(
    () =>
      filterImports(items, {
        search,
        client: clientFilter || null,
      }),
    [items, search, clientFilter],
  )

  const ignoredItems = useMemo(
    () => sortByReceivedDesc(filtered.filter((item) => item.ignored)),
    [filtered],
  )
  const visibleItems = useMemo(
    () => sortByReceivedDesc(selectByState(filtered, activeState)),
    [filtered, activeState],
  )

  const editingItem = useMemo(() => {
    if (!editingId) return null
    const item = items.find((candidate) => candidate.id === editingId)
    if (!item) return null
    return createEditableMissionImport(item)
  }, [editingId, items])

  if (!isOpen) return null

  function saveDraft(next: EditableMissionImport) {
    setDrafts((current) => ({
      ...current,
      [next.id]: {
        fields: { ...next, ...next.editedFields } as Partial<MissionImportPreview>,
        isEdited: true,
      },
    }))
  }

  async function createMission(item: EditableMissionImport) {
    try {
      setBusyId(item.id)
      setError(null)

      const result = await onCreateMission(toCreatePayload(item))
      if (!result) return

      // Transition immédiate vers « Créé » sans recharger toute la liste.
      setRawImports((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? {
                ...candidate,
                alreadyCreated: true,
                createdMissionId: result.mission.id,
                missionId: result.mission.id,
                missionReference: result.mission.reference,
                missionCreatedAt: new Date().toISOString(),
                assignment: null,
                importState: 'CREATED' as ImportState,
                attentionReasons: [],
              }
            : candidate,
        ),
      )
      setDrafts((current) => {
        const next = { ...current }
        delete next[item.id]
        return next
      })
      setEditingId(null)
      setNotice(`Mission ${result.mission.reference} créée.`)
    } catch (createError) {
      const message =
        createError instanceof Error
          ? createError.message
          : 'Impossible de créer la mission importée.'
      setError(message)
    } finally {
      setBusyId(null)
    }
  }

  async function ignoreImport(item: MissionImportPreview) {
    setRawImports((current) =>
      current.map((candidate) =>
        candidate.id === item.id ? { ...candidate, ignored: true } : candidate,
      ),
    )

    try {
      await fetch('/api/dispatch/imports/ignore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          previewKey: item.id,
          source: item.source,
          sourceEmailId: item.sourceEmailId,
          messageId: item.messageId,
          subject: item.sourceEmailSubject,
          fromAddress: item.sourceEmailFrom,
          clientReference: item.clientReference ?? null,
          provider: item.provider,
        }),
      })
    } catch {
      // L'état local reste cohérent ; le prochain refresh fera foi.
    }
  }

  async function restoreImport(item: MissionImportPreview) {
    setRawImports((current) =>
      current.map((candidate) =>
        candidate.id === item.id ? { ...candidate, ignored: false } : candidate,
      ),
    )

    try {
      await fetch(
        `/api/dispatch/imports/ignore?previewKey=${encodeURIComponent(item.id)}`,
        { method: 'DELETE' },
      )
    } catch {
      // idem
    }
  }

  const listToRender = showIgnored ? ignoredItems : visibleItems
  const isMutedView = activeState === 'CREATED' || activeState === 'ASSIGNED'
  const groups =
    !showIgnored && activeState === 'NEW' && listToRender.length > 6
      ? groupByClient(listToRender)
      : null

  function renderCard(item: MissionImportPreview) {
    return (
      <ImportCard
        key={item.id}
        item={item}
        isBusy={busyId === item.id}
        isEdited={Boolean(drafts[item.id]?.isEdited)}
        canManage={canManageImports}
        muted={!showIgnored && isMutedView}
        onEdit={() => setEditingId(item.id)}
        onCreate={() =>
          void createMission(createEditableMissionImport(item))
        }
        onIgnore={() => void ignoreImport(item)}
        onRestore={() => void restoreImport(item)}
        onViewEmail={() => setSourceEmail(buildSourceEmail(item))}
        onOpenMission={onOpenMission}
        onOpenInPlanning={onOpenMission}
      />
    )
  }

  return (
    <>
      <aside
        role="dialog"
        aria-label="Imports e-mail"
        className={[
          'fixed inset-x-0 bottom-0 z-50 flex h-[92dvh] w-full flex-col overflow-hidden',
          'rounded-t-[28px] border border-black/10 bg-white shadow-[0_24px_80px_rgba(17,18,15,0.18)]',
          'sm:inset-x-auto sm:right-4 sm:top-4 sm:h-[calc(100vh-32px)] sm:w-[860px] sm:max-w-[96vw] sm:rounded-[32px]',
        ].join(' ')}
      >
        {/* En-tête */}
        <header className="shrink-0 border-b border-black/[0.07] px-5 pb-3 pt-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-[#8b9186]">
                Imports
              </p>
              <h2 className="mt-0.5 text-xl font-semibold tracking-tight text-[#11130f]">
                Boîte de traitement
              </h2>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={[
                  'hidden rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] sm:inline-block',
                  connected
                    ? 'border-lime-300 bg-lime-100 text-[#49630b]'
                    : 'border-amber-200 bg-amber-50 text-amber-800',
                ].join(' ')}
              >
                {connected ? 'Demandes fictives' : 'Non connectée'}
              </span>
              <button
                type="button"
                onClick={() => void load()}
                aria-label="Rafraîchir les imports"
                title="Rafraîchir"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.045] text-[#62685e] transition hover:bg-lime-100 hover:text-[#283700]"
                style={{ border: 0 }}
              >
                <RefreshIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-[11px] font-semibold text-[#565c51] transition hover:border-lime-300 hover:text-[#405c08]"
              >
                Fermer
              </button>
            </div>
          </div>

          {/* Navigation du pipeline */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="-mx-1 flex max-w-full items-center gap-1 overflow-x-auto rounded-[18px] bg-black/[0.035] p-1 [scrollbar-width:none]">
              {importStateOrder.map((state) => {
                const isActive = !showIgnored && activeState === state
                return (
                  <button
                    key={state}
                    type="button"
                    onClick={() => {
                      setShowIgnored(false)
                      setActiveState(state)
                    }}
                    className={[
                      'flex h-8 shrink-0 items-center gap-1.5 rounded-[14px] px-3 text-[11px] font-semibold transition',
                      isActive
                        ? 'bg-[#11130f] text-white shadow-[0_8px_20px_rgba(17,18,15,0.14)]'
                        : 'text-[#5f665b] hover:bg-white/80 hover:text-[#11130f]',
                    ].join(' ')}
                    style={{ border: 0 }}
                  >
                    <span>{importStateLabels[state]}</span>
                    <span
                      className={[
                        'rounded-full px-1.5 text-[9px] font-bold leading-[1.5]',
                        isActive
                          ? 'bg-[#B9FF4A] text-[#11130F]'
                          : 'bg-white text-[#5f665b]',
                      ].join(' ')}
                    >
                      {counts[state]}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
              <div className="relative min-w-0 flex-1 sm:w-[190px] sm:flex-none">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9aa090]">
                  <SearchIcon className="h-3.5 w-3.5" />
                </span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Rechercher"
                  aria-label="Rechercher un import"
                  className="h-8 w-full rounded-full border border-black/10 bg-white pl-7 pr-2 text-[11px] font-semibold text-[#252821] outline-none transition focus:border-lime-300 focus:ring-4 focus:ring-lime-100"
                />
              </div>
              <select
                value={clientFilter}
                onChange={(event) => setClientFilter(event.target.value)}
                aria-label="Filtrer par client"
                className="h-8 max-w-[140px] rounded-full border border-black/10 bg-white px-2 text-[11px] font-semibold text-[#252821] outline-none transition focus:border-lime-300"
              >
                <option value="">Tous clients</option>
                {clients.map((client) => (
                  <option key={client} value={client}>
                    {client}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowIgnored((value) => !value)}
                className={[
                  'h-8 shrink-0 rounded-full px-3 text-[11px] font-semibold transition',
                  showIgnored
                    ? 'bg-[#11130f] text-white'
                    : 'border border-black/10 bg-white text-[#565c51] hover:border-black/20',
                ].join(' ')}
                style={showIgnored ? { border: 0 } : undefined}
              >
                Ignorés
              </button>
            </div>
          </div>
        </header>

        {/* Corps */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {error ? (
            <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">
              {error}
            </div>
          ) : null}

          {notice ? (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-lime-200 bg-lime-50 px-3 py-2 text-[11px] font-semibold text-[#49630b]">
              <span>{notice}</span>
              <button
                type="button"
                onClick={() => setNotice(null)}
                aria-label="Fermer le message"
                className="flex h-6 w-6 items-center justify-center rounded-full bg-black/[0.05] text-[11px]"
                style={{ border: 0 }}
              >
                ×
              </button>
            </div>
          ) : null}

          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((index) => (
                <div
                  key={index}
                  className="h-[64px] animate-pulse rounded-lg bg-black/[0.045]"
                />
              ))}
            </div>
          ) : listToRender.length === 0 ? (
            <div className="mt-8 px-4 text-center">
              <p className="text-sm font-semibold text-[#3d4238]">
                {showIgnored
                  ? 'Aucun import ignoré'
                  : emptyStates[activeState].title}
              </p>
              <p className="mt-1 text-[11px] font-medium text-[#8a9085]">
                {showIgnored
                  ? 'Les imports mis de côté apparaîtront ici.'
                  : emptyStates[activeState].hint}
              </p>
            </div>
          ) : groups ? (
            <div className="space-y-4">
              {groups.map((group) => (
                <section key={group.client}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#8b9186]">
                      {group.client}
                    </h3>
                    <span className="rounded-full bg-[#f4f5f1] px-1.5 text-[9px] font-bold leading-[1.6] text-[#5f665b]">
                      {group.imports.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {group.imports.map((item) => renderCard(item))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {listToRender.map((item) => renderCard(item))}
            </div>
          )}
        </div>
      </aside>

      {editingItem ? (
        <ImportEditDrawer
          item={editingItem}
          isSaving={busyId === editingItem.id}
          onClose={() => setEditingId(null)}
          onSave={(next) => {
            saveDraft(next)
            setEditingId(null)
          }}
          onSaveAndCreate={(next) => {
            saveDraft(next)
            void createMission(next)
          }}
          onViewEmail={() => setSourceEmail(buildSourceEmail(editingItem))}
        />
      ) : null}

      <SourceEmailModal
        isOpen={Boolean(sourceEmail)}
        sourceEmail={sourceEmail}
        onClose={() => setSourceEmail(null)}
      />
    </>
  )
}
