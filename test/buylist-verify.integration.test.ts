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

// "Submit A Buylist" pays only when the buylist app reports a real submission (its API faked).
describe.skipIf(!process.env.DATABASE_URL)(
  "verified buylist task",
  async () => {
    const { default: db } = await import("../app/db.server");
    const { completeAction } =
      await import("../app/lib/entries/actions.server");
    const { issueEntrantToken } = await import("../app/lib/token.server");

    const shop = `buylist-verify-${Date.now()}.myshopify.com`;
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
                label: "Submit A Buylist",
                entries: 50,
                repeatable: true,
                config: {
                  url: "https://poke-collect.com/apps/buylist",
                  daily: true,
                  confirm: "I Submitted My Buylist",
                  verifyBuylist: true,
                },
              },
            ],
          },
        },
        include: { actions: true },
      });
      campaignId = c.id;
      buylistId = c.actions.find((a) => a.label === "Submit A Buylist")!.id;
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
      process.env.BUYLIST_VERIFY_URL =
        "https://buylist.test/api/giveaway/buylist-submitted";
      process.env.BUYLIST_VERIFY_SECRET = "shh";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: URL, init: RequestInit) => {
          asked.push(new URL(url));
          const ok =
            (init.headers as Record<string, string>)["x-verify-secret"] ===
            "shh";
          return ok
            ? new Response(JSON.stringify({ submitted }))
            : new Response("{}", { status: 401 });
        }),
      );
    });
    afterEach(() => {
      process.env.BUYLIST_VERIFY_SECRET = "shh";
    });
    afterAll(async () => {
      vi.unstubAllGlobals();
      delete process.env.BUYLIST_VERIFY_URL;
      delete process.env.BUYLIST_VERIFY_SECRET;
      await db.campaign.deleteMany({ where: { id: campaignId } });
    });

    it("refuses the claim until a buylist exists", async () => {
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

    it("refuses when the buylist app can't be reached or rejects the secret", async () => {
      process.env.BUYLIST_VERIFY_SECRET = "wrong";
      submitted = true;
      const r = await completeAction(token, buylistId, {});
      expect(r).toMatchObject({ ok: false });
      expect((r as { error: string }).error).toContain("couldn't check");
    });

    it("pays 50 once per day after a real submission", async () => {
      submitted = true;
      const first = await completeAction(token, buylistId, {});
      expect(first.ok && first.awarded).toBe(true);
      const again = await completeAction(token, buylistId, {});
      expect(again.ok && again.awarded).toBe(false);
    });
  },
);
