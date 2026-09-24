import { OrganizationRole, Prisma } from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requireOrganizationAdmin } from '../../../../../lib/auth/organization-admin'
import { runWithCurrentOrganization } from '../../../../../lib/auth/authorization'
import { normalizeUsername, usernameError } from '../../../../../lib/auth/validation'
import { generateTemporaryPassword, getOrganizationAdminWorkspace, organizationAdminRoles } from '../../../../../lib/organization/admin'
import { addOrganizationMember } from '../../../../../lib/platform/organizations'

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireOrganizationAdmin(req, res)
  if (!actor) return
  return runWithCurrentOrganization(actor, async () => {
    if (req.method === 'GET') return res.status(200).json({ organization: await getOrganizationAdminWorkspace(actor.organizationId) })
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Méthode non autorisée' }) }
    const firstName = text(req.body?.firstName)
    const lastName = text(req.body?.lastName)
    const username = normalizeUsername(text(req.body?.username))
    const email = text(req.body?.email) || null
    const role = req.body?.role
    if (!firstName || !lastName || usernameError(username) || !organizationAdminRoles.includes(role) || role === undefined) return res.status(400).json({ error: 'Membre invalide' })
    const temporaryPassword = generateTemporaryPassword()
    try {
      const membership = await addOrganizationMember({ actorUserId: actor.id, organizationId: actor.organizationId, role: role as OrganizationRole, newUser: { firstName, lastName, username, email, password: temporaryPassword } })
      return res.status(201).json({ membership, temporaryPassword, mustChangePassword: true })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ error: 'Username ou email déjà utilisé' })
      throw error
    }
  })
}
