import { withTenantApiRoute } from '../../../lib/auth/authorization'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../lib/auth/authorization'
import { permissions } from '../../../lib/auth/permissions'
import { actorName } from '../../../lib/park/actor'
import { updateSpotNote } from '../../../lib/park/service'

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requirePermission(req, res, permissions.parkMove)
  if (!user) return
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }
  const { spotId, note } = req.body ?? {}
  if (
    typeof spotId !== 'string' ||
    (note !== null && typeof note !== 'string') ||
    (typeof note === 'string' && note.length > 500)
  ) {
    return res.status(400).json({ error: 'Requête invalide.' })
  }
  const result = await updateSpotNote({
    spotId,
    note,
    actor: { id: user.id, name: actorName(user) },
  })
  if (!result.ok) return res.status(result.code).json({ error: result.error })
  return res.status(200).json({ ok: true })
}

export default withTenantApiRoute(handler)
