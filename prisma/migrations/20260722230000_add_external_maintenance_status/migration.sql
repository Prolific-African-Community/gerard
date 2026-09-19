-- Distinguish maintenance performed at the NovoTralux base from an external
-- intervention. Existing IN_MAINTENANCE values are intentionally preserved and
-- continue to mean maintenance at the base.
ALTER TYPE "TruckStatus" ADD VALUE 'MAINTENANCE_EXT';
ALTER TYPE "TrailerStatus" ADD VALUE 'MAINTENANCE_EXT';
