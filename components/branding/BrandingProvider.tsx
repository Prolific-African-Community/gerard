import Head from 'next/head'
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

// The tab title and icon are rendered through next/head, so the served HTML already carries the tenant's
// branding and React keeps owning the element. Mutating a Head-managed <link> imperatively does not work:
// Next re-renders it and the document falls back to whatever the page declared.
function BrandingDocument({ branding }: { branding: OrganizationBranding }) {
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--brand-accent', branding.accentColor)
    root.style.setProperty('--brand-accent-hover', `color-mix(in srgb, ${branding.accentColor} 82%, black)`)
    root.style.setProperty('--brand-accent-soft', `color-mix(in srgb, ${branding.accentColor} 18%, white)`)
  }, [branding])
  return (
    <Head>
      <title>{branding.applicationTitle}</title>
      <link rel="icon" href={branding.faviconUrl} />
      <link rel="apple-touch-icon" href={branding.faviconUrl} />
    </Head>
  )
}

export function useBranding() { return useContext(BrandingContext) }
