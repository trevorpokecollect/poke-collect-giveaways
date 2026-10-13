import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../app/shopify.server", () => ({ unauthenticated: {} }));

describe.skipIf(!process.env.DATABASE_URL)(
  "follow button clicks are counted per day, giveaway and platform",
  async () => {
    const { default: db } = await import("../app/db.server");
    const { recordFollowClick, followClickStats } =
      await import("../app/lib/follow-clicks.server");

    const shop = `clicks-${Date.now()}.myshopify.com`;
    const ids: Record<string, string> = {};

    beforeAll(async () => {
      const c = await db.campaign.create({
        data: {
          shop,
          slug: "daily",
          title: "Daily",
          status: "ACTIVE",
          actions: {
            create: [
              {
                type: "SOCIAL_FOLLOW",
                label: "Follow On Whatnot",
                config: { url: "https://www.whatnot.com/user/pokecollect" },
              },
              {
                type: "SOCIAL_FOLLOW",
                label: "Join Discord",
                config: { url: "https://discord.gg/abc" },
              },
              { type: "SIGNUP", label: "Sign Up" },
            ],
          },
        },
        include: { actions: true },
      });
      for (const a of c.actions) ids[a.label] = a.id;
    });

    afterAll(async () => {
      await db.followClickDay.deleteMany({ where: { shop } });
      await db.campaign.deleteMany({ where: { shop } });
      await db.rateLimitHit.deleteMany({
        where: { key: { startsWith: "follow:" } },
      });
    });

    const click = (actionId: string, ip = "203.0.113.7", slug = "latest") =>
      recordFollowClick({ shop, slug, actionId, ip });

    it("upserts one row per date, giveaway and platform", async () => {
      expect(await click(ids["Follow On Whatnot"])).toEqual({
        counted: true,
        platform: "whatnot",
      });
      await click(ids["Follow On Whatnot"], "203.0.113.8", "daily");
      await click(ids["Join Discord"]);
      const rows = await followClickStats({ days: 1, shop });
      expect(
        rows.map(({ giveaway, platform, clicks }) => ({
          giveaway,
          platform,
          clicks,
        })),
      ).toEqual([
        { giveaway: "daily", platform: "discord", clicks: 1 },
        { giveaway: "daily", platform: "whatnot", clicks: 2 },
      ]);
    });

    it("ignores buttons that aren't follow buttons or other giveaways", async () => {
      expect(await click(ids["Sign Up"])).toMatchObject({ counted: false });
      expect(await click("nope")).toMatchObject({ counted: false });
      expect(
        await click(ids["Follow On Whatnot"], "1.1.1.1", "missing"),
      ).toEqual({ counted: false, reason: "no_campaign" });
    });

    it("rate-limits one network", async () => {
      const results = [];
      for (let i = 0; i < 12; i++)
        results.push(await click(ids["Follow On Whatnot"], "198.51.100.1"));
      expect(results.filter((r) => r.counted)).toHaveLength(10);
      // No IP is stored anywhere in the counter rows.
      const rows = await db.followClickDay.findMany({ where: { shop } });
      expect(JSON.stringify(rows)).not.toContain("198.51.100.1");
    });
  },
);
