CREATE TABLE "RouteFailureCache" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "errorCode" TEXT NOT NULL,
    "retryAfter" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouteFailureCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RouteFailureCache_fingerprint_key" ON "RouteFailureCache"("fingerprint");
CREATE INDEX "RouteFailureCache_retryAfter_idx" ON "RouteFailureCache"("retryAfter");
