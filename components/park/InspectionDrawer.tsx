'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ParkInspectionItemStatus,
  ParkInspectionStatus,
  ParkVehicleType,
} from '@prisma/client'

import type {
  ParkInspectionDTO,
  ParkInspectionResultInput,
} from '../../lib/park/inspection-types'
import {
  defaultPressurePositions,
  inspectionTemplate,
  pressureItemKey,
} from '../../lib/park/inspection-template'
import type { ParkVehicleDTO } from '../../lib/park/types'
import {
  InspectionIcon,
  inspectionOverallClass,
  inspectionOverallLabels,
} from './InspectionStatus'

type Answer = {
  status: ParkInspectionItemStatus
  comment: string
}

type PressureAnswer = {
  key: string
  label: string
  value: string
}

const quickStatuses: Array<{
  value: ParkInspectionItemStatus
  label: string
  symbol: string
  className: string
}> = [
  { value: 'OK', label: 'OK', symbol: '✓', className: 'border-lime-300 bg-lime-50 text-lime-900' },
  { value: 'WATCH', label: 'À surveiller', symbol: '!', className: 'border-amber-300 bg-amber-50 text-amber-900' },
  { value: 'CRITICAL', label: 'Critique', symbol: '×', className: 'border-red-300 bg-red-50 text-red-800' },
  { value: 'NOT_APPLICABLE', label: 'Non applicable', symbol: '—', className: 'border-slate-200 bg-slate-50 text-slate-600' },
]

