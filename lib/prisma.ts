import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { getActiveOrganizationContext } from "./auth/organization-context";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is missing");
}

const tenantModels = new Set([
  'ClientProfile', 'DispatchOptimizationApplication', 'Driver',
  'DriverActivityEvent', 'DriverPosition', 'DriverRegulatoryDeclaration',
  'IgnoredMailImport', 'Invoice', 'InvoiceLine', 'InvoiceMission',
  'MaintenanceInterventionLine', 'MaintenanceRequest',
  'MaintenanceStatusHistory', 'Mission', 'MissionAssignment', 'MissionEvent',
  'MissionSourceEmail', 'ParkInspection', 'ParkInspectionResult',
  'ParkMovement', 'ParkSpot', 'PlanningRow', 'Trailer',
  'TrailerCustodyEvent', 'Truck', 'TruckEvent', 'TruckPosition',
  'WeeklyProfitabilityAdjustment',
]);

function tenantArgs(model: string | undefined, operation: string, args: any) {
  if (!model || !tenantModels.has(model)) return args;
  const context = getActiveOrganizationContext();
  if (!context) throw new Error(`ORGANIZATION_CONTEXT_REQUIRED:${model}:${operation}`);
  const organizationId = context.organizationId;
  const scoped = { ...(args ?? {}) };
  if (['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy', 'update', 'updateMany', 'delete', 'deleteMany'].includes(operation)) {
    scoped.where = { ...(scoped.where ?? {}), organizationId };
  }
  const injectNestedOrganization = (value: any): any => {
    if (Array.isArray(value)) return value.map(injectNestedOrganization);
    if (!value || typeof value !== 'object' || value instanceof Date) return value;
    const result: any = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === 'create') {
        result[key] = Array.isArray(child)
          ? child.map((item) => ({ ...injectNestedOrganization(item), organizationId }))
          : { ...injectNestedOrganization(child), organizationId };
      } else if (key === 'createMany' && child && typeof child === 'object') {
        const createMany = injectNestedOrganization(child);
        createMany.data = Array.isArray(createMany.data)
          ? createMany.data.map((item: any) => ({ ...item, organizationId }))
          : { ...createMany.data, organizationId };
        result[key] = createMany;
      } else {
        result[key] = injectNestedOrganization(child);
      }
    }
    return result;
  };
  if (operation === 'create') scoped.data = { ...injectNestedOrganization(scoped.data ?? {}), organizationId };
  if (operation === 'createMany' || operation === 'createManyAndReturn') {
    scoped.data = Array.isArray(scoped.data)
      ? scoped.data.map((value: any) => ({ ...value, organizationId }))
      : { ...(scoped.data ?? {}), organizationId };
  }
  if (operation === 'upsert') {
    scoped.where = { ...(scoped.where ?? {}), organizationId };
    scoped.create = { ...injectNestedOrganization(scoped.create ?? {}), organizationId };
    scoped.update = { ...(scoped.update ?? {}), organizationId };
  }
  if (operation === 'update' || operation === 'updateMany') {
    scoped.data = { ...(scoped.data ?? {}), organizationId };
  }
  return scoped;
}

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: any;
};

const adapter = new PrismaPg({
  connectionString,
});

function createTenantPrisma() {
  return new PrismaClient({
    adapter,
  }).$extends({
    name: 'organization-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return query(tenantArgs(model, operation, args));
        },
      },
    },
  });
}

export const prisma = (globalForPrisma.prisma ?? createTenantPrisma()) as unknown as PrismaClient;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
