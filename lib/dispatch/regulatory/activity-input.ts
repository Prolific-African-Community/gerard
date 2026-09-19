import { DriverActivityType } from '@prisma/client'

export const driverActivityTypes = Object.values(DriverActivityType)

export function validateActivityAppend(
  next: DriverActivityType,
  previous: DriverActivityType | null
) {
  if (next === DriverActivityType.DRIVE_END) {
    return previous === DriverActivityType.DRIVE_START
      ? null
      : 'Aucune conduite ouverte ne peut être terminée.'
  }
  if (next === DriverActivityType.DRIVE_START) {
    return previous === DriverActivityType.DRIVE_START
      ? 'Une conduite est déjà ouverte.'
      : null
  }
  if (next === DriverActivityType.AVAILABLE) {
    return previous === DriverActivityType.UNAVAILABLE ||
      (previous !== null &&
        previous !== DriverActivityType.AVAILABLE &&
        previous !== DriverActivityType.DRIVE_END)
      ? null
      : 'Le chauffeur est déjà disponible.'
  }
  return null
}

export type ParsedActivityInput = {
  type: DriverActivityType
  effectiveAt: Date
  note: string | null
  latitude: number | null
  longitude: number | null
  retrospective: boolean
}

export function parseActivityInput(
  value: unknown,
  now: Date,
  options: { maximumRetrospectiveHours: number }
): ParsedActivityInput | null {
  if (!value || typeof value !== 'object') return null
  const body = value as Record<string, unknown>
  if (
    typeof body.type !== 'string' ||
    !driverActivityTypes.includes(body.type as DriverActivityType)
  ) {
    return null
  }
  const effectiveAt = new Date(String(body.effectiveAt ?? now.toISOString()))
  if (
    Number.isNaN(effectiveAt.getTime()) ||
    effectiveAt.getTime() > now.getTime() + 5 * 60 * 1000 ||
    effectiveAt.getTime() <
      now.getTime() -
        options.maximumRetrospectiveHours * 60 * 60 * 1000
  ) {
    return null
  }
  const note =
    typeof body.note === 'string' && body.note.trim()
      ? body.note.trim().slice(0, 500)
      : null
  const latitude =
    typeof body.latitude === 'number' && Number.isFinite(body.latitude)
      ? body.latitude
      : null
  const longitude =
    typeof body.longitude === 'number' && Number.isFinite(body.longitude)
      ? body.longitude
      : null
  if (
    (latitude === null) !== (longitude === null) ||
    (latitude !== null && (latitude < -90 || latitude > 90)) ||
    (longitude !== null && (longitude < -180 || longitude > 180))
  ) {
    return null
  }
  return {
    type: body.type as DriverActivityType,
    effectiveAt,
    note,
    latitude,
    longitude,
    retrospective: now.getTime() - effectiveAt.getTime() > 5 * 60 * 1000,
  }
}
