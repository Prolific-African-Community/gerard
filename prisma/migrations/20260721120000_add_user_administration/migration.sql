-- Extend the existing role enum without replacing it, preserving every account.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SECRETARY';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PARK_MANAGER';

-- Existing accounts remain active and are explicitly exempt from first-login rotation.
ALTER TABLE "User"
ADD COLUMN "firstName" TEXT NOT NULL DEFAULT '',
ADD COLUMN "lastName" TEXT NOT NULL DEFAULT '',
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "lastLoginAt" TIMESTAMP(3),
ADD COLUMN "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN "temporaryPasswordIssuedAt" TIMESTAMP(3),
ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- Keep the legacy display name while deriving non-destructive structured names.
UPDATE "User"
SET "firstName" = CASE
  WHEN position(' ' in trim("name")) > 0 THEN split_part(trim("name"), ' ', 1)
  ELSE trim("name")
END,
"lastName" = CASE
  WHEN position(' ' in trim("name")) > 0 THEN substring(trim("name") from position(' ' in trim("name")) + 1)
  ELSE ''
END;

CREATE INDEX "User_isActive_idx" ON "User"("isActive");
