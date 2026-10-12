import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The SMS opt-in action and its Klaviyo sync against a real Postgres. Runs when DATABASE_URL is set.
const enabled = !!process.env.DATABASE_URL;

describe.skipIf(!enabled)("SMS opt-in", async () => {
  const { default: db } = await import("../app/db.server");
  const { completeAction } = await import("../app/lib/entries/actions.server");
  const { issueEntrantToken } = await import("../app/lib/token.server");
  const { syncEntrantToKlaviyo } = await import("../app/lib/klaviyo.server");

  const shop = `sms-${Date.now()}.myshopify.com`;
  let actionId = "";
  const tokens: string[] = [];
  const entrantIds: string[] = [];
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ data: { id: "P1" } })),
  );

  beforeAll(async () => {
    process.env.ENTRANT_TOKEN_SECRET = "test-secret";
    delete process.env.KLAVIYO_PRIVATE_KEY;
    const c = await db.campaign.create({
      data: {
        shop,
        slug: "daily",
        title: "Daily giveaway",
        status: "ACTIVE",
        settings: { klaviyo: { enabled: true, onlyConsented: true } },
        actions: {
          create: [
            { type: "SIGNUP", label: "Enter", entries: 1 },
            { type: "SMS_OPTIN", label: "Texts", entries: 5 },
          ],
        },
      },
      include: { actions: true },
    });
    actionId = c.actions.find((a) => a.type === "SMS_OPTIN")!.id;
    for (const name of ["misty", "brock"]) {
      const e = await db.entrant.create({
        data: {
          campaignId: c.id,
          email: `${name}@example.com`,
          emailNormalized: `${name}@example.com`,
          status: "ACTIVE",
          referralCode: `${name}-${Date.now()}`,
        },
      });
      entrantIds.push(e.id);
      tokens.push(issueEntrantToken(e.id, c.id));
    }
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await db.campaign.deleteMany({ where: { shop } });
    await db.$disconnect();
  });

  it("needs a valid number and the consent box", async () => {
    expect(
      await completeAction(tokens[0], actionId, {
        phone: "123",
        consent: true,
      }),
    ).toMatchObject({ ok: false, error: "Enter a valid US mobile number." });
    expect(
      await completeAction(tokens[0], actionId, { phone: "(555) 234-5678" }),
    ).toMatchObject({ ok: false });
    expect(
      (await db.entrant.findUniqueOrThrow({ where: { id: entrantIds[0] } }))
        .smsConsentAt,
    ).toBeNull();
  });

  it("awards once, stores the number and refuses it for someone else", async () => {
    const ok = await completeAction(tokens[0], actionId, {
      phone: "(555) 234-5678",
      consent: true,
    });
    expect(ok).toMatchObject({ ok: true, awarded: true, entries: 5 });
    const misty = await db.entrant.findUniqueOrThrow({
      where: { id: entrantIds[0] },
    });
    expect(misty.phone).toBe("+15552345678");
    expect(misty.smsConsentAt).not.toBeNull();
    expect(
      await completeAction(tokens[0], actionId, {
        phone: "555-234-5678",
        consent: true,
      }),
    ).toMatchObject({ ok: true, awarded: false });
    expect(
      await completeAction(tokens[1], actionId, {
        phone: "+1 555 234 5678",
        consent: true,
      }),
    ).toMatchObject({ ok: false, error: "That number is already entered." });
  });

  it("subscribes the number to SMS in Klaviyo without email consent", async () => {
    process.env.KLAVIYO_PRIVATE_KEY = "pk_test";
    vi.stubGlobal("fetch", fetchMock);
    expect(await syncEntrantToKlaviyo(entrantIds[1])).toBe(false);
    expect(await syncEntrantToKlaviyo(entrantIds[0])).toBe(true);
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map((c) => c[0])).toEqual([
      "https://a.klaviyo.com/api/profile-import",
      "https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs",
      "https://a.klaviyo.com/api/events",
    ]);
    const job = JSON.parse(String(calls[1][1].body));
    expect(job.data.attributes.profiles.data[0].attributes).toEqual({
      email: "misty@example.com",
      phone_number: "+15552345678",
      subscriptions: { sms: { marketing: { consent: "SUBSCRIBED" } } },
    });
    expect(job.data.relationships).toBeUndefined();
    delete process.env.KLAVIYO_PRIVATE_KEY;
  });
});
