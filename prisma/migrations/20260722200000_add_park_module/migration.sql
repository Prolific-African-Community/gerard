-- CreateEnum
CREATE TYPE "ParkSpotType" AS ENUM ('PARKING', 'WORKSHOP', 'HALL', 'STORAGE');

-- CreateEnum
CREATE TYPE "ParkVehicleType" AS ENUM ('TRUCK', 'TRAILER');

-- CreateEnum
CREATE TYPE "ParkMovementAction" AS ENUM ('PLACE', 'MOVE', 'REMOVE');

-- CreateTable
CREATE TABLE "ParkSpot" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "ParkSpotType" NOT NULL DEFAULT 'PARKING',
    "posX" DOUBLE PRECISION NOT NULL,
    "posY" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "truckId" TEXT,
    "trailerId" TEXT,
    "occupiedAt" TIMESTAMP(3),
    "placedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParkSpot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkMovement" (
    "id" TEXT NOT NULL,
    "vehicleType" "ParkVehicleType" NOT NULL,
    "truckId" TEXT,
    "trailerId" TEXT,
    "plateNumber" TEXT NOT NULL,
    "action" "ParkMovementAction" NOT NULL,
    "fromSpotId" TEXT,
    "fromSpotCode" TEXT,
    "toSpotId" TEXT,
    "toSpotCode" TEXT,
    "actorId" TEXT,
    "actorName" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParkMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ParkSpot_code_key" ON "ParkSpot"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ParkSpot_truckId_key" ON "ParkSpot"("truckId");

-- CreateIndex
CREATE UNIQUE INDEX "ParkSpot_trailerId_key" ON "ParkSpot"("trailerId");

-- CreateIndex
CREATE INDEX "ParkSpot_zone_idx" ON "ParkSpot"("zone");

-- CreateIndex
CREATE INDEX "ParkSpot_type_idx" ON "ParkSpot"("type");

-- CreateIndex
CREATE INDEX "ParkSpot_isActive_idx" ON "ParkSpot"("isActive");

-- CreateIndex
CREATE INDEX "ParkSpot_sortOrder_idx" ON "ParkSpot"("sortOrder");

-- CreateIndex
CREATE INDEX "ParkMovement_truckId_createdAt_idx" ON "ParkMovement"("truckId", "createdAt");

-- CreateIndex
CREATE INDEX "ParkMovement_trailerId_createdAt_idx" ON "ParkMovement"("trailerId", "createdAt");

-- CreateIndex
CREATE INDEX "ParkMovement_createdAt_idx" ON "ParkMovement"("createdAt");

-- CreateIndex
CREATE INDEX "ParkMovement_actorId_idx" ON "ParkMovement"("actorId");

-- AddForeignKey
ALTER TABLE "ParkSpot" ADD CONSTRAINT "ParkSpot_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkSpot" ADD CONSTRAINT "ParkSpot_trailerId_fkey" FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkSpot" ADD CONSTRAINT "ParkSpot_placedById_fkey" FOREIGN KEY ("placedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkMovement" ADD CONSTRAINT "ParkMovement_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkMovement" ADD CONSTRAINT "ParkMovement_trailerId_fkey" FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkMovement" ADD CONSTRAINT "ParkMovement_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
