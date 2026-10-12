import { describe, expect, it } from "vitest";
import {
  landingPage,
  wantsLandingPage,
} from "../app/lib/storefront/landing.server";
import { orderIdFromGid } from "../app/lib/entries/order-entries.server";

const req = (
  url: string,
  headers: Record<string, string> = {},
  method = "GET",
) => new Request(url, { method, headers });

describe("hosted giveaway page", () => {
  it("is served for browser navigations only", () => {
    const page = "https://app.test/proxy/delta-reign?shop=x.myshopify.com";
    const html = { accept: "text/html,application/xhtml+xml,*/*;q=0.8" };
    expect(wantsLandingPage(req(page, html))).toBe(true);
    expect(wantsLandingPage(req(`${page}&format=json`, html))).toBe(false);
    expect(wantsLandingPage(req(page, { accept: "application/json" }))).toBe(
      false,
    );
    expect(wantsLandingPage(req(page, { accept: "*/*" }))).toBe(false);
    expect(wantsLandingPage(req(page, html, "POST"))).toBe(false);
  });

  it("returns Liquid that mounts the widget and can't be hijacked by merchant text", async () => {
    const res = landingPage({
      slug: "delta-reign",
      pathPrefix: "/apps/giveaways",
      campaign: {
        title: "Win {{ shop.email }} <b>now</b>",
        prize: "A booster box",
      },
    });
    expect(res.headers.get("content-type")).toBe("application/liquid");
    const body = await res.text();
    expect(body).toContain('data-slug="delta-reign"');
    expect(body).toContain('data-proxy="/apps/giveaways"');
    expect(body).toContain("Widget.prototype");
    expect(body).not.toContain("{{ shop.email }}");
    expect(body).not.toContain("<b>now</b>");
    // The inlined widget code sits inside one raw block.
    expect(body.match(/{% raw %}/g)?.length).toBe(2);
  });

  it("falls back to the default proxy path for odd prefixes", async () => {
    const body = await landingPage({
      slug: "latest",
      pathPrefix: '"><script>',
    }).text();
    expect(body).toContain('data-proxy="/apps/giveaways"');
  });
});

describe("order ids from extensions", () => {
  it("reads Order and OrderIdentity gids", () => {
    expect(orderIdFromGid("gid://shopify/OrderIdentity/5551234")).toBe(
      "5551234",
    );
    expect(orderIdFromGid("gid://shopify/Order/42")).toBe("42");
    expect(orderIdFromGid(null)).toBeNull();
  });
});
