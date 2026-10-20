import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Bundle prizes from the queue: every product reserved together (with its quantity), skipped
// when one is short, and released or sent line by line.
vi.mock("../app/shopify.server", () => ({ unauthenticated: {} }));

const stock: Record<string, number> = { "1": 3, "2": 1 };
const moves: { key: string; qty: number; from: string; to: string }[] = [];
const removed: { key: string; delta: number }[] = [];

const variant = (n: string) => ({
  id: `gid://shopify/ProductVariant/${n}`,
  title: "Default Title",
  displayName: `Item ${n}`,
  price: n === "1" ? "5.00" : "50.00",
  image: { url: `https://img/${n}.png` },
  product: {
    id: `gid://shopify/Product/${n}`,
    title: `Item ${n}`,
    handle: `item-${n}`,
    status: "ACTIVE",
    productType: "Sealed",
    tags: [],
    featuredMedia: null,
  },
  inventoryItem: {
    id: `gid://shopify/InventoryItem/${n}`,
    tracked: true,
    inventoryLevels: {
      nodes: [
        {
          location: { id: "gid://shopify/Location/1" },
          quantities: [
            { name: "available", quantity: stock[n] },
            { name: "safety_stock", quantity: 0 },
          ],
        },
      ],
    },
  },
});

const admin = {
  graphql: vi.fn(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (query: string, opts?: { variables?: Record<string, any> }) => {
      const v = opts?.variables ?? {};
      if (query.includes("DailyMoveInventory")) {
        const c = v.input.changes[0];
        moves.push({
          key: v.key,
          qty: c.quantity,
          from: c.from.name,
          to: c.to.name,
        });
        return Response.json({
          data: {
            inventoryMoveQuantities: {
              inventoryAdjustmentGroup: { id: "g" },
              userErrors: [],
            },
          },
        });
      }
      if (query.includes("DailyPrizeSent")) {
        removed.push({ key: v.key, delta: v.input.changes[0].delta });
        return Response.json({
          data: {
            inventoryAdjustQuantities: {
              inventoryAdjustmentGroup: { id: "g" },
              userErrors: [],
            },
          },
        });
      }
      const id = /product_id:(\d+)/.exec(String(v.query))?.[1];
      return Response.json({
        data: {
          productVariants: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: id && stock[id] !== undefined ? [variant(id)] : [],
          },
        },
      });
    },
  ),
};

describe.skipIf(!process.env.DATABASE_URL)("daily prize bundles", async () => {
  const { default: db } = await import("../app/db.server");
  const { ensurePrize, releasePrize, markPrizeSent } =
    await import("../app/lib/daily.server");
  const { addBundleToQueue } = await import("../app/lib/daily-queue.server");

  const shop = `bundles-${Date.now()}.myshopify.com`;
  let campaign: Awaited<ReturnType<typeof db.campaign.create>>;

  beforeAll(async () => {
    campaign = await db.campaign.create({
      data: {
        shop,
        slug: "daily",
        title: "Daily",
        status: "ACTIVE",
        timezone: "America/New_York",
        settings: { daily: { enabled: true, drawTime: "21:00", sources: [] } },
      },
    });
  });
  afterAll(async () => {
    await db.campaign.deleteMany({ where: { id: campaign.id } });
  });

  it("skips a bundle that's short, then reserves a 3x bundle in one move", async () => {
    // Needs 2 of item 2, which has 1: skipped.
    await addBundleToQueue(campaign.id, [
      {
        productId: "gid://shopify/Product/1",
        title: "Item 1",
        imageUrl: null,
        quantity: 1,
      },
      {
        productId: "gid://shopify/Product/2",
        title: "Item 2",
        imageUrl: null,
        quantity: 2,
      },
    ]);
    await addBundleToQueue(campaign.id, [
      {
        productId: "gid://shopify/Product/1",
        title: "Item 1",
        imageUrl: null,
        quantity: 3,
      },
    ]);
    const prize = await ensurePrize(campaign, admin as never);
    expect(prize?.title).toBe("3x Item 1");
    expect(prize?.value).toBe(15);
    expect(moves).toEqual([
      {
        key: `daily-reserve-${prize!.id}-0`,
        qty: 3,
        from: "available",
        to: "reserved",
      },
    ]);
    const skipped = await db.dailyQueueItem.findFirst({
      where: { campaignId: campaign.id, usedAt: null },
    });
    expect(skipped?.note).toMatch(/Not enough stock of 2x Item 2/);

    await releasePrize(prize!.id, admin as never, "test");
    expect(moves.at(-1)).toEqual({
      key: `daily-release-${prize!.id}-0`,
      qty: 3,
      from: "reserved",
      to: "available",
    });
  });

  it("reserves and sends every product of a mixed bundle", async () => {
    await db.dailyQueueItem.deleteMany({ where: { campaignId: campaign.id } });
    await db.dailyPrize.deleteMany({ where: { campaignId: campaign.id } });
    moves.length = 0;
    await addBundleToQueue(campaign.id, [
      {
        productId: "gid://shopify/Product/2",
        title: "Item 2",
        imageUrl: null,
        quantity: 1,
      },
      {
        productId: "gid://shopify/Product/1",
        title: "Item 1",
        imageUrl: null,
        quantity: 2,
      },
    ]);
    const prize = await ensurePrize(campaign, admin as never);
    expect(prize?.title).toBe("Item 2 + 2x Item 1");
    expect(moves.map((m) => [m.key.endsWith("-0") ? 0 : 1, m.qty])).toEqual([
      [0, 1],
      [1, 2],
    ]);
    await db.dailyPrize.update({
      where: { id: prize!.id },
      data: { status: "DRAWN" },
    });
    await markPrizeSent(prize!.id, admin as never);
    expect(removed.map((r) => r.delta)).toEqual([-1, -2]);
  });
});
