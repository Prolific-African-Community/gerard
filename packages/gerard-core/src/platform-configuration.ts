export const platformConfigurationActions = [
  'updateIdentity',
  'updateBranding',
  'updateModules',
  'updateIntegrationConfig',
  'updateIntegrationEnabled',
] as const

// Read-only actions travel over the same signed channel; the action is covered by the HMAC, so a read can never be replayed as a write.
export const platformConfigurationReadActions = ['getConfiguration', 'getOrgAdmins'] as const

// Emergency recovery of an organization's ORG_ADMIN accounts only; never general member management.
export const platformRecoveryActions = ['resetOrgAdminPassword', 'invalidateOrgAdminSessions', 'reactivateOrgAdmin'] as const

export type PlatformConfigurationAction = (typeof platformConfigurationActions)[number]
export type PlatformConfigurationReadAction = (typeof platformConfigurationReadActions)[number]
export type PlatformRecoveryAction = (typeof platformRecoveryActions)[number]
export type PlatformConfigurationCommand = PlatformConfigurationAction | PlatformConfigurationReadAction | PlatformRecoveryAction

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

// Safe view of an ORG_ADMIN account for recovery; `protection` names why the platform may not act on it.
export type PlatformOrgAdminSnapshot = {
  userId: string
  firstName: string
  lastName: string
  username: string
  email: string | null
  role: 'ORG_ADMIN'
  isActive: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
  protection: 'PLATFORM_ACCOUNT' | 'SHARED_ACCOUNT' | null
}

export function isPlatformRecoveryAction(value: unknown): value is PlatformRecoveryAction {
  return typeof value === 'string' && (platformRecoveryActions as readonly string[]).includes(value)
}

export function isPlatformConfigurationReadAction(value: unknown): value is PlatformConfigurationReadAction {
  return typeof value === 'string' && (platformConfigurationReadActions as readonly string[]).includes(value)
}

// The single parser for Platform-to-Custom commands, used by both the Platform route and the Custom endpoint, so an
// action added here is accepted by both sides at once. Reads carry no payload; recovery carries exactly `{ userId }`;
// writes carry an object whose fields the instance validates.
export type ParsedPlatformCommand =
  | { ok: true; kind: 'read'; action: PlatformConfigurationReadAction; payload: Record<string, never> }
  | { ok: true; kind: 'recovery'; action: PlatformRecoveryAction; payload: { userId: string } }
  | { ok: true; kind: 'write'; action: PlatformConfigurationAction; payload: Record<string, unknown> }
  | { ok: false; error: 'UNSUPPORTED_CONFIGURATION_ACTION' | 'INVALID_CONFIGURATION_PAYLOAD' }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parsePlatformCommand(action: unknown, payload: unknown): ParsedPlatformCommand {
  if (isPlatformConfigurationReadAction(action)) {
    if (payload !== undefined && payload !== null && !(isPlainObject(payload) && Object.keys(payload).length === 0)) return { ok: false, error: 'INVALID_CONFIGURATION_PAYLOAD' }
    return { ok: true, kind: 'read', action, payload: {} }
  }
  if (isPlatformRecoveryAction(action)) {
    if (!isPlainObject(payload) || Object.keys(payload).length !== 1 || typeof payload.userId !== 'string' || !payload.userId) return { ok: false, error: 'INVALID_CONFIGURATION_PAYLOAD' }
    return { ok: true, kind: 'recovery', action, payload: { userId: payload.userId } }
  }
  if (isPlatformConfigurationAction(action)) {
    if (!isPlainObject(payload)) return { ok: false, error: 'INVALID_CONFIGURATION_PAYLOAD' }
    return { ok: true, kind: 'write', action, payload }
  }
  return { ok: false, error: 'UNSUPPORTED_CONFIGURATION_ACTION' }
}
