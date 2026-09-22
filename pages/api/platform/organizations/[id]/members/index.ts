import { OrganizationRole, Prisma } from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requireSuperAdmin } from '../../../../../../lib/auth/platform-authorization'
import { normalizeUsername, passwordError, usernameError } from '../../../../../../lib/auth/validation'
import { addOrganizationMember } from '../../../../../../lib/platform/organizations'

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireSuperAdmin(req, res)
  if (!actor) return
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }
  const organizationId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  const role = req.body?.role
  if (!organizationId || !Object.values(OrganizationRole).includes(role)) return res.status(400).json({ error: 'Membre invalide' })
  const existingUserId = text(req.body?.existingUserId) || undefined
  let newUser
  if (!existingUserId) {
    const firstName = text(req.body?.firstName)
    const lastName = text(req.body?.lastName)
    const username = normalizeUsername(text(req.body?.username))
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    const validationError = !firstName || !lastName ? 'Nom requis' : usernameError(username) || passwordError(password)
    if (validationError) return res.status(400).json({ error: validationError })
    newUser = { firstName, lastName, username, email: text(req.body?.email) || null, password }
  }
  try {
    const membership = await addOrganizationMember({ actorUserId: actor.id, organizationId, role, existingUserId, newUser })
    return res.status(201).json({ membership })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ error: 'Utilisateur déjà membre, username ou email déjà utilisé' })
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') return res.status(404).json({ error: 'Organisation introuvable' })
    if (error instanceof Error && error.message === 'USER_NOT_FOUND') return res.status(404).json({ error: 'Utilisateur introuvable' })
    console.error('Platform member creation failed', error)
    return res.status(500).json({ error: 'Ajout impossible' })
  }
}
