-- Additive, immutable driver activity journal. Existing regulatory snapshots
-- remain untouched and continue to provide a historical compatibility baseline.
CREATE TYPE "DriverActivityType" AS ENUM (
  'DRIVE_START',
  'DRIVE_END',
  'OTHER_WORK',
  'BREAK',
  'SPLIT_BREAK',
  'DAILY_REST',
  'WEEKLY_REST',
  'UNAVAILABLE',
  'AVAILABLE'
);

CREATE TYPE "DriverActivitySource" AS ENUM (
  'DRIVER',
  'DISPATCHER_CORRECTION',
  'MISSION',
  'SYSTEM',
  'QA'
);

CREATE TABLE "DriverActivityEvent" (
  "id" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "type" "DriverActivityType" NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" "DriverActivitySource" NOT NULL,
  "note" TEXT,
  "authorUserId" TEXT NOT NULL,
  "missionId" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "retrospective" BOOLEAN NOT NULL DEFAULT false,
  "correctedEventId" TEXT,
  "previousType" "DriverActivityType",
  "previousEffectiveAt" TIMESTAMP(3),
  "previousNote" TEXT,
  "correctionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriverActivityEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DriverActivityEvent_driverId_effectiveAt_idx"
  ON "DriverActivityEvent"("driverId", "effectiveAt");
CREATE INDEX "DriverActivityEvent_driverId_recordedAt_idx"
  ON "DriverActivityEvent"("driverId", "recordedAt");
CREATE INDEX "DriverActivityEvent_authorUserId_idx"
  ON "DriverActivityEvent"("authorUserId");
CREATE INDEX "DriverActivityEvent_missionId_idx"
  ON "DriverActivityEvent"("missionId");
CREATE INDEX "DriverActivityEvent_correctedEventId_idx"
  ON "DriverActivityEvent"("correctedEventId");
CREATE INDEX "DriverActivityEvent_source_idx"
  ON "DriverActivityEvent"("source");

ALTER TABLE "DriverActivityEvent"
  ADD CONSTRAINT "DriverActivityEvent_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "Driver"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriverActivityEvent"
  ADD CONSTRAINT "DriverActivityEvent_authorUserId_fkey"
  FOREIGN KEY ("authorUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriverActivityEvent"
  ADD CONSTRAINT "DriverActivityEvent_missionId_fkey"
  FOREIGN KEY ("missionId") REFERENCES "Mission"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DriverActivityEvent"
  ADD CONSTRAINT "DriverActivityEvent_correctedEventId_fkey"
  FOREIGN KEY ("correctedEventId") REFERENCES "DriverActivityEvent"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
