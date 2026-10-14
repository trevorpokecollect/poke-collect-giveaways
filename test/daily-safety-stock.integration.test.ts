import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// A prize chosen from safety stock: Shopify requires a ledger document on both sides of the
// move (only "available" may go without), or it refuses with "A ledger document URI is required".
vi.mock("../app/shopify.server", () => ({ unauthenticated: {} }));

const moves: Record<string, unknown>[] = [];
const admin = {
  graphql: vi.fn(
    async (query: string, opts?: { variables?: Record<string, unknown> }) => {
      if (query.includes("DailyMoveInventory")) {
        moves.push(opts!.variables!);
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
                          { name: "available", quantity: 0 },
                          { name: "safety_stock", quantity: 2 },
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

describe.skipIf(!process.env.DATABASE_URL)("safety stock prizes", async () => {
  const { default: db } = await import("../app/db.server");
  const { ensurePrize } = await import("../app/lib/daily.server");

  const shop = `safety-${Date.now()}.myshopify.com`;
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
  });

  afterAll(async () => {
    await db.campaign.deleteMany({ where: { shop } });
    await db.$disconnect();
  });

  it("sends a ledger document when reserving from safety stock", async () => {
    const prize = await ensurePrize(campaign, admin as never, {
      productId: "gid://shopify/Product/1",
    });
    expect(prize?.reservedFrom).toBe("safety_stock");
    const change = (
      moves[0].input as {
        changes: {
          from: { name: string; ledgerDocumentUri: string | null };
          to: { name: string; ledgerDocumentUri: string | null };
        }[];
      }
    ).changes[0];
    expect(change.from.name).toBe("safety_stock");
    expect(change.from.ledgerDocumentUri).toMatch(
      /^poke-collect-giveaways:\/\//,
    );
    expect(change.to.name).toBe("reserved");
    expect(change.to.ledgerDocumentUri).toBe(change.from.ledgerDocumentUri);
  });
});
