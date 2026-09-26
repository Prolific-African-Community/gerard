import type { NextApiRequest, NextApiResponse } from 'next'
import { GERARD_CORE_VERSION, parsePlatformCommand } from '@prolific/gerard-core'
import { verifyPlatformConfigurationRequest } from '../../../../lib/platform/configuration-channel'
import { applyPlatformConfiguration, readPlatformConfiguration } from '../../../../lib/organization/platform-configuration'
import { listOrganizationAdmins, recoverOrganizationAdmin, recoveryErrorStatus } from '../../../../lib/organization/admin-recovery'

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
  // Same Core parser as the Platform route. An unknown action names this instance's Core version, so a Platform talking
  // to an outdated instance reports version skew instead of a generic rejection.
  const command = parsePlatformCommand(value.action, value.payload)
  if (!command.ok) return res.status(400).json({ error: command.error, coreVersion: GERARD_CORE_VERSION })
  const platformActorId = typeof req.headers['x-gerard-platform-actor'] === 'string' ? req.headers['x-gerard-platform-actor'] : 'platform'
  const reply = { ok: true, application: expectedApplication, organizationId: expectedOrganizationId, action: command.action }

  if (command.kind === 'read') {
    try {
      if (command.action === 'getOrgAdmins') return res.status(200).json({ ...reply, admins: await listOrganizationAdmins(expectedOrganizationId) })
      return res.status(200).json({ ...reply, configuration: await readPlatformConfiguration(expectedOrganizationId) })
    } catch (error) {
      if (error instanceof Error && error.message === 'ORGANIZATION_NOT_FOUND') return res.status(404).json({ error: error.message })
      console.error('Platform configuration read failed', { application: expectedApplication })
      return res.status(500).json({ error: 'Configuration unavailable' })
    }
  }

  if (command.kind === 'recovery') {
    try {
      const result = await recoverOrganizationAdmin({ organizationId: expectedOrganizationId, userId: command.payload.userId, action: command.action, platformActorId, auditActorUserId: command.payload.userId })
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json({ ...reply, userId: command.payload.userId, ...result })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (recoveryErrorStatus[message]) return res.status(recoveryErrorStatus[message]).json({ error: message })
      console.error('Platform recovery failed', { application: expectedApplication, action: command.action })
      return res.status(500).json({ error: 'Recovery unavailable' })
    }
  }

  try {
    const result = await applyPlatformConfiguration({ organizationId: expectedOrganizationId, action: command.action, payload: command.payload, platformActorId })
    return res.status(200).json({ ...reply, configuration: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Configuration rejected'
    if (['ORGANIZATION_NOT_FOUND', 'LOCAL_AUDIT_ACTOR_NOT_FOUND'].includes(message)) return res.status(404).json({ error: message })
    if (['FORBIDDEN_CONFIGURATION_FIELD', 'INVALID_BRANDING', 'INVALID_MODULES', 'INVALID_INTEGRATION', 'SECRET_FIELD_FORBIDDEN', 'UNSUPPORTED_CONFIGURATION_ACTION'].includes(message)) return res.status(400).json({ error: message })
    console.error('Platform configuration request failed', { application: expectedApplication, action: command.action, error: message })
    return res.status(500).json({ error: 'Configuration unavailable' })
  }
}
