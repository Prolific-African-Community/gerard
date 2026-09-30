export type OperatingBasePosition = {
  latitude: number
  longitude: number
  label?: string
}

/**
 * Demo-only display fixture. Business calculations must never use this value
 * unless it is passed explicitly by a demo fixture.
 */
export const DEFAULT_OPERATING_BASE = {
  latitude: 49.679703,
  longitude: 4.848586,
  label: 'Base d’exploitation · Sedan',
} as const

function validCoordinate(latitude: number, longitude: number) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  )
}

export function configuredOperatingBase(): OperatingBasePosition | null {
  const rawLatitude = process.env.DISPATCH_BASE_LATITUDE?.trim()
  const rawLongitude = process.env.DISPATCH_BASE_LONGITUDE?.trim()
  if (!rawLatitude || !rawLongitude) return null

  const latitude = Number(rawLatitude)
  const longitude = Number(rawLongitude)
  if (!validCoordinate(latitude, longitude)) return null
  return { latitude, longitude, label: 'Base d’exploitation' }
}

/**
 * Demo-only browser fallback retained for the current map presentation.
 * Server routing and planning use configuredOperatingBase() and therefore do
 * not treat Sedan as an organization base.
 */
export const GERARD_BASE = {
  name: DEFAULT_OPERATING_BASE.label,
  address: 'Sedan, France',
  lat: DEFAULT_OPERATING_BASE.latitude,
  lng: DEFAULT_OPERATING_BASE.longitude,
}
