-- AlterTable
ALTER TABLE "MaintenanceRequest" ADD COLUMN     "providerRequestId" TEXT;

-- CreateIndex
CREATE INDEX "MaintenanceRequest_externalProvider_idx" ON "MaintenanceRequest"("externalProvider");

-- CreateIndex
CREATE INDEX "MaintenanceRequest_externalRequestId_idx" ON "MaintenanceRequest"("externalRequestId");

-- CreateIndex
CREATE INDEX "MaintenanceRequest_providerRequestId_idx" ON "MaintenanceRequest"("providerRequestId");
