-- Import previews are intentionally permissive: absent business data is stored
-- as NULL and resolved later during mission preparation, never invented.
ALTER TABLE "Mission" ALTER COLUMN "clientName" DROP NOT NULL;
ALTER TABLE "Mission" ALTER COLUMN "pickupCity" DROP NOT NULL;
ALTER TABLE "Mission" ALTER COLUMN "deliveryCity" DROP NOT NULL;
