export const platformConfigurationActions = [
  'updateIdentity',
  'updateBranding',
  'updateModules',
  'updateIntegrationConfig',
  'updateIntegrationEnabled',
] as const

export type PlatformConfigurationAction = (typeof platformConfigurationActions)[number]

export type PlatformConfigurationRequest = {
  version: 1
  application: string
  organizationId: string
  action: PlatformConfigurationAction
  payload: Record<string, unknown>
  timestamp: number
  nonce: string
}

export function isPlatformConfigurationAction(value: unknown): value is PlatformConfigurationAction {
  return typeof value === 'string' && (platformConfigurationActions as readonly string[]).includes(value)
}
