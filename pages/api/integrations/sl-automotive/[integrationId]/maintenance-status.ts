import { createHash } from 'node:crypto'
import { OrganizationIntegrationType } from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'

import { parseSlAutomotiveConfig } from '../../../../../lib/integrations/config'
import { getIntegrationSecret } from '../../../../../lib/integrations/secrets'
import { applySlAutomotiveWebhook, SlWebhookError } from '../../../../../lib/integrations/sl-automotive-webhook'
import { prisma } from '../../../../../lib/prisma'

function digest(value: string) { return createHash('sha256').update(value).digest('hex') }
function constantTimeEqual(left: string, right: string) {
  const a = digest(left); const b = digest(right); let difference = a.length ^ b.length
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0)
  return difference === 0
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Méthode non autorisée' }) }
  const integrationId = typeof req.query.integrationId === 'string' ? req.query.integrationId : ''
  const integration = await prisma.organizationIntegration.findFirst({ where: { id: integrationId, type: OrganizationIntegrationType.SL_AUTOMOTIVE, enabled: true } })
  if (!integration) return res.status(404).json({ error: 'Intégration introuvable' })
  const config = parseSlAutomotiveConfig(integration.configJson)
  if (!config.webhookEnabled) return res.status(404).json({ error: 'Webhook désactivé' })
  try {
    const expected = await getIntegrationSecret(integration, 'inboundWebhookSecret')
    const supplied = typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : ''
    if (!supplied || !constantTimeEqual(supplied, expected)) return res.status(401).json({ error: 'Secret invalide' })
    const result = await applySlAutomotiveWebhook(integration.organizationId, integration.id, req.body)
    return res.status(200).json({ ok: true, idempotent: result.idempotent, maintenanceRequestId: result.maintenanceRequest.id })
  } catch (error) {
    if (error instanceof SlWebhookError) return res.status(error.statusCode).json({ error: error.message })
    if (error instanceof Error && error.name === 'IntegrationSecretError') return res.status(503).json({ error: 'Intégration indisponible' })
    console.error('SL Automotive webhook failed', { integrationId, error: error instanceof Error ? error.name : 'UnknownError' })
    return res.status(500).json({ error: 'Traitement webhook impossible' })
  }
}
