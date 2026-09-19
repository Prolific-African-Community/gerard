-- Add a normalized, immutable-after-finalization park inspection workflow.
-- Existing vehicles, park positions and maintenance records are untouched.
CREATE TYPE "ParkInspectionStatus" AS ENUM ('DRAFT', 'FINALIZED');
CREATE TYPE "ParkInspectionOverallResult" AS ENUM ('COMPLIANT', 'WATCH', 'INTERVENTION_REQUIRED');
CREATE TYPE "ParkInspectionItemStatus" AS ENUM ('OK', 'WATCH', 'CRITICAL', 'NOT_APPLICABLE');

CREATE TABLE "ParkInspection" (
    "id" TEXT NOT NULL,
    "vehicleType" "ParkVehicleType" NOT NULL,
    "truckId" TEXT,
    "trailerId" TEXT,
    "inspectedAt" TIMESTAMP(3) NOT NULL,
    "inspectorId" TEXT,
    "inspectorName" TEXT NOT NULL,
    "status" "ParkInspectionStatus" NOT NULL DEFAULT 'DRAFT',
    "overallResult" "ParkInspectionOverallResult",
    "mileage" INTEGER,
    "generalComment" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ParkInspection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ParkInspectionResult" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "ParkInspectionItemStatus" NOT NULL,
    "numericValue" DOUBLE PRECISION,
    "unit" TEXT,
    "comment" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "maintenanceRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ParkInspectionResult_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ParkInspection_truckId_inspectedAt_idx" ON "ParkInspection"("truckId", "inspectedAt");
CREATE INDEX "ParkInspection_trailerId_inspectedAt_idx" ON "ParkInspection"("trailerId", "inspectedAt");
CREATE INDEX "ParkInspection_status_idx" ON "ParkInspection"("status");
CREATE INDEX "ParkInspection_overallResult_idx" ON "ParkInspection"("overallResult");
CREATE INDEX "ParkInspection_inspectorId_idx" ON "ParkInspection"("inspectorId");
CREATE UNIQUE INDEX "ParkInspectionResult_maintenanceRequestId_key" ON "ParkInspectionResult"("maintenanceRequestId");
CREATE UNIQUE INDEX "ParkInspectionResult_inspectionId_itemKey_key" ON "ParkInspectionResult"("inspectionId", "itemKey");
CREATE INDEX "ParkInspectionResult_inspectionId_category_sortOrder_idx" ON "ParkInspectionResult"("inspectionId", "category", "sortOrder");
CREATE INDEX "ParkInspectionResult_status_idx" ON "ParkInspectionResult"("status");

ALTER TABLE "ParkInspection" ADD CONSTRAINT "ParkInspection_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ParkInspection" ADD CONSTRAINT "ParkInspection_trailerId_fkey" FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ParkInspection" ADD CONSTRAINT "ParkInspection_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ParkInspectionResult" ADD CONSTRAINT "ParkInspectionResult_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "ParkInspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParkInspectionResult" ADD CONSTRAINT "ParkInspectionResult_maintenanceRequestId_fkey" FOREIGN KEY ("maintenanceRequestId") REFERENCES "MaintenanceRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
