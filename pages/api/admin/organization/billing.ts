import type { NextApiRequest, NextApiResponse } from 'next'

import { runWithCurrentOrganization } from '../../../../lib/auth/authorization'
import { requireOrganizationAdmin } from '../../../../lib/auth/organization-admin'
import { upsertOrganizationBillingConfig } from '../../../../lib/platform/organizations'
import { prisma } from '../../../../lib/prisma'

// Legal identity and billing information of the caller's OWN organization. The organization always comes from
// the authenticated session (requireOrganizationAdmin), never from the request, so an ORG_ADMIN cannot target
// another organization by sending an id. The validation, the upsert and the audit entry are the same ones the
// platform (SUPER_ADMIN) route uses.
const messages: Record<string, string> = {
  LEGAL_NAME_REQUIRED: 'La raison sociale est obligatoire.',
  PAYMENT_TERMS_INVALID: 'Le délai de paiement doit être un nombre de jours entre 0 et 365.',
  BILLING_EMAIL_INVALID: 'L’e-mail de facturation est invalide.',
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireOrganizationAdmin(req, res)
  if (!actor) return
  return runWithCurrentOrganization(actor, async () => {
    if (req.method === 'GET') {
      const billingConfig = await prisma.organizationBillingConfig.findUnique({ where: { organizationId: actor.organizationId } })
      return res.status(200).json({ billingConfig })
    }
    if (req.method === 'PUT') {
      const value = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
      try {
        const billingConfig = await upsertOrganizationBillingConfig({
          actorUserId: actor.id,
          organizationId: actor.organizationId,
          value,
        })
        return res.status(200).json({ billingConfig })
      } catch (error) {
        const code = error instanceof Error ? error.message : 'BILLING_CONFIG_INVALID'
        if (code.startsWith('BILLING_FIELD_TOO_LONG')) return res.status(400).json({ error: 'Un des champs dépasse la longueur autorisée.', code })
        if (messages[code]) return res.status(400).json({ error: messages[code], code })
        throw error
      }
    }
    res.setHeader('Allow', 'GET, PUT')
    return res.status(405).json({ error: 'Méthode non autorisée' })
  })
}
