import { Prisma, UserRole } from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requireAdmin } from '../../../../../lib/auth/authorization'
import { safeUserSelect } from '../../../../../lib/auth/safe-user'
import { isUserRole, normalizeUsername, usernameError } from '../../../../../lib/auth/validation'
import { prisma } from '../../../../../lib/prisma'

function text(value: unknown) { return typeof value === 'string' ? value.trim() : '' }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const admin = await requireAdmin(req, res)
  if (!admin) return
  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  if (!id) return res.status(400).json({ error: 'Utilisateur invalide.' })
  const target = await prisma.user.findFirst({ where: { id, organizationMemberships: { some: { organizationId: admin.organizationId } } }, select: safeUserSelect })
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable.' })
  if (req.method === 'GET') return res.status(200).json({ user: target })
  if (req.method !== 'PATCH') { res.setHeader('Allow', 'GET, PATCH'); return res.status(405).json({ error: 'Méthode non autorisée' }) }

  const firstName = text(req.body?.firstName)
  const lastName = text(req.body?.lastName)
  const username = normalizeUsername(text(req.body?.username))
  const role = req.body?.role
  const isActive = req.body?.isActive
  const driverId = text(req.body?.driverId) || null
  if (!firstName || !lastName || usernameError(username) || !isUserRole(role) || typeof isActive !== 'boolean') return res.status(400).json({ error: usernameError(username) ?? 'Données utilisateur invalides.' })
  if (role === UserRole.DRIVER && !driverId) return res.status(400).json({ error: 'Un compte Chauffeur doit être lié à une fiche chauffeur existante.' })
  if (role !== UserRole.DRIVER && driverId) return res.status(400).json({ error: 'La liaison chauffeur est réservée au rôle Chauffeur.' })
  if (id === admin.id && (!isActive || role !== UserRole.ADMIN)) return res.status(409).json({ error: 'Vous ne pouvez pas retirer votre propre accès administrateur.' })

  try {
    const user = await prisma.$transaction(async tx => {
      if (target.role === UserRole.ADMIN && target.isActive && (!isActive || role !== UserRole.ADMIN)) {
        const activeAdmins = await tx.user.count({ where: { role: UserRole.ADMIN, isActive: true, organizationMemberships: { some: { organizationId: admin.organizationId } } } })
        if (activeAdmins <= 1) throw new Error('LAST_ACTIVE_ADMIN')
      }
      if (driverId) {
        const driver = await tx.driver.findUnique({ where: { id: driverId }, select: { user: { select: { id: true } } } })
        if (!driver) throw new Error('DRIVER_NOT_FOUND')
        if (driver.user && driver.user.id !== id) throw new Error('DRIVER_ALREADY_LINKED')
      }
      const updated = await tx.user.update({ where: { id }, data: {
        firstName, lastName, name: `${firstName} ${lastName}`, username, role, isActive,
        driverId: role === UserRole.DRIVER ? driverId : null,
        ...(!isActive && target.isActive ? { sessionVersion: { increment: 1 } } : {}),
      }, select: safeUserSelect })
      await tx.organizationUser.update({
        where: { organizationId_userId: { organizationId: admin.organizationId, userId: id } },
        data: { role: role === UserRole.ADMIN ? 'ORG_ADMIN' : role === UserRole.DISPATCHER ? 'DISPATCHER' : role === UserRole.SECRETARY ? 'SECRETARY' : role === UserRole.PARK_MANAGER ? 'MANAGER' : 'DRIVER' },
      })
      return updated
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return res.status(200).json({ user })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ error: 'Ce username ou cette fiche chauffeur est déjà utilisé.' })
    if (error instanceof Error && error.message === 'DRIVER_NOT_FOUND') return res.status(400).json({ error: 'Fiche chauffeur introuvable.' })
    if (error instanceof Error && error.message === 'DRIVER_ALREADY_LINKED') return res.status(409).json({ error: 'Cette fiche chauffeur est déjà liée à un autre compte.' })
    if (error instanceof Error && error.message === 'LAST_ACTIVE_ADMIN') return res.status(409).json({ error: 'Le dernier administrateur actif doit être conservé.' })
    throw error
  }
}
