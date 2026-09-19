ALTER TABLE "TrailerCustodyEvent"
  ADD COLUMN "planningRowId" TEXT;

CREATE INDEX "TrailerCustodyEvent_planningRowId_occurredAt_idx"
  ON "TrailerCustodyEvent"("planningRowId", "occurredAt");

ALTER TABLE "TrailerCustodyEvent"
  ADD CONSTRAINT "TrailerCustodyEvent_planningRowId_fkey"
  FOREIGN KEY ("planningRowId") REFERENCES "PlanningRow"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
