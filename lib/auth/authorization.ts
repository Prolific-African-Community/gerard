import { UserRole } from '@prisma/client'
import type { User } from '@prisma/client'
import type { IncomingMessage } from 'http'
import type { NextApiRequest, NextApiResponse } from 'next'

import { prisma } from '../prisma'
import { getSessionUser } from './session'
import {
  hasAnyPermission,
  hasPermission,
  permissions,
} from './permissions'
import type { Permission } from './permissions'

export type SafeCurrentUser = Omit<User, 'passwordHash'>

export async function getCurrentUser(req: IncomingMessage): Promise<SafeCurrentUser | null> {
  const session = getSessionUser(req)
  if (!session) return null

  const user = await prisma.user.findUnique({ where: { id: session.userId } })
  if (!user || user.sessionVersion !== (session.sessionVersion ?? 0)) return null

  const { passwordHash: _passwordHash, ...safeUser } = user
  return safeUser
}

export async function requireAuthenticatedUser(req: NextApiRequest, res: NextApiResponse) {
  const user = await getCurrentUser(req)
  if (!user) res.status(401).json({ error: 'Authentification requise' })
  return user
}

export async function requireActiveUser(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuthenticatedUser(req, res)
  if (!user) return null
  if (!user.isActive) {
    res.status(403).json({ error: 'Compte inactif' })
    return null
  }
  if (user.mustChangePassword) {
    res.status(403).json({ error: 'Changement de mot de passe requis' })
    return null
  }
  return user
}

export async function requireAnyRole(req: NextApiRequest, res: NextApiResponse, roles: UserRole[]) {
  const user = await requireActiveUser(req, res)
  if (!user) return null
  if (!roles.includes(user.role)) {
    res.status(403).json({ error: 'Accès interdit' })
    return null
  }
  return user
}

export function requireRole(req: NextApiRequest, res: NextApiResponse, role: UserRole) {
  return requireAnyRole(req, res, [role])
}

export function requireAdmin(req: NextApiRequest, res: NextApiResponse) {
  return requirePermission(req, res, permissions.usersManage)
}

export async function requirePermission(
  req: NextApiRequest,
  res: NextApiResponse,
  permission: Permission
) {
  const user = await requireActiveUser(req, res)
  if (!user) return null
  if (!hasPermission(user, permission)) {
    res.status(403).json({ error: 'Permission insuffisante' })
    return null
  }
  return user
}

export async function requireAnyPermission(
  req: NextApiRequest,
  res: NextApiResponse,
  requiredPermissions: readonly Permission[]
) {
  const user = await requireActiveUser(req, res)
  if (!user) return null
  if (!hasAnyPermission(user, requiredPermissions)) {
    res.status(403).json({ error: 'Permission insuffisante' })
    return null
  }
  return user
}

export function canManageUsers(user: Pick<User, 'role' | 'isActive'> | null) {
  return hasPermission(user, permissions.usersManage)
}

export function homeForRole(role: UserRole) {
  if (role === UserRole.ADMIN) return '/admin'
  if (role === UserRole.DRIVER) return '/driver'
  if (role === UserRole.PARK_MANAGER) return '/dispatch?view=park'
  return '/dispatch'
}
