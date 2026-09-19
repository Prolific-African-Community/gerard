CREATE TABLE "DispatchOptimizationApplication" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "simulationId" TEXT NOT NULL,
    "snapshotFingerprint" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "missionIds" JSONB NOT NULL,
    "pairRowIds" JSONB NOT NULL,
    "resultSummary" JSONB NOT NULL,
    "warnings" JSONB,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispatchOptimizationApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DispatchOptimizationApplication_idempotencyKey_key"
ON "DispatchOptimizationApplication"("idempotencyKey");

CREATE INDEX "DispatchOptimizationApplication_actorId_createdAt_idx"
ON "DispatchOptimizationApplication"("actorId", "createdAt");

CREATE INDEX "DispatchOptimizationApplication_simulationId_idx"
ON "DispatchOptimizationApplication"("simulationId");

CREATE INDEX "DispatchOptimizationApplication_periodStart_periodEnd_idx"
ON "DispatchOptimizationApplication"("periodStart", "periodEnd");

ALTER TABLE "DispatchOptimizationApplication"
ADD CONSTRAINT "DispatchOptimizationApplication_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
