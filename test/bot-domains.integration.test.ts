import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Bot farms: known farm domains are refused, an uncommon domain flooding sign-ups is refused,
// and the admin can disqualify (and restore) everyone on a domain at once.
vi.mock("../app/shopify.server", () => ({ unauthenticated: {} }));

describe.skipIf(!process.env.DATABASE_URL)("bot farm domains", async () => {
  const { default: db } = await import("../app/db.server");
  const { signup } = await import("../app/lib/entries/signup.server");
  const { DOMAIN_BURST } = await import("../app/lib/bot/domains");
  const { disqualifyDomain, restoreDomain, suspiciousDomains } =
    await import("../app/lib/entries/domain-tools.server");

  const shop = `domains-${Date.now()}.myshopify.com`;
  let campaignId = "";
  const base = {
    shop,
    campaignSlug: "daily",
    name: "Amy Cobb",
    signedInCustomer: true, // skip Turnstile in tests
    marketingConsent: true,
  };

  beforeAll(async () => {
    process.env.ENTRANT_TOKEN_SECRET = "test-secret";
    const c = await db.campaign.create({
      data: {
        shop,
        slug: "daily",
        title: "Daily",
        status: "ACTIVE",
        actions: { create: [{ type: "SIGNUP", label: "Enter", entries: 1 }] },
      },
    });
    campaignId = c.id;
  });

  afterAll(async () => {
    await db.campaign.deleteMany({ where: { shop } });
    await db.$disconnect();
  });

  it("refuses a known farm domain", async () => {
    const r = await signup({
      ...base,
      email: "gale.finch@putterkickz.com",
      ip: "203.0.113.1",
    });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses an uncommon domain once it floods sign-ups, but not gmail", async () => {
    for (let i = 0; i < DOMAIN_BURST.count; i++)
      await db.entrant.create({
        data: {
          campaignId,
          email: `bot${i}@newfarm.test`,
          emailNormalized: `bot${i}@newfarm.test`,
          referralCode: `nf-${Date.now()}-${i}`,
          status: "ACTIVE",
        },
      });
    const r = await signup({
      ...base,
      email: "pebble.wolf@newfarm.test",
      ip: "203.0.113.2",
    });
    expect(r).toMatchObject({ ok: false, status: 403 });
    const ok = await signup({
      ...base,
      email: "real.person@gmail.com",
      ip: "203.0.113.3",
    });
    expect(ok).toMatchObject({ ok: true });
  });

  it("disqualifies and restores everyone on a domain", async () => {
    expect(
      (await suspiciousDomains(campaignId)).find(
        (d) => d.domain === "newfarm.test",
      ),
    ).toMatchObject({ active: DOMAIN_BURST.count, disqualified: 0 });
    const ids = await disqualifyDomain(campaignId, "newfarm.test");
    expect(ids).toHaveLength(DOMAIN_BURST.count);
    expect(await disqualifyDomain(campaignId, "gmail.com")).toHaveLength(0);
    const gmail = await db.entrant.findFirstOrThrow({
      where: { campaignId, emailNormalized: { endsWith: "@gmail.com" } },
    });
    expect(gmail.status).not.toBe("DISQUALIFIED");
    expect(await restoreDomain(campaignId, "newfarm.test")).toBe(
      DOMAIN_BURST.count,
    );
  });
});
