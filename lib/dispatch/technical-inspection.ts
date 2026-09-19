const TECHNICAL_INSPECTION_WARNING_DAYS = 90

type TechnicalInspectionVehicle = {
  technicalInspectionDate?: Date | string | null
  technicalInspectionExpiresAt?: Date | string | null
}

export type TechnicalInspectionTone = 'neutral' | 'green' | 'orange' | 'red'

export type TechnicalInspectionState = {
  hasDate: boolean
  lastDate: Date | null
  expiresAt: Date | null
  daysRemaining: number | null
  isExpired: boolean
  isWarning: boolean
  label: string
  tone: TechnicalInspectionTone
  shouldPulse: boolean
}

export function getTechnicalInspectionExpiresAt(
  technicalInspectionDate: Date | null
) {
  if (!technicalInspectionDate) {
    return null
  }

  const expiresAt = new Date(technicalInspectionDate)
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1)
  return expiresAt
}

export function parseTechnicalInspectionDateInput(value: unknown) {
  if (typeof value === 'undefined') {
    return undefined
  }

  if (value === null || value === '') {
    return null
  }

  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return normalizeToUtcNoon(value)
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const trimmedValue = value.trim()

  if (!trimmedValue) {
    return null
  }

  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmedValue)

  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch
    const parsedDate = new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0, 0)
    )

    if (
      !Number.isFinite(parsedDate.getTime()) ||
      parsedDate.getUTCFullYear() !== Number(year) ||
      parsedDate.getUTCMonth() !== Number(month) - 1 ||
      parsedDate.getUTCDate() !== Number(day)
    ) {
      return undefined
    }

    return parsedDate
  }

  const parsedDate = new Date(trimmedValue)
  return Number.isFinite(parsedDate.getTime())
    ? normalizeToUtcNoon(parsedDate)
    : undefined
}

export function formatTechnicalInspectionDateInput(
  value?: Date | string | null
) {
  const date = toDate(value)

  if (!date) {
    return ''
  }

  return date.toISOString().slice(0, 10)
}

export function formatTechnicalInspectionDisplayDate(
  value?: Date | string | null
) {
  const date = toDate(value)

  if (!date) {
    return null
  }

  return new Intl.DateTimeFormat('fr-LU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

export function getTechnicalInspectionAlertDate(
  value?: Date | string | null
) {
  const expiresAt = toDate(value)

  if (!expiresAt) {
    return null
  }

  const alertDate = new Date(expiresAt)
  alertDate.setUTCDate(alertDate.getUTCDate() - TECHNICAL_INSPECTION_WARNING_DAYS)
  return alertDate
}

export function getTechnicalInspectionState(
  vehicle: TechnicalInspectionVehicle,
  now = new Date()
): TechnicalInspectionState {
  const lastDate = toDate(vehicle.technicalInspectionDate)
  const expiresAt =
    toDate(vehicle.technicalInspectionExpiresAt) ??
    getTechnicalInspectionExpiresAt(lastDate)

  if (!lastDate || !expiresAt) {
    return {
      hasDate: false,
      lastDate: null,
      expiresAt: null,
      daysRemaining: null,
      isExpired: false,
      isWarning: false,
      label: 'CT non renseigné',
      tone: 'neutral',
      shouldPulse: false,
    }
  }

  const today = startOfUtcDay(now)
  const expirationDay = startOfUtcDay(expiresAt)
  const daysRemaining = Math.ceil(
    (expirationDay.getTime() - today.getTime()) / 86_400_000
  )

  if (daysRemaining < 0) {
    return {
      hasDate: true,
      lastDate,
      expiresAt,
      daysRemaining,
      isExpired: true,
      isWarning: false,
      label: 'CT expiré',
      tone: 'red',
      shouldPulse: true,
    }
  }

  if (daysRemaining <= TECHNICAL_INSPECTION_WARNING_DAYS) {
    return {
      hasDate: true,
      lastDate,
      expiresAt,
      daysRemaining,
      isExpired: false,
      isWarning: true,
      label: `CT J-${daysRemaining}`,
      tone: 'orange',
      shouldPulse: true,
    }
  }

  return {
    hasDate: true,
    lastDate,
    expiresAt,
    daysRemaining,
    isExpired: false,
    isWarning: false,
    label: 'CT OK',
    tone: 'green',
    shouldPulse: false,
  }
}

export function getTechnicalInspectionBadgeClass(
  state: Pick<TechnicalInspectionState, 'tone' | 'shouldPulse'>
) {
  const pulseClass = state.shouldPulse ? ' animate-pulse' : ''

  if (state.tone === 'red') {
    return `border-red-200 bg-red-50 text-red-700${pulseClass}`
  }

  if (state.tone === 'orange') {
    return `border-amber-200 bg-amber-50 text-amber-800${pulseClass}`
  }

  if (state.tone === 'green') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }

  return 'border-black/10 bg-[#F4F5F1] text-[#6f756a]'
}

function normalizeToUtcNoon(date: Date) {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      12,
      0,
      0,
      0
    )
  )
}

function startOfUtcDay(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  )
}

function toDate(value?: Date | string | null) {
  if (!value) {
    return null
  }

  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null
  }

  const parsedDate = new Date(value)
  return Number.isFinite(parsedDate.getTime()) ? parsedDate : null
}
