ALTER TABLE "DriverRegulatoryDeclaration"
ALTER COLUMN "validUntil" DROP NOT NULL,
ADD COLUMN "knownFields" JSONB;
