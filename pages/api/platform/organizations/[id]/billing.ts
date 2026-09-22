import type { NextApiRequest, NextApiResponse } from 'next'
import { requireSuperAdmin } from '../../../../../lib/auth/platform-authorization'
import { upsertOrganizationBillingConfig } from '../../../../../lib/platform/organizations'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') { res.setHeader('Allow', 'PUT'); return res.status(405).json({ error: 'Méthode non autorisée' }) }
  const user = await requireSuperAdmin(req, res); if (!user) return
  const organizationId = typeof req.query.id === 'string' ? req.query.id : ''
  try { return res.status(200).json({ billingConfig: await upsertOrganizationBillingConfig({ actorUserId: user.id, organizationId, value: req.body || {} }) }) }
  catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : 'Configuration invalide' }) }
}
