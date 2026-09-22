import { useState } from 'react'
import { DEFAULT_BRANDING } from '../../lib/tenant/branding'
import { useBranding } from './BrandingProvider'

export function OrganizationLogo({ className = '', platform = false }: { className?: string; platform?: boolean }) {
  const branding = useBranding()
  const [failed, setFailed] = useState(false)
  const source = platform || failed ? DEFAULT_BRANDING : branding
  return <img src={source.logoUrl} alt={source.displayName} className={className} onError={() => setFailed(true)} />
}
