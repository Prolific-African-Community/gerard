-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "billingInfo" JSONB,
ADD COLUMN     "clientReference" TEXT,
ADD COLUMN     "contacts" JSONB,
ADD COLUMN     "deliveryDate" TIMESTAMP(3),
ADD COLUMN     "paymentTerms" TEXT,
ADD COLUMN     "pickupDate" TIMESTAMP(3),
ADD COLUMN     "preAnnouncementRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "preAnnouncementSent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "preAnnouncementSentAt" TIMESTAMP(3),
ADD COLUMN     "priceAmount" DOUBLE PRECISION,
ADD COLUMN     "priceCurrency" TEXT,
ADD COLUMN     "requiredTruckType" TEXT,
ADD COLUMN     "requirements" JSONB;
