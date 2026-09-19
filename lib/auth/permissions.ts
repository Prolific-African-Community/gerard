import { UserRole } from '@prisma/client'
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

export function hasPermission(
  user: { role: UserRole; isActive?: boolean } | null,
  permission: Permission
) {
  return Boolean(user && user.isActive !== false && rolePermissions[user.role].has(permission))
}

export function hasAnyPermission(
  user: { role: UserRole; isActive?: boolean } | null,
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
