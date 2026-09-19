-- CreateTable
CREATE TABLE "TruckEvent" (
    "id" TEXT NOT NULL,
    "truckId" TEXT NOT NULL,
    "actorId" TEXT,
    "fromStatus" "TruckStatus",
    "toStatus" "TruckStatus" NOT NULL,
    "message" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TruckEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TruckEvent_truckId_createdAt_idx" ON "TruckEvent"("truckId", "createdAt");

-- AddForeignKey
ALTER TABLE "TruckEvent" ADD CONSTRAINT "TruckEvent_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckEvent" ADD CONSTRAINT "TruckEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
