CREATE TABLE "RouteCache" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "originLat" DOUBLE PRECISION NOT NULL,
    "originLng" DOUBLE PRECISION NOT NULL,
    "destinationLat" DOUBLE PRECISION NOT NULL,
    "destinationLng" DOUBLE PRECISION NOT NULL,
    "waypoints" JSONB NOT NULL,
    "travelMode" TEXT NOT NULL,
    "routingPreference" TEXT NOT NULL,
    "distanceMeters" INTEGER NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "polyline" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouteCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RouteCache_fingerprint_key" ON "RouteCache"("fingerprint");
CREATE INDEX "RouteCache_originLat_originLng_destinationLat_destinationLng_idx" ON "RouteCache"("originLat", "originLng", "destinationLat", "destinationLng");
CREATE INDEX "RouteCache_updatedAt_idx" ON "RouteCache"("updatedAt");
