import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("../app/shopify.server", () => ({ unauthenticated: {} }));

// "List A Card On Vault Marketplace" pays only when Vault Market reports a real listing (its API faked).
describe.skipIf(!process.env.DATABASE_URL)(
  "verified Vault Market listing task",
  async () => {
    const { default: db } = await import("../app/db.server");
    const { completeAction } =
      await import("../app/lib/entries/actions.server");
    const { issueEntrantToken } = await import("../app/lib/token.server");

    const shop = `market-verify-${Date.now()}.myshopify.com`;
    let token = "";
    let buylistId = "";
    let campaignId = "";
    let submitted = false;
    const asked: URL[] = [];

    beforeAll(async () => {
      process.env.ENTRANT_TOKEN_SECRET = "test-secret";
      const c = await db.campaign.create({
        data: {
          shop,
          slug: "daily",
          title: "Daily",
          status: "ACTIVE",
          timezone: "America/New_York",
          settings: { daily: { enabled: true, drawTime: "21:00" } },
          actions: {
            create: [
              { type: "SIGNUP", label: "Sign Up", entries: 1, mandatory: true },
              {
                type: "SOCIAL_FOLLOW",
                label: "Whatnot",
                entries: 100,
                mandatory: true,
                config: { url: "https://whatnot.com/x" },
              },
              {
                type: "VISIT_URL",
                label: "List A Card On Vault Marketplace",
                entries: 20,
                repeatable: true,
                config: {
                  url: "https://poke-collect.com/apps/packs/market",
                  daily: true,
                  confirm: "I Listed A Card",
                  verifyMarketListing: true,
                },
              },
            ],
          },
        },
        include: { actions: true },
      });
      campaignId = c.id;
      buylistId = c.actions.find(
        (a) => a.label === "List A Card On Vault Marketplace",
      )!.id;
      const e = await db.entrant.create({
        data: {
          campaignId: c.id,
          email: "Ash@Example.com",
          emailNormalized: "ash@example.com",
          referralCode: `ash-${Date.now()}`,
          status: "ACTIVE",
        },
      });
      token = issueEntrantToken(e.id, c.id);
      await completeAction(
        token,
        c.actions.find((a) => a.label === "Whatnot")!.id,
        {},
      );
      process.env.MARKET_VERIFY_URL =
        "https://packs.test/api/giveaway/market-listed";
      process.env.MARKET_VERIFY_SECRET = "shh";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: URL, init: RequestInit) => {
          asked.push(new URL(url));
          const ok =
            (init.headers as Record<string, string>)["x-verify-secret"] ===
            "shh";
          return ok
            ? new Response(JSON.stringify({ listed: submitted }))
            : new Response("{}", { status: 401 });
        }),
      );
    });
    afterEach(() => {
      process.env.MARKET_VERIFY_SECRET = "shh";
    });
    afterAll(async () => {
      vi.unstubAllGlobals();
      delete process.env.MARKET_VERIFY_URL;
      delete process.env.MARKET_VERIFY_SECRET;
      await db.campaign.deleteMany({ where: { id: campaignId } });
    });

    it("refuses the claim until a listing exists", async () => {
      const r = await completeAction(token, buylistId, {
        step: "done",
        started: "verify",
      });
      expect(r.ok).toBe(false);
      expect(asked.at(-1)?.searchParams.get("email")).toBe("Ash@Example.com");
      // Asked from the start of today's draw day.
      expect(
        new Date(asked.at(-1)!.searchParams.get("since")!).getTime(),
      ).toBeLessThan(Date.now());
    });

    it("refuses when the packs app can't be reached or rejects the secret", async () => {
      process.env.MARKET_VERIFY_SECRET = "wrong";
      submitted = true;
      const r = await completeAction(token, buylistId, {});
      expect(r).toMatchObject({ ok: false });
      expect((r as { error: string }).error).toContain("couldn't check");
    });

    it("pays 20 once per day after a real listing (and sends the shop)", async () => {
      submitted = true;
      const first = await completeAction(token, buylistId, {});
      expect(first.ok && first.awarded).toBe(true);
      expect(asked.at(-1)?.searchParams.get("shop")).toBe(shop);
      const again = await completeAction(token, buylistId, {});
      expect(again.ok && again.awarded).toBe(false);
    });
  },
);
