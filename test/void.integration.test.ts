import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe.skipIf(!process.env.DATABASE_URL)(
  "disqualifying one entry",
  async () => {
    const { default: db } = await import("../app/db.server");
    const { voidEvent, restoreEvent, activityFeed } =
      await import("../app/lib/entries/void.server");
    const { processOrder } = await import("../app/lib/entries/orders.server");
    const { entrantTotal } = await import("../app/lib/entries/ledger.server");

    const shop = `void-${Date.now()}.myshopify.com`;
    let campaignId = "";
    let entrantId = "";
    let whatnotEvent = "";
    const order = {
      id: 77,
      name: "#77",
      email: "misty@poke-collect.com",
      created_at: new Date().toISOString(),
      subtotal_price: "30.00",
      total_price: "30.00",
      line_items: [
        { product_id: 1, variant_id: 11, quantity: 1, price: "30.00" },
      ],
    };

    beforeAll(async () => {
      const c = await db.campaign.create({
        data: {
          shop,
          slug: "monthly",
          title: "Monthly",
          status: "ACTIVE",
          createdAt: new Date(Date.now() - 3600_000),
          purchaseRules: {
            base: {
              mode: "per_amount",
              entries: 1,
              amount: 1,
              basis: "subtotal",
            },
          },
          actions: {
            create: [
              { type: "SIGNUP", label: "Sign Up", entries: 1 },
              {
                type: "SOCIAL_FOLLOW",
                label: "Follow Us On Whatnot",
                entries: 100,
              },
            ],
          },
        },
        include: { actions: true },
      });
      campaignId = c.id;
      const e = await db.entrant.create({
        data: {
          campaignId,
          email: "misty@poke-collect.com",
          emailNormalized: "misty@poke-collect.com",
          name: "Misty Waterflower",
          status: "ACTIVE",
          referralCode: `v${Date.now()}`,
        },
      });
      entrantId = e.id;
      const whatnot = c.actions.find((a) => a.type === "SOCIAL_FOLLOW")!;
      whatnotEvent = (
        await db.entryEvent.create({
          data: {
            campaignId,
            entrantId,
            entries: 100,
            source: "ACTION",
            actionId: whatnot.id,
          },
        })
      ).id;
      await processOrder(shop, order);
    });

    afterAll(async () => {
      await db.campaign.deleteMany({ where: { shop } });
      await db.$disconnect();
    });

    it("shows each entry by method in the activity feed", async () => {
      const feed = await activityFeed(campaignId, {});
      expect(feed.map((f) => [f.what, f.entries])).toEqual(
        expect.arrayContaining([
          ["Follow Us On Whatnot", 100],
          ["Order #77", 30],
        ]),
      );
      expect(await activityFeed(campaignId, { q: "nobody" })).toEqual([]);
      expect(await entrantTotal(entrantId)).toBe(130);
    });

    it("takes back one entry with a reason, once, and restores it", async () => {
      expect(await voidEvent(campaignId, whatnotEvent, "fake follow")).toEqual({
        ok: true,
      });
      expect(await voidEvent(campaignId, whatnotEvent, "again")).toMatchObject({
        error: expect.any(String),
      });
      expect(await entrantTotal(entrantId)).toBe(30);
      const feed = await activityFeed(campaignId, {});
      expect(feed.find((f) => f.id === whatnotEvent)?.voided).toBe(
        "fake follow",
      );
      expect(
        feed.some((f) => f.what === "Entry disqualified (fake follow)"),
      ).toBe(true);

      expect(await restoreEvent(campaignId, whatnotEvent)).toEqual({
        ok: true,
      });
      expect(await entrantTotal(entrantId)).toBe(130);
    });

    it("keeps a disqualified order at zero when Shopify updates it", async () => {
      const ev = await db.entryEvent.findFirstOrThrow({
        where: { campaignId, source: "PURCHASE" },
      });
      await voidEvent(campaignId, ev.id, "fraud");
      await processOrder(shop, { ...order, subtotal_price: "40.00" });
      expect(await entrantTotal(entrantId)).toBe(100);
    });
  },
);
