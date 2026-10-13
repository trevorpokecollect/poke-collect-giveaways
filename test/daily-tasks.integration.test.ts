import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// The draw code imports the Shopify app config, which needs env this test doesn't use.
vi.mock("../app/shopify.server", () => ({ unauthenticated: {} }));

// Daily Tasks against a real Postgres: unlock, once per day, races, the Friday window,
// the off switch, the claim-after-opening step, and fresh claims in a new giveaway.
describe.skipIf(!process.env.DATABASE_URL)("daily tasks", async () => {
  const { default: db } = await import("../app/db.server");
  const { completeAction, entrantState } =
    await import("../app/lib/entries/actions.server");
  const { issueEntrantToken } = await import("../app/lib/token.server");
  const { dayTickets } = await import("../app/lib/daily.server");
  const { periodFor } = await import("../app/lib/daily");

  const shop = `daily-tasks-${Date.now()}.myshopify.com`;
  const tz = "America/New_York";
  const ids: Record<string, string> = {};
  const campaigns: string[] = [];

  async function makeGiveaway(slug: string) {
    const c = await db.campaign.create({
      data: {
        shop,
        slug,
        title: "Daily",
        status: "ACTIVE",
        timezone: tz,
        settings: { daily: { enabled: true, drawTime: "21:00" } },
        actions: {
          create: [
            { type: "SIGNUP", label: "Sign Up", entries: 1, mandatory: true },
            {
              type: "SOCIAL_FOLLOW",
              label: "Whatnot",
              entries: 100,
              mandatory: true,
              config: { url: "https://whatnot.com/invite/x" },
            },
            {
              type: "SOCIAL_FOLLOW",
              label: "Discord",
              entries: 50,
              config: { url: "https://discord.gg/x" },
            },
            {
              type: "SOCIAL_FOLLOW",
              label: "Facebook",
              entries: 10,
              config: { url: "https://facebook.com/x" },
            },
            {
              type: "SOCIAL_FOLLOW",
              label: "Instagram",
              entries: 10,
              config: { url: "https://instagram.com/x" },
            },
            { type: "SMS_OPTIN", label: "Texts", entries: 100, config: {} },
            { type: "REFERRAL", label: "Refer", entries: 25 },
            {
              type: "VISIT_URL",
              label: "Bookmark Our Next Show",
              entries: 20,
              repeatable: true,
              config: { url: "https://whatnot.com/invite/x", daily: true },
            },
            {
              type: "VISIT_URL",
              label: "Like & Comment On Instagram",
              entries: 5,
              repeatable: true,
              config: {
                url: "https://instagram.com/p/a",
                urls: ["https://instagram.com/p/b"],
                daily: true,
                confirm: "I Liked & Commented",
              },
            },
            {
              type: "VISIT_URL",
              label: "Live",
              entries: 50,
              repeatable: true,
              config: {
                url: "https://whatnot.com/live/x",
                daily: true,
                live: true,
                schedule: { days: [5], start: "17:00", end: "20:00" },
              },
            },
          ],
        },
      },
      include: { actions: true },
    });
    campaigns.push(c.id);
    const e = await db.entrant.create({
      data: {
        campaignId: c.id,
        email: "ash@example.com",
        emailNormalized: "ash@example.com",
        referralCode: `ash-${slug}-${Date.now()}`,
        status: "ACTIVE",
      },
    });
    const by = (label: string) => c.actions.find((a) => a.label === label)!.id;
    return { c, e, token: issueEntrantToken(e.id, c.id), by };
  }

  let g: Awaited<ReturnType<typeof makeGiveaway>>;

  beforeAll(async () => {
    process.env.ENTRANT_TOKEN_SECRET = "test-secret";
    g = await makeGiveaway("daily");
    ids.bookmark = g.by("Bookmark Our Next Show");
    ids.insta = g.by("Like & Comment On Instagram");
    ids.live = g.by("Live");
  });

  afterEach(() => vi.useRealTimers());

  afterAll(async () => {
    await db.campaign.deleteMany({ where: { id: { in: campaigns } } });
  });

  it("stays locked until all four follow tasks are done (texts not needed)", async () => {
    let r = await completeAction(g.token, ids.bookmark, {});
    expect(r.ok).toBe(false);
    for (const label of ["Whatnot", "Discord", "Facebook"])
      expect((await completeAction(g.token, g.by(label), {})).ok).toBe(true);
    r = await completeAction(g.token, ids.bookmark, {});
    expect(r.ok).toBe(false);
    let state = await entrantState(g.token);
    expect(state?.dailyTasks?.unlocked).toBe(false);
    expect(state?.dailyTasks?.needed).toEqual(["Instagram"]);
    await completeAction(g.token, g.by("Instagram"), {});
    state = await entrantState(g.token);
    expect(state?.dailyTasks?.unlocked).toBe(true);
    expect(state?.dailyTasks?.needCount).toBe(4);
  });

  it("pays once per day, even for simultaneous requests", async () => {
    const results = await Promise.all(
      [1, 2, 3, 4].map(() => completeAction(g.token, ids.bookmark, {})),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => "awarded" in r && r.awarded)).toHaveLength(1);
    const events = await db.entryEvent.count({
      where: { entrantId: g.e.id, actionId: ids.bookmark },
    });
    expect(events).toBe(1);
    const state = await entrantState(g.token);
    expect(state?.dailyTasks?.tasks[ids.bookmark].done).toBe(true);
  });

  it("counts in today's daily draw", async () => {
    const p = periodFor(new Date(), tz, "21:00");
    const tickets = await dayTickets({
      campaignId: g.c.id,
      opensAt: p.opensAt,
      drawAt: p.drawAt,
    });
    // Whatnot 100 + Discord 50 + Facebook 10 + Instagram 10 + Bookmark 20.
    expect(tickets.find((t) => t.entrantId === g.e.id)?.entries).toBe(190);
  });

  it("is claimable again in the next task day", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 26 * 3600_000 });
    const r = await completeAction(g.token, ids.bookmark, {});
    expect(r.ok && r.awarded).toBe(true);
  });

  it("needs the link opened a few seconds before the honor-system claim", async () => {
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-10-20T15:00:00Z"),
    });
    expect((await completeAction(g.token, ids.insta, {})).ok).toBe(false);
    const start = await completeAction(g.token, ids.insta, { step: "start" });
    expect(start.ok && "started" in start).toBe(true);
    const started = (start as { started: string }).started;
    expect(
      (await completeAction(g.token, ids.insta, { step: "done", started })).ok,
    ).toBe(false);
    vi.setSystemTime(new Date("2026-10-20T15:00:06Z"));
    const r = await completeAction(g.token, ids.insta, {
      step: "done",
      started,
    });
    expect(r.ok && r.awarded).toBe(true);
  });

  it("opens the live task only Fridays 5–8pm Central, once per show", async () => {
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-10-16T21:59:00Z"),
    });
    expect((await completeAction(g.token, ids.live, {})).ok).toBe(false);
    let state = await entrantState(g.token);
    expect(state?.dailyTasks?.tasks[ids.live].open).toBe(false);
    expect(state?.dailyTasks?.tasks[ids.live].nextAt).toEqual(
      new Date("2026-10-16T22:00:00Z"),
    );

    vi.setSystemTime(new Date("2026-10-16T22:00:00Z"));
    const first = await completeAction(g.token, ids.live, {});
    expect(first.ok && first.awarded).toBe(true);
    vi.setSystemTime(new Date("2026-10-17T00:30:00Z"));
    const again = await completeAction(g.token, ids.live, {});
    expect(again.ok && again.awarded).toBe(false);
    state = await entrantState(g.token);
    expect(state?.dailyTasks?.tasks[ids.live]).toMatchObject({
      open: true,
      done: true,
    });

    vi.setSystemTime(new Date("2026-10-17T01:00:00Z"));
    expect((await completeAction(g.token, ids.live, {})).ok).toBe(false);
  });

  it("can be switched off for a canceled show", async () => {
    const live = await db.entryAction.findUniqueOrThrow({
      where: { id: ids.live },
    });
    await db.entryAction.update({
      where: { id: ids.live },
      data: { config: { ...(live.config as object), paused: true } },
    });
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-10-23T23:00:00Z"),
    });
    expect((await completeAction(g.token, ids.live, {})).ok).toBe(false);
    const state = await entrantState(g.token);
    expect(state?.dailyTasks?.tasks[ids.live].open).toBe(false);
  });

  it("starts fresh in a new giveaway and leaves the old entries alone", async () => {
    const before = await db.entryEvent.count({ where: { campaignId: g.c.id } });
    const n = await makeGiveaway("next-month");
    expect(
      (await completeAction(n.token, n.by("Bookmark Our Next Show"), {})).ok,
    ).toBe(false);
    for (const label of ["Whatnot", "Discord", "Facebook", "Instagram"])
      await completeAction(n.token, n.by(label), {});
    const r = await completeAction(n.token, n.by("Bookmark Our Next Show"), {});
    expect(r.ok && r.awarded).toBe(true);
    expect(await db.entryEvent.count({ where: { campaignId: g.c.id } })).toBe(
      before,
    );
  });
});
