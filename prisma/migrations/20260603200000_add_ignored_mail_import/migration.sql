-- CreateTable
CREATE TABLE "IgnoredMailImport" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceEmailId" TEXT NOT NULL,
    "messageId" TEXT,
    "previewKey" TEXT NOT NULL,
    "clientReference" TEXT,
    "subject" TEXT,
    "fromAddress" TEXT,
    "ignoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ignoredBy" TEXT,

    CONSTRAINT "IgnoredMailImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IgnoredMailImport_previewKey_key" ON "IgnoredMailImport"("previewKey");
