import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Import, backfill and analytics against a real Postgres. Runs when DATABASE_URL is set.
const enabled = !!process.env.DATABASE_URL;

describe.skipIf(!enabled)("admin data tools", async () => {
  const { default: db } = await import("../app/db.server");
  const { parseImport, previewImport, runImport } =
    await import("../app/lib/import.server");
  const { backfillOrders } = await import("../app/lib/backfill.server");
  const { campaignAnalytics } = await import("../app/lib/analytics.server");
  const { entrantTotal } = await import("../app/lib/entries/ledger.server");

  const shop = `tools-${Date.now()}.myshopify.com`;
  let campaignId = "";

  beforeAll(async () => {
    const c = await db.campaign.create({
      data: {
        shop,
        slug: "migrated",
        title: "Migrated giveaway",
        status: "ACTIVE",
        purchaseRules: {
          base: {
            mode: "per_amount",
            entries: 1,
            amount: 1,
            basis: "subtotal",
          },
        },
        actions: { create: [{ type: "SIGNUP", label: "Enter", entries: 1 }] },
      },
    });
    campaignId = c.id;
  });

  afterAll(async () => {
    await db.campaign.deleteMany({ where: { shop } });
    await db.$disconnect();
  });

  const csv = [
    "Email,Name,Total Entries",
    "misty@example.com,Misty,25",
    "Brock@Example.com,Brock,7",
    "Brock@example.com,Brock again,3",
  ].join("\n");

  it("previews, imports once, and ignores a re-import", async () => {
    const parsed = parseImport(csv);
    expect(await previewImport(campaignId, parsed)).toEqual({
      rows: 2,
      newEntrants: 2,
      existingEntrants: 0,
      alreadyImported: 0,
      entriesToAdd: 32,
    });
    expect(await runImport(campaignId, parsed)).toEqual({
      created: 2,
      awarded: 2,
      entries: 32,
    });
    expect(await runImport(campaignId, parseImport(csv))).toEqual({
      created: 0,
      awarded: 0,
      entries: 0,
    });
    expect(await previewImport(campaignId, parsed)).toMatchObject({
      existingEntrants: 2,
      alreadyImported: 2,
      entriesToAdd: 0,
    });
    const misty = await db.entrant.findFirstOrThrow({
      where: { campaignId, emailNormalized: "misty@example.com" },
    });
    expect(misty.status).toBe("ACTIVE");
    expect(await entrantTotal(misty.id)).toBe(25);
  });

  it("backfills orders through processOrder idempotently", async () => {
    const order = {
      id: "gid://shopify/Order/900001",
      name: "#2001",
      email: "misty@example.com",
      createdAt: new Date().toISOString(),
      cancelledAt: null,
      sourceName: "web",
      customer: null,
      currentSubtotalPriceSet: { shopMoney: { amount: "40.00" } },
      currentTotalPriceSet: { shopMoney: { amount: "43.20" } },
      lineItems: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [
          {
            quantity: 1,
            currentQuantity: 1,
            product: { id: "gid://shopify/Product/1" },
            variant: { id: "gid://shopify/ProductVariant/1" },
            originalUnitPriceSet: { shopMoney: { amount: "40.00" } },
          },
        ],
      },
    };
    const queries: Record<string, unknown>[] = [];
    const admin = {
      graphql: async (
        _q: string,
        o?: { variables?: Record<string, unknown> },
      ) => {
        queries.push(o?.variables ?? {});
        return new Response(
          JSON.stringify({
            data: {
              orders: {
                pageInfo: { hasNextPage: false, endCursor: "c1" },
                nodes: [order],
              },
            },
          }),
        );
      },
    };

    for (let i = 0; i < 2; i++) {
      expect(await backfillOrders(admin, shop, {})).toEqual({
        processed: 1,
        cursor: null,
      });
    }
    const misty = await db.entrant.findFirstOrThrow({
      where: { campaignId, emailNormalized: "misty@example.com" },
    });
    expect(await entrantTotal(misty.id)).toBe(25 + 40);
    const log = await db.orderLog.findFirstOrThrow({ where: { campaignId } });
    expect(log).toMatchObject({ shopifyOrderId: "900001", status: "ENTRIES" });
    expect(log.breakdown).toMatchObject({ subtotal: 40, total: 43.2 });
  });

  it("reports analytics", async () => {
    const campaign = await db.campaign.findUniqueOrThrow({
      where: { id: campaignId },
    });
    const a = await campaignAnalytics(campaign);
    expect(a.totals).toMatchObject({ entrants: 2, verified: 2, held: 0 });
    expect(a.revenue).toEqual({ orders: 1, revenue: 40, missing: 0 });
    expect(a.sources).toEqual(
      expect.arrayContaining([
        { label: "import", entries: 32, events: 2 },
        { label: "purchase", entries: 40, events: 1 },
      ]),
    );
    expect(a.days.at(-1)).toMatchObject({ entrants: 2, entries: 72 });
    expect(a.utm).toEqual([{ source: "(direct)", count: 2 }]);
    expect(a.conversion).toMatchObject({ buyers: 1, formEntrants: 0 });
  });
  it("tops up to a newer export's totals without ever lowering them", async () => {
    const newer = [
      "Email,Name,Total Entries",
      "misty@example.com,Misty,40",
      "brock@example.com,Brock,5",
    ].join("\n");
    expect(await previewImport(campaignId, parseImport(newer))).toMatchObject({
      entriesToAdd: 15,
    });
    expect(await runImport(campaignId, parseImport(newer))).toEqual({
      created: 0,
      awarded: 1,
      entries: 15,
    });
    expect(await runImport(campaignId, parseImport(newer))).toMatchObject({
      awarded: 0,
    });
    const misty = await db.entrant.findFirstOrThrow({
      where: { campaignId, emailNormalized: "misty@example.com" },
    });
    const imported = await db.entryEvent.aggregate({
      where: { entrantId: misty.id, source: "IMPORT" },
      _sum: { entries: true },
    });
    expect(imported._sum.entries).toBe(40);
  });
});
