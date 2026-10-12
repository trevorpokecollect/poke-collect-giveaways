import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Completing each action type against a real Postgres. Runs when DATABASE_URL is set.
const enabled = !!process.env.DATABASE_URL;

describe.skipIf(!enabled)("storefront actions", async () => {
  const { default: db } = await import("../app/db.server");
  const { completeAction, entrantState, leaderboard, issueVideoStart } =
    await import("../app/lib/entries/actions.server");
  const { issueEntrantToken } = await import("../app/lib/token.server");
  const { orderEntries } =
    await import("../app/lib/entries/order-entries.server");
  const { estimateForShop } =
    await import("../app/lib/entries/estimate.server");
  const { processOrder } = await import("../app/lib/entries/orders.server");

  const shop = `actions-${Date.now()}.myshopify.com`;
  const ids: Record<string, string> = {};
  let token = "";
  let entrantId = "";
  let campaignId = "";

  beforeAll(async () => {
    process.env.ENTRANT_TOKEN_SECRET = "test-secret";
    const c = await db.campaign.create({
      data: {
        shop,
        slug: "starter-pack",
        title: "Starter pack giveaway",
        status: "ACTIVE",
        settings: { showLeaderboard: true },
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
            {
              type: "VISIT_URL",
              label: "Visit the shop",
              entries: 1,
              mandatory: true,
              config: { url: "https://poke-collect.com" },
            },
            {
              type: "POLL",
              label: "Vote",
              entries: 2,
              config: {
                question: "Best starter?",
                options: ["Charmander", "Squirtle"],
              },
            },
            {
              type: "QUESTION",
              label: "Quiz",
              entries: 3,
              config: { question: "Who is #25?", answer: "Pikachu" },
            },
            {
              type: "WATCH_VIDEO",
              label: "Watch",
              entries: 4,
              config: { url: "https://youtu.be/x", seconds: 30 },
            },
            {
              type: "SOCIAL_SHARE",
              label: "Share",
              entries: 5,
              repeatable: true,
              config: { network: "any" },
            },
            {
              type: "VISIT_URL",
              label: "Old",
              entries: 9,
              config: { url: "https://x.com", archived: true },
            },
          ],
        },
      },
      include: { actions: true },
    });
    campaignId = c.id;
    for (const a of c.actions) ids[a.label] = a.id;
    const e = await db.entrant.create({
      data: {
        campaignId: c.id,
        email: "Ash.Ketchum@gmail.com",
        emailNormalized: "ashketchum@gmail.com",
        name: "Ash Ketchum",
        status: "ACTIVE",
        referralCode: `ref-${Date.now()}`,
      },
    });
    entrantId = e.id;
    token = issueEntrantToken(e.id, c.id);
  });

  afterAll(async () => {
    await db.rateLimitHit.deleteMany({
      where: { key: { endsWith: `:${entrantId}` } },
    });
    await db.campaign.deleteMany({ where: { shop } });
    await db.$disconnect();
  });

  it("locks optional actions until mandatory ones are done", async () => {
    const r = await completeAction(token, ids.Vote, { answer: "Squirtle" });
    expect(r).toMatchObject({ ok: false });
    expect(
      await completeAction(token, ids["Visit the shop"], {}),
    ).toMatchObject({
      ok: true,
      awarded: true,
    });
  });

  it("skips archived actions", async () => {
    expect(await completeAction(token, ids.Old, {})).toMatchObject({
      ok: false,
      error: "Unknown action.",
    });
  });

  it("stores poll answers and counts any option", async () => {
    expect(
      await completeAction(token, ids.Vote, { answer: "Sword" }),
    ).toMatchObject({ ok: false });
    expect(
      await completeAction(token, ids.Vote, { answer: "squirtle" }),
    ).toMatchObject({
      ok: true,
      awarded: true,
    });
    const state = await entrantState(token);
    expect(state?.answers[ids.Vote]).toBe("Squirtle");
    expect(state?.pollResults[ids.Vote]).toEqual({ Squirtle: 1 });
  });

  it("checks quiz answers with limited retries", async () => {
    const wrong = await completeAction(token, ids.Quiz, { answer: "Raichu" });
    expect(wrong).toMatchObject({ ok: false, attemptsLeft: 2 });
    expect(
      await completeAction(token, ids.Quiz, { answer: " PIKACHU " }),
    ).toMatchObject({
      ok: true,
      awarded: true,
    });
    expect((await entrantState(token))?.quizAttemptsLeft[ids.Quiz]).toBe(1);
  });

  it("only awards a video after the required time", async () => {
    const start = await completeAction(token, ids.Watch, { step: "start" });
    expect(start).toMatchObject({ ok: true, seconds: 30 });
    const started = (start as { started: string }).started;
    expect(await completeAction(token, ids.Watch, { started })).toMatchObject({
      ok: false,
    });
    expect(
      await completeAction(token, ids.Watch, { started: "1.forged" }),
    ).toMatchObject({
      ok: false,
      error: "Open the video first.",
    });
    const early = issueVideoStart(entrantId, ids.Watch, Date.now() - 31_000);
    expect(
      await completeAction(token, ids.Watch, { started: early }),
    ).toMatchObject({
      ok: true,
      awarded: true,
    });
  });

  it("awards a share once even when repeatable", async () => {
    expect(
      await completeAction(token, ids.Share, { network: "x" }),
    ).toMatchObject({ awarded: true });
    expect(
      await completeAction(token, ids.Share, { network: "copy" }),
    ).toMatchObject({ awarded: false });
    const state = await entrantState(token);
    expect(state?.entries).toBe(1 + 2 + 3 + 4 + 5);
    expect(state?.breakdown.actions).toBe(15);
  });

  it("ranks the leaderboard by entries with short names", async () => {
    const board = await leaderboard(campaignId, token);
    expect(board[0]).toMatchObject({
      rank: 1,
      name: "Ash K.",
      entries: 15,
      you: true,
    });
  });

  it("estimates and then reports entries for an order", async () => {
    const lines = [{ productId: 1, variantId: 11, quantity: 2, price: 1250 }];
    expect(await estimateForShop(shop, null, lines)).toMatchObject({
      entries: 25,
      giveaway: { slug: "starter-pack" },
    });
    const pending = await orderEntries({
      shop,
      orderGid: "gid://shopify/OrderIdentity/9001",
      lines,
    });
    expect(pending).toEqual({
      status: "pending",
      giveaways: [{ title: "Starter pack giveaway", entries: 25 }],
    });
    const old = await orderEntries({
      shop,
      orderGid: "gid://shopify/OrderIdentity/9001",
      lines,
      placedAt: async () => new Date(Date.now() - 3600_000),
    });
    expect(old).toEqual({ status: "none" });

    await processOrder(shop, {
      id: 9001,
      email: "ashketchum@gmail.com",
      created_at: new Date().toISOString(),
      source_name: "web",
      subtotal_price: "25.00",
      line_items: [
        { product_id: 1, variant_id: 11, quantity: 2, price: "12.50" },
      ],
    });
    expect(
      await orderEntries({
        shop,
        orderGid: "gid://shopify/Order/9001",
        lines: [],
      }),
    ).toEqual({
      status: "earned",
      giveaways: [{ title: "Starter pack giveaway", entries: 25 }],
    });
  });
});
