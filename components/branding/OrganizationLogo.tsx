import { useEffect, useState } from 'react'
import { DEFAULT_BRANDING } from '../../lib/tenant/branding'
import { useBranding } from './BrandingProvider'

// Tenant logos are arbitrary organization-configured URLs, so a plain <img> is used (no next/image remote
// pattern allow-list to maintain) and a failed load falls back to the Gerard logo. The failure is tied to the
// current URL: when branding changes, the new logo gets its own chance instead of staying on the fallback.
export function OrganizationLogo({ className = '', platform = false }: { className?: string; platform?: boolean }) {
  const branding = useBranding()
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  useEffect(() => { setFailedUrl((current) => (current === branding.logoUrl ? current : null)) }, [branding.logoUrl])
  const source = platform || failedUrl === branding.logoUrl ? DEFAULT_BRANDING : branding
  return <img src={source.logoUrl} alt={source.displayName} className={className} onError={() => setFailedUrl(branding.logoUrl)} />
}
