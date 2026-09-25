import type { NextApiRequest, NextApiResponse } from 'next'

import { requireOrganizationAdmin } from '../../../../lib/auth/organization-admin'
import { runWithCurrentOrganization } from '../../../../lib/auth/authorization'
import { getOrganizationAdminWorkspace } from '../../../../lib/organization/admin'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireOrganizationAdmin(req, res)
  if (!actor) return
  return runWithCurrentOrganization(actor, async () => {
    if (req.method === 'GET') {
      const organization = await getOrganizationAdminWorkspace(actor.organizationId)
      return organization ? res.status(200).json({ organization }) : res.status(404).json({ error: 'Organisation introuvable' })
    }
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Méthode non autorisée' })
  })
}
