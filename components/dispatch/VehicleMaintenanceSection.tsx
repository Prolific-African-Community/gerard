'use client'

import { useEffect, useMemo, useState } from 'react'

import type {
  MaintenanceInterventionType,
  MaintenanceRequestStatus,
  MaintenanceUrgency,
  MaintenanceVehicleType,
} from '../../lib/dispatch/maintenance-display'
import {
  getMaintenanceIndicatorClass,
  getMaintenanceStatusBadgeClass,
  getMaintenanceUrgencyBadgeClass,
  getVehicleDisplayStatus,
  isActiveMaintenanceStatus,
  maintenanceInterventionLabels,
  maintenanceStatusLabels,
  maintenanceUrgencyLabels,
} from '../../lib/dispatch/maintenance-display'
import { normalizeSlExternalInvoiceReference } from '../../lib/dispatch/sl-invoice-reference'

type MaintenanceRequestItem = {
  id: string
  vehicleType: MaintenanceVehicleType
  plateNumber: string
  interventionType: MaintenanceInterventionType
  urgency: MaintenanceUrgency
  status: MaintenanceRequestStatus
  mileage: number | null
  immobilizationRequired: boolean
  preferredDate: string | null
  issueDescription: string
  internalNotes: string | null
  quoteAmount: number | null
  quotePdfUrl: string | null
  invoiceAmount: number | null
  invoicePdfUrl: string | null
  externalRequestId: string | null
  providerRequestId: string | null
  slInvoiceReference: string | null
  createdAt: string
  statusHistory: Array<{
    id: string
    oldStatus: MaintenanceRequestStatus | null
    newStatus: MaintenanceRequestStatus
    comment: string | null
    createdAt: string
  }>
  interventionLines: Array<{
    id: string
    providerLineId: string | null
    code: string | null
    label: string
    description: string | null
    qty: number
    unitPrice: number
    total: number
    isCustom: boolean
  }>
}

type MaintenanceListResponse = {
  maintenanceRequests: MaintenanceRequestItem[]
}

type VehicleMaintenanceSectionProps = {
  vehicleId: string
  vehicleType: MaintenanceVehicleType
  plateNumber: string
  onMaintenanceUpdated?: () => Promise<void> | void
}

type MaintenanceFormState = {
  interventionType: MaintenanceInterventionType
  urgency: MaintenanceUrgency
  issueDescription: string
  mileage: string
  immobilizationRequired: boolean
  preferredDate: string
  internalNotes: string
}

const initialFormState: MaintenanceFormState = {
  interventionType: 'DIAGNOSTIC',
  urgency: 'NORMAL',
  issueDescription: '',
  mileage: '',
  immobilizationRequired: false,
  preferredDate: '',
  internalNotes: '',
}

const interventionOptions: MaintenanceInterventionType[] = [
  'DIAGNOSTIC',
  'TIRES',
  'BRAKES',
  'OIL_SERVICE',
  'ELECTRICAL',
  'BODYWORK',
  'TRAILER_REPAIR',
  'SAFETY_CHECK',
  'OTHER',
]

const urgencyOptions: MaintenanceUrgency[] = [
  'LOW',
  'NORMAL',
  'HIGH',
  'CRITICAL',
]

function formatDate(value: string | null | undefined) {
  if (!value) {
    return 'Non renseignée'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
  }).format(date)
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return 'Non renseignée'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('fr-LU', {
    style: 'currency',
    currency: 'EUR',
  }).format(value)
}

function getMaintenanceInvoiceReference(request: {
  id: string
  slInvoiceReference?: string | null
  providerRequestId?: string | null
  externalRequestId?: string | null
}) {
  return normalizeSlExternalInvoiceReference(
    request.slInvoiceReference,
    request.providerRequestId ?? request.externalRequestId ?? request.id
  )
}

