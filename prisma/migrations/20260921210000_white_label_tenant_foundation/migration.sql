ALTER TYPE "PlatformAuditAction" ADD VALUE 'BRANDING_CHANGED';
ALTER TYPE "PlatformAuditAction" ADD VALUE 'DOMAIN_CREATED';
ALTER TYPE "PlatformAuditAction" ADD VALUE 'DOMAIN_UPDATED';
ALTER TYPE "PlatformAuditAction" ADD VALUE 'DOMAIN_DELETED';

ALTER TABLE "Organization"
  ADD COLUMN "displayName" TEXT,
  ADD COLUMN "logoUrl" TEXT,
  ADD COLUMN "accentColor" TEXT,
  ADD COLUMN "faviconUrl" TEXT,
  ADD COLUMN "applicationTitle" TEXT;

CREATE TABLE "OrganizationDomain" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "hostname" TEXT NOT NULL,
  "pathPrefix" TEXT NOT NULL DEFAULT '',
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganizationDomain_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationDomain_hostname_pathPrefix_key" ON "OrganizationDomain"("hostname", "pathPrefix");
CREATE INDEX "OrganizationDomain_organizationId_isActive_idx" ON "OrganizationDomain"("organizationId", "isActive");
CREATE INDEX "OrganizationDomain_hostname_isActive_idx" ON "OrganizationDomain"("hostname", "isActive");
CREATE UNIQUE INDEX "OrganizationDomain_one_primary_per_organization" ON "OrganizationDomain"("organizationId") WHERE "isPrimary" = true;
ALTER TABLE "OrganizationDomain" ADD CONSTRAINT "OrganizationDomain_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
