'use client'

import { useMemo, useState } from 'react'

export type DriverInitialState = {
  id: string
  referenceAt: string
  validUntil: string | null
  source: string
  timeZone: string
  dailyDrivingSeconds: number
  weeklyDrivingSeconds: number
  previousWeekDrivingSeconds: number
  dailyExtensionsUsedThisWeek: number
  lastValidRestEndedAt: string
  notes: string | null
}

function localInput(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function hours(seconds: number) {
  return String(Math.round((seconds / 3600) * 100) / 100)
}

function seconds(value: string) {
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round(parsed * 3600)
    : null
}

export function DriverInitialStateForm({
  driverId,
  initialState,
  operationallyUnavailable,
  onSaved,
  onCancel,
}: {
  driverId: string
  initialState: DriverInitialState | null
  operationallyUnavailable: boolean
  onSaved: () => Promise<void>
  onCancel: () => void
}) {
  const now = useMemo(() => new Date(), [])
  const [form, setForm] = useState(() => ({
    referenceAt: localInput(initialState?.referenceAt ?? now),
    validUntil: initialState?.validUntil
      ? localInput(initialState.validUntil)
      : '',
    lastValidRestEndedAt: initialState
      ? localInput(initialState.lastValidRestEndedAt)
      : '',
    dailyDrivingHours: initialState
      ? hours(initialState.dailyDrivingSeconds)
      : '',
    weeklyDrivingHours: initialState
      ? hours(initialState.weeklyDrivingSeconds)
      : '',
    fortnightDrivingHours: initialState
      ? hours(
          initialState.weeklyDrivingSeconds +
            initialState.previousWeekDrivingSeconds
        )
      : '',
    dailyExtensionsUsedThisWeek:
      initialState?.dailyExtensionsUsedThisWeek.toString() ?? '',
    operationallyUnavailable,
    notes: initialState?.notes ?? '',
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function update(key: keyof typeof form, value: string | boolean) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function save() {
    const referenceAt = new Date(form.referenceAt)
    const validUntil = form.validUntil ? new Date(form.validUntil) : null
    const lastValidRestEndedAt = new Date(form.lastValidRestEndedAt)
    const dailyDrivingSeconds = seconds(form.dailyDrivingHours)
    const weeklyDrivingSeconds = seconds(form.weeklyDrivingHours)
    const fortnightDrivingSeconds = seconds(form.fortnightDrivingHours)
    const extensions = Number(form.dailyExtensionsUsedThisWeek)
    if (
      [referenceAt, lastValidRestEndedAt].some((date) =>
        Number.isNaN(date.getTime())
      ) ||
      (validUntil !== null &&
        (Number.isNaN(validUntil.getTime()) || validUntil <= referenceAt)) ||
      dailyDrivingSeconds === null ||
      weeklyDrivingSeconds === null ||
      fortnightDrivingSeconds === null ||
      fortnightDrivingSeconds < weeklyDrivingSeconds ||
      !Number.isInteger(extensions) ||
      extensions < 0
    ) {
      setError(
        'Renseignez les cinq valeurs obligatoires avec une période cohérente.'
      )
      return
    }
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(
        '/api/dispatch/auto-planning/regulatory-state',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            driverId,
            referenceAt: referenceAt.toISOString(),
            validUntil: validUntil?.toISOString() ?? null,
            lastValidRestEndedAt: lastValidRestEndedAt.toISOString(),
            dailyDrivingSeconds,
            weeklyDrivingSeconds,
            fortnightDrivingSeconds,
            dailyExtensionsUsedThisWeek: extensions,
            operationallyUnavailable: form.operationallyUnavailable,
            notes: form.notes.trim() || null,
          }),
        }
      )
      const payload = (await response.json().catch(() => null)) as {
        error?: string
      } | null
      if (!response.ok) {
        throw new Error(
          payload?.error ?? 'Impossible d’enregistrer l’état initial.'
        )
      }
      window.dispatchEvent(new CustomEvent('driver-regulatory-changed'))
      await onSaved()
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Impossible d’enregistrer l’état initial.'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 rounded-2xl bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black text-[#11130f]">
            État initial simplifié
          </p>
          <p className="mt-1 text-[10px] leading-4 text-[#6b7167]">
            Déclarez uniquement les informations connues. Les autres compteurs
            restent inconnus et produisent un avertissement, jamais une
            infraction inventée.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Fermer le formulaire"
          className="h-8 w-8 rounded-xl bg-black/[0.05] text-sm"
          style={{ border: 0 }}
        >
          ×
        </button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Date et heure de référence">
          <input
            type="datetime-local"
            value={form.referenceAt}
            onChange={(event) => update('referenceAt', event.target.value)}
            className="h-10 w-full rounded-xl border border-black/10 px-3 text-xs"
          />
        </Field>
        <Field label="Valable jusqu’au (facultatif)">
          <input
            type="datetime-local"
            value={form.validUntil}
            onChange={(event) => update('validUntil', event.target.value)}
            className="h-10 w-full rounded-xl border border-black/10 px-3 text-xs"
          />
        </Field>
        <Field label="Fuseau horaire">
          <input
            value={initialState?.timeZone ?? 'Europe/Luxembourg'}
            readOnly
            className="h-10 w-full rounded-xl border border-black/10 bg-black/[0.03] px-3 text-xs"
          />
        </Field>
        <Field label="Dernière fin de repos connue">
          <input
            type="datetime-local"
            value={form.lastValidRestEndedAt}
            onChange={(event) =>
              update('lastValidRestEndedAt', event.target.value)
            }
            className="h-10 w-full rounded-xl border border-black/10 px-3 text-xs"
          />
        </Field>
        <NumberField
          label="Conduite effectuée aujourd’hui (h)"
          value={form.dailyDrivingHours}
          onChange={(value) => update('dailyDrivingHours', value)}
        />
        <NumberField
          label="Conduite effectuée cette semaine (h)"
          value={form.weeklyDrivingHours}
          onChange={(value) => update('weeklyDrivingHours', value)}
        />
        <NumberField
          label="Conduite cumulée sur deux semaines (h)"
          value={form.fortnightDrivingHours}
          onChange={(value) => update('fortnightDrivingHours', value)}
        />
        <NumberField
          label="Extensions à 10 h déjà utilisées"
          value={form.dailyExtensionsUsedThisWeek}
          step="1"
          onChange={(value) =>
            update('dailyExtensionsUsedThisWeek', value)
          }
        />
      </div>
      <label className="mt-3 flex items-center gap-3 rounded-xl bg-black/[0.03] px-3 py-3 text-[10px] font-bold text-[#5f655b]">
        <input
          type="checkbox"
          checked={form.operationallyUnavailable}
          onChange={(event) =>
            update('operationallyUnavailable', event.target.checked)
          }
        />
        Indisponibilité opérationnelle connue
      </label>
      <Field label="Note et provenance">
        <textarea
          value={form.notes}
          onChange={(event) => update('notes', event.target.value)}
          rows={2}
          className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-xs"
          placeholder="Carte conducteur, relevé, déclaration du chauffeur…"
        />
      </Field>
      {error ? (
        <p className="mt-3 text-[11px] font-semibold text-red-700">{error}</p>
      ) : null}
      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="mt-4 h-10 w-full rounded-xl bg-[#B9FF4A] text-xs font-black text-[#11130f] disabled:opacity-50"
        style={{ border: 0 }}
      >
        {saving ? 'Enregistrement…' : 'Enregistrer l’état initial'}
      </button>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="text-[10px] font-bold text-[#5f655b]">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  )
}

function NumberField({
  label,
  value,
  onChange,
  step = '0.25',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  step?: string
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        min="0"
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-xl border border-black/10 px-3 text-xs"
      />
    </Field>
  )
}
