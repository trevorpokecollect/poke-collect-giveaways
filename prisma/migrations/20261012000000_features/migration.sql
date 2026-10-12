-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActionType" ADD VALUE 'POLL';
ALTER TYPE "ActionType" ADD VALUE 'QUESTION';
ALTER TYPE "ActionType" ADD VALUE 'WATCH_VIDEO';
ALTER TYPE "ActionType" ADD VALUE 'SOCIAL_SHARE';

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "settings" JSONB;

-- AlterTable
ALTER TABLE "Entrant" ADD COLUMN     "discountCode" TEXT,
ADD COLUMN     "klaviyoSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Winner" ADD COLUMN     "claimData" JSONB,
ADD COLUMN     "claimedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ActionResponse" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "entrantId" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActionResponse_actionId_entrantId_key" ON "ActionResponse"("actionId", "entrantId");

-- AddForeignKey
ALTER TABLE "ActionResponse" ADD CONSTRAINT "ActionResponse_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "EntryAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionResponse" ADD CONSTRAINT "ActionResponse_entrantId_fkey" FOREIGN KEY ("entrantId") REFERENCES "Entrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

