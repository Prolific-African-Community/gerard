-- CreateEnum
CREATE TYPE "TrailerLoadStatus" AS ENUM ('EMPTY', 'LOADED');

-- CreateEnum
CREATE TYPE "TrailerCargoType" AS ENUM ('WOOD', 'ALUMINIUM', 'STEEL', 'PALLETS', 'CONSTRUCTION_MATERIALS', 'FOOD', 'MACHINERY', 'TEXTILE', 'CHEMICALS', 'OTHER');

-- AlterTable
ALTER TABLE "Trailer" ADD COLUMN "loadStatus" "TrailerLoadStatus" NOT NULL DEFAULT 'EMPTY',
ADD COLUMN "cargoType" "TrailerCargoType",
ADD COLUMN "cargoDescription" TEXT;

-- CreateIndex
CREATE INDEX "Trailer_loadStatus_idx" ON "Trailer"("loadStatus");

-- CreateIndex
CREATE INDEX "Trailer_cargoType_idx" ON "Trailer"("cargoType");
