import type { NextApiRequest, NextApiResponse } from 'next'

import { requireOrganizationAdmin } from '../../../../lib/auth/organization-admin'
import { runWithCurrentOrganization } from '../../../../lib/auth/authorization'
import { parseBranding, updateOrganization } from '../../../../lib/platform/organizations'
import { getOrganizationAdminWorkspace } from '../../../../lib/organization/admin'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireOrganizationAdmin(req, res)
  if (!actor) return
  return runWithCurrentOrganization(actor, async () => {
    if (req.method === 'GET') {
      const organization = await getOrganizationAdminWorkspace(actor.organizationId)
      return organization ? res.status(200).json({ organization }) : res.status(404).json({ error: 'Organisation introuvable' })
    }
    if (req.method === 'PATCH') {
      const branding = parseBranding(req.body ?? {})
      if (!branding) return res.status(400).json({ error: 'Paramètres invalides' })
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : undefined
      if (req.body?.name !== undefined && !name) return res.status(400).json({ error: 'Nom requis' })
      await updateOrganization({ actorUserId: actor.id, organizationId: actor.organizationId, ...(name ? { name } : {}), ...branding })
      return res.status(200).json({ organization: await getOrganizationAdminWorkspace(actor.organizationId) })
    }
    res.setHeader('Allow', 'GET, PATCH')
    return res.status(405).json({ error: 'Méthode non autorisée' })
  })
}
