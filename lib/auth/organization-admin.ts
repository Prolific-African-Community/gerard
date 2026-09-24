import { OrganizationRole } from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requireActiveUser } from './authorization'

export async function requireOrganizationAdmin(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireActiveUser(req, res)
  if (!user) return null
  if (user.organizationRole !== OrganizationRole.ORG_ADMIN) {
    res.status(403).json({ error: 'Action réservée aux administrateurs de l’organisation' })
    return null
  }
  return user
}
