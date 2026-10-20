-- AlterTable
ALTER TABLE "DailyPrize" ADD COLUMN "items" JSONB;

-- AlterTable
ALTER TABLE "DailyQueueItem" ADD COLUMN "bundle" JSONB;
