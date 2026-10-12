import { afterAll, describe, expect, it } from "vitest";

// Editor save/duplicate against a real Postgres. Runs when DATABASE_URL is set.
const enabled = !!process.env.DATABASE_URL;

describe.skipIf(!enabled)("campaign editor", async () => {
  const { default: db } = await import("../app/db.server");
  const {
    campaignToForm,
    duplicateCampaign,
    updateCampaign,
    actionHistoryInclude,
  } = await import("../app/lib/campaign-form.server");
  const { newAction, validateCampaignForm } =
    await import("../app/lib/campaign-form");

  const shop = `edit-${Date.now()}.myshopify.com`;
  afterAll(async () => {
    await db.campaign.deleteMany({ where: { shop } });
    await db.$disconnect();
  });

  it("archives removed actions with entries, deletes unused ones, and duplicates as a draft", async () => {
    const c = await db.campaign.create({
      data: {
        shop,
        slug: "box",
        title: "Box",
        status: "ACTIVE",
        actions: {
          create: [
            { type: "SIGNUP", label: "Enter", entries: 1, sortOrder: 0 },
            { type: "DAILY_CHECKIN", label: "Daily", entries: 1, sortOrder: 1 },
            { type: "REFERRAL", label: "Refer", entries: 5, sortOrder: 2 },
          ],
        },
      },
      include: { actions: true },
    });
    const daily = c.actions.find((a) => a.type === "DAILY_CHECKIN")!;
    const entrant = await db.entrant.create({
      data: {
        campaignId: c.id,
        email: "misty@example.com",
        emailNormalized: "misty@example.com",
        referralCode: `r${Date.now()}`,
        status: "ACTIVE",
      },
    });
    await db.entryEvent.create({
      data: {
        campaignId: c.id,
        entrantId: entrant.id,
        source: "ACTION",
        actionId: daily.id,
        entries: 1,
      },
    });

    const loaded = await db.campaign.findUniqueOrThrow({
      where: { id: c.id },
      include: actionHistoryInclude,
    });
    const form = campaignToForm(loaded);
    expect(form.actions.find((a) => a.id === daily.id)?.hasEvents).toBe(true);

    // Keep only sign-up (renamed), add a secret code.
    const code = newAction("SECRET_CODE");
    code.config.code = "PIKACHU";
    form.actions = [
      { ...form.actions.find((a) => a.type === "SIGNUP")!, label: "Join" },
      code,
    ];
    const v = validateCampaignForm(form);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    await updateCampaign(c, v.value, null);

    const after = await db.entryAction.findMany({
      where: { campaignId: c.id },
      orderBy: { sortOrder: "asc" },
    });
    expect(after.map((a) => [a.type, a.label, a.entries])).toEqual([
      ["SIGNUP", "Join", 1],
      ["SECRET_CODE", "Enter the secret code", 5],
      ["DAILY_CHECKIN", "Daily", 0],
    ]);
    expect(after[0].id).toBe(c.actions[0].id);
    expect(after[2].config).toMatchObject({ archived: true });
    const ledger = await db.entryEvent.findFirstOrThrow({
      where: { entrantId: entrant.id },
    });
    expect(ledger.actionId).toBe(daily.id);

    const copy = await duplicateCampaign(shop, c.id);
    const full = await db.campaign.findUniqueOrThrow({
      where: { id: copy!.id },
      include: { actions: true, entrants: true },
    });
    expect(full).toMatchObject({ status: "DRAFT", slug: "box-copy" });
    expect(full.entrants).toHaveLength(0);
    expect(full.actions.map((a) => a.type).sort()).toEqual([
      "SECRET_CODE",
      "SIGNUP",
    ]);
    expect((await duplicateCampaign(shop, c.id))!.slug).toBe("box-copy-2");
  });
});
