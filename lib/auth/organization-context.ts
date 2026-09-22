import { AsyncLocalStorage } from 'node:async_hooks'
import type { OrganizationRole, PlatformRole } from '@prisma/client'

export type ActiveOrganizationContext = {
  organizationId: string
  organizationRole: OrganizationRole
  platformRole: PlatformRole | null
  userId: string
}

const storageKey = Symbol.for('gerard.organization-context')
const globalOrganizationContext = globalThis as typeof globalThis & {
  [storageKey]?: AsyncLocalStorage<ActiveOrganizationContext>
}
const organizationStorage = globalOrganizationContext[storageKey]
  ?? new AsyncLocalStorage<ActiveOrganizationContext>()
globalOrganizationContext[storageKey] = organizationStorage

export function getActiveOrganizationContext() {
  return organizationStorage.getStore() ?? null
}

export function requireActiveOrganizationId() {
  const context = getActiveOrganizationContext()
  if (!context) throw new Error('ORGANIZATION_CONTEXT_REQUIRED')
  return context.organizationId
}

export function enterOrganizationContext(context: ActiveOrganizationContext) {
  organizationStorage.enterWith(context)
  return context
}

export function runWithOrganization<T>(context: ActiveOrganizationContext, task: () => T) {
  return organizationStorage.run(context, task)
}

export function scopeToOrganization<T extends Record<string, unknown>>(where: T = {} as T) {
  return { ...where, organizationId: requireActiveOrganizationId() }
}

export function selectActiveOrganizationMembership<T extends { organizationId: string }>(
  memberships: readonly T[],
  requestedOrganizationId?: string | null,
) {
  if (requestedOrganizationId) {
    return memberships.find((membership) => membership.organizationId === requestedOrganizationId) ?? null
  }
  return memberships.length === 1 ? memberships[0] : null
}
