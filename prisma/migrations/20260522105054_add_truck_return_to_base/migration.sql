-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TruckStatus" ADD VALUE 'RETURNING_TO_BASE';
ALTER TYPE "TruckStatus" ADD VALUE 'AT_BASE';

-- AlterTable
ALTER TABLE "Truck" ADD COLUMN     "returnToBaseCalculatedAt" TIMESTAMP(3),
ADD COLUMN     "returnToBaseDistanceMeters" INTEGER,
ADD COLUMN     "returnToBaseDurationSeconds" INTEGER,
ADD COLUMN     "returnToBasePolyline" TEXT,
ADD COLUMN     "returnToBaseProvider" TEXT;
