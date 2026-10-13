import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Claiming a daily prize creates a $0 Shopify order for it (once); a monthly prize doesn't.
const calls: { query: string; variables?: Record<string, unknown> }[] = [];
let failNext = false;
const admin = {
  graphql: vi.fn(
    async (query: string, opts?: { variables?: Record<string, unknown> }) => {
      calls.push({ query, variables: opts?.variables });
      if (query.includes("currencyCode"))
        return Response.json({ data: { shop: { currencyCode: "USD" } } });
      if (failNext) {
        failNext = false;
        return Response.json({
          data: {
            orderCreate: {
              order: null,
              userErrors: [{ message: "Variant is unavailable" }],
            },
          },
        });
      }
      return Response.json({
        data: {
          orderCreate: {
            order: { id: "gid://shopify/Order/555", name: "#1001" },
            userErrors: [],
          },
        },
      });
    },
  ),
};
vi.mock("../app/shopify.server", () => ({
  unauthenticated: { admin: async () => ({ admin }) },
}));

describe.skipIf(!process.env.DATABASE_URL)(
  "prize orders on claim",
  async () => {
    const { default: db } = await import("../app/db.server");
    const w = await import("../app/lib/winners.server");
    const { issueClaimToken } = await import("../app/lib/winners");

    const shop = `prize-order-${Date.now()}.myshopify.com`;
    const address = {
      name: "Ash Ketchum",
      address1: "1 Route 1",
      city: "Pallet",
      province: "Texas",
      zip: "12345",
      country: "United States",
      phone: "555-123-4567",
    };

    async function makeWinner(daily: boolean, n: number) {
      const campaign = await db.campaign.create({
        data: { shop, slug: `g${n}`, title: "Daily", status: "ACTIVE" },
      });
      const entrant = await db.entrant.create({
        data: {
          campaignId: campaign.id,
          email: `win${n}@example.com`,
          emailNormalized: `win${n}@example.com`,
          name: "Ash Ketchum",
          status: "ACTIVE",
          referralCode: `ref-${Date.now()}-${n}`,
        },
      });
      const draw = await db.draw.create({
        data: {
          campaignId: campaign.id,
          seed: "00",
          snapshotHash: "00",
          totalEntries: 1,
          eligibleCount: 1,
          winners: {
            create: {
              entrantId: entrant.id,
              position: 1,
              notifiedAt: new Date(),
            },
          },
        },
        include: { winners: true },
      });
      if (daily)
        await db.dailyPrize.create({
          data: {
            campaignId: campaign.id,
            periodKey: "2026-10-12",
            opensAt: new Date(),
            drawAt: new Date(),
            productId: "gid://shopify/Product/1",
            variantId: "gid://shopify/ProductVariant/2",
            title: "Storm Emeralda Booster Box",
            value: 98.95,
            inventoryItemId: "gid://shopify/InventoryItem/3",
            locationId: "gid://shopify/Location/4",
            status: "DRAWN",
            drawId: draw.id,
          },
        });
      const winner = draw.winners[0];
      const token = issueClaimToken(
        "test-secret",
        winner.id,
        new Date(Date.now() + 86400_000),
      );
      return { winner, token };
    }

    beforeAll(() => {
      process.env.ENTRANT_TOKEN_SECRET = "test-secret";
    });

    afterAll(async () => {
      await db.campaign.deleteMany({ where: { shop } });
      await db.$disconnect();
    });

    it("creates a $0 order with the shipping address when a daily winner claims", async () => {
      calls.length = 0;
      const { winner, token } = await makeWinner(true, 1);
      const r = await w.submitClaim(shop, token, address);
      expect(r.view.kind).toBe("claimed");
      const create = calls.find((c) => c.query.includes("orderCreate"))!;
      const order = create.variables!.order as {
        lineItems: unknown[];
        shippingAddress: unknown;
      };
      expect(order.lineItems[0]).toMatchObject({
        variantId: "gid://shopify/ProductVariant/2",
        quantity: 1,
        priceSet: { shopMoney: { amount: "0.00", currencyCode: "USD" } },
      });
      expect(order.shippingAddress).toMatchObject({
        firstName: "Ash",
        lastName: "Ketchum",
        countryCode: "US",
        provinceCode: "TX",
      });
      expect(create.variables!.options).toMatchObject({
        inventoryBehaviour: "BYPASS",
      });
      const saved = await db.winner.findUniqueOrThrow({
        where: { id: winner.id },
      });
      expect(saved.prizeOrderName).toBe("#1001");

      // Submitting again doesn't create a second order.
      calls.length = 0;
      await w.submitClaim(shop, token, address);
      expect(calls).toHaveLength(0);
    });

    it("keeps the claim when Shopify refuses, and Create Order retries", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      failNext = true;
      const { winner, token } = await makeWinner(true, 2);
      const r = await w.submitClaim(shop, token, address);
      expect(r.view.kind).toBe("claimed");
      expect(
        (await db.winner.findUniqueOrThrow({ where: { id: winner.id } }))
          .prizeOrderName,
      ).toBeNull();
      const form = new FormData();
      form.set("winnerId", winner.id);
      const draw = await db.draw.findUniqueOrThrow({
        where: { id: winner.drawId },
      });
      const res = await w.handleDrawIntent({
        admin: admin as never,
        shop,
        campaignId: draw.campaignId,
        intent: "prizeOrder",
        form,
      });
      expect(res).toMatchObject({ ok: true, message: "Order #1001 created." });
    });

    it("doesn't create an order for a monthly winner", async () => {
      calls.length = 0;
      const { token } = await makeWinner(false, 3);
      await w.submitClaim(shop, token, address);
      expect(calls).toHaveLength(0);
    });
  },
);
