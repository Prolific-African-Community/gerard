-- AlterTable
ALTER TABLE "Trailer" ADD COLUMN     "technicalInspectionDate" TIMESTAMP(3),
ADD COLUMN     "technicalInspectionExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Truck" ADD COLUMN     "technicalInspectionDate" TIMESTAMP(3),
ADD COLUMN     "technicalInspectionExpiresAt" TIMESTAMP(3);
