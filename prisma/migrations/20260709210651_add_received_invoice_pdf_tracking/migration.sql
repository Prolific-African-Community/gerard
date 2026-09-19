-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "sourcePdfFileName" TEXT,
ADD COLUMN     "sourcePdfMimeType" TEXT,
ADD COLUMN     "sourcePdfUrl" TEXT;

-- CreateIndex
CREATE INDEX "Invoice_sourcePdfUrl_idx" ON "Invoice"("sourcePdfUrl");
