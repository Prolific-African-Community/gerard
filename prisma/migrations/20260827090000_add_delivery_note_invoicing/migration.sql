-- Additive delivery-note references for missions and immutable invoice snapshots.
ALTER TABLE "Mission" ADD COLUMN "deliveryNoteNumber" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "deliveryNoteNumber" TEXT;
ALTER TABLE "InvoiceMission" ADD COLUMN "deliveryNoteNumberSnapshot" TEXT;
ALTER TABLE "InvoiceMission" ADD COLUMN "clientReferenceSnapshot" TEXT;