function toLocalDateTime(value: Date | string) {
  const date = new Date(value)
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return shifted.toISOString().slice(0, 16)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function inspectionPayload(
  vehicle: ParkVehicleDTO,
  inspectedAt: string,
  mileage: string,
  generalComment: string,
  answers: Record<string, Answer>,
  pressures: PressureAnswer[]
) {
  const results: ParkInspectionResultInput[] = [
    ...Object.entries(answers).map(([itemKey, answer]) => ({
      category: '',
      itemKey,
      status: answer.status,
      comment: answer.comment.trim() || null,
    })),
    ...pressures
      .filter((pressure) => pressure.value.trim())
      .map((pressure) => ({
        category: 'TIRES',
        itemKey: pressure.key,
        label: pressure.label,
        status: ParkInspectionItemStatus.OK,
        numericValue: Number.parseFloat(pressure.value.replace(',', '.')),
        unit: 'bar',
      })),
  ]
  return {
    vehicleType: vehicle.type,
    vehicleId: vehicle.id,
    inspectedAt: new Date(inspectedAt).toISOString(),
    mileage: mileage.trim() ? Number.parseInt(mileage, 10) : null,
    generalComment: generalComment.trim() || null,
    results,
  }
}

export function InspectionDrawer({
  vehicle,
  canManage,
  onClose,
  onUpdated,
}: {
  vehicle: ParkVehicleDTO | null
  canManage: boolean
  onClose: () => void
  onUpdated: () => Promise<void> | void
}) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [history, setHistory] = useState<ParkInspectionDTO[]>([])
  const [activeInspection, setActiveInspection] = useState<ParkInspectionDTO | null>(null)
  const [inspectedAt, setInspectedAt] = useState(toLocalDateTime(new Date()))
  const [mileage, setMileage] = useState('')
  const [generalComment, setGeneralComment] = useState('')
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const [pressures, setPressures] = useState<PressureAnswer[]>([])
  const [activeSection, setActiveSection] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [historyResult, setHistoryResult] = useState('ALL')
  const [historyPeriod, setHistoryPeriod] = useState('ALL')

  const sections = useMemo(
    () => (vehicle ? inspectionTemplate(vehicle.type) : []),
    [vehicle]
  )

  function resetForm(inspection: ParkInspectionDTO | null) {
    setActiveInspection(inspection)
    setInspectedAt(toLocalDateTime(inspection?.inspectedAt ?? new Date()))
    setMileage(inspection?.mileage?.toString() ?? '')
    setGeneralComment(inspection?.generalComment ?? '')
    const nextAnswers: Record<string, Answer> = {}
    for (const result of inspection?.results ?? []) {
      if (!result.itemKey.startsWith('tires.pressure.')) {
        nextAnswers[result.itemKey] = {
          status: result.status,
          comment: result.comment ?? '',
        }
      }
    }
    setAnswers(nextAnswers)
    const storedPressures = (inspection?.results ?? [])
      .filter((result) => result.itemKey.startsWith('tires.pressure.'))
      .map((result) => ({
        key: result.itemKey,
        label: result.label,
        value: result.numericValue?.toString() ?? '',
      }))
    const defaultPressures = vehicle
      ? defaultPressurePositions(vehicle.type).map((label, index) => ({
          key: pressureItemKey(index),
          label,
          value: '',
        }))
      : []
    setPressures(storedPressures.length ? storedPressures : defaultPressures)
    setActiveSection(0)
    setDirty(false)
  }

  async function loadInspections() {
    if (!vehicle) return
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        vehicleType: vehicle.type,
        vehicleId: vehicle.id,
        limit: '50',
      })
      const response = await fetch(`/api/park/inspections?${params.toString()}`)
      const payload = (await response.json()) as {
        inspections?: ParkInspectionDTO[]
        error?: string
      }
      if (!response.ok) throw new Error(payload.error ?? 'Chargement impossible.')
      const inspections = payload.inspections ?? []
      setHistory(inspections)
      const draft = inspections.find((inspection) => inspection.status === ParkInspectionStatus.DRAFT)
      const latest = inspections.find((inspection) => inspection.status === ParkInspectionStatus.FINALIZED)
      resetForm(canManage ? draft ?? null : latest ?? null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Chargement impossible.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (vehicle) void loadInspections()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id, vehicle?.type, canManage])

  useEffect(() => {
    function protect(event: BeforeUnloadEvent) {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [dirty])

  if (!vehicle) return null

  const finalized = activeInspection?.status === ParkInspectionStatus.FINALIZED
  const editable = canManage && !finalized
  const requiredItems = sections.flatMap((section) => section.items.filter((item) => item.required))
  const completedCount = requiredItems.filter((item) => answers[item.key]).length
  const progress = requiredItems.length
    ? Math.round((completedCount / requiredItems.length) * 100)
    : 0
  const currentSection = sections[activeSection]
  const previewStatuses = Object.values(answers).map((answer) => answer.status)
  const previewResult = previewStatuses.includes(ParkInspectionItemStatus.CRITICAL)
    ? 'INTERVENTION_REQUIRED'
    : previewStatuses.includes(ParkInspectionItemStatus.WATCH)
    ? 'WATCH'
    : previewStatuses.length
    ? 'COMPLIANT'
    : null

  function requestClose() {
    if (dirty && !window.confirm('Ce contrôle contient des modifications non enregistrées. Fermer quand même ?')) {
      return
    }
    onClose()
  }

  function updateAnswer(itemKey: string, status: ParkInspectionItemStatus) {
    setAnswers((current) => ({
      ...current,
      [itemKey]: { status, comment: current[itemKey]?.comment ?? '' },
    }))
    setDirty(true)
  }

  function markSectionOk() {
    if (!currentSection) return
    setAnswers((current) => ({
      ...current,
      ...Object.fromEntries(
        currentSection.items.map((item) => [
          item.key,
          { status: ParkInspectionItemStatus.OK, comment: current[item.key]?.comment ?? '' },
        ])
      ),
    }))
    setDirty(true)
    if (activeSection < sections.length - 1) {
      window.setTimeout(() => setActiveSection((section) => section + 1), 180)
    }
  }

  async function saveDraft() {
    if (!editable) return activeInspection
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const url = activeInspection
        ? `/api/park/inspections/${activeInspection.id}`
        : '/api/park/inspections'
      const response = await fetch(url, {
        method: activeInspection ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          inspectionPayload(
            vehicle!,
            inspectedAt,
            mileage,
            generalComment,
            answers,
            pressures
          )
        ),
      })
      const payload = (await response.json()) as {
        inspection?: ParkInspectionDTO
        error?: string
      }
      if (!response.ok || !payload.inspection) {
        throw new Error(payload.error ?? 'Enregistrement impossible.')
      }
      setActiveInspection(payload.inspection)
      setHistory((current) => [
        payload.inspection as ParkInspectionDTO,
        ...current.filter((item) => item.id !== payload.inspection?.id),
      ])
      setDirty(false)
      setSuccess('Brouillon enregistré.')
      await onUpdated()
      return payload.inspection
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Enregistrement impossible.')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function finalize() {
    if (completedCount !== requiredItems.length) {
      setError(`Checklist incomplète : ${requiredItems.length - completedCount} élément(s) restant(s).`)
      return
    }
    const draft = await saveDraft()
    if (!draft) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/park/inspections/${draft.id}/finalize`, {
        method: 'POST',
      })
      const payload = (await response.json()) as {
        inspection?: ParkInspectionDTO
        error?: string
      }
      if (!response.ok || !payload.inspection) {
        throw new Error(payload.error ?? 'Finalisation impossible.')
      }
      resetForm(payload.inspection)
      setHistory((current) => [
        payload.inspection as ParkInspectionDTO,
        ...current.filter((item) => item.id !== payload.inspection?.id),
      ])
      setSuccess('Contrôle finalisé.')
      await onUpdated()
    } catch (finalizeError) {
      setError(finalizeError instanceof Error ? finalizeError.message : 'Finalisation impossible.')
    } finally {
      setSaving(false)
    }
  }

  async function createMaintenance(resultId: string) {
    if (!activeInspection) return
    if (!window.confirm('Créer une demande de maintenance en brouillon pour cette anomalie ?')) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/park/inspections/${activeInspection.id}/maintenance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resultId }),
      })
      const payload = (await response.json()) as {
        maintenanceRequest?: { id: string }
        error?: string
      }
      if (!response.ok || !payload.maintenanceRequest) {
        throw new Error(payload.error ?? 'Création de la maintenance impossible.')
      }
      setActiveInspection((current) =>
        current
          ? {
              ...current,
              results: current.results.map((result) =>
                result.id === resultId
                  ? { ...result, maintenanceRequestId: payload.maintenanceRequest?.id ?? null }
                  : result
              ),
            }
          : current
      )
      setSuccess('Demande de maintenance créée en brouillon.')
      await onUpdated()
    } catch (maintenanceError) {
      setError(
        maintenanceError instanceof Error
          ? maintenanceError.message
          : 'Création de la maintenance impossible.'
      )
    } finally {
      setSaving(false)
    }
  }

  function startNewInspection() {
    resetForm(null)
    setSuccess('')
    setError('')
  }

  const filteredHistory = history.filter((inspection) => {
    if (historyResult !== 'ALL' && inspection.overallResult !== historyResult) return false
    if (historyPeriod !== 'ALL') {
      const days = Number.parseInt(historyPeriod, 10)
      if (new Date(inspection.inspectedAt).getTime() < Date.now() - days * 86_400_000) return false
    }
    return true
  })

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/40" onClick={requestClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Contrôle ${vehicle.plateNumber}`}
        className="fixed inset-x-0 bottom-0 z-[80] flex max-h-[94dvh] flex-col overflow-hidden rounded-t-[30px] bg-white shadow-2xl sm:inset-y-0 sm:left-auto sm:w-[min(720px,94vw)] sm:max-h-none sm:rounded-none"
      >
        <header className="shrink-0 border-b border-black/[.07] bg-white px-4 pb-3 pt-4 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#11130f] text-[#c8ff00]">
                <InspectionIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[9px] font-black uppercase tracking-[.22em] text-[#83a900]">
                  Contrôle du parc
                </p>
                <h2 className="truncate text-xl font-black text-[#171914]">{vehicle.plateNumber}</h2>
                <p className="text-xs font-semibold text-[#777d72]">
                  {vehicle.type === ParkVehicleType.TRUCK ? 'Camion' : 'Remorque'} · {progress}% complété
                </p>
              </div>
            </div>
            <button type="button" onClick={requestClose} aria-label="Fermer le contrôle" className="h-10 w-10 shrink-0 rounded-full bg-black/[.05] text-xl">×</button>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#eceee8]">
            <div className="h-full rounded-full bg-[#a8db00] transition-all" style={{ width: `${progress}%` }} />
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          {loading ? <p className="py-16 text-center text-sm font-semibold text-[#777d72]">Chargement du contrôle…</p> : null}
          {error ? <p role="alert" className="mb-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{error}</p> : null}
          {success ? <p role="status" className="mb-3 rounded-2xl bg-lime-50 px-4 py-3 text-sm font-semibold text-lime-900">{success}</p> : null}

          {!loading && activeInspection && finalized ? (
            <FinalizedInspection
              inspection={activeInspection}
              canManage={canManage}
              onCreateMaintenance={createMaintenance}
            />
          ) : !loading && editable ? (
            <>
              <section className="grid gap-3 rounded-[22px] bg-[#f5f6f2] p-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[10px] font-black uppercase tracking-wide text-[#6d7368]">Date et heure</span>
                  <input type="datetime-local" value={inspectedAt} max={toLocalDateTime(new Date(Date.now() + 86_400_000))} onChange={(event) => { setInspectedAt(event.target.value); setDirty(true) }} className="mt-1 h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm font-semibold" />
                </label>
                {vehicle.type === ParkVehicleType.TRUCK ? (
                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-wide text-[#6d7368]">Kilométrage <span className="normal-case text-[#9aa094]">facultatif</span></span>
                    <input type="number" min="0" inputMode="numeric" value={mileage} onChange={(event) => { setMileage(event.target.value); setDirty(true) }} placeholder="Ex. 485200" className="mt-1 h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm font-semibold" />
                  </label>
                ) : null}
              </section>

              <nav aria-label="Sections du contrôle" className="dispatch-pool-scrollbar -mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-2">
                {sections.map((section, index) => {
                  const done = section.items.every((item) => answers[item.key])
                  return (
                    <button key={section.key} type="button" onClick={() => setActiveSection(index)} className={`flex h-11 shrink-0 items-center gap-2 rounded-xl border px-3 text-xs font-black transition ${activeSection === index ? 'border-black bg-[#11130f] text-white' : 'border-black/10 bg-white text-[#62685e]'}`}>
                      <SectionIcon icon={section.icon} />
                      {section.label}
                      {done ? <span className="text-[#c8ff00]">✓</span> : null}
                    </button>
                  )
                })}
              </nav>

              {currentSection ? (
                <section className="mt-2 rounded-[24px] border border-black/[.07] bg-white p-3 shadow-sm sm:p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f1f3ed] text-[#4d5348]"><SectionIcon icon={currentSection.icon} /></span>
                      <div><p className="text-[10px] font-black uppercase tracking-[.18em] text-[#7b8175]">Section {activeSection + 1}/{sections.length}</p><h3 className="font-black text-[#171914]">{currentSection.label}</h3></div>
                    </div>
                    <button type="button" onClick={markSectionOk} className="h-10 rounded-xl bg-lime-100 px-3 text-xs font-black text-lime-900 transition hover:bg-[#c8ff00]">Tout est OK</button>
                  </div>
                  <div className="mt-4 space-y-3">
                    {currentSection.items.map((item) => (
                      <ControlItem key={item.key} label={item.label} answer={answers[item.key]} onStatus={(status) => updateAnswer(item.key, status)} onComment={(comment) => { setAnswers((current) => ({ ...current, [item.key]: { status: current[item.key]?.status ?? ParkInspectionItemStatus.WATCH, comment } })); setDirty(true) }} />
                    ))}
                  </div>
                  {currentSection.key === 'TIRES' ? (
                    <PressureGrid pressures={pressures} previous={history.find((inspection) => inspection.status === ParkInspectionStatus.FINALIZED) ?? null} onChange={(next) => { setPressures(next); setDirty(true) }} />
                  ) : null}
                </section>
              ) : null}

              <label className="mt-4 block">
                <span className="text-[10px] font-black uppercase tracking-wide text-[#6d7368]">Commentaire général <span className="normal-case text-[#9aa094]">facultatif</span></span>
                <textarea value={generalComment} maxLength={2000} onChange={(event) => { setGeneralComment(event.target.value); setDirty(true) }} className="mt-1 min-h-20 w-full resize-none rounded-2xl border border-black/10 p-3 text-sm outline-none focus:border-[#8eb800]" placeholder="Observation générale…" />
              </label>
              {previewResult ? <p className={`mt-3 inline-flex rounded-full px-3 py-1.5 text-xs font-black ${inspectionOverallClass(previewResult)}`}>Résultat provisoire · {inspectionOverallLabels[previewResult]}</p> : null}
            </>
          ) : !loading ? (
            <p className="rounded-2xl bg-[#f5f6f2] p-5 text-sm font-semibold text-[#656b61]">Aucun contrôle finalisé pour ce véhicule.</p>
          ) : null}

          {!loading ? (
            <InspectionHistory history={filteredHistory} result={historyResult} period={historyPeriod} onResult={setHistoryResult} onPeriod={setHistoryPeriod} onOpen={resetForm} />
          ) : null}
        </div>

        {editable ? (
          <footer className="shrink-0 border-t border-black/[.07] bg-white/95 p-3 backdrop-blur sm:px-6">
            <div className="flex gap-2">
              <button type="button" disabled={saving} onClick={() => void saveDraft()} className="h-12 flex-1 rounded-2xl border border-black/10 bg-white text-sm font-black text-[#171914] disabled:opacity-40">Enregistrer le brouillon</button>
              <button type="button" disabled={saving || completedCount !== requiredItems.length} onClick={() => void finalize()} className="h-12 flex-1 rounded-2xl bg-[#11130f] text-sm font-black text-white transition hover:bg-[#c8ff00] hover:text-black disabled:opacity-40">Finaliser</button>
            </div>
          </footer>
        ) : finalized && canManage ? (
          <footer className="shrink-0 border-t border-black/[.07] bg-white p-3 sm:px-6"><button type="button" onClick={startNewInspection} className="h-12 w-full rounded-2xl bg-[#11130f] text-sm font-black text-white">Nouveau contrôle</button></footer>
        ) : null}
      </aside>
    </>
  )
}

function ControlItem({ label, answer, onStatus, onComment }: { label: string; answer?: Answer; onStatus: (status: ParkInspectionItemStatus) => void; onComment: (comment: string) => void }) {
  return (
    <article className="rounded-2xl bg-[#f7f8f5] p-3">
      <p className="text-sm font-black text-[#252821]">{label}</p>
      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {quickStatuses.map((status) => (
          <button key={status.value} type="button" aria-pressed={answer?.status === status.value} onClick={() => onStatus(status.value)} className={`flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-2 text-[10px] font-black transition ${answer?.status === status.value ? `${status.className} ring-2 ring-black/10` : 'border-black/[.07] bg-white text-[#656b61]'}`}><span className="text-base leading-none">{status.symbol}</span>{status.label}</button>
        ))}
      </div>
      {answer && (answer.status === ParkInspectionItemStatus.WATCH || answer.status === ParkInspectionItemStatus.CRITICAL) ? (
        <input value={answer.comment} maxLength={1000} onChange={(event) => onComment(event.target.value)} placeholder="Décrire brièvement l’anomalie…" className="mt-2 h-10 w-full rounded-xl border border-black/10 bg-white px-3 text-xs outline-none focus:border-[#8eb800]" />
      ) : null}
    </article>
  )
}

function PressureGrid({ pressures, previous, onChange }: { pressures: PressureAnswer[]; previous: ParkInspectionDTO | null; onChange: (pressures: PressureAnswer[]) => void }) {
  const previousByKey = new Map((previous?.results ?? []).map((result) => [result.itemKey, result]))
  function copyFirst() {
    const first = pressures.find((pressure) => pressure.value.trim())?.value
    if (first) onChange(pressures.map((pressure) => ({ ...pressure, value: first })))
  }
  return (
    <div className="mt-5 border-t border-black/[.07] pt-4">
      <div className="flex items-center justify-between"><div><h4 className="text-sm font-black text-[#252821]">Pressions</h4><p className="text-[10px] font-semibold text-[#858b80]">Valeurs facultatives · bar</p></div><button type="button" onClick={copyFirst} className="h-9 rounded-xl bg-[#f0f2ec] px-3 text-[10px] font-black text-[#555b51]">Recopier la première</button></div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {pressures.map((pressure, index) => {
          const previousValue = previousByKey.get(pressure.key)?.numericValue
          return <label key={pressure.key} className="rounded-xl bg-[#f7f8f5] p-2"><span className="block text-[9px] font-black uppercase tracking-wide text-[#6d7368]">{pressure.label}</span><span className="mt-1 flex items-center rounded-lg border border-black/10 bg-white px-2"><input inputMode="decimal" type="number" min="0.1" max="20" step="0.1" value={pressure.value} onChange={(event) => onChange(pressures.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} className="h-10 min-w-0 flex-1 bg-transparent text-base font-black outline-none" /><span className="text-xs font-bold text-[#777d72]">bar</span></span>{previousValue ? <span className="mt-1 block text-[9px] font-semibold text-[#91978d]">Précédent : {previousValue} bar</span> : null}</label>
        })}
      </div>
    </div>
  )
}

function FinalizedInspection({ inspection, canManage, onCreateMaintenance }: { inspection: ParkInspectionDTO; canManage: boolean; onCreateMaintenance: (resultId: string) => void }) {
  const anomalies = inspection.results.filter((result) => result.status === ParkInspectionItemStatus.WATCH || result.status === ParkInspectionItemStatus.CRITICAL)
  return (
    <section>
      <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-3 py-1.5 text-xs font-black ${inspection.overallResult ? inspectionOverallClass(inspection.overallResult) : ''}`}>{inspection.overallResult ? inspectionOverallLabels[inspection.overallResult] : 'Finalisé'}</span><span className="text-xs font-semibold text-[#757b70]">{formatDate(inspection.inspectedAt)} · {inspection.inspectorName}</span></div>
      {inspection.mileage !== null ? <p className="mt-3 text-sm font-semibold text-[#555b51]">Kilométrage : {inspection.mileage.toLocaleString('fr-FR')} km</p> : null}
      {inspection.generalComment ? <p className="mt-3 rounded-2xl bg-[#f5f6f2] p-3 text-sm text-[#555b51]">{inspection.generalComment}</p> : null}
      <div className="mt-5 space-y-2"><h3 className="text-[10px] font-black uppercase tracking-[.18em] text-[#73796d]">Anomalies · {anomalies.length}</h3>{anomalies.length ? anomalies.map((result) => <article key={result.id} className={`rounded-2xl border p-3 ${result.status === ParkInspectionItemStatus.CRITICAL ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wide text-[#555b51]">{result.category}</p><p className="font-black text-[#1f221c]">{result.label}</p><p className="mt-1 text-xs text-[#696f64]">{result.comment ?? (result.status === ParkInspectionItemStatus.CRITICAL ? 'Critique' : 'À surveiller')}</p></div><span className="text-xs font-black">{result.status === ParkInspectionItemStatus.CRITICAL ? 'Critique' : 'À surveiller'}</span></div>{result.maintenanceRequestId ? <p className="mt-2 text-xs font-black text-[#4d7c0f]">Maintenance créée · {result.maintenanceRequestId}</p> : canManage ? <button type="button" onClick={() => onCreateMaintenance(result.id)} className="mt-3 h-10 rounded-xl bg-[#11130f] px-3 text-xs font-black text-white">Créer une demande de maintenance</button> : null}</article>) : <p className="rounded-2xl bg-lime-50 p-4 text-sm font-semibold text-lime-900">Aucune anomalie relevée.</p>}</div>
      <div className="mt-5 grid gap-2 sm:grid-cols-2">{inspection.results.filter((result) => !result.itemKey.startsWith('tires.pressure.')).map((result) => <div key={result.id} className="flex items-center justify-between rounded-xl bg-[#f7f8f5] px-3 py-2 text-xs"><span className="font-semibold text-[#555b51]">{result.label}</span><span className="font-black text-[#252821]">{quickStatuses.find((status) => status.value === result.status)?.label}</span></div>)}</div>
    </section>
  )
}

function InspectionHistory({ history, result, period, onResult, onPeriod, onOpen }: { history: ParkInspectionDTO[]; result: string; period: string; onResult: (value: string) => void; onPeriod: (value: string) => void; onOpen: (inspection: ParkInspectionDTO) => void }) {
  return (
    <section className="mt-7 border-t border-black/[.07] pt-5"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-[10px] font-black uppercase tracking-[.2em] text-[#73796d]">Historique des contrôles</h3><div className="flex gap-1.5"><select aria-label="Période" value={period} onChange={(event) => onPeriod(event.target.value)} className="h-9 rounded-xl border border-black/10 bg-white px-2 text-[10px] font-bold"><option value="ALL">Toute période</option><option value="30">30 jours</option><option value="90">90 jours</option></select><select aria-label="Résultat" value={result} onChange={(event) => onResult(event.target.value)} className="h-9 rounded-xl border border-black/10 bg-white px-2 text-[10px] font-bold"><option value="ALL">Tous les résultats</option><option value="COMPLIANT">Conforme</option><option value="WATCH">À surveiller</option><option value="INTERVENTION_REQUIRED">Intervention requise</option></select></div></div><div className="mt-3 space-y-2">{history.length ? history.map((inspection) => <button key={inspection.id} type="button" onClick={() => onOpen(inspection)} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-black/[.07] bg-white p-3 text-left transition hover:bg-[#f7f8f5]"><div><p className="text-sm font-black text-[#252821]">{formatDate(inspection.inspectedAt)}</p><p className="text-[10px] font-semibold text-[#81877c]">{inspection.inspectorName} · {inspection.status === ParkInspectionStatus.DRAFT ? 'Brouillon' : 'Finalisé'}</p></div>{inspection.overallResult ? <span className={`rounded-full px-2 py-1 text-[9px] font-black ${inspectionOverallClass(inspection.overallResult)}`}>{inspectionOverallLabels[inspection.overallResult]}</span> : <span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black text-slate-600">Brouillon</span>}</button>) : <p className="text-sm font-semibold text-[#8a9082]">Aucun contrôle enregistré.</p>}</div></section>
  )
}

function SectionIcon({ icon }: { icon: string }) {
  const path = icon === 'tire' ? <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="3" /></> : icon === 'light' ? <><path d="M9 18h6M10 21h4" /><path d="M8 14a6 6 0 1 1 8 0l-1 2h-6z" /></> : icon === 'shield' ? <path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z" /> : icon === 'coupling' ? <path d="M5 8h5v8H5M14 7v10M10 12h4M18 9v6" /> : icon === 'brake' ? <><circle cx="12" cy="12" r="7" /><path d="M12 5v14M5 12h14" /></> : <><rect x="4" y="7" width="16" height="9" rx="2" /><path d="M7 16v2M17 16v2M8 11h8" /></>
  return <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">{path}</svg>
}
