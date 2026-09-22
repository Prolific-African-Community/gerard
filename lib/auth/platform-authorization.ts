import { PlatformRole } from '@prisma/client'
import type { IncomingMessage } from 'http'
import type { NextApiRequest, NextApiResponse } from 'next'

import { prisma } from '../prisma'
import { getSessionUser } from './session'

export type PlatformUser = {
  id: string
  firstName: string
  lastName: string
  username: string
  platformRole: PlatformRole
}

export async function getPlatformUser(req: IncomingMessage): Promise<PlatformUser | null> {
  const session = getSessionUser(req)
  if (!session) return null

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      username: true,
      platformRole: true,
      isActive: true,
      mustChangePassword: true,
      sessionVersion: true,
    },
  })

  if (
    !user ||
    !user.isActive ||
    user.mustChangePassword ||
    user.sessionVersion !== (session.sessionVersion ?? 0) ||
    !user.platformRole
  ) return null

  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    platformRole: user.platformRole,
  }
}

export async function requirePlatformAccess(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const user = await getPlatformUser(req)
  if (!user) {
    res.status(403).json({ error: 'Accès plateforme interdit' })
    return null
  }
  return user
}

export async function requireSuperAdmin(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const user = await requirePlatformAccess(req, res)
  if (!user) return null
  if (user.platformRole !== PlatformRole.SUPER_ADMIN) {
    res.status(403).json({ error: 'Action réservée au SUPER_ADMIN' })
    return null
  }
  return user
}

export function canMutatePlatform(user: PlatformUser) {
  return user.platformRole === PlatformRole.SUPER_ADMIN
}
