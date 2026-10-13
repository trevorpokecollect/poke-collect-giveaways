import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The draw code imports the Shopify app config, which needs env this test doesn't use.
vi.mock("../app/shopify.server", () => ({ unauthenticated: {} }));

describe.skipIf(!process.env.DATABASE_URL)(
  "returning players can enter each day's draw",
  async () => {
    const { default: db } = await import("../app/db.server");
    const { dayTickets } = await import("../app/lib/daily.server");
    const { enteredToday } = await import("../app/lib/entries/ledger.server");
    const { enterToday } = await import("../app/lib/entries/signup.server");
    const { periodFor } = await import("../app/lib/daily");

    const shop = `reenter-${Date.now()}.myshopify.com`;
    const tz = "America/New_York";
    const period = periodFor(new Date(), tz, "21:00");
    const yesterday = new Date(period.opensAt.getTime() - 3600_000);
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
      const signupId = (
        await db.entryAction.findFirstOrThrow({
          where: { campaignId: campaign.id, type: "SIGNUP" },
        })
      ).id;
      for (const [name, at] of [
        ["returning", yesterday],
        ["new", new Date()],
      ] as const) {
        const e = await db.entrant.create({
          data: {
            campaignId: campaign.id,
            email: `${name}@example.com`,
            emailNormalized: `${name}@example.com`,
            referralCode: `${name}-${Date.now()}`,
            status: "ACTIVE",
            createdAt: at,
          },
        });
        ids[name] = e.id;
        await db.entryEvent.create({
          data: {
            campaignId: campaign.id,
            entrantId: e.id,
            entries: 1,
            source: "ACTION",
            actionId: signupId,
            dedupeKey: `signup:${e.id}`,
            createdAt: at,
          },
        });
      }
    });

    afterAll(async () => {
      await db.campaign.deleteMany({ where: { shop } });
      await db.$disconnect();
    });

    it("isn't in today's draw from yesterday's sign-up", async () => {
      const tickets = await dayTickets({ campaignId: campaign.id, ...period });
      expect(tickets.map((t) => t.entrantId)).toEqual([ids.new]);
    });

    it("enters today once, then says already entered", async () => {
      expect(await enterToday(ids.returning)).toBe(true);
      expect(await enterToday(ids.returning)).toBe(false);
      const tickets = await dayTickets({ campaignId: campaign.id, ...period });
      expect(
        Object.fromEntries(tickets.map((t) => [t.entrantId, t.entries])),
      ).toEqual({ [ids.returning]: 1, [ids.new]: 1 });
    });

    it("doesn't double up for someone who signed up today", async () => {
      expect(await enterToday(ids.new)).toBe(false);
    });

    it("can enter again the next day", async () => {
      const tomorrow = new Date(period.drawAt.getTime() + 3600_000);
      expect(await enterToday(ids.returning, tomorrow)).toBe(true);
    });

    it("tells the widget whether the entrant is in today's draw", async () => {
      const other = await db.entrant.create({
        data: {
          campaignId: campaign.id,
          email: "old@example.com",
          emailNormalized: "old@example.com",
          referralCode: `old-${Date.now()}`,
          status: "ACTIVE",
          createdAt: yesterday,
        },
      });
      expect(await enteredToday(other.id, period.opensAt)).toBe(false);
      expect(await enteredToday(ids.returning, period.opensAt)).toBe(true);
    });
  },
);
