import { Prisma, UserRole } from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requireAdmin } from '../../../../lib/auth/authorization'
import { hashPassword } from '../../../../lib/auth/password'
import { safeUserSelect } from '../../../../lib/auth/safe-user'
import { isUserRole, normalizeUsername, passwordError, usernameError } from '../../../../lib/auth/validation'
import { prisma } from '../../../../lib/prisma'

function text(value: unknown) { return typeof value === 'string' ? value.trim() : '' }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const admin = await requireAdmin(req, res)
  if (!admin) return

  if (req.method === 'GET') {
    const search = text(req.query.search)
    const role = isUserRole(req.query.role) ? req.query.role : undefined
    const active = req.query.active === 'true' ? true : req.query.active === 'false' ? false : undefined
    const mustChangePassword = req.query.mustChangePassword === 'true' ? true : req.query.mustChangePassword === 'false' ? false : undefined
    const where: Prisma.UserWhereInput = {
      organizationMemberships: { some: { organizationId: admin.organizationId } },
      ...(role ? { role } : {}),
      ...(typeof active === 'boolean' ? { isActive: active } : {}),
      ...(typeof mustChangePassword === 'boolean' ? { mustChangePassword } : {}),
      ...(search ? { OR: [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
      ] } : {}),
    }
    const [users, total, activeCount, mustChangeCount, roleCounts, drivers] = await prisma.$transaction([
      prisma.user.findMany({ where, select: safeUserSelect, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
      prisma.user.count({ where: { organizationMemberships: { some: { organizationId: admin.organizationId } } } }),
      prisma.user.count({ where: { isActive: true, organizationMemberships: { some: { organizationId: admin.organizationId } } } }),
      prisma.user.count({ where: { mustChangePassword: true, organizationMemberships: { some: { organizationId: admin.organizationId } } } }),
      prisma.user.groupBy({ by: ['role'], where: { organizationMemberships: { some: { organizationId: admin.organizationId } } }, _count: { _all: true } }),
      prisma.driver.findMany({ select: { id: true, name: true, user: { select: { id: true } } }, orderBy: { name: 'asc' } }),
    ])
    return res.status(200).json({
      users,
      drivers: drivers.map(driver => ({ id: driver.id, name: driver.name, linkedUserId: driver.user?.id ?? null })),
      stats: { total, active: activeCount, mustChangePassword: mustChangeCount, roles: Object.fromEntries(roleCounts.map(item => [item.role, item._count._all])) },
    })
  }

  if (req.method === 'POST') {
    const firstName = text(req.body?.firstName)
    const lastName = text(req.body?.lastName)
    const username = normalizeUsername(text(req.body?.username))
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    const role = req.body?.role
    const driverId = text(req.body?.driverId) || null
    const usernameValidationError = usernameError(username)
    const validationError = !firstName || !lastName ? 'Le prénom et le nom sont requis.'
      : usernameValidationError ? usernameValidationError
      : !isUserRole(role) ? 'Rôle invalide.'
      : role === UserRole.DRIVER && !driverId ? 'Un compte Chauffeur doit être lié à une fiche chauffeur existante.'
      : role !== UserRole.DRIVER && driverId ? 'La liaison chauffeur est réservée au rôle Chauffeur.'
      : passwordError(password)
    if (validationError) return res.status(400).json({ error: validationError })
    if (password !== req.body?.passwordConfirmation) return res.status(400).json({ error: 'La confirmation ne correspond pas.' })

    try {
      const user = await prisma.$transaction(async tx => {
        if (driverId) {
          const driver = await tx.driver.findUnique({ where: { id: driverId }, select: { user: { select: { id: true } } } })
          if (!driver) throw new Error('DRIVER_NOT_FOUND')
          if (driver.user) throw new Error('DRIVER_ALREADY_LINKED')
        }
        const user = await tx.user.create({ data: {
          firstName, lastName, name: `${firstName} ${lastName}`, email: null, username,
          passwordHash: hashPassword(password), role, driverId,
          isActive: req.body?.isActive !== false, mustChangePassword: true,
          temporaryPasswordIssuedAt: new Date(),
        }, select: safeUserSelect })
        await tx.organizationUser.create({ data: {
          organizationId: admin.organizationId,
          userId: user.id,
          role: role === UserRole.ADMIN ? 'ORG_ADMIN'
            : role === UserRole.DISPATCHER ? 'DISPATCHER'
            : role === UserRole.SECRETARY ? 'SECRETARY'
            : role === UserRole.PARK_MANAGER ? 'MANAGER'
            : 'DRIVER',
        } })
        return user
      })
      return res.status(201).json({ user })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ error: 'Ce username ou cette fiche chauffeur est déjà utilisé.' })
      if (error instanceof Error && error.message === 'DRIVER_NOT_FOUND') return res.status(400).json({ error: 'Fiche chauffeur introuvable.' })
      if (error instanceof Error && error.message === 'DRIVER_ALREADY_LINKED') return res.status(409).json({ error: 'Cette fiche chauffeur est déjà liée à un compte.' })
      throw error
    }
  }

  res.setHeader('Allow', 'GET, POST')
  return res.status(405).json({ error: 'Méthode non autorisée' })
}
