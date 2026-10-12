import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Linked giveaways (one sign-up enters both) against a real Postgres. Runs when DATABASE_URL is set.
const enabled = !!process.env.DATABASE_URL;

describe.skipIf(!enabled)("linked giveaways", async () => {
  const { default: db } = await import("../app/db.server");
  const { completeAction, verifyEntrant } =
    await import("../app/lib/entries/actions.server");
  const { signup, activate } = await import("../app/lib/entries/signup.server");
  const { entrantFromLinked } = await import("../app/lib/entries/linked.server");
  const { entrantTotal } = await import("../app/lib/entries/ledger.server");

  const shop = `linked-${Date.now()}.myshopify.com`;
  const ids: Record<string, Record<string, string>> = { monthly: {}, daily: {} };
  let monthlyId = "";
  let dailyId = "";
  const codes: string[] = [];

  const find = (campaignId: string, emailNormalized: string) =>
    db.entrant.findUnique({
      where: { campaignId_emailNormalized: { campaignId, emailNormalized } },
    });

  beforeAll(async () => {
    process.env.ENTRANT_TOKEN_SECRET = "test-secret";
    delete process.env.KLAVIYO_PRIVATE_KEY;
    vi.spyOn(console, "info").mockImplementation((m: string) => {
      const match = /verification code is (\d{6})/.exec(m);
      if (match) codes.push(match[1]);
    });
    const actions = (signupEntries: number) => [
      { type: "SIGNUP" as const, label: "Enter", entries: signupEntries },
      { type: "SMS_OPTIN" as const, label: "Texts", entries: 5 },
      { type: "DAILY_CHECKIN" as const, label: "Check in", entries: 1 },
      {
        type: "SOCIAL_FOLLOW" as const,
        label: "Join Discord",
        entries: 3,
        config: { url: "https://discord.gg/Tk4zVvyHan" },
      },
      {
        type: "SOCIAL_FOLLOW" as const,
        label: "Instagram",
        entries: 2,
        config: { url: "https://instagram.com/pokecollect" },
      },
    ];
    const monthly = await db.campaign.create({
      data: {
        shop,
        slug: "monthly",
        title: "Monthly giveaway",
        status: "ACTIVE",
        actions: { create: actions(2) },
      },
      include: { actions: true },
    });
    const daily = await db.campaign.create({
      data: {
        shop,
        slug: "daily",
        title: "Daily giveaway",
        status: "ACTIVE",
        settings: { linkedSlug: "Monthly" },
        actions: { create: actions(1).filter((a) => a.label !== "Instagram") },
      },
      include: { actions: true },
    });
    monthlyId = monthly.id;
    dailyId = daily.id;
    for (const [key, c] of [
      ["monthly", monthly],
      ["daily", daily],
    ] as const)
      for (const a of c.actions) ids[key][a.label] = a.id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await db.campaign.deleteMany({ where: { shop } });
    await db.$disconnect();
  });

  it("enters a verified sign-up in both, with the texts counted in each", async () => {
    const res = await signup({
      shop,
      campaignSlug: "monthly",
      email: "misty@example.com",
      ip: "198.51.100.20",
      elapsedMs: 8000,
      userAgent: "vitest",
      name: "Ash Ketchum",
      phone: "(555) 222-3333",
      smsConsent: true,
      marketingConsent: true,
    });
    expect(res).toMatchObject({ ok: true, state: "verify" });
    const v = await verifyEntrant(shop, "monthly", "misty@example.com", codes.at(-1)!);
    expect(v).toMatchObject({ ok: true, state: "active", entries: 2 + 5 });

    const partner = await find(dailyId, "misty@example.com");
    expect(partner).toMatchObject({
      status: "ACTIVE",
      phone: "+15552223333",
      marketingConsent: true,
    });
    expect(await entrantTotal(partner!.id)).toBe(1 + 5);
  });

  it("counts a shared follow and a check-in in both, but not an unshared action", async () => {
    const m = (await find(monthlyId, "misty@example.com"))!;
    const d = (await find(dailyId, "misty@example.com"))!;
    const { issueEntrantToken } = await import("../app/lib/token.server");
    const token = issueEntrantToken(d.id, dailyId);

    expect(
      await completeAction(token, ids.daily["Join Discord"], {}),
    ).toMatchObject({ ok: true, awarded: true });
    expect(await completeAction(token, ids.daily["Check in"], {})).toMatchObject({
      ok: true,
      awarded: true,
    });
    expect(await entrantTotal(m.id)).toBe(2 + 5 + 3 + 1);

    // Doing it again on the monthly side earns nothing more.
    const mToken = issueEntrantToken(m.id, monthlyId);
    expect(
      await completeAction(mToken, ids.monthly["Join Discord"], {}),
    ).toMatchObject({ ok: true, awarded: false });
    expect(
      await completeAction(mToken, ids.monthly["Check in"], {}),
    ).toMatchObject({ ok: true, awarded: false });

    await completeAction(mToken, ids.monthly["Instagram"], {});
    expect(await entrantTotal(d.id)).toBe(1 + 5 + 3 + 1);
  });

  it("recognizes someone from the linked giveaway's token, catching up on shared actions", async () => {
    // Entered in the daily one before the link existed.
    const d = await db.entrant.create({
      data: {
        campaignId: dailyId,
        email: "brock@example.com",
        emailNormalized: "brock@example.com",
        status: "ACTIVE",
        verifiedAt: new Date(),
        referralCode: `brock-${Date.now()}`,
      },
    });
    await activate(d.id, { mirror: false });
    const { issueEntrantToken } = await import("../app/lib/token.server");
    await completeAction(
      issueEntrantToken(d.id, dailyId),
      ids.daily["Join Discord"],
      {},
    );
    expect(await find(monthlyId, "brock@example.com")).toBeNull();

    const monthly = await db.campaign.findUniqueOrThrow({ where: { id: monthlyId } });
    // A token from some other giveaway doesn't count.
    expect(await entrantFromLinked(monthly, d.id, monthlyId, activate)).toBeNull();
    const here = await entrantFromLinked(monthly, d.id, dailyId, activate);
    expect(here).toMatchObject({ status: "ACTIVE", campaignId: monthlyId });
    expect(await entrantTotal(here!.id)).toBe(2 + 3);
    // Asking again returns the same entry without awarding anything twice.
    const again = await entrantFromLinked(monthly, d.id, dailyId, activate);
    expect(again!.id).toBe(here!.id);
    expect(await entrantTotal(here!.id)).toBe(2 + 3);
  });

  it("stops mirroring once the link is removed", async () => {
    await db.campaign.update({ where: { id: dailyId }, data: { settings: {} } });
    const res = await signup({
      shop,
      campaignSlug: "daily",
      email: "gary@example.com",
      ip: "198.51.100.21",
      elapsedMs: 8000,
      userAgent: "vitest",
      name: "Ash Ketchum",
    });
    expect(res.ok).toBe(true);
    if (res.ok && res.state === "verify")
      await verifyEntrant(shop, "daily", "gary@example.com", codes.at(-1)!);
    expect(await find(monthlyId, "gary@example.com")).toBeNull();
  });
});
