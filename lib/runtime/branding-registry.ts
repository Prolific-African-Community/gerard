import type { OrganizationBranding } from '../tenant/branding'
import { DEFAULT_BRANDING } from '../tenant/branding'
import { novotraluxBranding } from '../../apps/novotralux/branding'

const brandingByApplication: Readonly<Record<string, OrganizationBranding>> = Object.freeze({
  'gerard-standard': DEFAULT_BRANDING,
  novotralux: novotraluxBranding,
})

export function resolveRuntimeBranding(id = process.env.NEXT_PUBLIC_GERARD_APPLICATION || 'gerard-standard') {
  return brandingByApplication[id] ?? DEFAULT_BRANDING
}

export const activeRuntimeBranding = resolveRuntimeBranding()
