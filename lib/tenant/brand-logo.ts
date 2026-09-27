import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { DEFAULT_BRANDING } from './branding'

export type BrandLogo = { bytes: Buffer; source: 'organization' | 'default' }

/**
 * Loads the bytes of a brand asset for server-side rendering (invoice PDFs). A repository-relative URL is read
 * from public/, an https URL is fetched. Returns null when the asset cannot be loaded, so the caller can fall
 * back instead of failing the document.
 */
export async function loadBrandAssetBytes(url: string | null | undefined, fetchImpl: typeof fetch = fetch): Promise<Buffer | null> {
  const value = url?.trim()
  if (!value) return null
  try {
    if (value.startsWith('/') && !value.startsWith('//')) {
      // Only files this repository serves; the leading slash is stripped and the result must stay under public/.
      const publicRoot = path.join(process.cwd(), 'public')
      const target = path.resolve(publicRoot, value.replace(/^\/+/, ''))
      if (target !== publicRoot && !target.startsWith(publicRoot + path.sep)) return null
      return await readFile(target)
    }
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:') return null
    const response = await fetchImpl(parsed.toString(), { signal: AbortSignal.timeout(5000) })
    if (!response.ok) return null
    return Buffer.from(await response.arrayBuffer())
  } catch {
    return null
  }
}

/**
 * The logo used on a document for an organization: its own configured logo, and the Gerard default only when
 * the organization has none or its asset cannot be loaded. No client name is involved.
 */
export async function resolveOrganizationLogo(logoUrl: string | null | undefined, fetchImpl: typeof fetch = fetch): Promise<BrandLogo | null> {
  const organizationLogo = await loadBrandAssetBytes(logoUrl, fetchImpl)
  if (organizationLogo) return { bytes: organizationLogo, source: 'organization' }
  const fallback = await loadBrandAssetBytes(DEFAULT_BRANDING.logoUrl, fetchImpl)
  return fallback ? { bytes: fallback, source: 'default' } : null
}
