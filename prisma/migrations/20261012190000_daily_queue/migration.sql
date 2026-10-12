CREATE TABLE "DailyQueueItem" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT,
    "position" INTEGER NOT NULL,
    "pinnedDate" TEXT,
    "usedAt" TIMESTAMP(3),
    "prizeId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyQueueItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DailyQueueItem_campaignId_usedAt_position_idx" ON "DailyQueueItem"("campaignId", "usedAt", "position");
ALTER TABLE "DailyQueueItem" ADD CONSTRAINT "DailyQueueItem_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
