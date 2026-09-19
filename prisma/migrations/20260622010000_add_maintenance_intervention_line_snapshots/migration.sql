CREATE TABLE "MaintenanceInterventionLine" (
    "id" TEXT NOT NULL,
    "maintenanceRequestId" TEXT NOT NULL,
    "providerLineId" TEXT,
    "code" TEXT,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "qty" DOUBLE PRECISION NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceInterventionLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MaintenanceInterventionLine_maintenanceRequestId_idx" ON "MaintenanceInterventionLine"("maintenanceRequestId");
CREATE INDEX "MaintenanceInterventionLine_providerLineId_idx" ON "MaintenanceInterventionLine"("providerLineId");

ALTER TABLE "MaintenanceInterventionLine" ADD CONSTRAINT "MaintenanceInterventionLine_maintenanceRequestId_fkey" FOREIGN KEY ("maintenanceRequestId") REFERENCES "MaintenanceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
