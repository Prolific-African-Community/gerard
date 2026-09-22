CREATE TYPE "OrganizationModule" AS ENUM ('PLANNING', 'MAP', 'PROFITABILITY', 'INVOICING', 'FLEET', 'INTELLIGENCE', 'ASSISTANT', 'MAINTENANCE');
CREATE TYPE "PlatformAuditAction" AS ENUM ('ORGANIZATION_CREATED', 'ORGANIZATION_UPDATED', 'ORGANIZATION_STATUS_CHANGED', 'MEMBER_ADDED', 'MEMBER_REMOVED', 'MEMBER_ROLE_CHANGED', 'MODULES_CHANGED');

ALTER TABLE "Organization"
ADD COLUMN "enabledModules" "OrganizationModule"[] NOT NULL
DEFAULT ARRAY['PLANNING', 'MAP', 'PROFITABILITY', 'INVOICING', 'FLEET', 'INTELLIGENCE', 'ASSISTANT', 'MAINTENANCE']::"OrganizationModule"[];

CREATE TABLE "PlatformAuditLog" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "action" "PlatformAuditAction" NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlatformAuditLog_organizationId_createdAt_idx" ON "PlatformAuditLog"("organizationId", "createdAt");
CREATE INDEX "PlatformAuditLog_actorUserId_createdAt_idx" ON "PlatformAuditLog"("actorUserId", "createdAt");

ALTER TABLE "PlatformAuditLog" ADD CONSTRAINT "PlatformAuditLog_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlatformAuditLog" ADD CONSTRAINT "PlatformAuditLog_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Bootstrap exactly one platform owner from the oldest active legacy administrator.
UPDATE "User"
SET "platformRole" = 'SUPER_ADMIN'
WHERE "id" = (
  SELECT "id" FROM "User"
  WHERE "role" = 'ADMIN' AND "isActive" = true
  ORDER BY "createdAt" ASC, "id" ASC
  LIMIT 1
)
AND "platformRole" IS NULL;
