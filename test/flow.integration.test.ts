import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// End-to-end flow against a real Postgres. Runs when DATABASE_URL is set (CI provides one).
const enabled = !!process.env.DATABASE_URL;

describe.skipIf(!enabled)("giveaway flow", async () => {
  const { default: db } = await import("../app/db.server");
  const { signup } = await import("../app/lib/entries/signup.server");
  const { verifyEntrant, completeAction } =
    await import("../app/lib/entries/actions.server");
  const { processOrder } = await import("../app/lib/entries/orders.server");
  const { entrantTotal } = await import("../app/lib/entries/ledger.server");
  const { runDraw } = await import("../app/lib/draw.server");

  const shop = `test-${Date.now()}.myshopify.com`;
  let campaignId = "";
  let dailyId = "";
  const codes: string[] = [];
  const base = {
    shop,
    campaignSlug: "booster-box",
    elapsedMs: 8000,
    userAgent: "vitest",
    name: "Ash Ketchum",
  };

  beforeAll(async () => {
    process.env.ENTRANT_TOKEN_SECRET = "test-secret";
    vi.spyOn(console, "info").mockImplementation((msg: string) => {
      const m = /verification code is (\d{6})/.exec(msg);
      if (m) codes.push(m[1]);
    });
    const c = await db.campaign.create({
      data: {
        shop,
        slug: "booster-box",
        title: "Win a booster box",
        status: "ACTIVE",
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
            { type: "SIGNUP", label: "Enter", entries: 1 },
            { type: "REFERRAL", label: "Refer", entries: 5 },
            { type: "DAILY_CHECKIN", label: "Daily", entries: 1 },
          ],
        },
      },
      include: { actions: true },
    });
    campaignId = c.id;
    dailyId = c.actions.find((a) => a.type === "DAILY_CHECKIN")!.id;
  });

  afterAll(async () => {
    await db.campaign.deleteMany({ where: { shop } });
    await db.$disconnect();
  });

  it("verifies a real entrant by email code and awards signup entries", async () => {
    const r = await signup({
      ...base,
      email: "ash.ketchum@gmail.com",
      ip: "198.51.100.1",
      deviceId: "dev-ash",
    });
    expect(r).toMatchObject({ ok: true, state: "verify" });
    const v = await verifyEntrant(
      shop,
      "booster-box",
      "ash.ketchum@gmail.com",
      codes.at(-1)!,
    );
    expect(v).toMatchObject({ ok: true, state: "active", entries: 1 });

    const daily = await completeAction(v.ok ? v.token : "", dailyId, {});
    expect(daily).toMatchObject({ ok: true, awarded: true, entries: 2 });
    const again = await completeAction(v.ok ? v.token : "", dailyId, {});
    expect(again).toMatchObject({ ok: true, awarded: false, entries: 2 });
  });

  it("treats a gmail alias as the same person", async () => {
    const r = await signup({
      ...base,
      email: "ashketchum+2@gmail.com",
      ip: "198.51.100.9",
      deviceId: "dev-x",
    });
    expect(r).toMatchObject({ ok: true, state: "verify", token: "" });
    expect(await db.entrant.count({ where: { campaignId } })).toBe(1);
  });

  it("credits referrals and blocks bots", async () => {
    const ash = await db.entrant.findFirstOrThrow({
      where: { campaignId, emailNormalized: "ashketchum@gmail.com" },
    });
    await signup({
      ...base,
      email: "misty@poke-collect.com",
      ip: "203.0.113.5",
      deviceId: "dev-misty",
      referralCode: ash.referralCode,
    });
    await verifyEntrant(
      shop,
      "booster-box",
      "misty@poke-collect.com",
      codes.at(-1)!,
    );
    expect(await entrantTotal(ash.id)).toBe(7);

    const bot = await signup({
      ...base,
      email: "x@mailinator.com",
      ip: "192.0.2.1",
      honeypot: "http://spam",
      elapsedMs: 200,
    });
    expect(bot).toMatchObject({ ok: false, status: 403 });

    const selfRef = await signup({
      ...base,
      email: "ash.alt@poke-collect.com",
      ip: "198.51.100.1",
      deviceId: "dev-ash",
      referralCode: ash.referralCode,
    });
    expect(selfRef).toMatchObject({ ok: true, state: "held" });
  });

  it("awards purchase entries, then rolls them back on edit and cancel", async () => {
    const payload = {
      id: 1001,
      name: "#1001",
      email: "Ash.Ketchum@gmail.com",
      created_at: new Date().toISOString(),
      source_name: "web",
      subtotal_price: "120.00",
      total_price: "129.60",
      line_items: [
        { product_id: 1, variant_id: 11, quantity: 1, price: "120.00" },
      ],
    };
    const ash = await db.entrant.findFirstOrThrow({
      where: { campaignId, emailNormalized: "ashketchum@gmail.com" },
    });
    await processOrder(shop, payload);
    await processOrder(shop, payload); // duplicate webhook delivery
    expect(await entrantTotal(ash.id)).toBe(7 + 120);

    await processOrder(shop, { ...payload, subtotal_price: "60.00" });
    expect(await entrantTotal(ash.id)).toBe(7 + 60);

    await processOrder(shop, payload, { cancelled: true });
    expect(await entrantTotal(ash.id)).toBe(7);

    // A buyer who never signed up is created automatically.
    await processOrder(shop, {
      ...payload,
      id: 1002,
      email: "brock@poke-collect.com",
    });
    const brock = await db.entrant.findFirstOrThrow({
      where: { campaignId, emailNormalized: "brock@poke-collect.com" },
    });
    expect(brock.status).toBe("ACTIVE");
  });

  it("gives no entries and signs nobody up for orders shipping outside the US", async () => {
    await processOrder(shop, {
      id: 1003,
      name: "#1003",
      email: "misty@example.ca",
      created_at: new Date().toISOString(),
      source_name: "web",
      subtotal_price: "120.00",
      total_price: "129.60",
      shipping_address: { country_code: "CA" },
      line_items: [
        { product_id: 1, variant_id: 11, quantity: 1, price: "120.00" },
      ],
    });
    expect(
      await db.entrant.findFirst({
        where: { campaignId, emailNormalized: "misty@example.ca" },
      }),
    ).toBeNull();
    const log = await db.orderLog.findFirstOrThrow({
      where: { campaignId, shopifyOrderId: "1003" },
    });
    expect(log.status).not.toBe("ENTRIES");
  });

  it("draws only from active entrants and never repeats a winner", async () => {
    const first = await runDraw(campaignId, 2);
    const second = await runDraw(campaignId, 5);
    const ids = [...first.winners, ...second.winners].map((w) => w.entrantId);
    expect(new Set(ids).size).toBe(ids.length);
    const statuses = await db.entrant.findMany({
      where: { id: { in: ids } },
      select: { status: true },
    });
    expect(statuses.every((s) => s.status === "ACTIVE")).toBe(true);
  });
});
