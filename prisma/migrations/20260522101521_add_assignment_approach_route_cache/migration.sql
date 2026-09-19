-- AlterTable
ALTER TABLE "MissionAssignment" ADD COLUMN     "approachCalculatedAt" TIMESTAMP(3),
ADD COLUMN     "approachDistanceMeters" INTEGER,
ADD COLUMN     "approachDurationSeconds" INTEGER,
ADD COLUMN     "approachPolyline" TEXT,
ADD COLUMN     "approachProvider" TEXT;
