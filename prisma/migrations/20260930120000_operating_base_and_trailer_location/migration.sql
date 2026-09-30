-- Optional organization configuration. Existing organizations remain valid and
-- the server falls back to deployment coordinates until these values are set.
ALTER TABLE "Organization"
  ADD COLUMN "operatingBaseAddress" TEXT,
  ADD COLUMN "operatingBasePlaceId" TEXT,
  ADD COLUMN "operatingBaseLat" DOUBLE PRECISION,
  ADD COLUMN "operatingBaseLng" DOUBLE PRECISION;

-- One current explicit position is sufficient for planning. This is not a
-- location history and does not alter existing trailer records.
ALTER TABLE "Trailer"
  ADD COLUMN "currentLocationAddress" TEXT,
  ADD COLUMN "currentLocationPlaceId" TEXT,
  ADD COLUMN "currentLocationLat" DOUBLE PRECISION,
  ADD COLUMN "currentLocationLng" DOUBLE PRECISION,
  ADD COLUMN "currentLocationUpdatedAt" TIMESTAMP(3);

-- A deliberate trailer deletion keeps business records and missions. The
-- trailer-specific custody journal is removed; durable records retain their
-- plate snapshots and lose only the nullable trailer foreign key.
ALTER TABLE "TrailerCustodyEvent" DROP CONSTRAINT "TrailerCustodyEvent_trailerId_fkey";
ALTER TABLE "TrailerCustodyEvent" ADD CONSTRAINT "TrailerCustodyEvent_trailerId_fkey"
  FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MaintenanceRequest" DROP CONSTRAINT "MaintenanceRequest_trailerId_fkey";
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_trailerId_fkey"
  FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ParkInspection" DROP CONSTRAINT "ParkInspection_trailerId_fkey";
ALTER TABLE "ParkInspection" ADD CONSTRAINT "ParkInspection_trailerId_fkey"
  FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
