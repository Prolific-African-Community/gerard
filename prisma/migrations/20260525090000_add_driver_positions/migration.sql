-- Driver phone positions replace truck tracker positions as the active live map source.
-- TruckPosition is intentionally kept for compatibility with existing historical data.
CREATE TABLE "DriverPosition" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "truckId" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "speedKmh" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "provider" TEXT NOT NULL DEFAULT 'DRIVER_PHONE',
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverPosition_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DriverPosition_driverId_idx" ON "DriverPosition"("driverId");
CREATE INDEX "DriverPosition_truckId_idx" ON "DriverPosition"("truckId");
CREATE INDEX "DriverPosition_recordedAt_idx" ON "DriverPosition"("recordedAt");
CREATE INDEX "DriverPosition_driverId_recordedAt_idx" ON "DriverPosition"("driverId", "recordedAt");
CREATE INDEX "DriverPosition_truckId_recordedAt_idx" ON "DriverPosition"("truckId", "recordedAt");

ALTER TABLE "DriverPosition"
ADD CONSTRAINT "DriverPosition_driverId_fkey"
FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DriverPosition"
ADD CONSTRAINT "DriverPosition_truckId_fkey"
FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE SET NULL ON UPDATE CASCADE;
