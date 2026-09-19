-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "routeCalculatedAt" TIMESTAMP(3),
ADD COLUMN     "routeDistanceMeters" INTEGER,
ADD COLUMN     "routeDurationSeconds" INTEGER,
ADD COLUMN     "routePolyline" TEXT,
ADD COLUMN     "routeProvider" TEXT;
