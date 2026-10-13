import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Claims import the prize-order code, which needs the Shopify app config this test doesn't use.
vi.mock("../app/shopify.server", () => ({ unauthenticated: {} }));

// Post-draw flow (winner email, claim, forfeit + redraw, public winners,
// consolation eligibility, Klaviyo and outbound webhooks) against a real Postgres.
const enabled = !!process.env.DATABASE_URL;

describe.skipIf(!enabled)("after the draw", async () => {
  const { default: db } = await import("../app/db.server");
  const { runDraw } = await import("../app/lib/draw.server");
  const w = await import("../app/lib/winners.server");
  const { pendingConsolation } = await import("../app/lib/discounts.server");
  const { syncEntrantToKlaviyo } = await import("../app/lib/klaviyo.server");

  const shop = `test-win-${Date.now()}.myshopify.com`;
  let campaignId = "";
  const mails: string[] = [];
  const fetchMock = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      void init;
      return new Response(
        String(url).includes("profile-import")
          ? JSON.stringify({ data: { id: "kprof1" } })
          : "{}",
        { status: 200 },
      );
    },
  );

  beforeAll(async () => {
    process.env.ENTRANT_TOKEN_SECRET = "test-secret";
    process.env.OUTBOUND_WEBHOOK_SECRET = "hook-secret";
    process.env.KLAVIYO_PRIVATE_KEY = "pk_test";
    vi.spyOn(console, "info").mockImplementation((m: string) => {
      mails.push(m);
    });
    vi.stubGlobal("fetch", fetchMock);
    const c = await db.campaign.create({
      data: {
        shop,
        slug: "charizard",
        title: "Charizard Giveaway",
        prize: "Charizard ex",
        status: "ACTIVE",
        settings: {
          webhookUrl: "https://hooks.example.com/giveaway",
          klaviyo: { enabled: true, listId: "LIST1", onlyConsented: true },
          consolation: { enabled: true, minEntries: 2 },
        },
      },
    });
    campaignId = c.id;
    for (const [i, name] of [
      "Ash Ketchum",
      "Misty",
      "Brock Harrison",
    ].entries()) {
      const e = await db.entrant.create({
        data: {
          campaignId,
          email: `p${i}@poke-collect.com`,
          emailNormalized: `p${i}@poke-collect.com`,
          name,
          status: "ACTIVE",
          referralCode: `ref-${Date.now()}-${i}`,
          marketingConsent: i === 0,
        },
      });
      await db.entryEvent.create({
        data: { campaignId, entrantId: e.id, source: "ACTION", entries: i + 1 },
      });
    }
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await db.campaign.deleteMany({ where: { shop } });
    await db.$disconnect();
  });

  it("emails a winner, who then claims the prize", async () => {
    const draw = await runDraw(campaignId, 1);
    const winner = draw.winners[0];
    await w.emailWinner(winner.id, "https://poke-collect.com");
    const mail = mails.find((m) => m.includes("You won Charizard ex!"))!;
    expect(mail).toBeTruthy();
    const token = /claim\/(\S+)/.exec(mail)![1];
    expect(
      (await db.winner.findUniqueOrThrow({ where: { id: winner.id } }))
        .notifiedAt,
    ).not.toBeNull();

    expect((await w.loadClaim("other.myshopify.com", token)).kind).toBe(
      "invalid",
    );
    expect((await w.loadClaim(shop, token)).kind).toBe("form");
    const bad = await w.submitClaim(shop, token, { name: "Ash" });
    expect(bad.error).toBeTruthy();
    const ok = await w.submitClaim(shop, token, {
      name: "Ash Ketchum",
      address1: "1 Route 1",
      city: "Pallet",
      zip: "12345",
      country: "US",
      phone: "555-123-4567",
    });
    expect(ok.view.kind).toBe("claimed");
    // A claimed winner can't be forfeited.
    await expect(w.forfeitAndRedraw(campaignId, winner.id)).rejects.toThrow();
  });

  it("forfeits and redraws one replacement, never a previous winner", async () => {
    const draw = await runDraw(campaignId, 1);
    const loser = draw.winners[0];
    const redraw = await w.forfeitAndRedraw(campaignId, loser.id);
    expect(redraw.winners).toHaveLength(1);
    const all = await db.winner.findMany({ where: { draw: { campaignId } } });
    expect(new Set(all.map((x) => x.entrantId)).size).toBe(3);
    expect(new Set(all.map((x) => x.position)).size).toBe(3);
    // Double click: already forfeited, no second redraw.
    await expect(w.forfeitAndRedraw(campaignId, loser.id)).rejects.toThrow();
    expect(await db.draw.count({ where: { campaignId } })).toBe(3);
  });

  it("lists public winners only once the giveaway has ended", async () => {
    expect(await w.publicWinners(shop, "charizard")).toBeNull();
    await db.campaign.update({
      where: { id: campaignId },
      data: { status: "ENDED" },
    });
    const list = await w.publicWinners(shop, "charizard");
    expect(list).toHaveLength(2);
    expect(list!.every((x) => /^\w+( \w\.)?$/.test(x.name))).toBe(true);
  });

  it("offers thank-you codes only to non-winners with enough entries", async () => {
    // Everyone has won or forfeited; the forfeited entrant is still owed one if they have 2+ entries.
    const pending = await pendingConsolation(campaignId, 2);
    const forfeited = await db.winner.findFirstOrThrow({
      where: { draw: { campaignId }, forfeited: true },
      include: { entrant: true },
    });
    const total = await db.entryEvent.aggregate({
      where: { entrantId: forfeited.entrantId },
      _sum: { entries: true },
    });
    expect(pending.map((p) => p.id)).toEqual(
      (total._sum.entries ?? 0) >= 2 ? [forfeited.entrantId] : [],
    );
  });

  it("syncs consenting entrants to Klaviyo and skips the rest", async () => {
    const [consented, other] = await db.entrant.findMany({
      where: { campaignId },
      orderBy: { email: "asc" },
    });
    fetchMock.mockClear();
    expect(await syncEntrantToKlaviyo(other.id)).toBe(false);
    expect(await syncEntrantToKlaviyo(consented.id)).toBe(true);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual([
      "https://a.klaviyo.com/api/profile-import",
      "https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs",
      "https://a.klaviyo.com/api/events",
    ]);
    const headers = fetchMock.mock.calls[0][1]!.headers as Record<
      string,
      string
    >;
    expect(headers.Authorization).toBe("Klaviyo-API-Key pk_test");
    expect(
      (await db.entrant.findUniqueOrThrow({ where: { id: consented.id } }))
        .klaviyoSyncedAt,
    ).not.toBeNull();
  });

  it("posts signed draw.completed webhooks", async () => {
    await db.campaign.update({
      where: { id: campaignId },
      data: { status: "ACTIVE" },
    });
    const extra = await db.entrant.create({
      data: {
        campaignId,
        email: "gary@poke-collect.com",
        emailNormalized: "gary@poke-collect.com",
        status: "ACTIVE",
        referralCode: `ref-gary-${Date.now()}`,
      },
    });
    await db.entryEvent.create({
      data: { campaignId, entrantId: extra.id, source: "ACTION", entries: 1 },
    });
    fetchMock.mockClear();
    await runDraw(campaignId, 1);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://hooks.example.com/giveaway");
    const body = JSON.parse(String(init!.body));
    expect(body.event).toBe("draw.completed");
    // Gary, or the entrant who forfeited (normal draws only skip standing winners).
    expect(body.data.draw.winners).toHaveLength(1);
    expect(body.data.drawId).toBeTruthy();
    expect(
      (init!.headers as Record<string, string>)["X-Giveaway-Signature"],
    ).toMatch(/^sha256=[0-9a-f]{64}$/);
  });
});
