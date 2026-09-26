import type { NextApiRequest, NextApiResponse } from 'next'
import { isPlatformRecoveryAction } from '@prolific/gerard-core'

import { requirePlatformAccess, requireSuperAdmin } from '../../../../../lib/auth/platform-authorization'
import { listOrganizationAdmins, recoverOrganizationAdmin, recoveryErrorStatus } from '../../../../../lib/organization/admin-recovery'
import { prisma } from '../../../../../lib/prisma'

// Standard organizations: ORG_ADMIN recovery on the local database. Custom instances use the signed channel instead.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const organizationId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  if (!organizationId) return res.status(400).json({ error: 'Organisation requise' })
  if (req.method === 'GET') {
    const actor = await requirePlatformAccess(req, res)
    if (!actor) return
    if (!await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } })) return res.status(404).json({ error: 'Organisation introuvable' })
    return res.status(200).json({ admins: await listOrganizationAdmins(organizationId) })
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Méthode non autorisée' }) }
  const actor = await requireSuperAdmin(req, res)
  if (!actor) return
  const action = req.body?.action
  const userId = req.body?.userId
  if (!isPlatformRecoveryAction(action) || typeof userId !== 'string') return res.status(400).json({ error: 'Action de récupération invalide' })
  try {
    const result = await recoverOrganizationAdmin({ organizationId, userId, action, platformActorId: actor.id, auditActorUserId: actor.id })
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({ ok: true, action, userId, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (recoveryErrorStatus[message]) return res.status(recoveryErrorStatus[message]).json({ error: message, code: message })
    throw error
  }
}
