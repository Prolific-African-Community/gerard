'use client'

import { useCallback, useEffect, useState } from 'react'

import type { DriverRegulatoryPresentation } from '../../lib/dispatch/regulatory/presentation'
import type {
  RegulatoryControl,
  RegulatoryParameter,
} from '../../lib/dispatch/regulatory/assessment'
import { DriverInitialStateForm } from './DriverInitialStateForm'
import {
  activityBusinessLabels,
  activitySourceLabels,
} from '../../lib/dispatch/regulatory/presentation'

type ActivityType =
  | 'DRIVE_START'
  | 'DRIVE_END'
  | 'OTHER_WORK'
  | 'BREAK'
  | 'SPLIT_BREAK'
  | 'DAILY_REST'
  | 'WEEKLY_REST'
  | 'UNAVAILABLE'
  | 'AVAILABLE'

type ActivityResponse = {
  driver: {
    id: string
    name: string
    status: string
  }
  summary: {
    updatedAt: string | null
    reliability: 'UP_TO_DATE' | 'TO_CONFIRM' | 'INCOMPLETE' | 'STALE'
    reliabilityReasons: string[]
    currentStatus: ActivityType | null
    openActivity: boolean
    weeklyDrivingRemainingSeconds: number | null
    dailyDrivingRemainingSeconds: number | null
    nextAvailabilityAt: string | null
    warning: string | null
  }
  presentation: DriverRegulatoryPresentation
  assessment: {
    status: 'CONFORME' | 'AVERTISSEMENT' | 'BLOQUANT'
    controls: RegulatoryControl[]
    parameters: RegulatoryParameter[]
  }
  position: {
    source: 'DRIVER_GPS' | 'LAST_COMPLETED_MISSION' | 'OPERATING_BASE' | 'UNKNOWN'
    sourceLabel: string
    observedAt: string | null
    freshnessSeconds: number | null
    confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'
    usable: boolean
    planningEffect: string
    latestGps: {
      latitude: number
      longitude: number
      recordedAt: string
      accuracy: number | null
      freshnessSeconds: number
      fresh: boolean
    } | null
  }
  initialState: React.ComponentProps<
    typeof DriverInitialStateForm
  >['initialState']
  events: Array<{
    id: string
    type: ActivityType
    effectiveAt: string
    recordedAt: string
    source: string
    note: string | null
    mission: { id: string; reference: string } | null
    retrospective: boolean
    isVoided: boolean
    correctionReason: string | null
    author: { name: string | null; username: string | null } | null
  }>
}

