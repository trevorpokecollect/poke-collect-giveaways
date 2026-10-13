-- CreateTable
CREATE TABLE "FollowClickDay" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "giveaway" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowClickDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FollowClickDay_shop_date_giveaway_platform_key" ON "FollowClickDay"("shop", "date", "giveaway", "platform");

-- CreateIndex
CREATE INDEX "FollowClickDay_date_idx" ON "FollowClickDay"("date");
