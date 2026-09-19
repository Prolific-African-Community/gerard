-- AlterTable
ALTER TABLE "PlanningRow" ADD COLUMN     "trailerId" TEXT;

-- CreateIndex
CREATE INDEX "PlanningRow_trailerId_idx" ON "PlanningRow"("trailerId");

-- AddForeignKey
ALTER TABLE "PlanningRow" ADD CONSTRAINT "PlanningRow_trailerId_fkey" FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