export function VehicleMaintenanceSection({
  vehicleId,
  vehicleType,
  plateNumber,
  onMaintenanceUpdated,
}: VehicleMaintenanceSectionProps) {
  const [maintenanceRequests, setMaintenanceRequests] = useState<
    MaintenanceRequestItem[]
  >([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(
    null
  )
  const [submittingRequestId, setSubmittingRequestId] = useState<string | null>(
    null
  )
  const [decidingRequestId, setDecidingRequestId] = useState<string | null>(
    null
  )

  async function loadMaintenanceRequests() {
    const query = new URLSearchParams(
      vehicleType === 'TRUCK'
        ? { truckId: vehicleId }
        : { trailerId: vehicleId }
    )

    const response = await fetch(
      `/api/dispatch/maintenance-requests?${query.toString()}`
    )

    if (!response.ok) {
      throw new Error('Impossible de charger la maintenance.')
    }

    const data = (await response.json()) as MaintenanceListResponse
    return data.maintenanceRequests
  }

  useEffect(() => {
    let isCancelled = false

    async function hydrateMaintenanceRequests() {
      try {
        setIsLoading(true)
        setError(null)
        const data = await loadMaintenanceRequests()

        if (!isCancelled) {
          setMaintenanceRequests(data)
        }
      } catch (loadError) {
        if (!isCancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Impossible de charger la maintenance.'
          )
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    void hydrateMaintenanceRequests()

    return () => {
      isCancelled = true
    }
  }, [vehicleId, vehicleType])

  const activeRequest = useMemo(
    () =>
      maintenanceRequests.find((request) =>
        isActiveMaintenanceStatus(request.status)
      ) ?? null,
    [maintenanceRequests]
  )
  const selectedRequest = useMemo(
    () =>
      maintenanceRequests.find(
        (request) => request.id === selectedRequestId
      ) ?? null,
    [maintenanceRequests, selectedRequestId]
  )
  // The card shows ONE computed operational status derived from the active SL
  // request. Surface that same computed status here so the edit modal never
  // contradicts the card (e.g. dropdown "Disponible" vs card "Immobilisé").
  const activeDisplayStatus = useMemo(
    () =>
      activeRequest
        ? getVehicleDisplayStatus({
            baseStatusLabel: '',
            baseStatusKind: 'neutral',
            activeMaintenance: activeRequest,
          })
        : null,
    [activeRequest]
  )
  const showOperationalNote =
    activeDisplayStatus !== null &&
    activeDisplayStatus.cardVariant !== 'available' &&
    activeDisplayStatus.cardVariant !== 'neutral'

  async function handleCreateRequest(formState: MaintenanceFormState) {
    const response = await fetch('/api/dispatch/maintenance-requests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        vehicleType,
        truckId: vehicleType === 'TRUCK' ? vehicleId : null,
        trailerId: vehicleType === 'TRAILER' ? vehicleId : null,
        plateNumber,
        interventionType: formState.interventionType,
        urgency: formState.urgency,
        issueDescription: formState.issueDescription.trim(),
        mileage: formState.mileage.trim()
          ? Number.parseInt(formState.mileage.trim(), 10)
          : null,
        immobilizationRequired: formState.immobilizationRequired,
        preferredDate: formState.preferredDate || null,
        internalNotes: formState.internalNotes.trim() || null,
      }),
    })

    const payload = (await response.json().catch(() => null)) as {
      error?: string
      maintenanceRequest?: MaintenanceRequestItem
    } | null

    if (!response.ok) {
      throw new Error(
        payload?.error ?? "Impossible d'enregistrer la demande d'intervention."
      )
    }

    setSuccessMessage('Demande d’intervention créée.')
    setIsModalOpen(false)
    setMaintenanceRequests(await loadMaintenanceRequests())
    await onMaintenanceUpdated?.()
  }

  async function handleSubmitDraft(requestId: string) {
    try {
      setSubmittingRequestId(requestId)
      setError(null)
      setSuccessMessage(null)

      const response = await fetch(
        `/api/dispatch/maintenance-requests/${requestId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'send_to_sl',
          }),
        }
      )

      const payload = (await response.json().catch(() => null)) as {
        error?: string
        alreadySent?: boolean
      } | null

      if (!response.ok) {
        throw new Error(
          payload?.error ?? "Impossible d'envoyer la demande à SL Automotive."
        )
      }

      setSuccessMessage(
        payload?.alreadySent
          ? 'Demande déjà transmise à SL Automotive.'
          : 'Demande transmise à SL Automotive.'
      )
      setMaintenanceRequests(await loadMaintenanceRequests())
      await onMaintenanceUpdated?.()
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Impossible d'envoyer la demande à SL Automotive."
      )
    } finally {
      setSubmittingRequestId(null)
    }
  }

  async function handleQuoteDecision(
    requestId: string,
    decision: 'approve' | 'reject'
  ) {
    try {
      setDecidingRequestId(requestId)
      setError(null)
      setSuccessMessage(null)
      const response = await fetch(
        `/api/dispatch/maintenance-requests/${requestId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'quote_decision', decision }),
        }
      )
      const payload = (await response.json().catch(() => null)) as {
        error?: string
        idempotent?: boolean
      } | null

      if (!response.ok) {
        throw new Error(
          payload?.error ??
            "Impossible d'enregistrer la décision sur les frais."
        )
      }

      setSuccessMessage(
        decision === 'approve' ? 'Frais acceptés.' : 'Frais refusés.'
      )
      setMaintenanceRequests(await loadMaintenanceRequests())
      await onMaintenanceUpdated?.()
    } catch (decisionError) {
      setError(
        decisionError instanceof Error
          ? decisionError.message
          : "Impossible d'enregistrer la décision sur les frais."
      )
    } finally {
      setDecidingRequestId(null)
    }
  }

  return (
    <>
      <section className="mt-5 rounded-[24px] border border-black/5 bg-[#F7F8F4] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
              Maintenance
            </p>
            <p className="mt-1 text-xs font-semibold text-[#7b8075]">
              Historique des interventions et nouvelle demande atelier.
            </p>
            <p className="mt-2 text-[11px] font-medium leading-relaxed text-[#8a9085]">
              Brouillon = demande créée localement. Envoyée = demande prête pour
              SL Automotive et future synchronisation.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSuccessMessage(null)
              setIsModalOpen(true)
            }}
            className="h-11 rounded-2xl bg-[#11130f] px-4 text-sm font-semibold text-white shadow-[0_12px_32px_rgba(17,18,15,0.15)] transition hover:bg-[#B9FF4A] hover:text-[#11130F]"
          >
            Demander intervention
          </button>
        </div>

        {successMessage ? (
          <p className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-700">
            {successMessage}
          </p>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
            {error}
          </p>
        ) : null}

        {showOperationalNote && activeDisplayStatus ? (
          <p
            className={[
              'mt-4 rounded-2xl border px-4 py-3 text-xs font-semibold',
              activeDisplayStatus.tone === 'red'
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-amber-200 bg-amber-50 text-amber-800',
            ].join(' ')}
          >
            Statut opérationnel affiché : {activeDisplayStatus.label} — lié à
            l’intervention SL Automotive.
          </p>
        ) : null}

        <div className="mt-4 space-y-3">
          {isLoading ? (
            <div className="rounded-[22px] border border-black/5 bg-white px-4 py-4 text-sm font-semibold text-[#7b8075]">
              Chargement de l’historique maintenance...
            </div>
          ) : maintenanceRequests.length > 0 ? (
            maintenanceRequests.map((request) => (
              <button
                type="button"
                key={request.id}
                onClick={() => setSelectedRequestId(request.id)}
                className={[
                  'w-full rounded-[20px] border bg-white px-4 py-3 text-left shadow-[0_8px_24px_rgba(17,18,15,0.04)] transition hover:-translate-y-0.5 hover:border-[#b5d86c] hover:shadow-[0_12px_32px_rgba(17,18,15,0.08)]',
                  activeRequest?.id === request.id
                    ? 'border-lime-300 ring-1 ring-lime-200'
                    : 'border-black/5',
                ].join(' ')}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={[
                          'mt-0.5 h-2 w-2 shrink-0 rounded-full',
                          getMaintenanceIndicatorClass(
                            request.status,
                            request.immobilizationRequired
                          ),
                        ].join(' ')}
                        aria-hidden="true"
                      />
                      {activeRequest?.id === request.id ? (
                        <span className="rounded-full border border-lime-300 bg-lime-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#49630b]">
                          Active
                        </span>
                      ) : null}
                      <span
                        className={[
                          'rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em]',
                          getMaintenanceStatusBadgeClass(request.status),
                        ].join(' ')}
                      >
                        {maintenanceStatusLabels[request.status]}
                      </span>
                      <span
                        className={[
                          'rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em]',
                          getMaintenanceUrgencyBadgeClass(request.urgency),
                        ].join(' ')}
                      >
                        {maintenanceUrgencyLabels[request.urgency]}
                      </span>
                      {request.immobilizationRequired ? (
                        <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-red-700">
                          Immobilisé
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 truncate text-sm font-bold text-[#171814]">
                      {maintenanceInterventionLabels[request.interventionType]}
                    </p>
                    <p className="mt-0.5 line-clamp-1 text-xs font-medium text-[#6f756a]">
                      {request.issueDescription}
                    </p>
                  </div>
                  <span className="pt-1 text-lg text-[#a0a699]">›</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 rounded-2xl border border-black/5 bg-[#F7F8F4] px-3 py-2 text-[10px] font-bold text-[#858b80] sm:grid-cols-4">
                  <span className="truncate">
                    {formatDate(request.preferredDate)}
                  </span>
                  <span className="truncate">
                    {maintenanceInterventionLabels[request.interventionType]}
                  </span>
                  {request.quoteAmount !== null ||
                  request.invoiceAmount !== null ? (
                    <span className="truncate text-[#45630c]">
                      {formatMoney(
                        request.quoteAmount ?? request.invoiceAmount ?? 0
                      )}
                    </span>
                  ) : (
                    <span className="truncate">Frais à venir</span>
                  )}
                  {request.quotePdfUrl || request.invoicePdfUrl ? (
                    <span className="truncate text-[#45630c]">
                      PDF · {getMaintenanceInvoiceReference(request)}
                    </span>
                  ) : (
                    <span className="truncate">Sans PDF</span>
                  )}
                </div>
              </button>
            ))
          ) : (
            <div className="rounded-[22px] border border-black/5 bg-white px-4 py-4 text-sm font-semibold text-[#7b8075]">
              Aucune demande d’intervention enregistrée pour ce véhicule.
            </div>
          )}
        </div>
      </section>

      <MaintenanceDetailDrawer
        request={selectedRequest}
        onClose={() => setSelectedRequestId(null)}
        onSubmitDraft={handleSubmitDraft}
        onQuoteDecision={handleQuoteDecision}
        submittingRequestId={submittingRequestId}
        decidingRequestId={decidingRequestId}
        error={error}
        successMessage={successMessage}
      />

      <MaintenanceRequestModal
        isOpen={isModalOpen}
        plateNumber={plateNumber}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreateRequest}
      />
    </>
  )
}

function MaintenanceDetailDrawer({
  request,
  onClose,
  onSubmitDraft,
  onQuoteDecision,
  submittingRequestId,
  decidingRequestId,
  error,
  successMessage,
}: {
  request: MaintenanceRequestItem | null
  onClose: () => void
  onSubmitDraft: (requestId: string) => Promise<void>
  onQuoteDecision: (
    requestId: string,
    decision: 'approve' | 'reject'
  ) => Promise<void>
  submittingRequestId: string | null
  decidingRequestId: string | null
  error: string | null
  successMessage: string | null
}) {
  useEffect(() => {
    if (!request) {
      return
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose, request])

  if (!request) {
    return null
  }

  const feesAmount = request.quoteAmount ?? request.invoiceAmount
  const feesPdfUrl = request.quotePdfUrl ?? request.invoicePdfUrl
  const feesReference = feesPdfUrl
    ? getMaintenanceInvoiceReference(request)
    : null
  const linesTotal = request.interventionLines.reduce(
    (sum, line) => sum + line.total,
    0
  )

  return (
    <div className="fixed inset-0 z-[90]">
      <button
        type="button"
        aria-label="Fermer le détail maintenance"
        onClick={onClose}
        className="absolute inset-0 bg-[#11130f]/30 backdrop-blur-[2px]"
      />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-[680px] flex-col border-l border-black/10 bg-[#fbfcf8] shadow-[-24px_0_80px_rgba(17,18,15,0.18)]">
        <header className="flex items-start justify-between gap-5 border-b border-black/5 bg-white px-5 py-5 sm:px-7">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#7b8075]">
              Détail maintenance
            </p>
            <h3 className="mt-1 text-2xl font-black text-[#171814]">
              {request.plateNumber}
            </h3>
            <p className="mt-1 text-xs font-semibold text-[#777d72]">
              {maintenanceInterventionLabels[request.interventionType]}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-black/10 bg-[#f5f6f1] px-3 py-2 text-xs font-bold text-[#30332d] transition hover:bg-[#e9ebE3]"
          >
            Fermer
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
          {successMessage ? (
            <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-700">
              {successMessage}
            </p>
          ) : null}
          {error ? (
            <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
              {error}
            </p>
          ) : null}

          <section className="rounded-[24px] border border-black/5 bg-white p-5 shadow-[0_10px_32px_rgba(17,18,15,0.04)]">
            <div className="flex flex-wrap gap-2">
              <span
                className={[
                  'rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]',
                  getMaintenanceStatusBadgeClass(request.status),
                ].join(' ')}
              >
                {maintenanceStatusLabels[request.status]}
              </span>
              <span
                className={[
                  'rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]',
                  getMaintenanceUrgencyBadgeClass(request.urgency),
                ].join(' ')}
              >
                {maintenanceUrgencyLabels[request.urgency]}
              </span>
              {request.immobilizationRequired ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-800">
                  Immobilisation
                </span>
              ) : null}
            </div>

            <h4 className="mt-5 text-xs font-black uppercase tracking-[0.14em] text-[#353832]">
              Signalement
            </h4>
            <p className="mt-2 whitespace-pre-wrap text-sm font-medium leading-6 text-[#555b50]">
              {request.issueDescription}
            </p>

            <dl className="mt-5 grid gap-4 border-t border-black/5 pt-5 text-xs sm:grid-cols-2">
              <div>
                <dt className="font-bold uppercase tracking-[0.1em] text-[#969c91]">
                  Notes internes
                </dt>
                <dd className="mt-1 font-semibold text-[#50554c]">
                  {request.internalNotes || 'Aucune note.'}
                </dd>
              </div>
              <div>
                <dt className="font-bold uppercase tracking-[0.1em] text-[#969c91]">
                  Date souhaitée
                </dt>
                <dd className="mt-1 font-semibold text-[#50554c]">
                  {formatDate(request.preferredDate)}
                </dd>
              </div>
              <div>
                <dt className="font-bold uppercase tracking-[0.1em] text-[#969c91]">
                  Créée le
                </dt>
                <dd className="mt-1 font-semibold text-[#50554c]">
                  {formatDateTime(request.createdAt)}
                </dd>
              </div>
              <div>
                <dt className="font-bold uppercase tracking-[0.1em] text-[#969c91]">
                  Véhicule
                </dt>
                <dd className="mt-1 font-semibold text-[#50554c]">
                  {request.vehicleType === 'TRUCK' ? 'Camion' : 'Remorque'} ·{' '}
                  {request.plateNumber}
                </dd>
              </div>
              <div>
                <dt className="font-bold uppercase tracking-[0.1em] text-[#969c91]">
                  ID Gerard
                </dt>
                <dd className="mt-1 break-all font-mono text-[11px] text-[#60665c]">
                  {request.id}
                </dd>
              </div>
              <div>
                <dt className="font-bold uppercase tracking-[0.1em] text-[#969c91]">
                  ID SL Automotive
                </dt>
                <dd className="mt-1 break-all font-mono text-[11px] text-[#60665c]">
                  {request.providerRequestId || 'Non synchronisée'}
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-[24px] border border-black/5 bg-white p-5 shadow-[0_10px_32px_rgba(17,18,15,0.04)]">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#8a9085]">
                  Détail atelier
                </p>
                <h4 className="mt-1 text-lg font-black text-[#171814]">
                  Lignes d’intervention
                </h4>
              </div>
              {request.interventionLines.length > 0 ? (
                <span className="text-sm font-black text-[#45630c]">
                  {formatMoney(linesTotal)}
                </span>
              ) : null}
            </div>

            {request.interventionLines.length > 0 ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-black/5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#969c91]">
                      <th className="pb-2 pr-3">Code / intervention</th>
                      <th className="pb-2 pr-3 text-right">Qté</th>
                      <th className="pb-2 pr-3 text-right">Prix unit.</th>
                      <th className="pb-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {request.interventionLines.map((line) => (
                      <tr key={line.id} className="border-b border-black/[0.04] align-top">
                        <td className="py-3 pr-3">
                          <p className="font-bold text-[#30342d]">
                            {line.code ? `${line.code} · ` : ''}
                            {line.label}
                          </p>
                          {line.description ? (
                            <p className="mt-1 max-w-[300px] text-[11px] leading-4 text-[#858b80]">
                              {line.description}
                            </p>
                          ) : null}
                          {line.isCustom ? (
                            <span className="mt-1 inline-block rounded-full bg-[#f1f2ed] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-[#777d72]">
                              Ligne personnalisée
                            </span>
                          ) : null}
                        </td>
                        <td className="py-3 pr-3 text-right font-semibold text-[#60665c]">
                          {line.qty}
                        </td>
                        <td className="py-3 pr-3 text-right font-semibold text-[#60665c]">
                          {formatMoney(line.unitPrice)}
                        </td>
                        <td className="py-3 text-right font-black text-[#30342d]">
                          {formatMoney(line.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3} className="pt-3 text-right font-bold text-[#777d72]">
                        Total
                      </td>
                      <td className="pt-3 text-right text-sm font-black text-[#45630c]">
                        {formatMoney(linesTotal)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="mt-4 rounded-2xl bg-[#f6f7f2] px-4 py-4 text-xs font-semibold text-[#7b8075]">
                Aucune ligne d’intervention reçue de SL Automotive.
              </p>
            )}
          </section>

          <section className="rounded-[24px] border border-lime-200 bg-lime-50/60 p-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#688928]">
              Frais
            </p>
            <p className="mt-2 text-2xl font-black text-[#314d04]">
              {feesAmount === null ? 'Non renseignés' : formatMoney(feesAmount)}
            </p>
            {feesPdfUrl ? (
              <a
                href={feesPdfUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex rounded-2xl bg-[#11130f] px-4 py-2.5 text-xs font-bold text-white transition hover:bg-[#B9FF4A] hover:text-[#11130F]"
              >
                Ouvrir PDF{feesReference ? ` · ${feesReference}` : ''}
              </a>
            ) : (
              <p className="mt-2 text-xs font-semibold text-[#72834f]">
                Aucun PDF reçu.
              </p>
            )}
          </section>

          <section className="rounded-[24px] border border-black/5 bg-white p-5 shadow-[0_10px_32px_rgba(17,18,15,0.04)]">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#8a9085]">
              Suivi
            </p>
            <h4 className="mt-1 text-lg font-black text-[#171814]">
              Historique complet
            </h4>
            <div className="mt-4 space-y-3">
              {request.statusHistory.length > 0 ? (
                request.statusHistory.map((entry) => (
                  <div key={entry.id} className="flex gap-3">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#B9FF4A] ring-4 ring-lime-100" />
                    <div className="min-w-0 flex-1 border-b border-black/[0.04] pb-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-black text-[#343832]">
                          {maintenanceStatusLabels[entry.newStatus]}
                        </p>
                        <p className="text-[10px] font-semibold text-[#92988d]">
                          {formatDateTime(entry.createdAt)}
                        </p>
                      </div>
                      {entry.comment ? (
                        <p className="mt-1 text-xs leading-5 text-[#70766b]">
                          {entry.comment}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs font-semibold text-[#7b8075]">
                  Aucun historique disponible.
                </p>
              )}
            </div>
          </section>
        </div>

        {request.status === 'DRAFT' || request.status === 'QUOTE_RECEIVED' ? (
          <footer className="border-t border-black/5 bg-white px-5 py-4 sm:px-7">
            <div className="flex flex-wrap justify-end gap-2">
              {request.status === 'DRAFT' ? (
                <button
                  type="button"
                  onClick={() => void onSubmitDraft(request.id)}
                  disabled={submittingRequestId === request.id}
                  className="rounded-2xl bg-[#11130f] px-4 py-2.5 text-xs font-bold text-white transition hover:bg-[#B9FF4A] hover:text-[#11130F] disabled:opacity-60"
                >
                  {submittingRequestId === request.id
                    ? 'Envoi en cours...'
                    : 'Envoyer à SL Automotive'}
                </button>
              ) : null}
              {request.status === 'QUOTE_RECEIVED' ? (
                <>
                  <button
                    type="button"
                    onClick={() => void onQuoteDecision(request.id, 'reject')}
                    disabled={decidingRequestId === request.id}
                    className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-bold text-red-700 transition hover:bg-red-100 disabled:opacity-60"
                  >
                    Refuser les frais
                  </button>
                  <button
                    type="button"
                    onClick={() => void onQuoteDecision(request.id, 'approve')}
                    disabled={decidingRequestId === request.id}
                    className="rounded-2xl bg-[#11130f] px-4 py-2.5 text-xs font-bold text-white transition hover:bg-[#B9FF4A] hover:text-[#11130F] disabled:opacity-60"
                  >
                    Accepter les frais
                  </button>
                </>
              ) : null}
            </div>
          </footer>
        ) : null}
      </aside>
    </div>
  )
}

function MaintenanceRequestModal({
  isOpen,
  plateNumber,
  onClose,
  onSubmit,
}: {
  isOpen: boolean
  plateNumber: string
  onClose: () => void
  onSubmit: (formState: MaintenanceFormState) => Promise<void>
}) {
  const [formState, setFormState] =
    useState<MaintenanceFormState>(initialFormState)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setFormState(initialFormState)
      setError(null)
      setIsSubmitting(false)
    }
  }, [isOpen])

  if (!isOpen) {
    return null
  }

  function updateField<Field extends keyof MaintenanceFormState>(
    field: Field,
    value: MaintenanceFormState[Field]
  ) {
    setFormState((currentFormState) => ({
      ...currentFormState,
      [field]: value,
    }))
  }

  async function handleSubmit() {
    if (!formState.issueDescription.trim()) {
      setError('La description du problème est obligatoire.')
      return
    }

    if (
      formState.mileage.trim() &&
      !Number.isInteger(Number.parseInt(formState.mileage.trim(), 10))
    ) {
      setError('Le kilométrage doit être un nombre entier.')
      return
    }

    try {
      setIsSubmitting(true)
      setError(null)
      await onSubmit(formState)
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Impossible d'enregistrer la demande d'intervention."
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center px-5 pb-32 sm:items-center sm:pb-0">
      <button
        type="button"
        aria-label="Fermer"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/25"
      />
      <div className="relative z-10 max-h-[88vh] w-full max-w-[560px] overflow-y-auto rounded-[32px] border border-black/10 bg-white p-6 shadow-[0_24px_80px_rgba(17,18,15,0.22)]">
        <div className="flex items-start justify-between gap-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#73796d]">
              Maintenance
            </p>
            <h3 className="mt-1 text-2xl font-semibold tracking-tight text-[#11130f]">
              Demander intervention
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-[#565c51] transition hover:border-lime-300 hover:text-[#405c08]"
          >
            Fermer
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ReadOnlyField label="Véhicule" value={plateNumber} />
          <label>
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
              Type d’intervention
            </span>
            <select
              value={formState.interventionType}
              onChange={(event) =>
                updateField(
                  'interventionType',
                  event.target.value as MaintenanceInterventionType
                )
              }
              className="focus:ring-lime-200/35 mt-2 h-12 w-full rounded-2xl border border-black/10 bg-black/[0.025] px-4 text-sm font-semibold text-[#171814] outline-none transition focus:border-lime-300 focus:bg-white focus:ring-4"
            >
              {interventionOptions.map((option) => (
                <option key={option} value={option}>
                  {maintenanceInterventionLabels[option]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
              Urgence
            </span>
            <select
              value={formState.urgency}
              onChange={(event) =>
                updateField('urgency', event.target.value as MaintenanceUrgency)
              }
              className="focus:ring-lime-200/35 mt-2 h-12 w-full rounded-2xl border border-black/10 bg-black/[0.025] px-4 text-sm font-semibold text-[#171814] outline-none transition focus:border-lime-300 focus:bg-white focus:ring-4"
            >
              {urgencyOptions.map((option) => (
                <option key={option} value={option}>
                  {maintenanceUrgencyLabels[option]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
              Kilométrage
            </span>
            <input
              type="number"
              value={formState.mileage}
              onChange={(event) => updateField('mileage', event.target.value)}
              placeholder="Optionnel"
              className="focus:ring-lime-200/35 mt-2 h-12 w-full rounded-2xl border border-black/10 bg-black/[0.025] px-4 text-sm font-semibold text-[#171814] outline-none transition placeholder:text-[#9aa090] focus:border-lime-300 focus:bg-white focus:ring-4"
            />
          </label>
          <label>
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
              Date souhaitée
            </span>
            <input
              type="date"
              value={formState.preferredDate}
              onChange={(event) =>
                updateField('preferredDate', event.target.value)
              }
              className="focus:ring-lime-200/35 mt-2 h-12 w-full rounded-2xl border border-black/10 bg-black/[0.025] px-4 text-sm font-semibold text-[#171814] outline-none transition focus:border-lime-300 focus:bg-white focus:ring-4"
            />
          </label>
          <label className="sm:col-span-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
              Description du problème
            </span>
            <textarea
              value={formState.issueDescription}
              onChange={(event) =>
                updateField('issueDescription', event.target.value)
              }
              placeholder="Symptômes, constat chauffeur, contexte..."
              className="focus:ring-lime-200/35 mt-2 min-h-[108px] w-full resize-none rounded-2xl border border-black/10 bg-black/[0.025] px-4 py-3 text-sm font-semibold text-[#171814] outline-none transition placeholder:text-[#9aa090] focus:border-lime-300 focus:bg-white focus:ring-4"
            />
          </label>
          <label className="sm:col-span-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
              Notes internes
            </span>
            <textarea
              value={formState.internalNotes}
              onChange={(event) =>
                updateField('internalNotes', event.target.value)
              }
              placeholder="Optionnel"
              className="focus:ring-lime-200/35 mt-2 min-h-[84px] w-full resize-none rounded-2xl border border-black/10 bg-black/[0.025] px-4 py-3 text-sm font-semibold text-[#171814] outline-none transition placeholder:text-[#9aa090] focus:border-lime-300 focus:bg-white focus:ring-4"
            />
          </label>
        </div>

        <label className="mt-4 flex items-center gap-3 rounded-[22px] border border-black/5 bg-[#F7F8F4] px-4 py-3">
          <input
            type="checkbox"
            checked={formState.immobilizationRequired}
            onChange={(event) =>
              updateField('immobilizationRequired', event.target.checked)
            }
            className="h-4 w-4 rounded border-black/20 text-[#11130f] focus:ring-lime-300"
          />
          <span className="text-sm font-semibold text-[#171814]">
            Immobilisation requise
          </span>
        </label>

        {error ? (
          <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onClose}
            className="h-12 rounded-2xl border border-black/10 bg-white px-4 text-sm font-semibold text-[#565c51] transition hover:border-lime-300 hover:text-[#405c08] sm:w-[180px]"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting}
            className="h-12 flex-1 rounded-2xl bg-[#11130f] px-4 text-sm font-semibold text-white shadow-[0_12px_32px_rgba(17,18,15,0.15)] transition hover:bg-[#B9FF4A] hover:text-[#11130F] disabled:cursor-not-allowed disabled:bg-black/20 disabled:text-white"
          >
            {isSubmitting ? 'Enregistrement...' : 'Créer la demande'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <label>
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
        {label}
      </span>
      <div className="mt-2 flex h-12 items-center rounded-2xl border border-black/10 bg-[#F4F5F1] px-4 text-sm font-semibold text-[#171814]">
        {value}
      </div>
    </label>
  )
}
