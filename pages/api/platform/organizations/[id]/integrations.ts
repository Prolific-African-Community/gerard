import { OrganizationIntegrationType } from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'
import { requireSuperAdmin } from '../../../../../lib/auth/platform-authorization'
import { upsertOrganizationIntegration } from '../../../../../lib/platform/organizations'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') { res.setHeader('Allow', 'PUT'); return res.status(405).json({ error: 'Méthode non autorisée' }) }
  const user = await requireSuperAdmin(req, res); if (!user) return
  const organizationId = typeof req.query.id === 'string' ? req.query.id : ''
  if (!Object.values(OrganizationIntegrationType).includes(req.body?.type)) return res.status(400).json({ error: 'Type invalide' })
  try { return res.status(200).json({ integration: await upsertOrganizationIntegration({ actorUserId: user.id, organizationId, type: req.body.type, enabled: req.body.enabled === true, configJson: req.body.configJson, secretRef: Object.prototype.hasOwnProperty.call(req.body, 'secretRef') ? req.body.secretRef : undefined }) }) }
  catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : 'Configuration invalide' }) }
}
