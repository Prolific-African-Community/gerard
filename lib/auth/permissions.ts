import { OrganizationRole, UserRole } from '@prisma/client'
import type { DispatchCapabilities } from './dispatch-capabilities'

export const permissions = {
  usersManage: 'users.manage',
  dispatchView: 'dispatch.view',
  dispatchAssign: 'dispatch.assign',
  dispatchDragDrop: 'dispatch.drag_drop',
  missionsView: 'missions.view',
  missionsCreate: 'missions.create',
  missionsEdit: 'missions.edit',
  missionsDelete: 'missions.delete',
  customersView: 'customers.view',
  customersManage: 'customers.manage',
  customersDelete: 'customers.delete',
  driversView: 'drivers.view',
  driversManage: 'drivers.manage',
  driversCredentialsManage: 'drivers.credentials_manage',
  driversDelete: 'drivers.delete',
  trucksView: 'trucks.view',
  trucksManage: 'trucks.manage',
  trucksDelete: 'trucks.delete',
  trailersView: 'trailers.view',
  trailersManage: 'trailers.manage',
  trailersDelete: 'trailers.delete',
  mapView: 'map.view',
  importsView: 'imports.view',
  importsManage: 'imports.manage',
  profitabilityView: 'profitability.view',
  profitabilityManage: 'profitability.manage',
  invoicesView: 'invoices.view',
  invoicesManage: 'invoices.manage',
  maintenanceView: 'maintenance.view',
  maintenanceRequest: 'maintenance.request',
  maintenanceManage: 'maintenance.manage',
  parkView: 'park.view',
  parkMove: 'park.move',
  parkHistoryView: 'park.history.view',
  parkInspectionView: 'park.inspection.view',
  parkInspectionManage: 'park.inspection.manage',
} as const

export type Permission = (typeof permissions)[keyof typeof permissions]

const allPermissions = Object.values(permissions)

/** Fixed Run 2 authorization matrix. Missing permissions are denied by default. */
export const rolePermissions: Readonly<Record<UserRole, ReadonlySet<Permission>>> = {
  // Super-utilisateur : l'administrateur possède toutes les permissions
  // fonctionnelles, y compris la gestion du Parc et de ses contrôles.
  [UserRole.ADMIN]: new Set(allPermissions),
  [UserRole.DISPATCHER]: new Set(
    allPermissions.filter(
      (permission) =>
        permission !== permissions.usersManage &&
        permission !== permissions.driversCredentialsManage &&
        permission !== permissions.parkMove &&
        permission !== permissions.parkInspectionManage
    )
  ),
  [UserRole.SECRETARY]: new Set([
    permissions.dispatchView,
    permissions.missionsView,
    permissions.missionsCreate,
    permissions.missionsEdit,
    permissions.customersView,
    permissions.customersManage,
    permissions.driversView,
    permissions.driversManage,
    permissions.trucksView,
    permissions.trucksManage,
    permissions.trailersView,
    permissions.trailersManage,
    permissions.mapView,
    permissions.importsView,
    permissions.importsManage,
    permissions.profitabilityView,
    permissions.profitabilityManage,
    permissions.invoicesView,
    permissions.invoicesManage,
    permissions.maintenanceView,
    permissions.maintenanceRequest,
    permissions.parkView,
    permissions.parkHistoryView,
    permissions.parkInspectionView,
  ]),
  [UserRole.PARK_MANAGER]: new Set([
    permissions.parkView,
    permissions.parkMove,
    permissions.parkHistoryView,
    permissions.parkInspectionView,
    permissions.parkInspectionManage,
    permissions.maintenanceView,
    permissions.maintenanceRequest,
  ]),
  [UserRole.DRIVER]: new Set(),
}

export const organizationRolePermissions: Readonly<Record<OrganizationRole, ReadonlySet<Permission>>> = {
  [OrganizationRole.ORG_ADMIN]: new Set(allPermissions),
  [OrganizationRole.MANAGER]: new Set(allPermissions.filter(permission =>
    permission !== permissions.usersManage &&
    permission !== permissions.driversCredentialsManage
  )),
  [OrganizationRole.DISPATCHER]: rolePermissions[UserRole.DISPATCHER],
  [OrganizationRole.SECRETARY]: rolePermissions[UserRole.SECRETARY],
  [OrganizationRole.ACCOUNTING]: new Set([
    permissions.dispatchView,
    permissions.missionsView,
    permissions.customersView,
    permissions.profitabilityView,
    permissions.profitabilityManage,
    permissions.invoicesView,
    permissions.invoicesManage,
  ]),
  [OrganizationRole.DRIVER]: new Set(),
  [OrganizationRole.VIEWER]: new Set([
    permissions.dispatchView,
    permissions.missionsView,
    permissions.customersView,
    permissions.driversView,
    permissions.trucksView,
    permissions.trailersView,
    permissions.mapView,
    permissions.profitabilityView,
    permissions.invoicesView,
    permissions.maintenanceView,
    permissions.parkView,
    permissions.parkHistoryView,
    permissions.parkInspectionView,
  ]),
}

export function hasPermission(
  user: { role: UserRole; organizationRole?: OrganizationRole; isActive?: boolean } | null,
  permission: Permission
) {
  return Boolean(user && user.isActive !== false && (user.organizationRole
    ? organizationRolePermissions[user.organizationRole]
    : rolePermissions[user.role]).has(permission))
}

