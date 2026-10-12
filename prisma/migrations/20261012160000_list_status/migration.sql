-- AlterTable
ALTER TABLE "Entrant" ADD COLUMN "existingCustomer" BOOLEAN,
ADD COLUMN "emailWasSubscribed" BOOLEAN,
ADD COLUMN "smsWasSubscribed" BOOLEAN,
ADD COLUMN "listsCheckedAt" TIMESTAMP(3);
