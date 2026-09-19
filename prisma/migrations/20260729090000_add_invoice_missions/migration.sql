-- Additive support for grouped invoices. Existing Invoice.missionId links stay intact.
CREATE TABLE "InvoiceMission" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "missionId" TEXT NOT NULL,
  "missionReferenceSnapshot" TEXT NOT NULL,
  "cmrNumberSnapshot" TEXT,
  "amountSnapshot" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "currencySnapshot" TEXT NOT NULL DEFAULT 'EUR',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InvoiceMission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvoiceMission_invoiceId_missionId_key" ON "InvoiceMission"("invoiceId", "missionId");
CREATE INDEX "InvoiceMission_missionId_idx" ON "InvoiceMission"("missionId");
CREATE INDEX "InvoiceMission_invoiceId_sortOrder_idx" ON "InvoiceMission"("invoiceId", "sortOrder");

ALTER TABLE "InvoiceMission" ADD CONSTRAINT "InvoiceMission_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceMission" ADD CONSTRAINT "InvoiceMission_missionId_fkey"
  FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
