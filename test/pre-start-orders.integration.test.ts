import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe.skipIf(!process.env.DATABASE_URL)(
  "orders placed before the start",
  async () => {
    const { default: db } = await import("../app/db.server");
    const { processOrder, removePreStartOrderEntries } =
      await import("../app/lib/entries/orders.server");
    const { entrantTotal } = await import("../app/lib/entries/ledger.server");

    const shop = `prestart-${Date.now()}.myshopify.com`;
    const hourAgo = new Date(Date.now() - 3600_000);
    const dayAgo = new Date(Date.now() - 86400_000);
    let campaignId = "";
    const order = (id: number, placed: Date) => ({
      id,
      name: `#${id}`,
      email: "brock@poke-collect.com",
      created_at: placed.toISOString(),
      customer: { id: 7, first_name: "Brock", last_name: "Harrison" },
      subtotal_price: "20.00",
      total_price: "20.00",
      line_items: [
        { product_id: 1, variant_id: 11, quantity: 1, price: "20.00" },
      ],
    });

    beforeAll(async () => {
      const c = await db.campaign.create({
        data: {
          shop,
          slug: "daily",
          title: "Daily",
          status: "ACTIVE",
          // Opened with Go live and no start date before the fix.
          createdAt: hourAgo,
          settings: { daily: { enabled: true } },
          purchaseRules: {
            autoSignupFromOrders: true,
            base: {
              mode: "per_amount",
              entries: 1,
              amount: 1,
              basis: "subtotal",
            },
          },
          actions: {
            create: [{ type: "SIGNUP", label: "Sign Up", entries: 1 }],
          },
        },
      });
      campaignId = c.id;
    });

    afterAll(async () => {
      await db.campaign.deleteMany({ where: { shop } });
      await db.$disconnect();
    });

    it("ignores Shopify updates to orders placed before the giveaway opened", async () => {
      await processOrder(shop, order(1, dayAgo));
      expect(await db.entrant.count({ where: { campaignId } })).toBe(0);

      await processOrder(shop, order(2, new Date()));
      const brock = await db.entrant.findFirstOrThrow({
        where: { campaignId },
      });
      expect(brock.name).toBe("Brock Harrison");
      expect(await entrantTotal(brock.id)).toBe(20);
      // Daily: the order counts on the day it was placed.
      const ev = await db.entryEvent.findFirstOrThrow({
        where: { campaignId, source: "PURCHASE" },
      });
      expect(Math.abs(ev.createdAt.getTime() - Date.now())).toBeLessThan(
        60_000,
      );
    });

    it("takes back entries already given for older orders", async () => {
      const brock = await db.entrant.findFirstOrThrow({
        where: { campaignId },
      });
      // An entry from before the fix: an old order scored by an update webhook.
      const log = await db.orderLog.create({
        data: {
          campaignId,
          shopifyOrderId: "3",
          orderName: "#3",
          status: "ENTRIES",
          entries: 50,
        },
      });
      await db.entryEvent.create({
        data: {
          campaignId,
          entrantId: brock.id,
          entries: 50,
          source: "PURCHASE",
          orderLogId: log.id,
        },
      });
      expect(await entrantTotal(brock.id)).toBe(70);

      const admin = {
        graphql: async (
          _q: string,
          o?: { variables?: Record<string, unknown> },
        ) => {
          const ids = o!.variables!.ids as string[];
          return new Response(
            JSON.stringify({
              data: {
                nodes: ids.map((id) => ({
                  id,
                  createdAt: (id.endsWith("/3")
                    ? dayAgo
                    : new Date()
                  ).toISOString(),
                })),
              },
            }),
          );
        },
      };
      expect(
        await removePreStartOrderEntries(
          await db.campaign.findUniqueOrThrow({ where: { id: campaignId } }),
          admin,
        ),
      ).toEqual({ orders: 1, entries: 50 });
      expect(await entrantTotal(brock.id)).toBe(20);
      expect(
        await db.orderLog.findUniqueOrThrow({ where: { id: log.id } }),
      ).toMatchObject({
        entries: 0,
        status: "NO_ENTRIES",
      });
      // Running it again changes nothing.
      expect(
        await removePreStartOrderEntries(
          await db.campaign.findUniqueOrThrow({ where: { id: campaignId } }),
          admin,
        ),
      ).toEqual({ orders: 0, entries: 0 });
    });
  },
);
