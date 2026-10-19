import { afterAll, beforeAll, describe, expect, it } from "vitest";

// "Add Entries" in the admin: a manual ADJUSTMENT on the ledger, by entrant or by email.
describe.skipIf(!process.env.DATABASE_URL)("add entries", async () => {
  const { default: db } = await import("../app/db.server");
  const { addEntries, parseAdjustment } =
    await import("../app/lib/entries/adjust.server");

  const shop = `adjust-${Date.now()}.myshopify.com`;
  let campaignId = "";
  let entrantId = "";

  beforeAll(async () => {
    const c = await db.campaign.create({
      data: { shop, slug: "g", title: "G", status: "ACTIVE" },
    });
    campaignId = c.id;
    const e = await db.entrant.create({
      data: {
        campaignId,
        email: "Misty@Example.com",
        emailNormalized: "misty@example.com",
        referralCode: `m-${Date.now()}`,
        status: "ACTIVE",
      },
    });
    entrantId = e.id;
  });

  afterAll(async () => {
    await db.campaign.deleteMany({ where: { shop } });
    await db.$disconnect();
  });

  it("validates the amount", () => {
    expect(parseAdjustment("50")).toBe(50);
    expect(parseAdjustment("-20")).toBe(-20);
    expect(typeof parseAdjustment("0")).toBe("string");
    expect(typeof parseAdjustment("2.5")).toBe("string");
    expect(typeof parseAdjustment("abc")).toBe("string");
    expect(typeof parseAdjustment("1000001")).toBe("string");
  });

  it("adds entries by email with a note, and takes them away with a minus", async () => {
    const r = await addEntries({
      campaignId,
      email: " misty@example.com ",
      entries: "500",
      note: "Order #258400",
    });
    expect(r).toMatchObject({ ok: true, entries: 500, total: 500 });
    const ev = await db.entryEvent.findFirstOrThrow({ where: { entrantId } });
    expect(ev).toMatchObject({ source: "ADJUSTMENT", note: "Order #258400" });
    const r2 = await addEntries({ campaignId, entrantId, entries: -100 });
    expect(r2).toMatchObject({ ok: true, total: 400 });
  });

  it("explains when nobody has that email, or they're disqualified", async () => {
    expect(
      await addEntries({ campaignId, email: "brock@example.com", entries: 5 }),
    ).toMatchObject({ error: expect.stringContaining("need to enter first") });
    await db.entrant.update({
      where: { id: entrantId },
      data: { status: "DISQUALIFIED" },
    });
    expect(
      await addEntries({ campaignId, entrantId, entries: 5 }),
    ).toMatchObject({ error: expect.stringContaining("disqualified") });
  });
});
