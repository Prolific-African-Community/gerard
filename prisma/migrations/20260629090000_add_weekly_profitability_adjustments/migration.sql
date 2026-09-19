-- CreateTable
CREATE TABLE "WeeklyProfitabilityAdjustment" (
    "id" TEXT NOT NULL,
    "weekStartDate" TIMESTAMP(3) NOT NULL,
    "tollCostAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyProfitabilityAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyProfitabilityAdjustment_weekStartDate_key" ON "WeeklyProfitabilityAdjustment"("weekStartDate");

-- CreateIndex
CREATE INDEX "WeeklyProfitabilityAdjustment_weekStartDate_idx" ON "WeeklyProfitabilityAdjustment"("weekStartDate");
