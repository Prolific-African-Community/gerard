-- Additive Run 4 correction: a planned trailer assignment is distinct from
-- Trailer.truckId, which remains the current physical attachment.
ALTER TABLE "MissionAssignment"
  ADD COLUMN "trailerId" TEXT,
  ADD COLUMN "plannedEndAt" TIMESTAMP(3);

ALTER TABLE "MissionEvent"
  ADD COLUMN "trailerId" TEXT;

ALTER TABLE "MissionAssignment"
  ADD CONSTRAINT "MissionAssignment_trailerId_fkey"
  FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MissionEvent"
  ADD CONSTRAINT "MissionEvent_trailerId_fkey"
  FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "MissionAssignment_trailerId_scheduledDate_idx"
  ON "MissionAssignment"("trailerId", "scheduledDate");

CREATE INDEX "MissionAssignment_trailerId_plannedEndAt_idx"
  ON "MissionAssignment"("trailerId", "plannedEndAt");

CREATE INDEX "MissionEvent_trailerId_idx"
  ON "MissionEvent"("trailerId");
