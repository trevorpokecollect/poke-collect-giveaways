-- AlterEnum
ALTER TYPE "ActionType" ADD VALUE 'SMS_OPTIN';

-- AlterTable
ALTER TABLE "Entrant" ADD COLUMN "phone" TEXT,
ADD COLUMN "smsConsentAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Entrant_campaignId_phone_idx" ON "Entrant"("campaignId", "phone");
