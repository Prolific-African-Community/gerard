CREATE TYPE "TrailerCustodyState" AS ENUM (
  'EMPTY',
  'LOADED',
  'IN_MISSION',
  'AT_BASE',
  'RELAY_AVAILABLE',
  'DELIVERED',
  'IMMOBILIZED'
);

CREATE TYPE "TrailerCustodyTransitionStatus" AS ENUM (
  'PLANNED',
  'COMPLETED',
  'CANCELLED'
);

ALTER TABLE "Trailer"
  ADD COLUMN "custodyState" "TrailerCustodyState" NOT NULL DEFAULT 'EMPTY',
  ADD COLUMN "custodyVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "TrailerCustodyEvent" (
  "id" TEXT NOT NULL,
  "trailerId" TEXT NOT NULL,
  "missionId" TEXT,
  "fromDriverId" TEXT,
  "toDriverId" TEXT,
  "fromState" "TrailerCustodyState" NOT NULL,
  "toState" "TrailerCustodyState" NOT NULL,
  "status" "TrailerCustodyTransitionStatus" NOT NULL DEFAULT 'COMPLETED',
  "location" TEXT,
  "note" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrailerCustodyEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TrailerCustodyEvent_trailerId_occurredAt_idx"
  ON "TrailerCustodyEvent"("trailerId", "occurredAt");
CREATE INDEX "TrailerCustodyEvent_missionId_occurredAt_idx"
  ON "TrailerCustodyEvent"("missionId", "occurredAt");
CREATE INDEX "TrailerCustodyEvent_fromDriverId_occurredAt_idx"
  ON "TrailerCustodyEvent"("fromDriverId", "occurredAt");
CREATE INDEX "TrailerCustodyEvent_toDriverId_occurredAt_idx"
  ON "TrailerCustodyEvent"("toDriverId", "occurredAt");

ALTER TABLE "TrailerCustodyEvent"
  ADD CONSTRAINT "TrailerCustodyEvent_trailerId_fkey"
  FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "TrailerCustodyEvent_missionId_fkey"
  FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "TrailerCustodyEvent_fromDriverId_fkey"
  FOREIGN KEY ("fromDriverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "TrailerCustodyEvent_toDriverId_fkey"
  FOREIGN KEY ("toDriverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "TrailerCustodyEvent_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
