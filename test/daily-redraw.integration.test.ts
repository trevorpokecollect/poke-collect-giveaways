import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Forfeiting a daily winner redraws from that day's entries, inside the same draw, so the
// replacement is emailed (and gets the $0 order for) that day's product.
vi.mock("../app/shopify.server", () => ({ unauthenticated: {} }));

describe.skipIf(!process.env.DATABASE_URL)(
  "forfeit and redraw on a daily prize",
  async () => {
    const { default: db } = await import("../app/db.server");
    const { forfeitAndRedraw } = await import("../app/lib/winners.server");
    const { periodFor } = await import("../app/lib/daily");

    const shop = `redraw-${Date.now()}.myshopify.com`;
    const tz = "America/New_York";
    // Yesterday's draw: its day closed at the last 9pm.
    const today = periodFor(new Date(), tz, "21:00");
    const opensAt = new Date(today.opensAt.getTime() - 24 * 3600_000);
    const drawAt = today.opensAt;
    const during = new Date(opensAt.getTime() + 60_000);
    const earlier = new Date(opensAt.getTime() - 60_000);
    let campaignId = "";
    let drawId = "";
    const ids: Record<string, string> = {};

    beforeAll(async () => {
      const campaign = await db.campaign.create({
        data: {
          shop,
          slug: "daily",
          title: "Daily",
          prize: "Grand Prize",
          status: "ACTIVE",
          timezone: tz,
          settings: { daily: { enabled: true, drawTime: "21:00" } },
        },
      });
      campaignId = campaign.id;
      // first won; second entered that day; third only entered the day before.
      for (const [name, at] of [
        ["first", during],
        ["second", during],
        ["third", earlier],
      ] as const) {
        const e = await db.entrant.create({
          data: {
            campaignId,
            email: `${name}@example.com`,
            emailNormalized: `${name}@example.com`,
            referralCode: `${name}-${Date.now()}`,
            status: "ACTIVE",
          },
        });
        ids[name] = e.id;
        await db.entryEvent.create({
          data: {
            campaignId,
            entrantId: e.id,
            entries: 5,
            source: "ACTION",
            createdAt: at,
          },
        });
      }
      const draw = await db.draw.create({
        data: {
          campaignId,
          seed: "00",
          snapshotHash: "x",
          totalEntries: 10,
          eligibleCount: 2,
          createdBy: "daily draw",
          winners: { create: [{ entrantId: ids.first, position: 1 }] },
        },
        include: { winners: true },
      });
      drawId = draw.id;
      await db.dailyPrize.create({
        data: {
          campaignId,
          periodKey: "test",
          opensAt,
          drawAt,
          productId: "p",
          variantId: "v",
          title: "Daily ETB",
          value: 1,
          inventoryItemId: "i",
          locationId: "l",
          status: "DRAWN",
          drawId,
        },
      });
    });

    afterAll(async () => {
      await db.campaign.deleteMany({ where: { shop } });
      await db.$disconnect();
    });

    it("replaces the winner from that day's entries in the same draw", async () => {
      const first = await db.winner.findFirstOrThrow({ where: { drawId } });
      const draw = await forfeitAndRedraw(campaignId, first.id);
      expect(draw.id).toBe(drawId);
      const live = draw.winners.filter((w) => !w.forfeited);
      expect(live.map((w) => w.entrantId)).toEqual([ids.second]);
      expect(live[0].position).toBe(2);
      // The prize still points at this draw, so the email and $0 order use it.
      const prize = await db.dailyPrize.findFirstOrThrow({
        where: { campaignId },
      });
      expect(prize.drawId).toBe(drawId);
    });

    it("says so when nobody else entered that day", async () => {
      const second = await db.winner.findFirstOrThrow({
        where: { drawId, entrantId: ids.second },
      });
      await expect(forfeitAndRedraw(campaignId, second.id)).rejects.toThrow(
        /Nobody else entered that day/,
      );
    });
  },
);