export function hasAnyPermission(
  user: { role: UserRole; organizationRole?: OrganizationRole; isActive?: boolean } | null,
  requiredPermissions: readonly Permission[]
) {
  return requiredPermissions.some((permission) => hasPermission(user, permission))
}

export function getDispatchCapabilities(role: UserRole): DispatchCapabilities {
  const user = { role, isActive: true }
  return {
    canViewPlanning: hasPermission(user, permissions.dispatchView),
    canCreateMission: hasPermission(user, permissions.missionsCreate),
    canEditMission: hasPermission(user, permissions.missionsEdit),
    canDeleteMission: hasPermission(user, permissions.missionsDelete),
    canAssign: hasPermission(user, permissions.dispatchAssign),
    canDragDrop: hasPermission(user, permissions.dispatchDragDrop),
    canManageCustomers: hasPermission(user, permissions.customersManage),
    canManageDrivers: hasPermission(user, permissions.driversManage),
    canManageDriverCredentials: hasPermission(
      user,
      permissions.driversCredentialsManage
    ),
    canManageTrucks: hasPermission(user, permissions.trucksManage),
    canManageTrailers: hasPermission(user, permissions.trailersManage),
    canDeleteResources:
      hasPermission(user, permissions.driversDelete) &&
      hasPermission(user, permissions.trucksDelete) &&
      hasPermission(user, permissions.trailersDelete),
    canViewImports: hasPermission(user, permissions.importsView),
    canManageImports: hasPermission(user, permissions.importsManage),
    canViewMap: hasPermission(user, permissions.mapView),
    canViewProfitability: hasPermission(user, permissions.profitabilityView),
    canManageProfitability: hasPermission(user, permissions.profitabilityManage),
    canViewInvoices: hasPermission(user, permissions.invoicesView),
    canManageInvoices: hasPermission(user, permissions.invoicesManage),
    canViewMaintenance: hasPermission(user, permissions.maintenanceView),
    canRequestMaintenance: hasPermission(user, permissions.maintenanceRequest),
    canManageMaintenance: hasPermission(user, permissions.maintenanceManage),
    canViewPark: hasPermission(user, permissions.parkView),
    canMovePark: hasPermission(user, permissions.parkMove),
    canViewParkHistory: hasPermission(user, permissions.parkHistoryView),
    canViewParkInspections: hasPermission(user, permissions.parkInspectionView),
    canManageParkInspections: hasPermission(
      user,
      permissions.parkInspectionManage
    ),
  }
}

export function getDispatchCapabilitiesForUser(user: {
  role: UserRole
  organizationRole?: OrganizationRole
  isActive?: boolean
  enabledModules: readonly string[]
}): DispatchCapabilities {
  const allowed = (permission: Permission) => {
    const module = moduleForPermissionName(permission)
    return hasPermission(user, permission) && (!module || user.enabledModules.includes(module))
  }
  return {
    canViewPlanning: allowed(permissions.dispatchView),
    canCreateMission: allowed(permissions.missionsCreate),
    canEditMission: allowed(permissions.missionsEdit),
    canDeleteMission: allowed(permissions.missionsDelete),
    canAssign: allowed(permissions.dispatchAssign),
    canDragDrop: allowed(permissions.dispatchDragDrop),
    canManageCustomers: allowed(permissions.customersManage),
    canManageDrivers: allowed(permissions.driversManage),
    canManageDriverCredentials: allowed(permissions.driversCredentialsManage),
    canManageTrucks: allowed(permissions.trucksManage),
    canManageTrailers: allowed(permissions.trailersManage),
    canDeleteResources: allowed(permissions.driversDelete) && allowed(permissions.trucksDelete) && allowed(permissions.trailersDelete),
    canViewImports: allowed(permissions.importsView),
    canManageImports: allowed(permissions.importsManage),
    canViewMap: allowed(permissions.mapView),
    canViewProfitability: allowed(permissions.profitabilityView),
    canManageProfitability: allowed(permissions.profitabilityManage),
    canViewInvoices: allowed(permissions.invoicesView),
    canManageInvoices: allowed(permissions.invoicesManage),
    canViewMaintenance: allowed(permissions.maintenanceView),
    canRequestMaintenance: allowed(permissions.maintenanceRequest),
    canManageMaintenance: allowed(permissions.maintenanceManage),
    canViewPark: allowed(permissions.parkView),
    canMovePark: allowed(permissions.parkMove),
    canViewParkHistory: allowed(permissions.parkHistoryView),
    canViewParkInspections: allowed(permissions.parkInspectionView),
    canManageParkInspections: allowed(permissions.parkInspectionManage),
  }
}

function moduleForPermissionName(permission: Permission) {
  if (permission === permissions.mapView) return 'MAP'
  if (permission === permissions.profitabilityView || permission === permissions.profitabilityManage) return 'PROFITABILITY'
  if (permission === permissions.invoicesView || permission === permissions.invoicesManage) return 'INVOICING'
  if (permission.startsWith('maintenance.')) return 'MAINTENANCE'
  if (permission.startsWith('park.')) return 'FLEET'
  if (permission === permissions.usersManage) return null
  return 'PLANNING'
}
