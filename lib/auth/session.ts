import { createHmac, timingSafeEqual } from 'crypto'
import type { IncomingMessage } from 'http'
import type { NextApiRequest, NextApiResponse } from 'next'
import { OrganizationRole, PlatformRole, UserRole } from '@prisma/client'
import { prisma } from '../prisma'
import { enterOrganizationContext, selectActiveOrganizationMembership } from './organization-context'
import { assertDomainSessionCoherence, resolveOrganizationFromRequest } from '../tenant/request-resolution'

export const sessionCookieName = 'gerard_session'

const sessionDurationSeconds = 60 * 60 * 24 * 7
const allowedDispatcherRoles = new Set<UserRole>([
  UserRole.ADMIN,
  UserRole.DISPATCHER,
  UserRole.SECRETARY,
  UserRole.PARK_MANAGER,
])

type SessionPayload = {
  userId: string
  username: string
  role: UserRole
  driverId?: string | null
  sessionVersion?: number
  platformRole?: PlatformRole | null
  organizationId?: string | null
  organizationRole?: OrganizationRole | null
  exp: number
}

type SessionUser = Omit<SessionPayload, 'exp'>

type SessionUserInput = {
  id: string
  username: string | null
  role: UserRole
  driverId?: string | null
  sessionVersion?: number
  platformRole?: PlatformRole | null
  organizationId?: string | null
  organizationRole?: OrganizationRole | null
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET

  if (!secret) {
    throw new Error('JWT_SECRET is missing')
  }

  return secret
}

function base64UrlEncode(value: string) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function base64UrlDecode(value: string) {
  const normalizedValue = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = '='.repeat((4 - (normalizedValue.length % 4)) % 4)

  return Buffer.from(`${normalizedValue}${padding}`, 'base64').toString('utf8')
}

function signTokenPart(value: string) {
  return createHmac('sha256', getJwtSecret()).update(value).digest('base64url')
}

function parseCookies(req: IncomingMessage) {
  const cookieHeader = req.headers.cookie

  if (!cookieHeader) {
    return new Map<string, string>()
  }

  return new Map(
    cookieHeader.split(';').map((cookie) => {
      const [name, ...rawValueParts] = cookie.trim().split('=')
      return [name, decodeURIComponent(rawValueParts.join('='))]
    })
  )
}

