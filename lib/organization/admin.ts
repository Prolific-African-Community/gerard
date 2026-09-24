import { randomBytes } from 'node:crypto'
import { OrganizationRole } from '@prisma/client'

import { prisma } from '../prisma'

export const organizationAdminRoles = Object.values(OrganizationRole)

export async function getOrganizationAdminWorkspace(organizationId: string) {
  return prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true, name: true, slug: true, status: true, enabledModules: true,
      displayName: true, logoUrl: true, accentColor: true, faviconUrl: true, applicationTitle: true,
      users: {
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true, role: true, createdAt: true,
          user: { select: { id: true, firstName: true, lastName: true, username: true, email: true, isActive: true, mustChangePassword: true } },
        },
      },
    },
  })
}

export function generateTemporaryPassword() {
  return `G!${randomBytes(18).toString('base64url')}9a`
}
