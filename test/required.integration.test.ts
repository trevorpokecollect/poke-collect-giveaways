import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Required steps keep entrants out of the draw until done. Runs when DATABASE_URL is set.
const enabled = !!process.env.DATABASE_URL;

describe.skipIf(!enabled)("required steps to enter", async () => {
  const { default: db } = await import("../app/db.server");
  const { eligibleTickets } = await import("../app/lib/entries/ledger.server");
  const { completeAction } = await import("../app/lib/entries/actions.server");
  const { signup } = await import("../app/lib/entries/signup.server");
  const { issueEntrantToken } = await import("../app/lib/token.server");
  const { award } = await import("../app/lib/entries/ledger.server");

  const shop = `required-${Date.now()}.myshopify.com`;
  let campaignId = "";
  let whatnotId = "";
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    process.env.ENTRANT_TOKEN_SECRET = "test-secret";
    vi.spyOn(console, "info").mockImplementation(() => {});
    const c = await db.campaign.create({
      data: {
        shop,
        slug: "monthly",
        title: "Monthly",
        status: "ACTIVE",
        settings: { requireEmailConsent: true },
        actions: {
          create: [
            { type: "SIGNUP", label: "Enter", entries: 1, mandatory: true },
            {
              type: "SOCIAL_FOLLOW",
              label: "Follow us on Whatnot",
              entries: 2,
              mandatory: true,
              config: { url: "https://whatnot.com/invite/pokecollectcards" },
            },
            { type: "DAILY_CHECKIN", label: "Check in", entries: 1 },
          ],
        },
      },
      include: { actions: true },
    });
    campaignId = c.id;
    whatnotId = c.actions.find((a) => a.type === "SOCIAL_FOLLOW")!.id;
    for (const [name, consent] of [
      ["ash", true],
      ["misty", true],
      ["brock", false],
    ] as const) {
      const e = await db.entrant.create({
        data: {
          campaignId,
          email: `${name}@example.com`,
          emailNormalized: `${name}@example.com`,
          status: "ACTIVE",
          marketingConsent: consent,
          referralCode: `${name}-${Date.now()}`,
        },
      });
      ids[name] = e.id;
      await award({
        campaignId,
        entrantId: e.id,
        entries: 1,
        source: "ACTION",
        dedupeKey: `signup:${e.id}`,
      });
    }
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await db.campaign.deleteMany({ where: { shop } });
    await db.$disconnect();
  });

  it("refuses a sign-up without the email opt-in", async () => {
    const res = await signup({
      shop,
      campaignSlug: "monthly",
      email: "gary@example.com",
      ip: "198.51.100.40",
      elapsedMs: 8000,
    });
    expect(res).toMatchObject({ ok: false, error: "Tick the email box to enter." });
  });

  it("only draws people who did every required step", async () => {
    expect(await eligibleTickets(campaignId)).toEqual([]);
    for (const name of ["ash", "brock"])
      expect(
        await completeAction(issueEntrantToken(ids[name], campaignId), whatnotId, {}),
      ).toMatchObject({ ok: true, awarded: true });
    // Misty skipped Whatnot; Brock never ticked the email box.
    expect(await eligibleTickets(campaignId)).toEqual([
      { entrantId: ids.ash, entries: 3 },
    ]);
  });
});
