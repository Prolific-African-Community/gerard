// Shared rules for organization brand assets (logo, favicon). Used by the upload route and its tests, so the
// validation lives in one place and no client name is ever involved.

export const BRAND_ASSET_MAX_BYTES = 3 * 1024 * 1024

// Raster formats plus SVG, which is common for logos. Keyed by MIME type so the check never trusts the filename.
export const BRAND_ASSET_MIME_EXTENSIONS: Readonly<Record<string, string>> = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
})

export const brandAssetAcceptAttribute = 'image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon'

export type BrandAssetKind = 'logo' | 'favicon'

export function isBrandAssetKind(value: unknown): value is BrandAssetKind {
  return value === 'logo' || value === 'favicon'
}

export function brandAssetExtension(mimeType: string | null | undefined) {
  if (!mimeType) return null
  return BRAND_ASSET_MIME_EXTENSIONS[mimeType.trim().toLowerCase()] ?? null
}

export type BrandAssetRejection = 'BRAND_ASSET_TYPE_UNSUPPORTED' | 'BRAND_ASSET_TOO_LARGE' | 'BRAND_ASSET_EMPTY'

/** Returns null when the file is acceptable, otherwise the reason code. */
export function validateBrandAsset(file: { mimetype?: string | null; size?: number | null }): BrandAssetRejection | null {
  if (!brandAssetExtension(file.mimetype)) return 'BRAND_ASSET_TYPE_UNSUPPORTED'
  const size = file.size ?? 0
  if (size <= 0) return 'BRAND_ASSET_EMPTY'
  if (size > BRAND_ASSET_MAX_BYTES) return 'BRAND_ASSET_TOO_LARGE'
  return null
}

/**
 * Storage path for an organization brand asset. The filename is generated, never taken from the upload, so a
 * hostile name cannot escape the organization prefix.
 */
export function brandAssetBlobPath(organizationId: string, kind: BrandAssetKind, mimeType: string, now = new Date()) {
  const extension = brandAssetExtension(mimeType)
  if (!extension) throw new Error('BRAND_ASSET_TYPE_UNSUPPORTED')
  // Dots are stripped as well, so no path segment can ever look like a traversal.
  const safeOrganizationId = organizationId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64)
  return `organizations/${safeOrganizationId}/branding/${kind}-${now.getTime()}.${extension}`
}
