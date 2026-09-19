-- DropForeignKey
ALTER TABLE "MissionAssignment" DROP CONSTRAINT "MissionAssignment_driverId_fkey";

-- AlterTable
ALTER TABLE "MissionAssignment" ADD COLUMN     "planningRowId" TEXT,
ALTER COLUMN "driverId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "PlanningRow" (
    "id" TEXT NOT NULL,
    "weekStartDate" TIMESTAMP(3) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "driverId" TEXT,
    "truckId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanningRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanningRow_weekStartDate_sortOrder_idx" ON "PlanningRow"("weekStartDate", "sortOrder");

-- CreateIndex
CREATE INDEX "PlanningRow_driverId_idx" ON "PlanningRow"("driverId");

-- CreateIndex
CREATE INDEX "PlanningRow_truckId_idx" ON "PlanningRow"("truckId");

-- CreateIndex
CREATE INDEX "MissionAssignment_planningRowId_scheduledDate_idx" ON "MissionAssignment"("planningRowId", "scheduledDate");

-- AddForeignKey
ALTER TABLE "PlanningRow" ADD CONSTRAINT "PlanningRow_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningRow" ADD CONSTRAINT "PlanningRow_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionAssignment" ADD CONSTRAINT "MissionAssignment_planningRowId_fkey" FOREIGN KEY ("planningRowId") REFERENCES "PlanningRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionAssignment" ADD CONSTRAINT "MissionAssignment_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
