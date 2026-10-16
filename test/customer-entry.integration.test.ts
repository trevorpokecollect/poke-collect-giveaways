import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Shoppers signed in to their store account enter with one tap: no Turnstile or form checks,
// and a returning customer gets their entry back on any device.
vi.mock("../app/shopify.server", () => ({ unauthenticated: {} }));

describe.skipIf(!process.env.DATABASE_URL)(
  "signed-in customer entry",
  async () => {
    const { default: db } = await import("../app/db.server");
    const { signup } = await import("../app/lib/entries/signup.server");
    const { tokenForCustomer } =
      await import("../app/lib/storefront/customer.server");
    const { readEntrantToken } = await import("../app/lib/token.server");

    const shop = `customer-${Date.now()}.myshopify.com`;
    let campaignId = "";
    const customer = {
      email: "Misty@Example.com",
      firstName: "Misty",
      lastName: "Waterflower",
      emailSubscribed: true,
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

    it("has no entry to hand back before they enter", async () => {
      expect(
        await tokenForCustomer(
          campaignId,
          "gid://shopify/Customer/1",
          async () => customer,
        ),
      ).toBeNull();
    });

    it("enters straight away without a Turnstile token or email code", async () => {
      const r = await signup({
        shop,
        campaignSlug: "daily",
        email: customer.email,
        name: "Misty Waterflower",
        ip: "203.0.113.9",
        shopifyCustomerId: "gid://shopify/Customer/1",
        signedInCustomer: true,
        marketingConsent: true,
      });
      expect(r).toMatchObject({ ok: true, state: "active" });
    });

    it("keeps the mobile number and text opt-in from the one-tap entry", async () => {
      const r = await signup({
        shop,
        campaignSlug: "daily",
        email: "dawn@example.com",
        name: "Dawn Berlitz",
        ip: "203.0.113.10",
        shopifyCustomerId: "gid://shopify/Customer/3",
        signedInCustomer: true,
        marketingConsent: true,
        phone: "(555) 234-5678",
        smsConsent: true,
      });
      expect(r).toMatchObject({ ok: true });
      const saved = await db.entrant.findFirstOrThrow({
        where: { campaignId, emailNormalized: "dawn@example.com" },
      });
      expect(saved.phone).toBeTruthy();
      expect(saved.smsConsentAt).not.toBeNull();
    });

    it("hands the entry back on another device", async () => {
      const token = await tokenForCustomer(
        campaignId,
        "gid://shopify/Customer/1",
        async () => null,
      );
      expect(readEntrantToken(token)?.campaignId).toBe(campaignId);
    });

    it("finds an entry made with the same email before signing in", async () => {
      const e = await db.entrant.create({
        data: {
          campaignId,
          email: "brock@example.com",
          emailNormalized: "brock@example.com",
          referralCode: `brock-${Date.now()}`,
          status: "ACTIVE",
        },
      });
      const token = await tokenForCustomer(
        campaignId,
        "gid://shopify/Customer/2",
        async () => ({ ...customer, email: "Brock@example.com" }),
      );
      expect(readEntrantToken(token)?.entrantId).toBe(e.id);
      const saved = await db.entrant.findUniqueOrThrow({ where: { id: e.id } });
      expect(saved.shopifyCustomerId).toBe("gid://shopify/Customer/2");
    });
  },
);
