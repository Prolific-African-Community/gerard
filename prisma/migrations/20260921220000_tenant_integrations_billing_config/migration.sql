-- Tenant-scoped legal identity and optional provider integrations.
CREATE TYPE "OrganizationIntegrationType" AS ENUM ('MAIL_INTAKE', 'SL_AUTOMOTIVE');

ALTER TYPE "PlatformAuditAction" ADD VALUE 'BILLING_CONFIG_CHANGED';
ALTER TYPE "PlatformAuditAction" ADD VALUE 'INTEGRATION_CHANGED';

CREATE TABLE "OrganizationBillingConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "legalAddress" TEXT,
    "vatNumber" TEXT,
    "iban" TEXT,
    "bic" TEXT,
    "bankName" TEXT,
    "beneficiary" TEXT,
    "invoicePrefix" TEXT,
    "paymentTermsDays" INTEGER,
    "billingEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganizationBillingConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizationIntegration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "OrganizationIntegrationType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "configJson" JSONB NOT NULL DEFAULT '{}',
    "secretRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganizationIntegration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationBillingConfig_organizationId_key" ON "OrganizationBillingConfig"("organizationId");
CREATE UNIQUE INDEX "OrganizationIntegration_organizationId_type_key" ON "OrganizationIntegration"("organizationId", "type");
CREATE INDEX "OrganizationIntegration_organizationId_enabled_idx" ON "OrganizationIntegration"("organizationId", "enabled");

ALTER TABLE "OrganizationBillingConfig" ADD CONSTRAINT "OrganizationBillingConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationIntegration" ADD CONSTRAINT "OrganizationIntegration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
