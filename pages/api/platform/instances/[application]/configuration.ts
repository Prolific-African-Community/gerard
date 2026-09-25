import type { NextApiRequest, NextApiResponse } from 'next'
import { isPlatformConfigurationAction } from '@prolific/gerard-core'
import { requireSuperAdmin } from '../../../../../lib/auth/platform-authorization'
import { getRegisteredGerardInstance } from '../../../../../lib/runtime/instance-registry'
import { createPlatformConfigurationRequest } from '../../../../../lib/platform/configuration-channel'
import { prisma } from '../../../../../lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireSuperAdmin(req, res)
  if (!actor) return
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }) }
  const application = Array.isArray(req.query.application) ? req.query.application[0] : req.query.application
  const instance = application ? getRegisteredGerardInstance(application) : null
  if (!instance || instance.applicationType !== 'CUSTOM' || instance.status !== 'ACTIVE' || !instance.configurationEndpoint) return res.status(404).json({ error: 'Custom instance unavailable' })
  const action = req.body?.action
  const payload = req.body?.payload
  if (!isPlatformConfigurationAction(action) || !payload || typeof payload !== 'object' || Array.isArray(payload)) return res.status(400).json({ error: 'Invalid configuration request' })
  let signed: ReturnType<typeof createPlatformConfigurationRequest>
  try {
    signed = createPlatformConfigurationRequest({ application: instance.application, organizationId: instance.organizationId, action, payload: payload as Record<string, unknown> })
  } catch (error) {
    if (error instanceof Error && error.message === 'PLATFORM_INSTANCE_SECRET_REQUIRED') return res.status(503).json({ error: 'Platform instance channel unavailable' })
    throw error
  }
  try {
    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-gerard-platform-signature': signed.signature, 'x-gerard-platform-actor': actor.id }
    if (bypass && new URL(instance.configurationEndpoint).hostname.endsWith('.vercel.app')) headers['x-vercel-protection-bypass'] = bypass
    const response = await fetch(instance.configurationEndpoint, { method: 'POST', headers, body: JSON.stringify({ request: signed.request }), signal: AbortSignal.timeout(8000) })
    const result = await response.json().catch(() => ({}))
    await prisma.platformAuditLog.create({ data: { actorUserId: actor.id, organizationId: 'org-gerard-default', action: 'ORGANIZATION_UPDATED', metadata: { source: 'PLATFORM_INSTANCE_CONFIGURATION', targetApplication: instance.application, targetOrganizationId: instance.organizationId, action, success: response.ok } } })
    return res.status(response.ok ? 200 : response.status >= 400 && response.status < 500 ? 400 : 502).json(response.ok ? result : { error: 'Custom configuration rejected', code: result?.error || 'INSTANCE_CONFIGURATION_FAILED' })
  } catch (error) {
    console.error('Custom configuration request failed', { targetApplication: instance.application, error: error instanceof Error ? error.message : 'unknown' })
    return res.status(502).json({ error: 'Custom configuration unavailable' })
  }
}
