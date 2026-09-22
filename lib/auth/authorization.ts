import { UserRole } from '@prisma/client'
import type { OrganizationModule, OrganizationRole, PlatformRole, User } from '@prisma/client'
import type { IncomingMessage } from 'http'
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next'

import { prisma } from '../prisma'
import { getSessionUser } from './session'
import {
  hasAnyPermission,
  hasPermission,
  permissions,
} from './permissions'
import type { Permission } from './permissions'
import { enterOrganizationContext, getActiveOrganizationContext, runWithOrganization, selectActiveOrganizationMembership } from './organization-context'
import { assertDomainSessionCoherence, resolveOrganizationFromRequest } from '../tenant/request-resolution'

export type SafeCurrentUser = Omit<User, 'passwordHash'> & {
  organizationId: string
  organizationRole: OrganizationRole
  platformRole: PlatformRole | null
  enabledModules: OrganizationModule[]
}

export async function getCurrentUser(req: IncomingMessage): Promise<SafeCurrentUser | null> {
  const session = getSessionUser(req)
  if (!session) return null

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: {
      organizationMemberships: {
        where: {
          ...(session.organizationId ? { organizationId: session.organizationId } : {}),
          organization: { status: 'ACTIVE' },
        },
        take: session.organizationId ? 1 : 2,
        include: { organization: { select: { enabledModules: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!user || user.sessionVersion !== (session.sessionVersion ?? 0)) return null

  const membership = selectActiveOrganizationMembership(user.organizationMemberships, session.organizationId)
  if (!membership) return null
  try {
    assertDomainSessionCoherence(await resolveOrganizationFromRequest(req), membership.organizationId)
  } catch {
    return null
  }

  enterOrganizationContext({
    userId: user.id,
    platformRole: user.platformRole,
    organizationId: membership.organizationId,
    organizationRole: membership.role,
  })

  const { passwordHash: _passwordHash, organizationMemberships: _memberships, ...safeUser } = user
  return {
    ...safeUser,
    organizationId: membership.organizationId,
    organizationRole: membership.role,
    enabledModules: membership.organization.enabledModules,
  }
}

export function getActiveOrganization(user: SafeCurrentUser) {
  const context = getActiveOrganizationContext()
  if (!context || context.userId !== user.id) throw new Error('ORGANIZATION_CONTEXT_REQUIRED')
  return context
}

export function runWithCurrentOrganization<T>(user: SafeCurrentUser, task: () => T) {
  return runWithOrganization({
    userId: user.id,
    platformRole: user.platformRole,
    organizationId: user.organizationId,
    organizationRole: user.organizationRole,
  }, task)
}

export function withTenantApiRoute(handler: NextApiHandler): NextApiHandler {
  return async (req, res) => {
    const user = await getCurrentUser(req)
    if (!user) return res.status(401).json({ error: 'Authentification requise' })
    return runWithCurrentOrganization(user, () => handler(req, res))
  }
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
  const requiredModule = moduleForPermission(permission)
  if (requiredModule && !user.enabledModules.includes(requiredModule)) {
    res.status(403).json({ error: 'Module désactivé', code: 'MODULE_DISABLED', module: requiredModule })
    return null
  }
  return user
}

const permissionModules: Partial<Record<Permission, OrganizationModule>> = {
  [permissions.dispatchView]: 'PLANNING',
  [permissions.dispatchAssign]: 'PLANNING',
  [permissions.dispatchDragDrop]: 'PLANNING',
  [permissions.missionsView]: 'PLANNING',
  [permissions.missionsCreate]: 'PLANNING',
  [permissions.missionsEdit]: 'PLANNING',
  [permissions.missionsDelete]: 'PLANNING',
  [permissions.customersView]: 'PLANNING',
  [permissions.customersManage]: 'PLANNING',
  [permissions.customersDelete]: 'PLANNING',
  [permissions.driversView]: 'PLANNING',
  [permissions.driversManage]: 'PLANNING',
  [permissions.driversCredentialsManage]: 'PLANNING',
  [permissions.driversDelete]: 'PLANNING',
  [permissions.trucksView]: 'PLANNING',
  [permissions.trucksManage]: 'PLANNING',
  [permissions.trucksDelete]: 'PLANNING',
  [permissions.trailersView]: 'PLANNING',
  [permissions.trailersManage]: 'PLANNING',
  [permissions.trailersDelete]: 'PLANNING',
  [permissions.importsView]: 'PLANNING',
  [permissions.importsManage]: 'PLANNING',
  [permissions.mapView]: 'MAP',
  [permissions.profitabilityView]: 'PROFITABILITY',
  [permissions.profitabilityManage]: 'PROFITABILITY',
  [permissions.invoicesView]: 'INVOICING',
  [permissions.invoicesManage]: 'INVOICING',
  [permissions.maintenanceView]: 'MAINTENANCE',
  [permissions.maintenanceRequest]: 'MAINTENANCE',
  [permissions.maintenanceManage]: 'MAINTENANCE',
  [permissions.parkView]: 'FLEET',
  [permissions.parkMove]: 'FLEET',
  [permissions.parkHistoryView]: 'FLEET',
  [permissions.parkInspectionView]: 'FLEET',
  [permissions.parkInspectionManage]: 'FLEET',
}

export function moduleForPermission(permission: Permission) {
  return permissionModules[permission] ?? null
}

export async function requireOrganizationModule(
  req: NextApiRequest,
  res: NextApiResponse,
  module: OrganizationModule,
) {
  const user = await requireActiveUser(req, res)
  if (!user) return null
  if (!user.enabledModules.includes(module)) {
    res.status(403).json({ error: 'Module désactivé', code: 'MODULE_DISABLED', module })
    return null
  }
  return user
}

export async function requireOrganizationContext(req: NextApiRequest, res: NextApiResponse) {
  return requireActiveUser(req, res)
}

export async function requireOrganizationPermission(
  req: NextApiRequest,
  res: NextApiResponse,
  permission: Permission
) {
  return requirePermission(req, res, permission)
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
