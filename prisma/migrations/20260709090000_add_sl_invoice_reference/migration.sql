-- AlterTable
ALTER TABLE "MaintenanceRequest" ADD COLUMN "slInvoiceReference" TEXT;

-- CreateIndex
CREATE INDEX "MaintenanceRequest_slInvoiceReference_idx" ON "MaintenanceRequest"("slInvoiceReference");
