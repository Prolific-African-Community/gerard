CREATE TYPE "MissionPreparationStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'READY',
  'REVIEW_REQUIRED',
  'FAILED'
);

CREATE TYPE "AddressResolutionStatus" AS ENUM (
  'PENDING',
  'AUTO_CONFIRMED',
  'REVIEW_REQUIRED',
  'CONFIRMED',
  'FAILED'
);

CREATE TYPE "AddressResolutionMethod" AS ENUM (
  'PROVIDED_COORDINATES',
  'GOOGLE_PLACES',
  'MANUAL'
);

CREATE TYPE "RegulatoryStateSource" AS ENUM (
  'TACHOGRAPH',
  'DISPATCHER_DECLARATION',
  'QA',
  'UNKNOWN'
);

ALTER TABLE "Mission"
  ADD COLUMN "pickupSourceAddress" TEXT,
  ADD COLUMN "deliverySourceAddress" TEXT,
  ADD COLUMN "pickupNormalizedAddress" TEXT,
  ADD COLUMN "deliveryNormalizedAddress" TEXT,
  ADD COLUMN "pickupResolvedAddress" TEXT,
  ADD COLUMN "deliveryResolvedAddress" TEXT,
  ADD COLUMN "pickupResolutionStatus" "AddressResolutionStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "deliveryResolutionStatus" "AddressResolutionStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "pickupResolutionMethod" "AddressResolutionMethod",
  ADD COLUMN "deliveryResolutionMethod" "AddressResolutionMethod",
  ADD COLUMN "pickupResolutionConfidence" DOUBLE PRECISION,
  ADD COLUMN "deliveryResolutionConfidence" DOUBLE PRECISION,
  ADD COLUMN "pickupResolvedAt" TIMESTAMP(3),
  ADD COLUMN "deliveryResolvedAt" TIMESTAMP(3),
  ADD COLUMN "pickupResolutionReason" TEXT,
  ADD COLUMN "deliveryResolutionReason" TEXT,
  ADD COLUMN "pickupResolutionCandidates" JSONB,
  ADD COLUMN "deliveryResolutionCandidates" JSONB,
  ADD COLUMN "preparationStatus" "MissionPreparationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "preparationMissingData" JSONB,
  ADD COLUMN "preparationLastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "preparationError" TEXT;

ALTER TABLE "Truck"
  ADD COLUMN "category" TEXT,
  ADD COLUMN "capacityKg" INTEGER,
  ADD COLUMN "couplingType" TEXT;

ALTER TABLE "Trailer"
  ADD COLUMN "capacityKg" INTEGER,
  ADD COLUMN "couplingType" TEXT;

CREATE TABLE "DriverRegulatoryDeclaration" (
  "id" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "source" "RegulatoryStateSource" NOT NULL,
  "referenceAt" TIMESTAMP(3) NOT NULL,
  "validUntil" TIMESTAMP(3) NOT NULL,
  "timeZone" TEXT NOT NULL DEFAULT 'Europe/Luxembourg',
  "drivingSinceValidBreakSeconds" INTEGER NOT NULL,
  "dailyDrivingSeconds" INTEGER NOT NULL,
  "weeklyDrivingSeconds" INTEGER NOT NULL,
  "previousWeekDrivingSeconds" INTEGER NOT NULL,
  "dailyExtensionsUsedThisWeek" INTEGER NOT NULL,
  "reducedDailyRestsUsedSinceWeeklyRest" INTEGER NOT NULL,
  "splitBreakFirstPartSeconds" INTEGER NOT NULL DEFAULT 0,
  "splitDailyRestFirstPartSeconds" INTEGER NOT NULL DEFAULT 0,
  "lastValidRestEndedAt" TIMESTAMP(3) NOT NULL,
  "dutyPeriodStartedAt" TIMESTAMP(3) NOT NULL,
  "currentIsoWeek" TEXT NOT NULL,
  "weeklyRestDueAt" TIMESTAMP(3),
  "weeklyRestCompensationDueSeconds" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DriverRegulatoryDeclaration_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DriverRegulatoryDeclaration_driverId_referenceAt_idx"
  ON "DriverRegulatoryDeclaration"("driverId", "referenceAt");
CREATE INDEX "DriverRegulatoryDeclaration_driverId_validUntil_idx"
  ON "DriverRegulatoryDeclaration"("driverId", "validUntil");
CREATE INDEX "DriverRegulatoryDeclaration_source_idx"
  ON "DriverRegulatoryDeclaration"("source");

ALTER TABLE "DriverRegulatoryDeclaration"
  ADD CONSTRAINT "DriverRegulatoryDeclaration_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "Driver"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DriverRegulatoryDeclaration"
  ADD CONSTRAINT "DriverRegulatoryDeclaration_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
