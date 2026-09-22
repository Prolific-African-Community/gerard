-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPER_ADMIN', 'PLATFORM_SUPPORT');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('ORG_ADMIN', 'MANAGER', 'DISPATCHER', 'SECRETARY', 'ACCOUNTING', 'DRIVER', 'VIEWER');

-- DropIndex
DROP INDEX "ClientProfile_name_key";

-- DropIndex
DROP INDEX "DispatchOptimizationApplication_idempotencyKey_key";

-- DropIndex
DROP INDEX "IgnoredMailImport_previewKey_key";

-- DropIndex
DROP INDEX "Invoice_invoiceNumber_key";

-- DropIndex
DROP INDEX "Mission_reference_key";

-- DropIndex
DROP INDEX "ParkSpot_code_key";

-- DropIndex
DROP INDEX "PlanningRow_weekStartDate_driverId_key";

-- DropIndex
DROP INDEX "PlanningRow_weekStartDate_truckId_key";

-- DropIndex
DROP INDEX "Trailer_plateNumber_key";

-- DropIndex
DROP INDEX "Truck_plateNumber_key";

-- DropIndex
DROP INDEX "WeeklyProfitabilityAdjustment_weekStartDate_key";

-- AlterTable
ALTER TABLE "ClientProfile" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "DispatchOptimizationApplication" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "DriverActivityEvent" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "DriverPosition" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "DriverRegulatoryDeclaration" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "IgnoredMailImport" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "InvoiceMission" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "MaintenanceInterventionLine" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "MaintenanceRequest" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "MaintenanceStatusHistory" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "MissionAssignment" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "MissionEvent" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "MissionSourceEmail" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ParkInspection" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ParkInspectionResult" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ParkMovement" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ParkSpot" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "PlanningRow" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Trailer" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "TrailerCustodyEvent" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Truck" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "TruckEvent" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "TruckPosition" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "platformRole" "PlatformRole",
ALTER COLUMN "mustChangePassword" SET DEFAULT true;

-- AlterTable
ALTER TABLE "WeeklyProfitabilityAdjustment" ADD COLUMN     "organizationId" TEXT;

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationUser" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrganizationRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationUser_pkey" PRIMARY KEY ("id")
);

