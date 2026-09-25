import type { NextApiRequest, NextApiResponse } from 'next'
import { isPlatformConfigurationAction, isPlatformConfigurationReadAction } from '@prolific/gerard-core'
import { verifyPlatformConfigurationRequest } from '../../../../lib/platform/configuration-channel'
import { applyPlatformConfiguration, readPlatformConfiguration } from '../../../../lib/organization/platform-configuration'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }) }
  const expectedApplication = process.env.GERARD_APPLICATION_ID
  const expectedOrganizationId = process.env.GERARD_INSTANCE_ORGANIZATION_ID
  if (!expectedApplication || !expectedOrganizationId) return res.status(503).json({ error: 'Instance identity unavailable' })
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {}
  const request = body.request
  const signature = req.headers['x-gerard-platform-signature']
  const verified = verifyPlatformConfigurationRequest(request, Array.isArray(signature) ? signature[0] : signature, expectedApplication, expectedOrganizationId)
  if (!verified.ok) return res.status(401).json({ error: verified.reason })
  const value = request as Record<string, unknown>
  if (isPlatformConfigurationReadAction(value.action)) {
    try {
      return res.status(200).json({ ok: true, application: expectedApplication, organizationId: expectedOrganizationId, action: value.action, configuration: await readPlatformConfiguration(expectedOrganizationId) })
    } catch (error) {
      if (error instanceof Error && error.message === 'ORGANIZATION_NOT_FOUND') return res.status(404).json({ error: error.message })
      console.error('Platform configuration read failed', { application: expectedApplication })
      return res.status(500).json({ error: 'Configuration unavailable' })
    }
  }
  if (!isPlatformConfigurationAction(value.action) || !value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) return res.status(400).json({ error: 'Invalid configuration request' })
  try {
    const result = await applyPlatformConfiguration({ organizationId: expectedOrganizationId, action: value.action, payload: value.payload as Record<string, unknown>, platformActorId: typeof req.headers['x-gerard-platform-actor'] === 'string' ? req.headers['x-gerard-platform-actor'] : 'platform' })
    return res.status(200).json({ ok: true, application: expectedApplication, organizationId: expectedOrganizationId, action: value.action, configuration: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Configuration rejected'
    if (['ORGANIZATION_NOT_FOUND', 'LOCAL_AUDIT_ACTOR_NOT_FOUND'].includes(message)) return res.status(404).json({ error: message })
    if (['FORBIDDEN_CONFIGURATION_FIELD', 'INVALID_BRANDING', 'INVALID_MODULES', 'INVALID_INTEGRATION', 'SECRET_FIELD_FORBIDDEN', 'UNSUPPORTED_CONFIGURATION_ACTION'].includes(message)) return res.status(400).json({ error: message })
    console.error('Platform configuration request failed', { application: expectedApplication, action: value.action, error: message })
    return res.status(500).json({ error: 'Configuration unavailable' })
  }
}
