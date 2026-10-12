-- CreateEnum
CREATE TYPE "DailyPrizeStatus" AS ENUM ('RESERVED', 'DRAWN', 'SENT', 'RELEASED');

-- CreateTable
CREATE TABLE "DailyPrize" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "drawAt" TIMESTAMP(3) NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productHandle" TEXT,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT,
    "value" DOUBLE PRECISION NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" "DailyPrizeStatus" NOT NULL DEFAULT 'RESERVED',
    "drawId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyPrize_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyPrize_drawId_key" ON "DailyPrize"("drawId");

-- CreateIndex
CREATE INDEX "DailyPrize_campaignId_periodKey_idx" ON "DailyPrize"("campaignId", "periodKey");

-- CreateIndex
CREATE INDEX "DailyPrize_status_drawAt_idx" ON "DailyPrize"("status", "drawAt");

-- AddForeignKey
ALTER TABLE "DailyPrize" ADD CONSTRAINT "DailyPrize_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPrize" ADD CONSTRAINT "DailyPrize_drawId_fkey" FOREIGN KEY ("drawId") REFERENCES "Draw"("id") ON DELETE SET NULL ON UPDATE CASCADE;

