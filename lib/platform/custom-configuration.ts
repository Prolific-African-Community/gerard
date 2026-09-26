import { getVercelOidcToken } from '@vercel/oidc'
import { isPlatformConfigurationReadAction, isPlatformRecoveryAction, type PlatformConfigurationCommand } from '@prolific/gerard-core'

import { prisma } from '../prisma'
import { getRegisteredGerardInstance } from '../runtime/instance-registry'
import { createPlatformConfigurationRequest } from './configuration-channel'

export type CustomConfigurationResult = { status: number; body: Record<string, unknown> }

// The single Platform-to-Custom path for reads and writes: registry lookup, HMAC signing, Preview OIDC and write audit.
export async function sendCustomConfigurationCommand(input: { application: string; action: PlatformConfigurationCommand; payload: Record<string, unknown>; actorId: string }): Promise<CustomConfigurationResult> {
  const instance = getRegisteredGerardInstance(input.application)
  if (!instance || instance.applicationType !== 'CUSTOM' || instance.status !== 'ACTIVE' || !instance.configurationEndpoint) return { status: 404, body: { error: 'Custom instance unavailable' } }
  const isRead = isPlatformConfigurationReadAction(input.action)
  let signed: ReturnType<typeof createPlatformConfigurationRequest>
  try {
    signed = createPlatformConfigurationRequest({ application: instance.application, organizationId: instance.organizationId, action: input.action, payload: input.payload })
  } catch (error) {
    if (error instanceof Error && error.message === 'PLATFORM_INSTANCE_SECRET_REQUIRED') return { status: 503, body: { error: 'Platform instance channel unavailable' } }
    throw error
  }
  // Reads are not audited, matching the platform convention of auditing mutations only. The response body (which may
  // carry a one-time temporary password) is never written to the audit.
  const audit = (success: boolean, code?: string) => isRead ? Promise.resolve() : prisma.platformAuditLog.create({ data: { actorUserId: input.actorId, organizationId: 'org-gerard-default', action: 'ORGANIZATION_UPDATED', metadata: { source: 'PLATFORM_INSTANCE_CONFIGURATION', targetApplication: instance.application, targetOrganizationId: instance.organizationId, action: input.action, ...(typeof input.payload.userId === 'string' ? { targetUserId: input.payload.userId } : {}), success, ...(code ? { code } : {}) } } }).then(() => undefined)
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-gerard-platform-signature': signed.signature, 'x-gerard-platform-actor': input.actorId }
    if (process.env.VERCEL_ENV === 'preview') {
      const oidcToken = await getVercelOidcToken()
      if (!oidcToken) return { status: 503, body: { error: 'Platform preview identity unavailable' } }
      headers['x-vercel-trusted-oidc-idp-token'] = oidcToken
    }
    const response = await fetch(instance.configurationEndpoint, { method: 'POST', headers, body: JSON.stringify({ request: signed.request }), signal: AbortSignal.timeout(8000) })
    const result = await response.json().catch(() => ({}))
    await audit(response.ok, response.ok ? undefined : String(result?.error || response.status))
    if (response.ok) return { status: 200, body: result }
    // An instance built before an action existed rejects it: before the shared parser as a generic 'Invalid configuration
    // request', since then as UNSUPPORTED_CONFIGURATION_ACTION with its Core version. Report that as version skew and name
    // the endpoint host, so a stale Preview endpoint is visible instead of looking like a bad request.
    const outdated = response.status === 400 && (result?.error === 'UNSUPPORTED_CONFIGURATION_ACTION' || (result?.error === 'Invalid configuration request' && (isRead || isPlatformRecoveryAction(input.action))))
    if (outdated) return { status: 409, body: { error: 'Custom instance outdated', code: 'CUSTOM_INSTANCE_OUTDATED', instanceCoreVersion: typeof result?.coreVersion === 'string' ? result.coreVersion : null, endpointHost: new URL(instance.configurationEndpoint).host } }
    return { status: response.status >= 400 && response.status < 500 ? 400 : 502, body: { error: 'Custom configuration rejected', code: result?.error || 'INSTANCE_CONFIGURATION_FAILED' } }
  } catch (error) {
    console.error('Custom configuration request failed', { targetApplication: instance.application, action: input.action, error: error instanceof Error ? error.message : 'unknown' })
    await audit(false, 'INSTANCE_UNREACHABLE')
    return { status: 502, body: { error: 'Custom configuration unavailable' } }
  }
}
