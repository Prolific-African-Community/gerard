import { Prisma } from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePlatformAccess, requireSuperAdmin } from '../../../../lib/auth/platform-authorization'
import { passwordError, normalizeUsername, usernameError } from '../../../../lib/auth/validation'
import { createOrganization, getPlatformDashboard, isOrganizationStatus, normalizeSlug, parseModules } from '../../../../lib/platform/organizations'

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const actor = await requirePlatformAccess(req, res)
    if (!actor) return
    return res.status(200).json({ ...(await getPlatformDashboard()), platformRole: actor.platformRole })
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }
  const actor = await requireSuperAdmin(req, res)
  if (!actor) return
  const name = text(req.body?.name)
  const slug = normalizeSlug(text(req.body?.slug) || name)
  const status = req.body?.status ?? 'ACTIVE'
  const modules = req.body?.enabledModules === undefined ? undefined : parseModules(req.body.enabledModules)
  const adminInput = req.body?.admin
  if (!name || !slug || !isOrganizationStatus(status) || modules === null) return res.status(400).json({ error: 'Organisation invalide' })
  let admin = null
  if (adminInput) {
    const firstName = text(adminInput.firstName)
    const lastName = text(adminInput.lastName)
    const username = normalizeUsername(text(adminInput.username))
    const password = typeof adminInput.password === 'string' ? adminInput.password : ''
    const validationError = !firstName || !lastName ? 'Nom administrateur requis'
      : usernameError(username) || passwordError(password)
    if (validationError) return res.status(400).json({ error: validationError })
    admin = { firstName, lastName, username, email: text(adminInput.email) || null, password }
  }
  try {
    const organization = await createOrganization({ actorUserId: actor.id, name, slug, status, enabledModules: modules, admin })
    return res.status(201).json({ organization })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ error: 'Slug, username ou email déjà utilisé' })
    console.error('Platform organization creation failed', error)
    return res.status(500).json({ error: 'Création impossible' })
  }
}
