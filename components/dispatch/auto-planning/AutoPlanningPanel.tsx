'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import type {
  DispatchOptimizationResult,
  OptimizationStrategy,
  PairProposal,
} from '../../../lib/dispatch/optimization'
import type {
  ApplyResult,
  ProposalAdjustment,
  ProposalAdjustmentOption,
  SimulationResponse,
} from '../../../lib/dispatch/auto-planning/types'
import {
  reasonActionLabels,
  translateReasonCode,
} from '../../../lib/dispatch/reason-labels'
import { resolvePairChecklistAction } from '../../../lib/dispatch/auto-planning/checklist-actions'
import type { MissionPrerequisiteItem } from '../../../lib/dispatch/mission-prerequisites'

const strategyLabels: Record<OptimizationStrategy, string> = {
  MAX_PROFITABILITY: 'Rentabilité maximale',
  BALANCED: 'Équilibrée',
  MAX_COVERAGE: 'Couverture maximale',
}

const strategyDescriptions: Record<OptimizationStrategy, string> = {
  MAX_PROFITABILITY:
    'Favorise la valeur économique et limite les kilomètres à vide.',
  BALANCED: 'Équilibre couverture, charge, priorité et robustesse des données.',
  MAX_COVERAGE: 'Cherche à couvrir davantage de missions réalisables.',
}

const progressSteps = [
  'Préparation des missions',
  'Calcul des approches',
  'Analyse des ressources',
  'Construction du planning',
]

export type AutoPlanningPreview = {
  simulation: SimulationResponse
  strategy: OptimizationStrategy
  result: DispatchOptimizationResult
}

type ReadinessResponse = {
  missionScope: SimulationResponse['snapshotSummary']['missionScope']
  base: {
    configured: boolean
    latitude: number | null
    longitude: number | null
    source: string
  }
  missions: Array<{
    missionId: string
    reference: string
    preparationStatus: string
    missingData: unknown[]
    prerequisites: MissionPrerequisiteItem[]
    pickupResolutionStatus: string
    deliveryResolutionStatus: string
    pickupResolutionReason: string | null
    deliveryResolutionReason: string | null
    pickupCandidates: Array<{
      placeId: string
      formattedAddress: string
    }>
    deliveryCandidates: Array<{
      placeId: string
      formattedAddress: string
    }>
  }>
  pairs: Array<{
    rowId: string
    driverId: string | null
    driverName: string | null
    truckId: string | null
    truckPlateNumber: string | null
    missingPosition: boolean
    missingRegulatoryState: boolean
    regulatoryStatus: 'CONFORME' | 'AVERTISSEMENT' | 'BLOQUANT'
    regulatoryControls: Array<{
      key: string
      label: string
      status: 'CONFORME' | 'AVERTISSEMENT' | 'BLOQUANT'
      value: string
      explanation: string
      planningEffect: string
    }>
    unavailable: boolean
  }>
  counts: {
    readyMissions: number
    pendingAddresses: number
    ambiguousAddresses: number
    missingRoutes: number
    missingPositions: number
    missingRegulatoryStates: number
    outsidePeriod: number
    unavailableResources: number
  }
}

export function AutoPlanningButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-[46px] rounded-[18px] bg-[#11130f] px-5 text-xs font-semibold text-white shadow-[0_12px_30px_rgba(17,19,15,0.16)] transition hover:-translate-y-0.5 hover:bg-[#B9FF4A] hover:text-[#11130f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B9FF4A]/70"
      style={{ border: 0 }}
    >
      Planification automatique
    </button>
  )
}

