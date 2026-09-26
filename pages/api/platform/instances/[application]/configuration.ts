import type { NextApiRequest, NextApiResponse } from 'next'
import { isPlatformConfigurationReadAction, parsePlatformCommand } from '@prolific/gerard-core'
import { requirePlatformAccess, requireSuperAdmin } from '../../../../../lib/auth/platform-authorization'
import { sendCustomConfigurationCommand } from '../../../../../lib/platform/custom-configuration'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }) }
  const action = req.body?.action
  // Reads follow the platform read-only policy (SUPER_ADMIN and PLATFORM_SUPPORT); writes and ORG_ADMIN recovery stay
  // SUPER_ADMIN only.
  const actor = isPlatformConfigurationReadAction(action) ? await requirePlatformAccess(req, res) : await requireSuperAdmin(req, res)
  if (!actor) return
  const application = Array.isArray(req.query.application) ? req.query.application[0] : req.query.application
  if (!application) return res.status(400).json({ error: 'Invalid configuration request', code: 'APPLICATION_REQUIRED' })
  // Same Core parser as the Custom endpoint: both sides accept exactly the same actions and payload shapes.
  const command = parsePlatformCommand(action, req.body?.payload)
  if (!command.ok) return res.status(400).json({ error: 'Invalid configuration request', code: command.error })
  const result = await sendCustomConfigurationCommand({ application, action: command.action, payload: command.payload, actorId: actor.id })
  if (command.kind === 'recovery') res.setHeader('Cache-Control', 'no-store')
  return res.status(result.status).json(result.body)
}
