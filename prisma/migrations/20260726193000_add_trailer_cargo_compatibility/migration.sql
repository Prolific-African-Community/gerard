-- Cargo currently loaded (cargoType) and cargo families accepted by a trailer
-- are distinct concepts. Existing rows remain unknown (NULL).
ALTER TABLE "Trailer"
  ADD COLUMN "compatibleCargoTypes" JSONB;
