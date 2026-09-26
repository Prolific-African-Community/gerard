import type { NextApiRequest, NextApiResponse } from 'next'
import { isPlatformConfigurationAction, isPlatformConfigurationReadAction, isPlatformRecoveryAction } from '@prolific/gerard-core'
import { requirePlatformAccess, requireSuperAdmin } from '../../../../../lib/auth/platform-authorization'
import { sendCustomConfigurationCommand } from '../../../../../lib/platform/custom-configuration'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }) }
  const action = req.body?.action
  const isRead = isPlatformConfigurationReadAction(action)
  // Reads follow the platform read-only policy (SUPER_ADMIN and PLATFORM_SUPPORT); writes and ORG_ADMIN recovery stay
  // SUPER_ADMIN only.
  const actor = isRead ? await requirePlatformAccess(req, res) : await requireSuperAdmin(req, res)
  if (!actor) return
  const application = Array.isArray(req.query.application) ? req.query.application[0] : req.query.application
  const payload = isRead ? {} : req.body?.payload
  const isRecovery = isPlatformRecoveryAction(action)
  if (isRecovery && (typeof payload?.userId !== 'string' || Object.keys(payload).length !== 1)) return res.status(400).json({ error: 'Invalid configuration request' })
  if (!application || (!isRead && !isRecovery && !isPlatformConfigurationAction(action)) || !payload || typeof payload !== 'object' || Array.isArray(payload)) return res.status(400).json({ error: 'Invalid configuration request' })
  const result = await sendCustomConfigurationCommand({ application, action, payload: payload as Record<string, unknown>, actorId: actor.id })
  if (isRecovery) res.setHeader('Cache-Control', 'no-store')
  return res.status(result.status).json(result.body)
}
