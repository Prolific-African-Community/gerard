import { createContext, useContext, useEffect, useState } from 'react'

import { DEFAULT_BRANDING, type OrganizationBranding } from '../../lib/tenant/branding'

const BrandingContext = createContext<OrganizationBranding>(DEFAULT_BRANDING)

export function BrandingProvider({ children, fallbackBranding = DEFAULT_BRANDING }: { children: React.ReactNode, fallbackBranding?: OrganizationBranding }) {
  const [branding, setBranding] = useState<OrganizationBranding>(fallbackBranding)
  useEffect(() => {
    let active = true
    fetch('/api/tenant/branding').then(async (response) => response.ok ? response.json() : null).then((body) => {
      if (active && body?.branding) setBranding(body.branding)
    }).catch(() => undefined)
    return () => { active = false }
  }, [])
  return <BrandingContext.Provider value={branding}><BrandingDocument branding={branding} />{children}</BrandingContext.Provider>
}

function BrandingDocument({ branding }: { branding: OrganizationBranding }) {
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--brand-accent', branding.accentColor)
    root.style.setProperty('--brand-accent-hover', `color-mix(in srgb, ${branding.accentColor} 82%, black)`)
    root.style.setProperty('--brand-accent-soft', `color-mix(in srgb, ${branding.accentColor} 18%, white)`)
    document.title = branding.applicationTitle
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (icon) icon.href = branding.faviconUrl
  }, [branding])
  return null
}

export function useBranding() { return useContext(BrandingContext) }
