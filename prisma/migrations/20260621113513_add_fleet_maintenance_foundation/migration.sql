-- CreateEnum
CREATE TYPE "MaintenanceVehicleType" AS ENUM ('TRUCK', 'TRAILER');

-- CreateEnum
CREATE TYPE "MaintenanceInterventionType" AS ENUM ('DIAGNOSTIC', 'TIRES', 'BRAKES', 'OIL_SERVICE', 'ELECTRICAL', 'BODYWORK', 'TRAILER_REPAIR', 'SAFETY_CHECK', 'OTHER');

-- CreateEnum
CREATE TYPE "MaintenanceUrgency" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "MaintenanceRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'RECEIVED', 'UNDER_REVIEW', 'QUOTE_RECEIVED', 'QUOTE_APPROVED', 'QUOTE_REJECTED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'INVOICED', 'CANCELLED');

-- CreateTable
CREATE TABLE "MaintenanceRequest" (
    "id" TEXT NOT NULL,
    "truckId" TEXT,
    "trailerId" TEXT,
    "vehicleType" "MaintenanceVehicleType" NOT NULL,
    "plateNumber" TEXT NOT NULL,
    "interventionType" "MaintenanceInterventionType" NOT NULL,
    "urgency" "MaintenanceUrgency" NOT NULL DEFAULT 'NORMAL',
    "status" "MaintenanceRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "mileage" INTEGER,
    "immobilizationRequired" BOOLEAN NOT NULL DEFAULT false,
    "preferredDate" TIMESTAMP(3),
    "issueDescription" TEXT NOT NULL,
    "internalNotes" TEXT,
    "externalProvider" TEXT,
    "externalRequestId" TEXT,
    "quoteAmount" DOUBLE PRECISION,
    "invoiceAmount" DOUBLE PRECISION,
    "quotePdfUrl" TEXT,
    "invoicePdfUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceRequest_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "MaintenanceRequest"
ADD CONSTRAINT "MaintenanceRequest_exactly_one_vehicle_check"
CHECK (
    (
        "truckId" IS NOT NULL
        AND "trailerId" IS NULL
        AND "vehicleType" = 'TRUCK'
    )
    OR
    (
        "truckId" IS NULL
        AND "trailerId" IS NOT NULL
        AND "vehicleType" = 'TRAILER'
    )
);

-- CreateTable
CREATE TABLE "MaintenanceStatusHistory" (
    "id" TEXT NOT NULL,
    "maintenanceRequestId" TEXT NOT NULL,
    "oldStatus" "MaintenanceRequestStatus",
    "newStatus" "MaintenanceRequestStatus" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintenanceRequest_status_idx" ON "MaintenanceRequest"("status");

-- CreateIndex
CREATE INDEX "MaintenanceRequest_truckId_idx" ON "MaintenanceRequest"("truckId");

-- CreateIndex
CREATE INDEX "MaintenanceRequest_trailerId_idx" ON "MaintenanceRequest"("trailerId");

-- CreateIndex
CREATE INDEX "MaintenanceRequest_plateNumber_idx" ON "MaintenanceRequest"("plateNumber");

-- CreateIndex
CREATE INDEX "MaintenanceStatusHistory_maintenanceRequestId_createdAt_idx" ON "MaintenanceStatusHistory"("maintenanceRequestId", "createdAt");

-- AddForeignKey
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_trailerId_fkey" FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceStatusHistory" ADD CONSTRAINT "MaintenanceStatusHistory_maintenanceRequestId_fkey" FOREIGN KEY ("maintenanceRequestId") REFERENCES "MaintenanceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
