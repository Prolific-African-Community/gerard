-- Add the optional business CMR reference to missions and invoice snapshots.
ALTER TABLE "Mission" ADD COLUMN "cmrNumber" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "cmrNumber" TEXT;
