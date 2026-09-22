import { withTenantApiRoute } from '../../../../lib/auth/authorization'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../../lib/auth/authorization'
import { requireActiveOrganizationId } from '../../../../lib/auth/organization-context'
import { permissions } from '../../../../lib/auth/permissions'
import { prisma } from '../../../../lib/prisma'

function value(input: unknown) { return typeof input === 'string' && input.trim() ? input.trim() : null }

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requirePermission(req, res, permissions.importsManage)
  if (!user) return
  const organizationId = requireActiveOrganizationId()
  const previewKey = value(req.body?.previewKey)
  if (!previewKey) return res.status(400).json({ error: 'previewKey requis' })

  if (req.method === 'POST') {
    const ignored = await prisma.ignoredMailImport.upsert({
      where: { organizationId_previewKey: { organizationId, previewKey } },
      create: {
        organizationId, previewKey,
        source: value(req.body.source) || 'imap', provider: value(req.body.provider) || 'imap',
        sourceEmailId: value(req.body.sourceEmailId) || previewKey, messageId: value(req.body.messageId),
        clientReference: value(req.body.clientReference), subject: value(req.body.subject),
        fromAddress: value(req.body.fromAddress), ignoredBy: user.id,
      },
      update: { ignoredAt: new Date(), ignoredBy: user.id },
    })
    return res.status(200).json({ ignored: { id: ignored.id, previewKey: ignored.previewKey } })
  }
  if (req.method === 'DELETE') {
    await prisma.ignoredMailImport.deleteMany({ where: { organizationId, previewKey } })
    return res.status(200).json({ restored: true })
  }
  res.setHeader('Allow', ['POST', 'DELETE'])
  return res.status(405).json({ error: 'Méthode non autorisée' })
}

export default withTenantApiRoute(handler)
