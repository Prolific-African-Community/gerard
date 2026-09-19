-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TruckStatus" ADD VALUE 'EN_ROUTE_TO_PICKUP';
ALTER TYPE "TruckStatus" ADD VALUE 'AT_PICKUP';
ALTER TYPE "TruckStatus" ADD VALUE 'ON_MISSION';

-- AlterTable
ALTER TABLE "Truck" ADD COLUMN     "statusUpdatedAt" TIMESTAMP(3);
