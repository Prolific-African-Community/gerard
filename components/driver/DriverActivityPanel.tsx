'use client'

import { useCallback, useEffect, useState } from 'react'

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

type ActivityPayload = {
  summary: {
    currentStatus: ActivityType | null
    updatedAt: string | null
    weeklyDrivingRemainingSeconds: number | null
    reliability: 'UP_TO_DATE' | 'TO_CONFIRM' | 'INCOMPLETE' | 'STALE'
  }
  events: Array<{
    id: string
    type: ActivityType
    effectiveAt: string
  }>
}

const actions: Array<{
  type: ActivityType
  label: string
  primary?: boolean
}> = [
  { type: 'DRIVE_START', label: 'Début de conduite', primary: true },
  { type: 'DRIVE_END', label: 'Fin de conduite' },
  { type: 'OTHER_WORK', label: 'Autre travail' },
  { type: 'BREAK', label: 'Pause' },
  { type: 'SPLIT_BREAK', label: 'Coupure' },
  { type: 'DAILY_REST', label: 'Repos journalier' },
  { type: 'WEEKLY_REST', label: 'Repos hebdomadaire' },
  { type: 'UNAVAILABLE', label: 'Indisponible' },
  { type: 'AVAILABLE', label: 'Disponible' },
]

function formatRemaining(seconds: number | null) {
  if (seconds === null) return 'À vérifier'
  return `${Math.floor(seconds / 3600)} h ${String(
    Math.floor((seconds % 3600) / 60)
  ).padStart(2, '0')}`
}

export function DriverActivityPanel() {
  const [data, setData] = useState<ActivityPayload | null>(null)
  const [pending, setPending] = useState<ActivityType | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [showNote, setShowNote] = useState(false)

  const load = useCallback(async () => {
    const response = await fetch('/api/driver/activity')
    const payload = (await response.json()) as
      | ActivityPayload
      | { error?: string }
    if (!response.ok || !('summary' in payload)) {
      throw new Error(
        'error' in payload && payload.error
          ? payload.error
          : 'Activité indisponible.'
      )
    }
    setData(payload)
  }, [])

  useEffect(() => {
    void load().catch((loadError) =>
      setError(
        loadError instanceof Error ? loadError.message : 'Activité indisponible.'
      )
    )
  }, [load])

  async function declare(type: ActivityType) {
    setPending(type)
    setError(null)
    try {
      const response = await fetch('/api/driver/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          effectiveAt: new Date().toISOString(),
          note: note.trim() || undefined,
        }),
      })
      const payload = (await response.json().catch(() => null)) as {
        error?: string
      } | null
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Déclaration refusée.')
      }
      setNote('')
      setShowNote(false)
      await load()
    } catch (declareError) {
      setError(
        declareError instanceof Error
          ? declareError.message
          : 'Déclaration refusée.'
      )
    } finally {
      setPending(null)
    }
  }

  const current = actions.find(
    (action) => action.type === data?.summary.currentStatus
  )
  return (
    <section className="mt-4 rounded-[30px] border border-black/[0.04] bg-white p-4 shadow-[0_18px_50px_rgba(17,19,15,0.08)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#8a9085]">
            Mon activité
          </p>
          <p className="mt-1 text-base font-black text-[#11130f]">
            {current?.label ?? 'À confirmer'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[9px] font-black uppercase tracking-[0.12em] text-[#9aa090]">
            Reste cette semaine
          </p>
          <p className="mt-1 text-sm font-black">
            {formatRemaining(
              data?.summary.weeklyDrivingRemainingSeconds ?? null
            )}
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {actions.map((action) => (
          <button
            key={action.type}
            type="button"
            disabled={pending !== null}
            onClick={() => void declare(action.type)}
            className={[
              'min-h-14 rounded-[20px] px-3 py-3 text-left text-xs font-black transition active:scale-[0.98] disabled:opacity-50',
              action.primary
                ? 'bg-[#B9FF4A] text-[#11130f]'
                : data?.summary.currentStatus === action.type
                  ? 'bg-[#11130f] text-white'
                  : 'bg-[#F4F5F1] text-[#3f453c]',
            ].join(' ')}
            style={{ border: 0 }}
          >
            {pending === action.type ? 'Enregistrement…' : action.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setShowNote((visible) => !visible)}
        className="mt-3 text-[10px] font-black text-[#6e7468]"
        style={{ border: 0, background: 'transparent' }}
      >
        {showNote ? 'Masquer la note' : 'Ajouter une note'}
      </button>
      {showNote ? (
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={500}
          placeholder="Précision facultative"
          className="mt-2 min-h-20 w-full rounded-[18px] border border-black/10 bg-[#F4F5F1] px-3 py-2 text-xs outline-none focus:border-lime-400"
        />
      ) : null}
      {error ? (
        <p className="mt-3 rounded-2xl bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">
          {error}
        </p>
      ) : null}
      <p className="mt-3 text-[9px] font-semibold leading-relaxed text-[#9aa090]">
        Une déclaration enregistre l’heure effective et l’heure de saisie. Elle
        ne modifie jamais une mission.
      </p>
    </section>
  )
}