function serializeCookie(value: string, maxAge: number) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''

  return `${sessionCookieName}=${encodeURIComponent(
    value
  )}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

export function createSessionToken(user: SessionUserInput) {
  if (!user.username) {
    throw new Error('Session user username is missing')
  }

  const header = base64UrlEncode(
    JSON.stringify({
      alg: 'HS256',
      typ: 'JWT',
    })
  )
  const payload = base64UrlEncode(
    JSON.stringify({
      userId: user.id,
      username: user.username,
      role: user.role,
      driverId: user.driverId ?? null,
      sessionVersion: user.sessionVersion ?? 0,
      platformRole: user.platformRole ?? null,
      organizationId: user.organizationId ?? null,
      organizationRole: user.organizationRole ?? null,
      exp: Math.floor(Date.now() / 1000) + sessionDurationSeconds,
    })
  )
  const unsignedToken = `${header}.${payload}`
  const signature = signTokenPart(unsignedToken)

  return `${unsignedToken}.${signature}`
}

export function verifySessionToken(token: string): SessionUser | null {
  const [header, payload, signature] = token.split('.')

  if (!header || !payload || !signature) {
    return null
  }

  const expectedSignature = signTokenPart(`${header}.${payload}`)
  const signatureBuffer = new TextEncoder().encode(signature)
  const expectedSignatureBuffer = new TextEncoder().encode(expectedSignature)

  if (signatureBuffer.length !== expectedSignatureBuffer.length) {
    return null
  }

  if (!timingSafeEqual(signatureBuffer, expectedSignatureBuffer)) {
    return null
  }

  let parsedPayload: Partial<SessionPayload>

  try {
    parsedPayload = JSON.parse(
      base64UrlDecode(payload)
    ) as Partial<SessionPayload>
  } catch {
    return null
  }

  if (
    typeof parsedPayload.userId !== 'string' ||
    typeof parsedPayload.username !== 'string' ||
    !isUserRole(parsedPayload.role) ||
    typeof parsedPayload.exp !== 'number' ||
    parsedPayload.exp < Math.floor(Date.now() / 1000)
  ) {
    return null
  }

  return {
    userId: parsedPayload.userId,
    username: parsedPayload.username,
    role: parsedPayload.role,
    driverId:
      typeof parsedPayload.driverId === 'string'
        ? parsedPayload.driverId
        : null,
    sessionVersion:
      typeof parsedPayload.sessionVersion === 'number'
        ? parsedPayload.sessionVersion
        : 0,
    platformRole: Object.values(PlatformRole).includes(parsedPayload.platformRole as PlatformRole)
      ? parsedPayload.platformRole as PlatformRole
      : null,
    organizationId: typeof parsedPayload.organizationId === 'string' ? parsedPayload.organizationId : null,
    organizationRole: Object.values(OrganizationRole).includes(parsedPayload.organizationRole as OrganizationRole)
      ? parsedPayload.organizationRole as OrganizationRole
      : null,
  }
}

export function getSessionUser(req: IncomingMessage) {
  const token = parseCookies(req).get(sessionCookieName)

  return token ? verifySessionToken(token) : null
}

export function setSessionCookie(res: NextApiResponse, token: string) {
  res.setHeader('Set-Cookie', serializeCookie(token, sessionDurationSeconds))
}

export function clearSessionCookie(res: NextApiResponse) {
  res.setHeader('Set-Cookie', serializeCookie('', 0))
}

export async function requireDispatcher(req: NextApiRequest, res: NextApiResponse) {
  const sessionUser = getSessionUser(req)

  if (!sessionUser) {
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.userId },
    select: {
      role: true,
      isActive: true,
      mustChangePassword: true,
      sessionVersion: true,
      platformRole: true,
      organizationMemberships: {
        where: {
          ...(sessionUser.organizationId ? { organizationId: sessionUser.organizationId } : {}),
          organization: { status: 'ACTIVE' },
        },
        take: sessionUser.organizationId ? 1 : 2,
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!user || user.sessionVersion !== (sessionUser.sessionVersion ?? 0)) {
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }
  if (!user.isActive || user.mustChangePassword || !allowedDispatcherRoles.has(user.role)) {
    res.status(403).json({ error: user.mustChangePassword ? 'Password change required' : 'Forbidden' })
    return null
  }

  const membership = selectActiveOrganizationMembership(user.organizationMemberships, sessionUser.organizationId)
  if (!membership) {
    res.status(403).json({ error: 'Organisation active requise' })
    return null
  }
  try {
    assertDomainSessionCoherence(await resolveOrganizationFromRequest(req), membership.organizationId)
  } catch {
    res.status(403).json({ error: 'Domaine et organisation active incompatibles', code: 'DOMAIN_ORGANIZATION_MISMATCH' })
    return null
  }
  enterOrganizationContext({ userId: sessionUser.userId, platformRole: user.platformRole, organizationId: membership.organizationId, organizationRole: membership.role })
  return { ...sessionUser, role: user.role, platformRole: user.platformRole, organizationId: membership.organizationId, organizationRole: membership.role }
}

export function canAccessDispatcher(sessionUser: SessionUser | null) {
  return Boolean(sessionUser && allowedDispatcherRoles.has(sessionUser.role))
}

export function canAccessDriver(sessionUser: SessionUser | null) {
  return Boolean(sessionUser && sessionUser.role === UserRole.DRIVER)
}

function isUserRole(value: unknown): value is UserRole {
  return (
    value === UserRole.ADMIN ||
    value === UserRole.DISPATCHER ||
    value === UserRole.SECRETARY ||
    value === UserRole.PARK_MANAGER ||
    value === UserRole.DRIVER
  )
}
