export type OrganizationBranding = {
  displayName: string
  logoUrl: string
  accentColor: string
  faviconUrl: string
  applicationTitle: string
}

export const DEFAULT_BRANDING: OrganizationBranding = Object.freeze({
  displayName: 'Gerard',
  logoUrl: '/logo_gerard_texte.png',
  accentColor: '#C8FF00',
  faviconUrl: '/favicon.ico',
  applicationTitle: 'Gerard Dispatch',
})

type BrandingSource = Partial<Record<keyof OrganizationBranding, string | null>>

export function resolveBranding(source?: BrandingSource | null): OrganizationBranding {
  return {
    displayName: source?.displayName?.trim() || DEFAULT_BRANDING.displayName,
    logoUrl: source?.logoUrl?.trim() || DEFAULT_BRANDING.logoUrl,
    accentColor: normalizeAccentColor(source?.accentColor) || DEFAULT_BRANDING.accentColor,
    faviconUrl: source?.faviconUrl?.trim() || DEFAULT_BRANDING.faviconUrl,
    applicationTitle: source?.applicationTitle?.trim() || source?.displayName?.trim() || DEFAULT_BRANDING.applicationTitle,
  }
}

export function normalizeAccentColor(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : null
}

export function normalizeBrandAssetUrl(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (normalized.startsWith('/') && !normalized.startsWith('//')) return normalized
  try {
    const url = new URL(normalized)
    return url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}
