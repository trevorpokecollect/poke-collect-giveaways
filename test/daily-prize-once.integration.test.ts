import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Two picks for the same day at once (scheduler + admin button, or two containers during a
// deploy) must hold, and reserve stock for, only one prize.
vi.mock("../app/shopify.server", () => ({ unauthenticated: {} }));

const moves: string[] = [];
const admin = {
  graphql: vi.fn(
    async (query: string, opts?: { variables?: Record<string, unknown> }) => {
      if (query.includes("DailyMoveInventory")) {
        moves.push(String(opts?.variables?.key));
        return Response.json({
          data: {
            inventoryMoveQuantities: {
              inventoryAdjustmentGroup: { id: "g" },
              userErrors: [],
            },
          },
        });
      }
      // Shopify is slow: both picks are looking at the same time.
      await new Promise((r) => setTimeout(r, 50));
      return Response.json({
        data: {
          productVariants: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                id: "gid://shopify/ProductVariant/1",
                title: "Default Title",
                displayName: "ETB",
                price: "50.00",
                image: null,
                product: {
                  id: "gid://shopify/Product/1",
                  title: "ETB",
                  handle: "etb",
                  status: "ACTIVE",
                  productType: "Sealed",
                  tags: [],
                  featuredMedia: null,
                },
                inventoryItem: {
                  id: "gid://shopify/InventoryItem/1",
                  tracked: true,
                  inventoryLevels: {
                    nodes: [
                      {
                        location: { id: "gid://shopify/Location/1" },
                        quantities: [
                          { name: "available", quantity: 3 },
                          { name: "safety_stock", quantity: 0 },
                        ],
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
      });
    },
  ),
};

describe.skipIf(!process.env.DATABASE_URL)(
  "one daily prize per day",
  async () => {
    const { default: db } = await import("../app/db.server");
    const { ensurePrize } = await import("../app/lib/daily.server");

    const shop = `prize-once-${Date.now()}.myshopify.com`;
    let campaign: Awaited<ReturnType<typeof db.campaign.create>>;

    beforeAll(async () => {
      campaign = await db.campaign.create({
        data: {
          shop,
          slug: "daily",
          title: "Daily",
          status: "ACTIVE",
          timezone: "America/New_York",
          settings: { daily: { enabled: true, drawTime: "21:00" } },
        },
      });
      await db.dailyQueueItem.create({
        data: {
          campaignId: campaign.id,
          productId: "gid://shopify/Product/1",
          title: "ETB",
          position: 1,
        },
      });
    });

    afterAll(async () => {
      await db.campaign.deleteMany({ where: { shop } });
      await db.$disconnect();
    });

    it("holds one prize when two picks race", async () => {
      const a = admin as never;
      const [x, y] = await Promise.all([
        ensurePrize(campaign, a),
        ensurePrize(campaign, a),
      ]);
      expect(x?.id).toBeTruthy();
      expect(y?.id).toBe(x?.id);
      const rows = await db.dailyPrize.findMany({
        where: { campaignId: campaign.id },
      });
      expect(rows).toHaveLength(1);
      expect(moves).toEqual([`daily-reserve-${x?.id}`]);
    });
  },
);
