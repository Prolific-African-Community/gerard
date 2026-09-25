export const platformConfigurationActions = [
  'updateIdentity',
  'updateBranding',
  'updateModules',
  'updateIntegrationConfig',
  'updateIntegrationEnabled',
] as const

// Read-only actions travel over the same signed channel; the action is covered by the HMAC, so a read can never be replayed as a write.
export const platformConfigurationReadActions = ['getConfiguration'] as const

export type PlatformConfigurationAction = (typeof platformConfigurationActions)[number]
export type PlatformConfigurationReadAction = (typeof platformConfigurationReadActions)[number]
export type PlatformConfigurationCommand = PlatformConfigurationAction | PlatformConfigurationReadAction

export type PlatformConfigurationRequest = {
  version: 1
  application: string
  organizationId: string
  action: PlatformConfigurationCommand
  payload: Record<string, unknown>
  timestamp: number
  nonce: string
}

// Normalised, allow-listed configuration shared by Standard (local read) and Custom (signed read).
export type PlatformIntegrationSnapshot = {
  type: string
  enabled: boolean
  configJson: Record<string, string | number | boolean | null>
  secretConfigured: boolean
  updatedAt: string
}
export type PlatformConfigurationSnapshot = {
  organizationId: string
  status: string
  identity: { name: string; displayName: string | null; applicationTitle: string | null }
  branding: { accentColor: string | null; logoUrl: string | null; faviconUrl: string | null }
  enabledModules: string[]
  integrations: PlatformIntegrationSnapshot[]
  updatedAt: string
}

export function isPlatformConfigurationAction(value: unknown): value is PlatformConfigurationAction {
  return typeof value === 'string' && (platformConfigurationActions as readonly string[]).includes(value)
}

export function isPlatformConfigurationReadAction(value: unknown): value is PlatformConfigurationReadAction {
  return typeof value === 'string' && (platformConfigurationReadActions as readonly string[]).includes(value)
}
