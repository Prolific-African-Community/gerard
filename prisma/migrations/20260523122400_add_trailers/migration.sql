-- CreateEnum
CREATE TYPE "TrailerType" AS ENUM ('CURTAINSIDER', 'FLATBED', 'REFRIGERATED', 'CONTAINER', 'BOX', 'OTHER');

-- CreateEnum
CREATE TYPE "TrailerStatus" AS ENUM ('AVAILABLE', 'ASSIGNED', 'IN_MAINTENANCE', 'OUT_OF_SERVICE');

-- CreateTable
CREATE TABLE "Trailer" (
    "id" TEXT NOT NULL,
    "plateNumber" TEXT NOT NULL,
    "type" "TrailerType" NOT NULL,
    "status" "TrailerStatus" NOT NULL DEFAULT 'AVAILABLE',
    "truckId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trailer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Trailer_plateNumber_key" ON "Trailer"("plateNumber");

-- CreateIndex
CREATE INDEX "Trailer_truckId_idx" ON "Trailer"("truckId");

-- CreateIndex
CREATE INDEX "Trailer_status_idx" ON "Trailer"("status");

-- CreateIndex
CREATE INDEX "Trailer_type_idx" ON "Trailer"("type");

-- AddForeignKey
ALTER TABLE "Trailer" ADD CONSTRAINT "Trailer_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE SET NULL ON UPDATE CASCADE;