const activityLabels: Record<ActivityType, string> = {
  DRIVE_START: 'Début de conduite',
  DRIVE_END: 'Fin de conduite',
  OTHER_WORK: 'Autre travail',
  BREAK: 'Pause',
  SPLIT_BREAK: 'Coupure',
  DAILY_REST: 'Repos journalier',
  WEEKLY_REST: 'Repos hebdomadaire',
  UNAVAILABLE: 'Indisponible',
  AVAILABLE: 'Disponible',
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return 'À vérifier'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours} h ${String(minutes).padStart(2, '0')}`
}

function toLocalInput(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000
  return new Date(value.getTime() - offset).toISOString().slice(0, 16)
}

function formatFreshness(seconds: number) {
  if (seconds < 60) return 'À l’instant'
  if (seconds < 3600) return `Il y a ${Math.floor(seconds / 60)} min`
  if (seconds < 86400) return `Il y a ${Math.floor(seconds / 3600)} h`
  return `Il y a ${Math.floor(seconds / 86400)} j`
}

export function DriverRegulatorySummary({
  driverId,
  canCorrect,
}: {
  driverId: string
  canCorrect: boolean
}) {
  const [data, setData] = useState<ActivityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showTimeline, setShowTimeline] = useState(false)
  const [showCorrection, setShowCorrection] = useState(false)
  const [type, setType] = useState<ActivityType>('AVAILABLE')
  const [effectiveAt, setEffectiveAt] = useState(() =>
    toLocalInput(new Date())
  )
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [appendActivity, setAppendActivity] = useState(false)
  const [showInitialState, setShowInitialState] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(
        `/api/dispatch/drivers/${encodeURIComponent(driverId)}/activity`
      )
      const payload = (await response.json()) as
        | ActivityResponse
        | { error?: string }
      if (!response.ok || !('summary' in payload)) {
        throw new Error(
          'error' in payload && payload.error
            ? payload.error
            : 'État réglementaire indisponible.'
        )
      }
      setData(payload)
      setError(null)
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'État réglementaire indisponible.'
      )
    } finally {
      setLoading(false)
    }
  }, [driverId])

  useEffect(() => {
    void load()
  }, [load])

  async function saveCorrection() {
    if (reason.trim().length < 5) {
      setError('Ajoutez une justification vérifiée.')
      return
    }
    setSaving(true)
    try {
      const response = await fetch(
        `/api/dispatch/drivers/${encodeURIComponent(driverId)}/activity`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type,
            effectiveAt: new Date(effectiveAt).toISOString(),
            correctionReason: reason.trim(),
            note: note.trim() || undefined,
            appendActivity,
            correctedEventId: selectedEventId,
          }),
        }
      )
      const payload = (await response.json().catch(() => null)) as {
        error?: string
      } | null
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Correction refusée.')
      }
      setShowCorrection(false)
      setReason('')
      setNote('')
      setAppendActivity(false)
      setSelectedEventId(null)
      window.dispatchEvent(new CustomEvent('driver-regulatory-changed'))
      await load()
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : 'Correction refusée.'
      )
    } finally {
      setSaving(false)
    }
  }

  const summary = data?.summary
  const presentation = data?.presentation
  const control = (key: RegulatoryControl['key']) =>
    data?.assessment.controls.find((item) => item.key === key)

  function startRecommendedAction() {
    if (!presentation?.action.activityType) return
    setType(presentation.action.activityType as ActivityType)
    setEffectiveAt(toLocalInput(new Date()))
    setReason(`Action réglementaire : ${presentation.action.label}`)
    setNote('')
    setAppendActivity(true)
    setSelectedEventId(null)
    setShowCorrection(true)
  }

  function startControlAction(control: RegulatoryControl) {
    if (control.action.kind === 'OPEN_INITIAL_STATE') {
      setShowInitialState(true)
      return
    }
    if (!control.action.activityType) return
    setType(control.action.activityType as ActivityType)
    setEffectiveAt(toLocalInput(new Date()))
    setReason(`Action réglementaire : ${control.action.label}`)
    setNote('')
    setAppendActivity(true)
    setSelectedEventId(null)
    setShowCorrection(true)
  }

  async function voidActivity(eventId: string) {
    if (!window.confirm('Supprimer cette activité erronée du calcul ?')) return
    const justification = window.prompt(
      'Justification vérifiée de la suppression :'
    )?.trim()
    if (!justification || justification.length < 5) {
      setError('Une justification vérifiée est requise.')
      return
    }
    setSaving(true)
    try {
      const response = await fetch(
        `/api/dispatch/drivers/${encodeURIComponent(driverId)}/activity`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'AVAILABLE',
            effectiveAt: new Date().toISOString(),
            correctionReason: justification,
            correctedEventId: eventId,
            voidEvent: true,
          }),
        }
      )
      const payload = (await response.json().catch(() => null)) as {
        error?: string
      } | null
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Suppression refusée.')
      }
      window.dispatchEvent(new CustomEvent('driver-regulatory-changed'))
      await load()
    } catch (voidError) {
      setError(
        voidError instanceof Error ? voidError.message : 'Suppression refusée.'
      )
    } finally {
      setSaving(false)
    }
  }
  return (
    <section
      id={`driver-regulatory-${driverId}`}
      className="rounded-[24px] bg-[#F7F8F4] p-3 sm:p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
            Disponibilité et temps de conduite
          </p>
          <p className="mt-1 text-xs font-semibold text-[#7b8075]">
            Calcul serveur à partir des déclarations et missions connues.
          </p>
        </div>
        {data?.assessment ? (
          <span
            className={[
              'shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black',
              data.assessment.status === 'CONFORME'
                ? 'bg-lime-100 text-lime-950'
                : data.assessment.status === 'AVERTISSEMENT'
                  ? 'bg-amber-100 text-amber-900'
                  : 'bg-red-50 text-red-800',
            ].join(' ')}
          >
            {data.assessment.status === 'CONFORME'
              ? 'Conforme'
              : data.assessment.status === 'AVERTISSEMENT'
                ? 'Avertissement'
                : 'Bloquant'}
          </span>
        ) : null}
      </div>

      {loading ? (
        <p className="mt-4 text-xs font-semibold text-[#7b8075]">
          Calcul en cours…
        </p>
      ) : summary ? (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <QuickValue
              label="Disponibilité opérationnelle"
              value={
                data?.driver.status === 'ACTIVE'
                  ? 'Disponible'
                  : 'Indisponible'
              }
              detail={
                control('AVAILABILITY')?.planningEffect ??
                'Statut opérationnel actuel'
              }
            />
            <QuickValue
              label="Dernière activité"
              value={
                summary.currentStatus
                  ? activityBusinessLabels[summary.currentStatus] ??
                    activityLabels[summary.currentStatus]
                  : 'Aucune activité connue'
              }
              detail={
                summary.openActivity
                  ? 'Activité ouverte · action requise'
                  : summary.updatedAt
                    ? new Date(summary.updatedAt).toLocaleString('fr-FR')
                    : 'Aucun horodatage'
              }
            />
            <QuickValue
              label="Dernière position GPS"
              value={
                data?.position.latestGps
                  ? data.position.latestGps.fresh
                    ? 'Position récente'
                    : 'Position trop ancienne'
                  : 'Aucun partage GPS'
              }
              detail={
                data?.position.latestGps
                  ? `${data.position.latestGps.latitude.toFixed(5)}, ${data.position.latestGps.longitude.toFixed(5)} · ${formatFreshness(data.position.latestGps.freshnessSeconds)} · précision ${
                      data.position.latestGps.accuracy === null
                        ? 'inconnue'
                        : `± ${Math.round(data.position.latestGps.accuracy)} m`
                    }`
                  : data?.position.planningEffect ?? 'Position inconnue'
              }
            />
            <QuickValue
              label="Conduite disponible aujourd’hui"
              value={control('DRIVING_AVAILABLE')?.value ?? 'Inconnue'}
              detail={control('DRIVING_AVAILABLE')?.source ?? 'Aucune source'}
            />
            <QuickValue
              label="Repos journalier"
              value={control('DAILY_REST')?.value ?? 'Inconnu'}
              detail={control('DAILY_REST')?.planningEffect ?? 'À confirmer'}
            />
            <QuickValue
              label="Limite hebdomadaire"
              value={control('WEEKLY_LIMIT')?.value ?? 'Inconnue'}
              detail={control('WEEKLY_LIMIT')?.source ?? 'Aucune source'}
            />
            <QuickValue
              label="Position utilisée par le moteur"
              value={data?.position.sourceLabel ?? 'Position inconnue'}
              detail={data?.position.planningEffect ?? 'Estimation conditionnelle'}
            />
          </div>
          <button
            type="button"
            onClick={() => setShowDetails((visible) => !visible)}
            className="mt-3 w-full rounded-xl bg-white px-3 py-2 text-[10px] font-bold text-[#4f5549] shadow-sm"
            style={{ border: 0 }}
          >
            {showDetails
              ? 'Masquer les détails réglementaires'
              : 'Voir les détails réglementaires'}
          </button>
          <div className="mt-3 space-y-2">
            {data?.assessment.controls.map((control) => (
              <div
                key={control.key}
                className={[
                  'rounded-2xl bg-white px-3 py-3',
                  control.status === 'BLOQUANT'
                    ? 'ring-1 ring-red-200'
                    : control.status === 'AVERTISSEMENT'
                      ? 'ring-1 ring-amber-200'
                      : '',
                ].join(' ')}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-black text-[#252921]">
                      {control.label}
                    </p>
                    <p className="mt-0.5 text-[10px] font-semibold text-[#596055]">
                      {control.value}
                    </p>
                  </div>
                  <span
                    className={[
                      'shrink-0 rounded-full px-2 py-1 text-[9px] font-black',
                      control.status === 'CONFORME'
                        ? 'bg-lime-100 text-lime-950'
                        : control.status === 'AVERTISSEMENT'
                          ? 'bg-amber-100 text-amber-900'
                          : 'bg-red-100 text-red-800',
                    ].join(' ')}
                  >
                    {control.status === 'CONFORME'
                      ? 'Conforme'
                      : control.status === 'AVERTISSEMENT'
                        ? 'Avertissement'
                        : 'Bloquant'}
                  </span>
                </div>
                <p className="mt-2 text-[10px] leading-4 text-[#6b7167]">
                  {control.explanation}
                </p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[9px] text-[#858b80]">
                  <span>
                    {control.period} · Source : {control.source}
                  </span>
                  {canCorrect && control.action.kind !== 'NONE' ? (
                    <button
                      type="button"
                      onClick={() => startControlAction(control)}
                      className="rounded-lg bg-[#11130f] px-2.5 py-1.5 font-bold text-white"
                      style={{ border: 0 }}
                    >
                      {control.action.label}
                    </button>
                  ) : null}
                </div>
                <p className="mt-1 text-[9px] font-semibold text-[#555c51]">
                  Planification : {control.planningEffect}
                </p>
              </div>
            ))}
          </div>
          {showDetails ? (
            <>
          {showInitialState && data ? (
            <DriverInitialStateForm
              driverId={driverId}
              initialState={data.initialState}
              operationallyUnavailable={data.driver.status !== 'ACTIVE'}
              onCancel={() => setShowInitialState(false)}
              onSaved={async () => {
                setShowInitialState(false)
                await load()
              }}
            />
          ) : null}
          <button
            type="button"
            onClick={() => setShowRules((visible) => !visible)}
            className="mt-3 rounded-xl bg-white px-3 py-2 text-[10px] font-bold text-[#4f5549] shadow-sm"
            style={{ border: 0 }}
          >
            {showRules ? 'Masquer les règles appliquées' : 'Voir les règles appliquées'}
          </button>
          {showRules ? (
            <div className="mt-2 space-y-2 rounded-2xl bg-white p-3">
              {data?.assessment.parameters.map((parameter) => (
                <div key={parameter.key} className="border-b border-black/[0.05] pb-2 last:border-0 last:pb-0">
                  <div className="flex justify-between gap-3">
                    <p className="text-[10px] font-bold text-[#30352d]">
                      {parameter.label}
                    </p>
                    <p className="text-right text-[10px] font-black text-[#11130f]">
                      {parameter.value}
                    </p>
                  </div>
                  <p className="mt-1 text-[9px] text-[#777d72]">
                    Source : {parameter.source} · {parameter.planningEffect}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
            </>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {data?.position.usable ? (
              <a
                href="/dispatch?view=map"
                className="rounded-xl bg-white px-3 py-2 text-[10px] font-bold text-[#4f5549] shadow-sm"
                title="Ouvre la carte sans modifier la position utilisée par le moteur"
              >
                Voir sur la carte
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => setShowTimeline((visible) => !visible)}
              className="rounded-xl bg-white px-3 py-2 text-[10px] font-bold text-[#4f5549] shadow-sm"
              style={{ border: 0 }}
            >
              {showTimeline ? 'Masquer l’activité' : 'Voir l’activité de la semaine'}
            </button>
            {canCorrect ? (
              presentation?.action.activityType ? (
                <button
                  type="button"
                  onClick={startRecommendedAction}
                  className="rounded-xl bg-[#B9FF4A] px-3 py-2 text-[10px] font-bold text-[#11130f]"
                  style={{ border: 0 }}
                >
                  {presentation.action.label}
                </button>
              ) : null
            ) : null}
            {canCorrect ? (
              <button
                type="button"
                onClick={() => {
                  setAppendActivity(false)
                  setSelectedEventId(null)
                  setShowCorrection((visible) => !visible)
                }}
                className="rounded-xl bg-[#11130f] px-3 py-2 text-[10px] font-bold text-white"
                style={{ border: 0 }}
              >
                Ajouter une correction vérifiée
              </button>
            ) : null}
          </div>
          {showTimeline ? (
            <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
              {data?.events.length ? (
                [...data.events]
                  .sort(
                    (left, right) =>
                      new Date(left.effectiveAt).getTime() -
                      new Date(right.effectiveAt).getTime()
                  )
                  .map((event) => (
                  <div
                    key={event.id}
                    className={[
                      'rounded-2xl bg-white px-3 py-2',
                      event.isVoided ? 'opacity-55' : '',
                    ].join(' ')}
                  >
                    <div className="flex justify-between gap-2">
                      <p className="text-[11px] font-bold text-[#22251f]">
                        {event.isVoided
                          ? 'Activité supprimée'
                          : activityBusinessLabels[event.type] ??
                            activityLabels[event.type]}
                      </p>
                      <p className="text-[9px] font-semibold text-[#8a9085]">
                        {new Date(event.effectiveAt).toLocaleString('fr-FR')}
                      </p>
                    </div>
                    <p className="mt-1 text-[9px] text-[#7b8075]">
                      {activitySourceLabels[event.source] ??
                        'Origine non précisée'}
                      {event.mission ? ` · ${event.mission.reference}` : ''}
                      {event.retrospective ? ' · Rétrospectif' : ''}
                      {event.correctionReason
                        ? ` · Correction : ${event.correctionReason}`
                        : ''}
                    </p>
                    {canCorrect && !event.isVoided ? (
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedEventId(event.id)
                            setType(event.type)
                            setEffectiveAt(
                              toLocalInput(new Date(event.effectiveAt))
                            )
                            setReason('')
                            setNote(event.note ?? '')
                            setAppendActivity(false)
                            setShowCorrection(true)
                          }}
                          className="rounded-lg bg-black/[0.06] px-2 py-1 text-[9px] font-bold"
                          style={{ border: 0 }}
                        >
                          Corriger
                        </button>
                        <button
                          type="button"
                          onClick={() => void voidActivity(event.id)}
                          className="rounded-lg bg-red-50 px-2 py-1 text-[9px] font-bold text-red-700"
                          style={{ border: 0 }}
                        >
                          Supprimer
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="text-[11px] text-[#7b8075]">
                  Aucune activité déclarée cette semaine.
                </p>
              )}
            </div>
          ) : null}
          {showCorrection ? (
            <div className="mt-3 grid gap-2 rounded-2xl bg-white p-3">
              <select
                value={type}
                onChange={(event) => setType(event.target.value as ActivityType)}
                className="h-10 rounded-xl border border-black/10 bg-white px-3 text-xs font-semibold"
              >
                {(Object.keys(activityLabels) as ActivityType[]).map((item) => (
                  <option key={item} value={item}>
                    {activityLabels[item]}
                  </option>
                ))}
              </select>
              <input
                type="datetime-local"
                value={effectiveAt}
                onChange={(event) => setEffectiveAt(event.target.value)}
                className="h-10 rounded-xl border border-black/10 px-3 text-xs"
              />
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Justification vérifiée (obligatoire)"
                className="h-10 rounded-xl border border-black/10 px-3 text-xs"
              />
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Note complémentaire"
                className="h-10 rounded-xl border border-black/10 px-3 text-xs"
              />
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveCorrection()}
                className="h-10 rounded-xl bg-[#B9FF4A] text-xs font-black text-[#11130f] disabled:opacity-50"
                style={{ border: 0 }}
              >
                {saving ? 'Enregistrement…' : 'Enregistrer la correction'}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      {error ? (
        <p className="mt-3 text-[11px] font-semibold text-red-700">{error}</p>
      ) : null}
    </section>
  )
}

function QuickValue({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="rounded-2xl bg-white px-3 py-3">
      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#858b80]">
        {label}
      </p>
      <p className="mt-1 text-[11px] font-black text-[#252921]">{value}</p>
      <p className="mt-1 text-[9px] leading-4 text-[#6b7167]">{detail}</p>
    </div>
  )
}

function Metric({
  label,
  value,
  primary = false,
}: {
  label: string
  value: string
  primary?: boolean
}) {
  return (
    <div className={primary ? 'rounded-2xl bg-[#11130f] p-3 text-white' : 'rounded-2xl bg-white p-3'}>
      <p className={primary ? 'text-[9px] font-black uppercase tracking-[0.12em] text-white/55' : 'text-[9px] font-black uppercase tracking-[0.12em] text-[#9aa090]'}>
        {label}
      </p>
      <p className="mt-1 text-sm font-black">{value}</p>
    </div>
  )
}