export function AutoPlanningPanel({
  isOpen,
  weekStart,
  onClose,
  onApplied,
  onPreviewChange,
  dataVersion = 0,
  onOpenResource,
  onOpenMission,
}: {
  isOpen: boolean
  weekStart: string
  onClose: () => void
  onApplied: (result: ApplyResult) => void
  onPreviewChange: (preview: AutoPlanningPreview | null) => void
  /** Incrémenté par le parent à chaque enregistrement d'une donnée source. */
  dataVersion?: number
  /** Ouvre la fiche exacte de la ressource (ferme le tiroir, conserve l'état). */
  onOpenResource?: (type: 'driver' | 'truck' | 'trailer', id: string) => void
  /** Ouvre la mission exacte pour corriger horaires / adresse. */
  onOpenMission?: (missionId: string) => void
}) {
  const [strategy, setStrategy] = useState<OptimizationStrategy>('BALANCED')
  const [compareStrategies, setCompareStrategies] = useState(true)
  const [includeExistingForced, setIncludeExistingForced] = useState(false)
  const [simulation, setSimulation] = useState<SimulationResponse | null>(null)
  const [selectedMissionIds, setSelectedMissionIds] = useState<Set<string>>(
    new Set()
  )
  const [confirmedConditionalMissionIds, setConfirmedConditionalMissionIds] =
    useState<Set<string>>(new Set())
  const [adjustments, setAdjustments] = useState<
    Record<string, ProposalAdjustment>
  >({})
  const [editingMissionId, setEditingMissionId] = useState<string | null>(null)
  const [draftOptionId, setDraftOptionId] = useState<string | null>(null)
  const [resultFilter, setResultFilter] = useState<
    'ALL' | 'GREEN' | 'ORANGE' | 'RED'
  >('ALL')
  const [isRunning, setIsRunning] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preparationNotice, setPreparationNotice] = useState<string | null>(
    null
  )
  const [stale, setStale] = useState(false)
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null)
  const [confirmingAddressKey, setConfirmingAddressKey] = useState<
    string | null
  >(null)
  // Vrai lorsqu'une donnée source a changé depuis la dernière simulation.
  const [dataChanged, setDataChanged] = useState(false)

  const activeResult = useMemo(() => {
    if (!simulation) return null
    return (
      simulation.comparison?.results[strategy] ??
      (simulation.selectedStrategy === strategy ? simulation.result : null)
    )
  }, [simulation, strategy])

  // Une donnée source enregistrée par le parent (chauffeur, camion, remorque,
  // mission) rend obsolète toute simulation affichée : marquer le changement.
  const lastSeenDataVersion = useRef(dataVersion)
  useEffect(() => {
    if (dataVersion === lastSeenDataVersion.current) return
    lastSeenDataVersion.current = dataVersion
    setDataChanged(true)
  }, [dataVersion])

  useEffect(() => {
    if (!isOpen) return
    let active = true
    void fetch(
      `/api/dispatch/auto-planning/readiness?weekStart=${encodeURIComponent(
        weekStart
      )}`
    )
      .then(async (response) => {
        const payload = (await response.json()) as
          | ReadinessResponse
          | { error?: string }
        if (!response.ok || !('counts' in payload)) {
          throw new Error(
            'error' in payload && payload.error
              ? payload.error
              : 'Checklist indisponible.'
          )
        }
        if (active) setReadiness(payload)
      })
      .catch((readinessError) => {
        if (active) {
          setError(
            readinessError instanceof Error
              ? readinessError.message
              : 'Checklist indisponible.'
          )
        }
      })
    return () => {
      active = false
    }
  }, [isOpen, weekStart])

  if (!isOpen) return null

  async function refreshReadiness() {
    const refreshed = await fetch(
      `/api/dispatch/auto-planning/readiness?weekStart=${encodeURIComponent(
        weekStart
      )}`
    )
    if (refreshed.ok) {
      setReadiness((await refreshed.json()) as ReadinessResponse)
    }
  }

  async function confirmAddress(
    missionId: string,
    endpoint: 'pickup' | 'delivery',
    placeId: string
  ) {
    const key = `${missionId}:${endpoint}:${placeId}`
    setConfirmingAddressKey(key)
    setError(null)
    setPreparationNotice(null)
    try {
      const response = await fetch(
        '/api/dispatch/auto-planning/confirm-address',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ missionId, endpoint, placeId }),
        }
      )
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(payload?.error ?? 'Confirmation impossible.')
      }
      const refreshed = await fetch(
        `/api/dispatch/auto-planning/readiness?weekStart=${encodeURIComponent(
          weekStart
        )}`
      )
      if (refreshed.ok) {
        setReadiness((await refreshed.json()) as ReadinessResponse)
      }
    } catch (confirmationError) {
      setError(
        confirmationError instanceof Error
          ? confirmationError.message
          : 'Confirmation impossible.'
      )
    } finally {
      setConfirmingAddressKey(null)
    }
  }

  function publishPreview(
    nextSimulation: SimulationResponse,
    nextStrategy: OptimizationStrategy
  ) {
    const result =
      nextSimulation.comparison?.results[nextStrategy] ?? nextSimulation.result
    onPreviewChange({
      simulation: nextSimulation,
      strategy: nextStrategy,
      result,
    })
    setSelectedMissionIds(
      new Set(
        result.confirmedProposals.flatMap((proposal) =>
          proposal.missions.map((mission) => mission.missionId)
        )
      )
    )
    setConfirmedConditionalMissionIds(new Set())
    setAdjustments({})
    setEditingMissionId(null)
    setDraftOptionId(null)
    setResultFilter('ALL')
  }

  async function runSimulation() {
    if (
      Object.keys(adjustments).length > 0 &&
      !window.confirm(
        'Relancer la simulation abandonnera les ajustements non appliqués. Continuer ?'
      )
    ) {
      return
    }
    setIsRunning(true)
    setError(null)
    setPreparationNotice(null)
    setStale(false)
    setDataChanged(false)
    try {
      const response = await fetch(
        '/api/dispatch/auto-planning/prepare-and-simulate',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            weekStart,
            strategy,
            compareStrategies,
            includeExistingForced,
          }),
        }
      )
      const payload = (await response.json()) as
        | SimulationResponse
        | { error?: string }
      if (!response.ok || !('result' in payload)) {
        throw new Error(
          'error' in payload && payload.error
            ? payload.error
            : 'Simulation indisponible.'
        )
      }
      setSimulation(payload)
      const manualPreparationCount =
        (payload.preparation?.missionsRequiringReview ?? 0) +
        (payload.preparation?.preparationFailures ?? 0)
      if (manualPreparationCount > 0) {
        setPreparationNotice(
          `${manualPreparationCount} mission(s) nécessitent une adresse ou une donnée à confirmer avant de pouvoir être planifiées.`
        )
      }
      publishPreview(payload, strategy)
      await refreshReadiness()
    } catch (simulationError) {
      setError(
        simulationError instanceof Error
          ? simulationError.message
          : 'Simulation indisponible.'
      )
    } finally {
      setIsRunning(false)
    }
  }

  function chooseStrategy(nextStrategy: OptimizationStrategy) {
    setStrategy(nextStrategy)
    if (simulation?.comparison) publishPreview(simulation, nextStrategy)
  }

  function toggleProposal(proposal: PairProposal) {
    const ids = proposal.missions.map((mission) => mission.missionId)
    const allSelected = ids.every((id) => selectedMissionIds.has(id))
    setSelectedMissionIds((current) => {
      const next = new Set(current)
      ids.forEach((id) => {
        if (allSelected) next.delete(id)
        else next.add(id)
      })
      return next
    })
  }

  function confirmConditionalProposal(proposal: PairProposal) {
    const ids = proposal.missions.map((mission) => mission.missionId)
    const allConfirmed = ids.every((id) =>
      confirmedConditionalMissionIds.has(id)
    )
    if (
      !allConfirmed &&
      !window.confirm(
        `Confirmer explicitement ${ids.length} proposition(s) orange malgré les réserves affichées ?`
      )
    ) {
      return
    }
    setConfirmedConditionalMissionIds((current) => {
      const next = new Set(current)
      ids.forEach((id) => {
        if (allConfirmed) next.delete(id)
        else next.add(id)
      })
      return next
    })
    setSelectedMissionIds((current) => {
      const next = new Set(current)
      ids.forEach((id) => {
        if (allConfirmed) next.delete(id)
        else next.add(id)
      })
      return next
    })
  }

  function openProposalEditor(
    proposal: PairProposal,
    missionId: string,
    trailerId: string | null
  ) {
    const current = adjustments[missionId]
    setEditingMissionId(missionId)
    setDraftOptionId(
      current
        ? `${current.pairRowId}:${current.trailerId ?? 'none'}`
        : `${proposal.pair.rowId}:${trailerId ?? 'none'}`
    )
  }

  function cancelAdjustment(missionId: string) {
    setAdjustments((current) => {
      const next = { ...current }
      delete next[missionId]
      return next
    })
    setConfirmedConditionalMissionIds((current) => {
      const next = new Set(current)
      next.delete(missionId)
      return next
    })
    setEditingMissionId(null)
    setDraftOptionId(null)
  }

  function validateAdjustment(option: ProposalAdjustmentOption) {
    if (
      option.classification === 'ORANGE' &&
      !window.confirm(
        'Cette alternative est orange et comporte des réserves. La confirmer explicitement ?'
      )
    ) {
      return
    }
    setAdjustments((current) => ({
      ...current,
      [option.missionId]: {
        missionId: option.missionId,
        pairRowId: option.pairRowId,
        trailerId: option.trailerId,
      },
    }))
    setSelectedMissionIds((current) => new Set(current).add(option.missionId))
    setConfirmedConditionalMissionIds((current) => {
      const next = new Set(current)
      if (option.classification === 'ORANGE') next.add(option.missionId)
      else next.delete(option.missionId)
      return next
    })
    setEditingMissionId(null)
    setDraftOptionId(null)
  }

  async function applySelection() {
    if (!simulation || !activeResult || stale || dataChanged) return
    if (
      !window.confirm(
        `Appliquer ${selectedMissionIds.size} mission(s) confirmée(s) au planning réel ?`
      )
    ) {
      return
    }
    setIsApplying(true)
    setError(null)
    try {
      const response = await fetch('/api/dispatch/auto-planning/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshotToken: simulation.snapshotToken,
          snapshotFingerprint: simulation.snapshotFingerprint,
          simulationId: simulation.simulationId,
          strategy,
          selectedMissionIds: Array.from(selectedMissionIds),
          confirmedConditionalMissionIds: Array.from(
            confirmedConditionalMissionIds
          ),
          adjustments: Object.values(adjustments),
          idempotencyKey:
            typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `${Date.now()}-${Array.from(
                  crypto.getRandomValues(new Uint32Array(4))
                )
                  .map((value) => value.toString(16))
                  .join('')}`,
        }),
      })
      const payload = (await response.json()) as
        | ApplyResult
        | { error?: string; stale?: boolean }
      if (!response.ok || !('appliedMissionIds' in payload)) {
        if ('stale' in payload && payload.stale) setStale(true)
        throw new Error(
          'error' in payload && payload.error
            ? payload.error
            : 'Application refusée.'
        )
      }
      onPreviewChange(null)
      setSimulation(null)
      onApplied(payload)
      onClose()
    } catch (applyError) {
      setError(
        applyError instanceof Error
          ? applyError.message
          : 'Application refusée.'
      )
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex justify-end bg-black/25 backdrop-blur-[2px]">
      <button
        type="button"
        aria-label="Fermer la planification automatique"
        className="absolute inset-0 cursor-default"
        style={{ border: 0, background: 'transparent' }}
        onClick={() => {
          onPreviewChange(null)
          onClose()
        }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Planification automatique"
        className="relative z-10 flex h-full w-full max-w-[760px] flex-col overflow-hidden bg-[#f6f7f2] shadow-[-24px_0_70px_rgba(17,19,15,0.22)]"
      >
        <header className="flex items-start justify-between border-b border-black/[0.06] bg-white px-5 py-5 sm:px-7">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#798071]">
              Aide à la décision
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-[#11130f]">
              Planification automatique
            </h2>
            <p className="mt-1 text-xs text-[#70766b]">
              Meilleure proposition trouvée dans les limites de calcul.
            </p>
          </div>
          <button
            type="button"
            aria-label="Fermer"
            onClick={() => {
              onPreviewChange(null)
              onClose()
            }}
            className="flex h-10 w-10 items-center justify-center rounded-2xl bg-black/[0.05] text-xl text-[#555b50] hover:bg-black/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300"
            style={{ border: 0 }}
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          {!simulation ? (
            <div className="space-y-5">
              {readiness ? (
                <ReadinessChecklist
                  readiness={readiness}
                  confirmingAddressKey={confirmingAddressKey}
                  onConfirmAddress={(missionId, endpoint, placeId) =>
                    void confirmAddress(missionId, endpoint, placeId)
                  }
                  onEditRegulatory={(id) => {
                    onClose()
                    onOpenResource?.('driver', id)
                  }}
                  onOpenResource={onOpenResource}
                  onOpenMission={(missionId) => {
                    onClose()
                    onOpenMission?.(missionId)
                  }}
                />
              ) : null}
              <section className="rounded-[24px] bg-white p-5 shadow-[0_16px_42px_rgba(17,19,15,0.07)]">
                <p className="text-xs font-semibold text-[#11130f]">
                  Semaine du {weekStart}
                </p>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  {(Object.keys(strategyLabels) as OptimizationStrategy[]).map(
                    (item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setStrategy(item)}
                        className={[
                          'rounded-[18px] p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300',
                          strategy === item
                            ? 'bg-[#11130f] text-white'
                            : 'bg-[#f1f3ec] text-[#33372f] hover:bg-lime-100',
                        ].join(' ')}
                        style={{ border: 0 }}
                      >
                        <span className="text-xs font-semibold">
                          {strategyLabels[item]}
                        </span>
                        <span className="mt-1 block text-[10px] leading-4 opacity-70">
                          {strategyDescriptions[item]}
                        </span>
                      </button>
                    )
                  )}
                </div>
                <label className="mt-4 flex items-center gap-3 text-xs font-medium text-[#555c51]">
                  <input
                    type="checkbox"
                    checked={compareStrategies}
                    onChange={(event) =>
                      setCompareStrategies(event.target.checked)
                    }
                    className="h-4 w-4 accent-[#11130f]"
                  />
                  Comparer les trois stratégies sur le même instantané
                </label>
                <label className="mt-3 flex items-center gap-3 text-xs font-medium text-[#555c51]">
                  <input
                    type="checkbox"
                    checked={includeExistingForced}
                    onChange={(event) =>
                      setIncludeExistingForced(event.target.checked)
                    }
                    className="h-4 w-4 accent-[#11130f]"
                  />
                  Revalider les missions déjà imposées sans les déplacer
                </label>
              </section>
              {isRunning ? (
                <section className="rounded-[24px] bg-[#11130f] p-5 text-white">
                  <p className="text-sm font-semibold">Simulation en cours</p>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {progressSteps.map((step) => (
                      <div
                        key={step}
                        className="flex items-center gap-2 text-[11px] text-white/70"
                      >
                        <span className="h-2 w-2 animate-pulse rounded-full bg-[#B9FF4A]" />
                        {step}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
              <button
                type="button"
                disabled={isRunning}
                onClick={() => void runSimulation()}
                className="h-12 w-full rounded-[18px] bg-[#B9FF4A] text-sm font-semibold text-[#11130f] shadow-[0_14px_34px_rgba(120,170,40,0.24)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#11130f] disabled:cursor-not-allowed disabled:opacity-50"
                style={{ border: 0 }}
              >
                {isRunning ? 'Planification en cours…' : 'Planifier automatiquement'}
              </button>
            </div>
          ) : activeResult ? (
            <div className="space-y-4">
              {preparationNotice ? (
                <p className="rounded-2xl bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-900">
                  {preparationNotice}
                </p>
              ) : null}
              {simulation.comparison ? (
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(strategyLabels) as OptimizationStrategy[]).map(
                    (item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => chooseStrategy(item)}
                        className={[
                          'rounded-2xl px-2 py-3 text-[10px] font-semibold transition',
                          strategy === item
                            ? 'bg-[#11130f] text-white'
                            : 'bg-white text-[#555c51]',
                        ].join(' ')}
                        style={{ border: 0 }}
                      >
                        {strategyLabels[item]}
                      </button>
                    )
                  )}
                </div>
              ) : null}

              <Summary result={activeResult} strategy={strategy} />
              <section className="rounded-[22px] bg-white px-4 py-3 text-[11px] text-[#5d6459]">
                <p className="font-semibold text-[#11130f]">
                  Réconciliation des missions
                </p>
                <p className="mt-1">
                  {simulation.reconciliation.visible} visible(s) ·{' '}
                  {simulation.reconciliation.included} simulée(s) ·{' '}
                  {simulation.reconciliation.manualPreserved} manuelle(s)
                  préservée(s) · {simulation.reconciliation.excluded}{' '}
                  exclusion(s) expliquée(s)
                </p>
                {!simulation.reconciliation.poolEquationValid ||
                !simulation.reconciliation.resultEquationValid ? (
                  <p className="mt-2 font-semibold text-red-700">
                    Incohérence détectée entre le pool et le résultat.
                  </p>
                ) : null}
              </section>

              <div
                className="grid grid-cols-4 gap-2"
                aria-label="Filtrer les propositions par couleur"
              >
                {(
                  [
                    ['ALL', 'Toutes'],
                    ['GREEN', `Vertes ${simulation.reconciliation.confirmed}`],
                    [
                      'ORANGE',
                      `Orange ${simulation.reconciliation.conditional}`,
                    ],
                    ['RED', `Rouges ${simulation.reconciliation.red}`],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setResultFilter(value)}
                    aria-pressed={resultFilter === value}
                    className={[
                      'min-h-10 rounded-2xl px-2 text-[10px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300',
                      resultFilter === value
                        ? 'bg-[#11130f] text-white'
                        : 'bg-white text-[#555c51]',
                    ].join(' ')}
                    style={{ border: 0 }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {resultFilter === 'ALL' || resultFilter === 'GREEN'
                ? activeResult.confirmedProposals.map((proposal) => {
                    const selected = proposal.missions.every((mission) =>
                      selectedMissionIds.has(mission.missionId)
                    )
                    return (
                      <ProposalCard
                        key={proposal.pair.rowId}
                        proposal={proposal}
                        pairLabel={simulation.pairLabels[proposal.pair.rowId]}
                        selected={selected}
                        onToggle={() => toggleProposal(proposal)}
                        conditional={false}
                        adjustments={adjustments}
                        adjustmentOptions={simulation.adjustmentOptions}
                        onEdit={openProposalEditor}
                        onCancelAdjustment={cancelAdjustment}
                      />
                    )
                  })
                : null}

              {(resultFilter === 'ALL' || resultFilter === 'ORANGE') &&
              activeResult.conditionalProposals.length ? (
                <section>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-amber-700">
                    À confirmer
                  </h3>
                  {activeResult.conditionalProposals.map((proposal) => (
                    <ProposalCard
                      key={`conditional-${proposal.pair.rowId}`}
                      proposal={proposal}
                      pairLabel={simulation.pairLabels[proposal.pair.rowId]}
                      selected={proposal.missions.every((mission) =>
                        confirmedConditionalMissionIds.has(mission.missionId)
                      )}
                      onToggle={() => confirmConditionalProposal(proposal)}
                      conditional
                      adjustments={adjustments}
                      adjustmentOptions={simulation.adjustmentOptions}
                      onEdit={openProposalEditor}
                      onCancelAdjustment={cancelAdjustment}
                    />
                  ))}
                </section>
              ) : null}

              {resultFilter === 'ALL' || resultFilter === 'RED' ? (
                <Unassigned
                  result={activeResult}
                  onOpenMission={onOpenMission}
                />
              ) : null}

              {dataChanged ? (
                <div className="rounded-2xl bg-amber-100 px-4 py-3 text-xs font-semibold text-amber-900">
                  Données modifiées — relancez la simulation. Les propositions
                  affichées ne sont plus applicables tant que le serveur n’a pas
                  recalculé.
                </div>
              ) : stale ? (
                <div className="rounded-2xl bg-amber-100 px-4 py-3 text-xs font-semibold text-amber-900">
                  Cette simulation est obsolète. Relancez le calcul avant toute
                  application.
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
              {error}
            </div>
          ) : null}
        </div>

        {simulation && editingMissionId ? (
          <ProposalEditor
            missionId={editingMissionId}
            options={simulation.adjustmentOptions[editingMissionId] ?? []}
            selectedOptionId={draftOptionId}
            onSelect={setDraftOptionId}
            onCancel={() => {
              setEditingMissionId(null)
              setDraftOptionId(null)
            }}
            onReset={() => cancelAdjustment(editingMissionId)}
            onValidate={(option) => validateAdjustment(option)}
          />
        ) : null}

        {simulation && activeResult ? (
          <footer className="border-t border-black/[0.06] bg-white px-5 py-4 sm:px-7">
            <div className="mb-3 flex items-center justify-between text-xs text-[#646a60]">
              <span>{selectedMissionIds.size} mission(s) sélectionnée(s)</span>
              <button
                type="button"
                onClick={() => {
                  if (
                    Object.keys(adjustments).length > 0 &&
                    !window.confirm(
                      'Abandonner les ajustements non appliqués ?'
                    )
                  ) {
                    return
                  }
                  setSimulation(null)
                  onPreviewChange(null)
                }}
                className="font-semibold underline decoration-black/20 underline-offset-4"
                style={{ border: 0, background: 'transparent' }}
              >
                Nouvelle simulation
              </button>
            </div>
            <button
              type="button"
              disabled={
                stale ||
                dataChanged ||
                isApplying ||
                selectedMissionIds.size === 0
              }
              onClick={() => void applySelection()}
              className="h-12 w-full rounded-[18px] bg-[#11130f] text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 disabled:cursor-not-allowed disabled:opacity-40"
              style={{ border: 0 }}
            >
              {isApplying
                ? 'Revalidation serveur…'
                : 'Revalider et appliquer la sélection'}
            </button>
          </footer>
        ) : null}
      </aside>
    </div>
  )
}

function ReadinessChecklist({
  readiness,
  confirmingAddressKey,
  onConfirmAddress,
  onEditRegulatory,
  onOpenResource,
  onOpenMission,
}: {
  readiness: ReadinessResponse
  confirmingAddressKey: string | null
  onConfirmAddress: (
    missionId: string,
    endpoint: 'pickup' | 'delivery',
    placeId: string
  ) => void
  onEditRegulatory: (driverId: string, driverName: string) => void
  onOpenResource?: (type: 'driver' | 'truck' | 'trailer', id: string) => void
  onOpenMission?: (missionId: string) => void
}) {
  const items = [
    ['Missions prêtes', readiness.counts.readyMissions, 'ok'],
    ['Adresses en attente', readiness.counts.pendingAddresses, 'warning'],
    ['Adresses ambiguës', readiness.counts.ambiguousAddresses, 'warning'],
    ['Itinéraires manquants', readiness.counts.missingRoutes, 'warning'],
    ['Positions de départ', readiness.counts.missingPositions, 'warning'],
    [
      'États réglementaires',
      readiness.counts.missingRegulatoryStates,
      'warning',
    ],
    ['Hors période', readiness.counts.outsidePeriod, 'neutral'],
    [
      'Ressources indisponibles',
      readiness.counts.unavailableResources,
      'neutral',
    ],
  ] as const
  const manualAddressActions = readiness.counts.ambiguousAddresses
  return (
    <section className="rounded-[24px] bg-white p-5 shadow-[0_16px_42px_rgba(17,19,15,0.07)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#777d72]">
            État de la semaine
          </p>
          <p className="mt-1 text-sm font-semibold text-[#11130f]">
            {manualAddressActions > 0
              ? 'Adresses à confirmer'
              : 'Prêt à planifier'}{' '}
            · {readiness.missionScope.counts.included} mission(s)
          </p>
        </div>
      </div>
      {manualAddressActions > 0 ? (
        <p className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-900">
          {manualAddressActions} mission(s) nécessitent une adresse à confirmer
          avant de pouvoir être planifiées.
        </p>
      ) : null}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map(([label, value, tone]) => (
          <div
            key={label}
            className={[
              'rounded-2xl px-3 py-2',
              tone === 'ok' && value > 0
                ? 'text-lime-950 bg-lime-100'
                : tone === 'warning' && value > 0
                ? 'bg-amber-50 text-amber-900'
                : 'bg-[#f1f3ec] text-[#555c51]',
            ].join(' ')}
          >
            <p className="text-lg font-semibold">{value}</p>
            <p className="text-[9px] font-semibold uppercase tracking-[0.1em]">
              {label}
            </p>
          </div>
        ))}
      </div>
      {readiness.missionScope.exclusions.length ? (
        <details className="mt-3 rounded-2xl bg-[#f6f7f2] px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-semibold text-[#555c51]">
            Exclusions expliquées ({readiness.missionScope.exclusions.length})
          </summary>
          <div className="mt-2 space-y-1.5">
            {readiness.missionScope.exclusions.map((item) => (
              <p key={item.missionId} className="text-[10px] text-[#6a7166]">
                <strong>{item.reference}</strong> · {item.reason}
              </p>
            ))}
          </div>
        </details>
      ) : null}
      <div className="mt-3 space-y-2">
        {readiness.missions.map((mission) => (
          <details
            key={mission.missionId}
            className="rounded-2xl bg-[#f6f7f2] px-3 py-2"
          >
            <summary className="cursor-pointer text-[11px] font-semibold text-[#30352d]">
              {mission.reference}
            </summary>
            <div className="mt-2 space-y-1.5">
              {mission.prerequisites.map((item) => {
                const needsAction =
                  item.status === 'MISSING' ||
                  item.status === 'ACTION_REQUIRED'
                return (
                  <div
                    key={item.key}
                    className="flex items-start justify-between gap-3 rounded-xl bg-white px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold text-[#30352d]">
                        {item.label} ·{' '}
                        {item.status === 'CONFIRMED'
                          ? 'Confirmé'
                          : item.status === 'NOT_REQUIRED'
                            ? 'Non requis'
                            : item.status === 'ACTION_REQUIRED'
                              ? 'Action requise'
                              : 'Manquant'}
                      </p>
                      <p className="mt-0.5 text-[9px] leading-4 text-[#6a7166]">
                        {item.detail}
                      </p>
                    </div>
                    {needsAction && item.key !== 'driver' ? (
                      <button
                        type="button"
                        onClick={() => onOpenMission?.(mission.missionId)}
                        className="shrink-0 rounded-full bg-[#11130f] px-3 py-1.5 text-[9px] font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300"
                        style={{ border: 0 }}
                      >
                        Modifier
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </details>
        ))}
      </div>
      {readiness.missions.some(
        (mission) =>
          mission.pickupResolutionStatus === 'REVIEW_REQUIRED' ||
          mission.deliveryResolutionStatus === 'REVIEW_REQUIRED'
      ) ? (
        <div className="mt-3 space-y-2">
          {readiness.missions.map((mission) =>
            (
              [
                [
                  'pickup',
                  mission.pickupResolutionStatus,
                  mission.pickupResolutionReason,
                  mission.pickupCandidates,
                ],
                [
                  'delivery',
                  mission.deliveryResolutionStatus,
                  mission.deliveryResolutionReason,
                  mission.deliveryCandidates,
                ],
              ] as const
            ).map(([endpoint, status, reason, candidates]) =>
              status === 'REVIEW_REQUIRED' ? (
                <div
                  key={`${mission.missionId}:${endpoint}`}
                  className="rounded-2xl bg-amber-50 px-3 py-3"
                >
                  <p className="text-amber-950 text-[11px] font-semibold">
                    {mission.reference} ·{' '}
                    {endpoint === 'pickup' ? 'chargement' : 'livraison'}
                  </p>
                  <p className="mt-1 text-[10px] text-amber-800">{reason}</p>
                  <div className="mt-2 space-y-1.5">
                    {candidates.map((candidate) => {
                      const key = `${mission.missionId}:${endpoint}:${candidate.placeId}`
                      return (
                        <button
                          key={candidate.placeId}
                          type="button"
                          disabled={confirmingAddressKey !== null}
                          onClick={() =>
                            onConfirmAddress(
                              mission.missionId,
                              endpoint,
                              candidate.placeId
                            )
                          }
                          className="block w-full rounded-xl bg-white px-3 py-2 text-left text-[10px] font-medium text-[#33372f] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-50"
                          style={{ border: 0 }}
                        >
                          {confirmingAddressKey === key
                            ? 'Confirmation…'
                            : candidate.formattedAddress}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null
            )
          )}
        </div>
      ) : null}
      <PairResolutionList
        pairs={readiness.pairs}
        onEditRegulatory={onEditRegulatory}
        onOpenResource={onOpenResource}
      />
      <BaseStatusCard base={readiness.base} />
    </section>
  )
}

function PairResolutionList({
  pairs,
  onEditRegulatory,
  onOpenResource,
}: {
  pairs: ReadinessResponse['pairs']
  onEditRegulatory: (driverId: string, driverName: string) => void
  onOpenResource?: (type: 'driver' | 'truck' | 'trailer', id: string) => void
}) {
  // Ne conserver que les couples présentant un point à corriger, chacun avec
  // une raison traduite et une action ciblée (§8 : centre de résolution).
  const rows = pairs.filter(
    (pair) =>
      pair.missingRegulatoryState || pair.missingPosition || pair.unavailable
  )
  if (!rows.length) return null
  return (
    <div className="mt-3 space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#777d72]">
        Ressources à compléter
      </p>
      {rows.map((pair) => {
        const label = `${pair.driverName ?? 'Chauffeur ?'} · ${
          pair.truckPlateNumber ?? 'Camion ?'
        }`
        const reason = pair.missingRegulatoryState
          ? translateReasonCode('MISSING_DRIVER_STATE')
          : pair.missingPosition
          ? translateReasonCode('MISSING_POSITION')
          : translateReasonCode('DRIVER_UNAVAILABLE')
        const regulatoryWarnings = pair.regulatoryControls.filter(
          (control) => control.status !== 'CONFORME'
        )
        return (
          <div key={pair.rowId} className="rounded-2xl bg-amber-50 px-3 py-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-amber-950 text-[11px] font-semibold">
                  {label}
                </p>
                <p className="mt-0.5 text-[10px] font-semibold text-amber-900">
                  {reason.title}
                </p>
                <p className="mt-0.5 text-[10px] text-amber-800">
                  {regulatoryWarnings.length
                    ? regulatoryWarnings
                        .map(
                          (control) =>
                            `${control.label} : ${control.value}. ${control.explanation}`
                        )
                        .join(' ')
                    : reason.explanation}
                </p>
              </div>
              <PairActionButton
                action={resolvePairChecklistAction(pair)}
                driverName={pair.driverName}
                fallbackAction={reason.action}
                onEditRegulatory={onEditRegulatory}
                onOpenResource={onOpenResource}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PairActionButton({
  action,
  driverName,
  fallbackAction,
  onEditRegulatory,
  onOpenResource,
}: {
  action: ReturnType<typeof resolvePairChecklistAction>
  driverName: string | null
  fallbackAction: ReturnType<typeof translateReasonCode>['action']
  onEditRegulatory: (driverId: string, driverName: string) => void
  onOpenResource?: (type: 'driver' | 'truck' | 'trailer', id: string) => void
}) {
  const primary =
    'shrink-0 rounded-xl bg-[#11130f] px-3 py-2 text-[10px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300'
  const secondary =
    'shrink-0 rounded-xl bg-white px-3 py-2 text-[10px] font-semibold text-amber-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400'

  if (action.kind === 'EDIT_DRIVER_REGULATORY') {
    return (
      <button
        type="button"
        onClick={() =>
          onEditRegulatory(action.driverId, driverName ?? 'Chauffeur')
        }
        className={primary}
        style={{ border: 0 }}
      >
        {reasonActionLabels.EDIT_DRIVER_REGULATORY}
      </button>
    )
  }
  if (action.kind === 'CHECK_POSITION' && onOpenResource) {
    return (
      <button
        type="button"
        onClick={() => onOpenResource('truck', action.truckId)}
        className={secondary}
        style={{ border: 0 }}
        title="Position issue du GPS, du statut « à la base » ou de la base opérationnelle."
      >
        Ouvrir le camion
      </button>
    )
  }
  if (action.kind === 'CHECK_AVAILABILITY' && onOpenResource) {
    return (
      <button
        type="button"
        onClick={() => onOpenResource('truck', action.truckId)}
        className={secondary}
        style={{ border: 0 }}
      >
        {reasonActionLabels.CHECK_AVAILABILITY}
      </button>
    )
  }
  if (fallbackAction) {
    return (
      <span className={secondary.replace('focus-visible:ring-amber-400', '')}>
        {reasonActionLabels[fallbackAction]}
      </span>
    )
  }
  return null
}

function BaseStatusCard({ base }: { base: ReadinessResponse['base'] }) {
  return (
    <div
      className={[
        'mt-3 rounded-2xl px-3 py-2 text-[10px]',
        base.configured
          ? 'bg-[#f1f3ec] text-[#555c51]'
          : 'bg-amber-50 text-amber-900',
      ].join(' ')}
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.14em]">
        Base opérationnelle
      </p>
      {base.configured ? (
        <p className="mt-1">
          Configurée ({base.latitude?.toFixed(4)}, {base.longitude?.toFixed(4)}
          ). Sert de point de départ / retour lorsque la position GPS est
          inconnue. Modifiable uniquement par l’administrateur via les variables
          d’environnement (redéploiement requis).
        </p>
      ) : (
        <p className="mt-1 font-semibold">
          Non configurée. L’administrateur doit définir DISPATCH_BASE_LATITUDE
          et DISPATCH_BASE_LONGITUDE (redéploiement requis) pour évaluer les
          approches depuis la base.
        </p>
      )}
    </div>
  )
}

function Summary({
  result,
  strategy,
}: {
  result: DispatchOptimizationResult
  strategy: OptimizationStrategy
}) {
  const metrics = result.metrics
  const proposals = [
    ...result.confirmedProposals,
    ...result.conditionalProposals,
  ]
  const knownCost =
    proposals.length > 0 &&
    proposals.every((proposal) => proposal.knownCost !== null)
      ? proposals.reduce((sum, proposal) => sum + (proposal.knownCost ?? 0), 0)
      : null
  const estimatedCost =
    proposals.length > 0 &&
    proposals.every((proposal) => proposal.estimatedCost !== null)
      ? proposals.reduce(
          (sum, proposal) => sum + (proposal.estimatedCost ?? 0),
          0
        )
      : null
  const formatDuration = (seconds: number) =>
    `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)}`
  return (
    <section className="rounded-[24px] bg-[#11130f] p-5 text-white shadow-[0_18px_46px_rgba(17,19,15,0.15)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-white/55 text-[10px] uppercase tracking-[0.18em]">
            {strategyLabels[strategy]}
          </p>
          <p className="mt-1 text-base font-semibold">
            {metrics.confirmedMissions} confirmée(s) ·{' '}
            {metrics.conditionalMissions} à confirmer
          </p>
        </div>
        <span className="rounded-full bg-white/10 px-3 py-1 text-[10px]">
          {result.status}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <Metric
          label="Revenu couvert"
          value={`${metrics.revenueCovered.toFixed(0)} €`}
        />
        <Metric
          label="Coût connu"
          value={knownCost === null ? 'Inconnu' : `${knownCost.toFixed(0)} €`}
        />
        <Metric
          label="Coût estimé"
          value={
            estimatedCost === null
              ? 'Non calculable'
              : `≈ ${estimatedCost.toFixed(0)} €`
          }
        />
        <Metric
          label="Marge"
          value={
            metrics.estimatedMargin === null
              ? 'Non calculable'
              : `≈ ${metrics.estimatedMargin.toFixed(0)} €`
          }
        />
        <Metric
          label="Km chargés"
          value={`${metrics.loadedKilometers.toFixed(1)} km`}
        />
        <Metric
          label="Km à vide"
          value={`${metrics.emptyKilometers.toFixed(1)} km`}
        />
        <Metric
          label="Conduite"
          value={formatDuration(metrics.drivingSeconds)}
        />
        <Metric
          label="Autre travail"
          value={formatDuration(metrics.otherWorkSeconds)}
        />
        <Metric label="Retours base" value={String(metrics.returnsToBase)} />
        <Metric
          label="Changements remorque"
          value={String(metrics.trailerChanges)}
        />
        <Metric
          label="Non affectées"
          value={String(metrics.unassignedMissions)}
        />
        <Metric label="Calcul" value={`${result.computationDurationMs} ms`} />
      </div>
      {result.computationLimitReached ? (
        <p className="mt-3 text-[11px] text-amber-200">
          Limite de calcul atteinte · résultat partiel.
        </p>
      ) : null}
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-white/45 text-[9px] uppercase tracking-[0.14em]">
        {label}
      </p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  )
}

function ProposalCard({
  proposal,
  pairLabel,
  selected,
  onToggle,
  conditional,
  adjustments,
  adjustmentOptions,
  onEdit,
  onCancelAdjustment,
}: {
  proposal: PairProposal
  pairLabel?: {
    driverName: string
    truckPlateNumber: string
    locked: boolean
  }
  selected: boolean
  onToggle?: () => void
  conditional: boolean
  adjustments: Record<string, ProposalAdjustment>
  adjustmentOptions: SimulationResponse['adjustmentOptions']
  onEdit: (
    proposal: PairProposal,
    missionId: string,
    trailerId: string | null
  ) => void
  onCancelAdjustment: (missionId: string) => void
}) {
  return (
    <article
      className={[
        'mb-3 rounded-[22px] bg-white p-4 shadow-[0_12px_34px_rgba(17,19,15,0.06)]',
        conditional ? 'border border-amber-200' : '',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-[#11130f]">
            {pairLabel
              ? `${pairLabel.driverName} · ${pairLabel.truckPlateNumber}`
              : `Couple ${proposal.pair.rowId}`}
          </p>
          <p className="mt-1 text-[10px] text-[#777d72]">
            Couple proposé · {proposal.confidence}
          </p>
        </div>
        {conditional ? (
          <button
            type="button"
            onClick={onToggle}
            aria-pressed={selected}
            className={[
              'rounded-full px-3 py-1 text-[9px] font-bold uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
              selected
                ? 'bg-amber-500 text-white'
                : 'bg-amber-100 text-amber-800',
            ].join(' ')}
            style={{ border: 0 }}
          >
            {selected ? 'Orange confirmée' : 'Confirmer l’orange'}
          </button>
        ) : (
          <label className="flex items-center gap-2 text-[10px] font-semibold text-[#555c51]">
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggle}
              className="h-4 w-4 accent-[#11130f]"
            />
            Appliquer la séquence
          </label>
        )}
      </div>
      <div className="mt-3 space-y-2">
        {proposal.missions.map((mission, index) => {
          const adjustment = adjustments[mission.missionId]
          const adjustedOption = adjustmentOptions[mission.missionId]?.find(
            (option) =>
              option.pairRowId === adjustment?.pairRowId &&
              option.trailerId === adjustment?.trailerId
          )
          return (
            <details
              key={mission.missionId}
              className="rounded-2xl bg-[#f3f5ee] px-3 py-2"
            >
              <summary className="cursor-pointer list-none text-xs font-semibold text-[#22251f]">
                {index + 1}. {mission.reference}
                <span className="ml-2 text-[9px] font-medium text-[#7a8074]">
                  {mission.temporalEvaluation?.possibleStartAt
                    ? new Intl.DateTimeFormat('fr-FR', {
                        weekday: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      }).format(
                        new Date(mission.temporalEvaluation.possibleStartAt)
                      )
                    : 'planification non calculée'}
                </span>
              </summary>
              <div className="mt-3 grid gap-2 text-[10px] text-[#5d6459] sm:grid-cols-2">
                <p>{mission.explanation.summary}</p>
                <p className="font-semibold text-[#30352d]">
                  Remorque · {mission.trailerPlateNumber ?? 'Aucune'}
                  {mission.trailerChange ? ' · accrochage/décrochage' : ''}
                </p>
                <p>
                  Score {mission.score.toFixed(1)} ·{' '}
                  {mission.transitions.reduce(
                    (sum, route) => sum + route.distanceMeters,
                    0
                  ) / 1000}{' '}
                  km à vide
                </p>
                {mission.explanation.assumptions.map((item) => (
                  <p key={item}>Hypothèse · {item}</p>
                ))}
                {mission.explanation.missingData.map((item) => {
                  const label = translateReasonCode(item)
                  return (
                    <p key={item} className="font-semibold text-amber-700">
                      Donnée manquante · {label.title}
                      {label.action
                        ? ` → ${reasonActionLabels[label.action]}`
                        : ''}
                    </p>
                  )
                })}
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  <button
                    type="button"
                    onClick={() =>
                      onEdit(proposal, mission.missionId, mission.trailerId)
                    }
                    className="rounded-full bg-white px-3 py-2 text-[9px] font-bold text-[#242820] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300"
                    style={{ border: 0 }}
                  >
                    Modifier la proposition
                  </button>
                  {adjustedOption ? (
                    <>
                      <span className="rounded-full bg-[#11130f] px-3 py-2 text-[8px] font-bold uppercase text-[#B9FF4A]">
                        Ajustée manuellement · {adjustedOption.classification}
                      </span>
                      <button
                        type="button"
                        onClick={() => onCancelAdjustment(mission.missionId)}
                        className="rounded-full px-3 py-2 text-[9px] font-bold text-[#6b7167]"
                        style={{ border: 0, background: 'transparent' }}
                      >
                        Annuler les modifications
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            </details>
          )
        })}
      </div>
    </article>
  )
}

function ProposalEditor({
  missionId,
  options,
  selectedOptionId,
  onSelect,
  onCancel,
  onReset,
  onValidate,
}: {
  missionId: string
  options: ProposalAdjustmentOption[]
  selectedOptionId: string | null
  onSelect: (id: string) => void
  onCancel: () => void
  onReset: () => void
  onValidate: (option: ProposalAdjustmentOption) => void
}) {
  const selectedOption = options.find(
    (option) => option.id === selectedOptionId
  )
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Modifier la proposition"
      className="absolute inset-0 z-20 flex items-end bg-black/30 p-3 sm:items-center sm:justify-center"
    >
      <section className="max-h-[82vh] w-full overflow-hidden rounded-[26px] bg-white shadow-2xl sm:max-w-xl">
        <header className="flex items-start justify-between gap-4 border-b border-black/[0.06] px-5 py-4">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#777d72]">
              Ajustement local · aucune écriture
            </p>
            <h3 className="mt-1 text-lg font-bold">Modifier la proposition</h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Fermer"
            className="h-10 w-10 rounded-full bg-[#f2f4ee] text-lg"
            style={{ border: 0 }}
          >
            ×
          </button>
        </header>
        <div className="max-h-[58vh] space-y-2 overflow-y-auto px-5 py-4">
          {options.length ? (
            options.map((option) => (
              <label
                key={option.id}
                className={[
                  'flex cursor-pointer items-start gap-3 rounded-2xl p-3 transition',
                  selectedOptionId === option.id
                    ? 'bg-[#11130f] text-white'
                    : 'bg-[#f3f5ee] text-[#20231e]',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name={`adjustment-${missionId}`}
                  checked={selectedOptionId === option.id}
                  onChange={() => onSelect(option.id)}
                  className="mt-1 accent-[#B9FF4A]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-bold">
                    {option.driverName} · {option.truckPlateNumber}
                  </span>
                  <span className="mt-1 block text-[10px] opacity-70">
                    Remorque · {option.trailerPlateNumber ?? 'Aucune'}
                  </span>
                  <span className="bg-white/15 mt-2 inline-flex rounded-full px-2 py-1 text-[8px] font-bold uppercase">
                    {option.classification === 'GREEN'
                      ? 'Verte · faisable'
                      : 'Orange · sous réserve'}
                  </span>
                  <span className="mt-2 block text-[10px] opacity-80">
                    {option.explanation.summary}
                  </span>
                </span>
              </label>
            ))
          ) : (
            <p className="rounded-2xl bg-red-50 p-4 text-xs font-semibold text-red-700">
              Aucune alternative exploitable dans le snapshot.
            </p>
          )}
        </div>
        <footer className="flex flex-wrap justify-end gap-2 border-t border-black/[0.06] px-5 py-4">
          <button
            type="button"
            onClick={onReset}
            className="h-11 rounded-2xl px-4 text-xs font-semibold text-[#555c51]"
            style={{ border: 0, background: '#f2f4ee' }}
          >
            Annuler les modifications
          </button>
          <button
            type="button"
            disabled={!selectedOption}
            onClick={() => selectedOption && onValidate(selectedOption)}
            className="h-11 rounded-2xl bg-[#11130f] px-5 text-xs font-semibold text-white disabled:opacity-40"
            style={{ border: 0 }}
          >
            Valider la proposition
          </button>
        </footer>
      </section>
    </div>
  )
}

function Unassigned({
  result,
  onOpenMission,
}: {
  result: DispatchOptimizationResult
  onOpenMission?: (missionId: string) => void
}) {
  const items = [
    ...result.impossibleMissions,
    ...result.deferredMissions,
    ...result.unassignedMissions,
  ]
  if (!items.length) return null
  return (
    <section className="rounded-[22px] bg-white p-4">
      <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-[#686f63]">
        Missions non affectées
      </h3>
      <div className="mt-3 space-y-2">
        {items.map((item) => {
          const category = translateReasonCode(item.category)
          const codeLabels = (item.codes ?? [])
            .filter((code) => code !== item.category)
            .map((code) => translateReasonCode(code))
          return (
            <div
              key={item.missionId}
              className="rounded-2xl bg-[#f3f5ee] px-3 py-2 text-xs"
            >
              <div className="flex justify-between gap-3">
                <span className="font-semibold">{item.reference}</span>
                <span
                  className="rounded-full bg-red-100 px-2 py-0.5 text-[9px] font-bold uppercase text-red-700"
                  title={item.category}
                >
                  Non placée
                </span>
              </div>
              <p className="mt-1 text-[10px] font-semibold text-[#33372f]">
                {category.title}
              </p>
              <p className="mt-0.5 text-[10px] text-[#6a7166]">
                {category.explanation}
              </p>
              {codeLabels.map((label) => (
                <p
                  key={label.code}
                  className="mt-0.5 text-[10px] text-[#6a7166]"
                >
                  · {label.title}
                  {label.action ? ` → ${reasonActionLabels[label.action]}` : ''}
                </p>
              ))}
              {category.action ? (
                <p className="mt-1 text-[10px] font-semibold text-[#405c08]">
                  Action : {reasonActionLabels[category.action]}
                </p>
              ) : null}
              {onOpenMission &&
              (category.action === 'EDIT_MISSION_SCHEDULE' ||
                item.category === 'DEFERRED' ||
                codeLabels.some(
                  (label) =>
                    label.action === 'EDIT_MISSION_SCHEDULE' ||
                    label.action === 'REVIEW_ADDRESS'
                )) ? (
                <button
                  type="button"
                  onClick={() => onOpenMission(item.missionId)}
                  className="mt-2 rounded-xl bg-[#11130f] px-3 py-1.5 text-[10px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300"
                  style={{ border: 0 }}
                >
                  {category.action === 'EDIT_MISSION_SCHEDULE' ||
                  item.category === 'DEFERRED' ||
                  item.category === 'TIME_WINDOW_IMPOSSIBLE'
                    ? reasonActionLabels.EDIT_MISSION_SCHEDULE
                    : 'Ouvrir la mission'}
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}
