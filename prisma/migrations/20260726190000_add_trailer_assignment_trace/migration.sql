ALTER TABLE "MissionAssignment"
  ADD COLUMN "trailerChangePlanned" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "trailerTransitions" JSONB;
