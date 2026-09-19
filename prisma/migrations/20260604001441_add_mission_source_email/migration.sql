-- CreateTable
CREATE TABLE "MissionSourceEmail" (
    "id" TEXT NOT NULL,
    "missionId" TEXT,
    "source" TEXT NOT NULL,
    "provider" TEXT,
    "sourceEmailId" TEXT NOT NULL,
    "messageId" TEXT,
    "previewKey" TEXT,
    "subject" TEXT,
    "fromName" TEXT,
    "fromAddress" TEXT,
    "toAddresses" JSONB,
    "ccAddresses" JSONB,
    "receivedAt" TIMESTAMP(3),
    "bodyPreview" TEXT,
    "cleanedBodyText" TEXT,
    "rawBodyText" TEXT,
    "rawBodyHtml" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MissionSourceEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MissionSourceEmail_missionId_key" ON "MissionSourceEmail"("missionId");

-- CreateIndex
CREATE INDEX "MissionSourceEmail_missionId_idx" ON "MissionSourceEmail"("missionId");

-- CreateIndex
CREATE INDEX "MissionSourceEmail_sourceEmailId_idx" ON "MissionSourceEmail"("sourceEmailId");

-- CreateIndex
CREATE INDEX "MissionSourceEmail_messageId_idx" ON "MissionSourceEmail"("messageId");

-- AddForeignKey
ALTER TABLE "MissionSourceEmail" ADD CONSTRAINT "MissionSourceEmail_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
