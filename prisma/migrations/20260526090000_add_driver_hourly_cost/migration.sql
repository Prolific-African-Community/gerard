-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "hourlyCostAmount" DOUBLE PRECISION,
ADD COLUMN     "hourlyCostCurrency" TEXT NOT NULL DEFAULT 'EUR';
