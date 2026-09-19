-- CreateTable
CREATE TABLE "ClientProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "displayName" TEXT,
    "emailDomains" JSONB,
    "contactEmails" JSONB,
    "contactPhones" JSONB,
    "billingInfo" JSONB,
    "defaultPaymentTerms" TEXT,
    "defaultTruckType" TEXT,
    "defaultTrailerType" TEXT,
    "defaultPreAnnouncementRequired" BOOLEAN NOT NULL DEFAULT false,
    "defaultRequirements" JSONB,
    "defaultContacts" JSONB,
    "operationalNotes" TEXT,
    "parserHints" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientProfile_name_key" ON "ClientProfile"("name");

-- CreateIndex
CREATE INDEX "ClientProfile_name_idx" ON "ClientProfile"("name");

-- CreateIndex
CREATE INDEX "ClientProfile_isActive_idx" ON "ClientProfile"("isActive");