-- Create the single tenant that owns every pre-existing Gerard record.
INSERT INTO "Organization" ("id", "name", "slug", "status", "createdAt", "updatedAt")
VALUES ('org-gerard-default', 'Gerard', 'gerard', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Existing users keep their functional role, now expressed as an
-- organization membership. No platform privilege is granted implicitly.
INSERT INTO "OrganizationUser" ("id", "organizationId", "userId", "role", "createdAt", "updatedAt")
SELECT
  'org-user-' || "id",
  'org-gerard-default',
  "id",
  CASE "role"::text
    WHEN 'ADMIN' THEN 'ORG_ADMIN'::"OrganizationRole"
    WHEN 'DISPATCHER' THEN 'DISPATCHER'::"OrganizationRole"
    WHEN 'SECRETARY' THEN 'SECRETARY'::"OrganizationRole"
    WHEN 'PARK_MANAGER' THEN 'MANAGER'::"OrganizationRole"
    WHEN 'DRIVER' THEN 'DRIVER'::"OrganizationRole"
  END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User";

-- Backfill all business rows without touching their existing values.
UPDATE "ClientProfile" SET "organizationId" = 'org-gerard-default';
UPDATE "DispatchOptimizationApplication" SET "organizationId" = 'org-gerard-default';
UPDATE "Driver" SET "organizationId" = 'org-gerard-default';
UPDATE "DriverActivityEvent" SET "organizationId" = 'org-gerard-default';
UPDATE "DriverPosition" SET "organizationId" = 'org-gerard-default';
UPDATE "DriverRegulatoryDeclaration" SET "organizationId" = 'org-gerard-default';
UPDATE "IgnoredMailImport" SET "organizationId" = 'org-gerard-default';
UPDATE "Invoice" SET "organizationId" = 'org-gerard-default';
UPDATE "InvoiceLine" SET "organizationId" = 'org-gerard-default';
UPDATE "InvoiceMission" SET "organizationId" = 'org-gerard-default';
UPDATE "MaintenanceInterventionLine" SET "organizationId" = 'org-gerard-default';
UPDATE "MaintenanceRequest" SET "organizationId" = 'org-gerard-default';
UPDATE "MaintenanceStatusHistory" SET "organizationId" = 'org-gerard-default';
UPDATE "Mission" SET "organizationId" = 'org-gerard-default';
UPDATE "MissionAssignment" SET "organizationId" = 'org-gerard-default';
UPDATE "MissionEvent" SET "organizationId" = 'org-gerard-default';
UPDATE "MissionSourceEmail" SET "organizationId" = 'org-gerard-default';
UPDATE "ParkInspection" SET "organizationId" = 'org-gerard-default';
UPDATE "ParkInspectionResult" SET "organizationId" = 'org-gerard-default';
UPDATE "ParkMovement" SET "organizationId" = 'org-gerard-default';
UPDATE "ParkSpot" SET "organizationId" = 'org-gerard-default';
UPDATE "PlanningRow" SET "organizationId" = 'org-gerard-default';
UPDATE "Trailer" SET "organizationId" = 'org-gerard-default';
UPDATE "TrailerCustodyEvent" SET "organizationId" = 'org-gerard-default';
UPDATE "Truck" SET "organizationId" = 'org-gerard-default';
UPDATE "TruckEvent" SET "organizationId" = 'org-gerard-default';
UPDATE "TruckPosition" SET "organizationId" = 'org-gerard-default';
UPDATE "WeeklyProfitabilityAdjustment" SET "organizationId" = 'org-gerard-default';

ALTER TABLE "ClientProfile" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "DispatchOptimizationApplication" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Driver" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "DriverActivityEvent" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "DriverPosition" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "DriverRegulatoryDeclaration" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "IgnoredMailImport" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Invoice" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "InvoiceLine" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "InvoiceMission" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "MaintenanceInterventionLine" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "MaintenanceRequest" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "MaintenanceStatusHistory" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Mission" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "MissionAssignment" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "MissionEvent" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "MissionSourceEmail" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "ParkInspection" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "ParkInspectionResult" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "ParkMovement" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "ParkSpot" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "PlanningRow" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Trailer" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "TrailerCustodyEvent" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Truck" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "TruckEvent" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "TruckPosition" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "WeeklyProfitabilityAdjustment" ALTER COLUMN "organizationId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_status_idx" ON "Organization"("status");

-- CreateIndex
CREATE INDEX "OrganizationUser_userId_idx" ON "OrganizationUser"("userId");

-- CreateIndex
CREATE INDEX "OrganizationUser_organizationId_role_idx" ON "OrganizationUser"("organizationId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationUser_organizationId_userId_key" ON "OrganizationUser"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "ClientProfile_organizationId_idx" ON "ClientProfile"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientProfile_organizationId_name_key" ON "ClientProfile"("organizationId", "name");

-- CreateIndex
CREATE INDEX "DispatchOptimizationApplication_organizationId_idx" ON "DispatchOptimizationApplication"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "DispatchOptimizationApplication_organizationId_idempotencyK_key" ON "DispatchOptimizationApplication"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Driver_organizationId_idx" ON "Driver"("organizationId");

-- CreateIndex
CREATE INDEX "DriverActivityEvent_organizationId_idx" ON "DriverActivityEvent"("organizationId");

-- CreateIndex
CREATE INDEX "DriverPosition_organizationId_idx" ON "DriverPosition"("organizationId");

-- CreateIndex
CREATE INDEX "DriverRegulatoryDeclaration_organizationId_idx" ON "DriverRegulatoryDeclaration"("organizationId");

-- CreateIndex
CREATE INDEX "IgnoredMailImport_organizationId_idx" ON "IgnoredMailImport"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "IgnoredMailImport_organizationId_previewKey_key" ON "IgnoredMailImport"("organizationId", "previewKey");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_idx" ON "Invoice"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_organizationId_invoiceNumber_key" ON "Invoice"("organizationId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "InvoiceLine_organizationId_idx" ON "InvoiceLine"("organizationId");

-- CreateIndex
CREATE INDEX "InvoiceMission_organizationId_idx" ON "InvoiceMission"("organizationId");

-- CreateIndex
CREATE INDEX "MaintenanceInterventionLine_organizationId_idx" ON "MaintenanceInterventionLine"("organizationId");

-- CreateIndex
CREATE INDEX "MaintenanceRequest_organizationId_idx" ON "MaintenanceRequest"("organizationId");

-- CreateIndex
CREATE INDEX "MaintenanceStatusHistory_organizationId_idx" ON "MaintenanceStatusHistory"("organizationId");

-- CreateIndex
CREATE INDEX "Mission_organizationId_idx" ON "Mission"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Mission_organizationId_reference_key" ON "Mission"("organizationId", "reference");

-- CreateIndex
CREATE INDEX "MissionAssignment_organizationId_idx" ON "MissionAssignment"("organizationId");

-- CreateIndex
CREATE INDEX "MissionEvent_organizationId_idx" ON "MissionEvent"("organizationId");

-- CreateIndex
CREATE INDEX "MissionSourceEmail_organizationId_idx" ON "MissionSourceEmail"("organizationId");

-- CreateIndex
CREATE INDEX "ParkInspection_organizationId_idx" ON "ParkInspection"("organizationId");

-- CreateIndex
CREATE INDEX "ParkInspectionResult_organizationId_idx" ON "ParkInspectionResult"("organizationId");

-- CreateIndex
CREATE INDEX "ParkMovement_organizationId_idx" ON "ParkMovement"("organizationId");

-- CreateIndex
CREATE INDEX "ParkSpot_organizationId_idx" ON "ParkSpot"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ParkSpot_organizationId_code_key" ON "ParkSpot"("organizationId", "code");

-- CreateIndex
CREATE INDEX "PlanningRow_organizationId_idx" ON "PlanningRow"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanningRow_organizationId_weekStartDate_driverId_key" ON "PlanningRow"("organizationId", "weekStartDate", "driverId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanningRow_organizationId_weekStartDate_truckId_key" ON "PlanningRow"("organizationId", "weekStartDate", "truckId");

-- CreateIndex
CREATE INDEX "Trailer_organizationId_idx" ON "Trailer"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Trailer_organizationId_plateNumber_key" ON "Trailer"("organizationId", "plateNumber");

-- CreateIndex
CREATE INDEX "TrailerCustodyEvent_organizationId_idx" ON "TrailerCustodyEvent"("organizationId");

-- CreateIndex
CREATE INDEX "Truck_organizationId_idx" ON "Truck"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Truck_organizationId_plateNumber_key" ON "Truck"("organizationId", "plateNumber");

-- CreateIndex
CREATE INDEX "TruckEvent_organizationId_idx" ON "TruckEvent"("organizationId");

-- CreateIndex
CREATE INDEX "TruckPosition_organizationId_idx" ON "TruckPosition"("organizationId");

-- CreateIndex
CREATE INDEX "WeeklyProfitabilityAdjustment_organizationId_idx" ON "WeeklyProfitabilityAdjustment"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyProfitabilityAdjustment_organizationId_weekStartDate_key" ON "WeeklyProfitabilityAdjustment"("organizationId", "weekStartDate");

-- AddForeignKey
ALTER TABLE "OrganizationUser" ADD CONSTRAINT "OrganizationUser_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationUser" ADD CONSTRAINT "OrganizationUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Truck" ADD CONSTRAINT "Truck_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trailer" ADD CONSTRAINT "Trailer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProfile" ADD CONSTRAINT "ClientProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceMission" ADD CONSTRAINT "InvoiceMission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningRow" ADD CONSTRAINT "PlanningRow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionAssignment" ADD CONSTRAINT "MissionAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrailerCustodyEvent" ADD CONSTRAINT "TrailerCustodyEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionEvent" ADD CONSTRAINT "MissionEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchOptimizationApplication" ADD CONSTRAINT "DispatchOptimizationApplication_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverRegulatoryDeclaration" ADD CONSTRAINT "DriverRegulatoryDeclaration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverActivityEvent" ADD CONSTRAINT "DriverActivityEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckEvent" ADD CONSTRAINT "TruckEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckPosition" ADD CONSTRAINT "TruckPosition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverPosition" ADD CONSTRAINT "DriverPosition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IgnoredMailImport" ADD CONSTRAINT "IgnoredMailImport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceStatusHistory" ADD CONSTRAINT "MaintenanceStatusHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceInterventionLine" ADD CONSTRAINT "MaintenanceInterventionLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyProfitabilityAdjustment" ADD CONSTRAINT "WeeklyProfitabilityAdjustment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionSourceEmail" ADD CONSTRAINT "MissionSourceEmail_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkSpot" ADD CONSTRAINT "ParkSpot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkMovement" ADD CONSTRAINT "ParkMovement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkInspection" ADD CONSTRAINT "ParkInspection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkInspectionResult" ADD CONSTRAINT "ParkInspectionResult_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

