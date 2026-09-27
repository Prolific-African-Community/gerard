import type { NextApiRequest, NextApiResponse } from 'next'

import { runWithCurrentOrganization } from '../../../../lib/auth/authorization'
import { requireOrganizationAdmin } from '../../../../lib/auth/organization-admin'
import { updateOrganization } from '../../../../lib/platform/organizations'
import { normalizeBrandAssetUrl } from '../../../../lib/tenant/branding'

// Branding assets of the caller's OWN organization: the organization comes from the session, and only the
// asset fields are accepted, so this route can never rename an organization or change platform configuration.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireOrganizationAdmin(req, res)
  if (!actor) return
  if (req.method !== 'PUT') {
    res.setHeader('Allow', 'PUT')
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }
  return runWithCurrentOrganization(actor, async () => {
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
    const patch: { logoUrl?: string | null; faviconUrl?: string | null } = {}
    for (const field of ['logoUrl', 'faviconUrl'] as const) {
      if (!Object.prototype.hasOwnProperty.call(body, field)) continue
      const normalized = normalizeBrandAssetUrl(body[field])
      // undefined means the value was neither a clearing value nor a usable URL.
      if (normalized === undefined) return res.status(400).json({ error: 'URL d’image invalide : utilisez https:// ou un chemin commençant par /.' })
      patch[field] = normalized
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Aucune modification.' })
    const organization = await updateOrganization({ actorUserId: actor.id, organizationId: actor.organizationId, ...patch })
    return res.status(200).json({ organization: { id: organization.id, logoUrl: organization.logoUrl, faviconUrl: organization.faviconUrl } })
  })
}
