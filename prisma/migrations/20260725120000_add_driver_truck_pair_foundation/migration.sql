CREATE TYPE "PlanningAssignmentOrigin" AS ENUM ('MANUAL', 'AUTOMATIC', 'ADJUSTED');

ALTER TABLE "PlanningRow"
ADD COLUMN "pairLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "assignmentOrigin" "PlanningAssignmentOrigin" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "isExceptionalReplacement" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "usualTruckIdSnapshot" TEXT;

UPDATE "PlanningRow" AS planning_row
SET
  "usualTruckIdSnapshot" = usual_truck.id,
  "isExceptionalReplacement" = (
    planning_row."truckId" IS NOT NULL
    AND planning_row."truckId" <> usual_truck.id
  )
FROM "Truck" AS usual_truck
WHERE usual_truck."driverId" = planning_row."driverId";

CREATE UNIQUE INDEX "Truck_driverId_key" ON "Truck"("driverId");
CREATE UNIQUE INDEX "PlanningRow_weekStartDate_driverId_key"
ON "PlanningRow"("weekStartDate", "driverId");
CREATE UNIQUE INDEX "PlanningRow_weekStartDate_truckId_key"
ON "PlanningRow"("weekStartDate", "truckId");
