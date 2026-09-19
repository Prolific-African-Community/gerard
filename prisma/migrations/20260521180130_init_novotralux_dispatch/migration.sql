-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'DISPATCHER', 'DRIVER');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('ACTIVE', 'UNAVAILABLE', 'ON_LEAVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TruckStatus" AS ENUM ('AVAILABLE', 'ASSIGNED', 'IN_MAINTENANCE', 'OUT_OF_SERVICE');

-- CreateEnum
CREATE TYPE "MissionStatus" AS ENUM ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'DONE', 'ISSUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PlanningDay" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "MissionEventType" AS ENUM ('CREATED', 'ASSIGNED', 'UNASSIGNED', 'RESCHEDULED', 'STATUS_CHANGED', 'DRIVER_CHANGED', 'TRUCK_CHANGED', 'NOTE_ADDED', 'COMPLETED', 'CANCELLED', 'ISSUE_REPORTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'DISPATCHER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "status" "DriverStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Truck" (
    "id" TEXT NOT NULL,
    "plateNumber" TEXT NOT NULL,
    "model" TEXT,
    "brand" TEXT,
    "status" "TruckStatus" NOT NULL DEFAULT 'AVAILABLE',
    "driverId" TEXT,
    "gpsDeviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Truck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mission" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT,
    "clientName" TEXT NOT NULL,
    "pickupCity" TEXT NOT NULL,
    "deliveryCity" TEXT NOT NULL,
    "pickupAddress" TEXT,
    "deliveryAddress" TEXT,
    "pickupPlaceId" TEXT,
    "deliveryPlaceId" TEXT,
    "estimatedKm" INTEGER,
    "status" "MissionStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "sourceEmailId" TEXT,
    "sourceEmailFrom" TEXT,
    "sourceEmailSubject" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionAssignment" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "truckId" TEXT,
    "day" "PlanningDay" NOT NULL,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MissionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionEvent" (
    "id" TEXT NOT NULL,
    "type" "MissionEventType" NOT NULL,
    "message" TEXT,
    "metadata" JSONB,
    "missionId" TEXT NOT NULL,
    "actorId" TEXT,
    "driverId" TEXT,
    "truckId" TEXT,
    "fromStatus" "MissionStatus",
    "toStatus" "MissionStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TruckPosition" (
    "id" TEXT NOT NULL,
    "truckId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "speedKmh" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "provider" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TruckPosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "Driver_status_idx" ON "Driver"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Truck_plateNumber_key" ON "Truck"("plateNumber");

-- CreateIndex
CREATE INDEX "Truck_driverId_idx" ON "Truck"("driverId");

-- CreateIndex
CREATE INDEX "Truck_status_idx" ON "Truck"("status");

-- CreateIndex
CREATE INDEX "Truck_gpsDeviceId_idx" ON "Truck"("gpsDeviceId");

-- CreateIndex
CREATE UNIQUE INDEX "Mission_reference_key" ON "Mission"("reference");

-- CreateIndex
CREATE INDEX "Mission_status_idx" ON "Mission"("status");

-- CreateIndex
CREATE INDEX "Mission_clientName_idx" ON "Mission"("clientName");

-- CreateIndex
CREATE INDEX "Mission_sourceEmailId_idx" ON "Mission"("sourceEmailId");

-- CreateIndex
CREATE INDEX "Mission_createdAt_idx" ON "Mission"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MissionAssignment_missionId_key" ON "MissionAssignment"("missionId");

-- CreateIndex
CREATE INDEX "MissionAssignment_driverId_scheduledDate_idx" ON "MissionAssignment"("driverId", "scheduledDate");

-- CreateIndex
CREATE INDEX "MissionAssignment_truckId_scheduledDate_idx" ON "MissionAssignment"("truckId", "scheduledDate");

-- CreateIndex
CREATE INDEX "MissionAssignment_day_idx" ON "MissionAssignment"("day");

-- CreateIndex
CREATE INDEX "MissionAssignment_scheduledDate_idx" ON "MissionAssignment"("scheduledDate");

-- CreateIndex
CREATE INDEX "MissionEvent_missionId_createdAt_idx" ON "MissionEvent"("missionId", "createdAt");

-- CreateIndex
CREATE INDEX "MissionEvent_actorId_idx" ON "MissionEvent"("actorId");

-- CreateIndex
CREATE INDEX "MissionEvent_driverId_idx" ON "MissionEvent"("driverId");

-- CreateIndex
CREATE INDEX "MissionEvent_truckId_idx" ON "MissionEvent"("truckId");

-- CreateIndex
CREATE INDEX "MissionEvent_type_idx" ON "MissionEvent"("type");

-- CreateIndex
CREATE INDEX "TruckPosition_truckId_recordedAt_idx" ON "TruckPosition"("truckId", "recordedAt");

-- AddForeignKey
ALTER TABLE "Truck" ADD CONSTRAINT "Truck_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionAssignment" ADD CONSTRAINT "MissionAssignment_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionAssignment" ADD CONSTRAINT "MissionAssignment_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionAssignment" ADD CONSTRAINT "MissionAssignment_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionEvent" ADD CONSTRAINT "MissionEvent_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionEvent" ADD CONSTRAINT "MissionEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionEvent" ADD CONSTRAINT "MissionEvent_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionEvent" ADD CONSTRAINT "MissionEvent_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckPosition" ADD CONSTRAINT "TruckPosition_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
