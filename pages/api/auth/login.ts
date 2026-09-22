import type { NextApiRequest, NextApiResponse } from 'next'

import { verifyPassword } from '../../../lib/auth/password'
import { createSessionToken, setSessionCookie } from '../../../lib/auth/session'
import { prisma } from '../../../lib/prisma'
import { homeForRole } from '../../../lib/auth/authorization'
import { normalizeUsername, usernameError } from '../../../lib/auth/validation'
import { isConfiguredPlatformHostname, resolveOrganizationFromRequest } from '../../../lib/tenant/request-resolution'
import { selectActiveOrganizationMembership } from '../../../lib/auth/organization-context'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseBody(body: unknown) {
  if (!isRecord(body)) {
    return null
  }

  if (typeof body.username !== 'string' || typeof body.password !== 'string') {
    return null
  }

  const username = normalizeUsername(body.username)

  if (usernameError(username) || !body.password) {
    return null
  }

  return {
    username,
    password: body.password,
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const body = parseBody(req.body)

  if (!body) {
    return res.status(400).json({ error: 'Invalid credentials' })
  }

  try {
    const domainResolution = await resolveOrganizationFromRequest(req)
    const user = await prisma.user.findFirst({
      where: { username: { equals: body.username, mode: 'insensitive' } },
      include: {
        organizationMemberships: {
          where: {
            organization: { status: 'ACTIVE' },
            ...(domainResolution.status === 'resolved' ? { organizationId: domainResolution.organizationId! } : {}),
          },
          include: { organization: true },
          orderBy: { createdAt: 'asc' },
          take: 2,
        },
      },
    })

    if (
      !user ||
      !user.username ||
      !user.passwordHash ||
      !verifyPassword(body.password, user.passwordHash)
    ) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    if (!user.isActive) {
      return res.status(403).json({ error: 'Compte inactif' })
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    const membership = selectActiveOrganizationMembership(user.organizationMemberships)
    if (!membership && !user.platformRole) {
      return res.status(403).json({ error: 'Organisation inactive ou inaccessible' })
    }

    if (domainResolution.status !== 'resolved' && domainResolution.status !== 'local' && !(user.platformRole && isConfiguredPlatformHostname(domainResolution.hostname))) {
      return res.status(403).json({ error: 'Domaine organisation inconnu', code: 'UNKNOWN_ORGANIZATION_DOMAIN' })
    }
    setSessionCookie(res, createSessionToken({
      ...user,
      organizationId: membership?.organizationId ?? null,
      organizationRole: membership?.role ?? null,
    }))

    return res.status(200).json({
      ok: true,
      redirectTo: user.mustChangePassword
        ? '/change-password'
        : user.platformRole
          ? '/admin'
          : homeForRole(user.role),
    })
  } catch (error) {
    console.error('Failed to login dispatcher', error)
    return res.status(500).json({ error: 'Login failed' })
  }
}
