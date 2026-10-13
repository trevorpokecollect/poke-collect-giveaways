import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The draw code imports the Shopify app config, which needs env this test doesn't use.
vi.mock("../app/shopify.server", () => ({ unauthenticated: {} }));

describe.skipIf(!process.env.DATABASE_URL)(
  "a daily draw only counts that day's entries",
  async () => {
    const { default: db } = await import("../app/db.server");
    const { dayTickets } = await import("../app/lib/daily.server");
    const { campaignAnalytics } = await import("../app/lib/analytics.server");
    const { periodFor } = await import("../app/lib/daily");

    const shop = `window-${Date.now()}.myshopify.com`;
    const tz = "America/New_York";
    const period = periodFor(new Date(), tz, "21:00");
    const before = new Date(period.opensAt.getTime() - 60_000);
    const during = new Date(period.opensAt.getTime() + 60_000);
    let campaign: Awaited<ReturnType<typeof db.campaign.create>>;
    const ids: Record<string, string> = {};

    beforeAll(async () => {
      campaign = await db.campaign.create({
        data: {
          shop,
          slug: "daily",
          title: "Daily",
          status: "ACTIVE",
          timezone: tz,
          settings: { daily: { enabled: true, drawTime: "21:00" } },
          actions: {
            create: [{ type: "SIGNUP", label: "Sign Up", entries: 1 }],
          },
        },
      });
      for (const [name, entries] of [
        ["yesterday", [{ at: before, n: 50 }]],
        ["today", [{ at: during, n: 3 }]],
        [
          "both",
          [
            { at: before, n: 100 },
            { at: during, n: 2 },
          ],
        ],
      ] as const) {
        const e = await db.entrant.create({
          data: {
            campaignId: campaign.id,
            email: `${name}@example.com`,
            emailNormalized: `${name}@example.com`,
            referralCode: `${name}-${Date.now()}`,
            status: "ACTIVE",
            createdAt: entries[0].at,
          },
        });
        ids[name] = e.id;
        for (const x of entries)
          await db.entryEvent.create({
            data: {
              campaignId: campaign.id,
              entrantId: e.id,
              entries: x.n,
              source: "ACTION",
              createdAt: x.at,
            },
          });
      }
    });

    afterAll(async () => {
      await db.campaign.deleteMany({ where: { shop } });
      await db.$disconnect();
    });

    it("leaves out entries earned before the previous draw", async () => {
      const tickets = await dayTickets({ campaignId: campaign.id, ...period });
      expect(
        Object.fromEntries(tickets.map((t) => [t.entrantId, t.entries])),
      ).toEqual({ [ids.today]: 3, [ids.both]: 2 });
    });

    it("limits analytics to the draw's window", async () => {
      const stats = await campaignAnalytics(campaign, {
        start: period.opensAt,
        end: period.drawAt,
      });
      expect(stats.activity).toEqual({ people: 2, entries: 5 });
      expect(stats.totals.entrants).toBe(1); // only "today" signed up in the window
      const all = await campaignAnalytics(campaign);
      expect(all.activity).toEqual({ people: 3, entries: 155 });
    });
  },
);
