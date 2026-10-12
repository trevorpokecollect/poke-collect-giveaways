import { describe, expect, it } from "vitest";
import {
  eligible,
  periodFor,
  pickPrize,
  type Candidate,
} from "../app/lib/daily";
import { campaignSettingsSchema } from "../app/lib/settings";

const cfg = campaignSettingsSchema.parse({ daily: { enabled: true } }).daily;
const NY = "America/New_York";

const card = (over: Partial<Candidate>): Candidate => ({
  variantId: "v",
  productId: "p",
  productHandle: "h",
  productType: "Pokemon Single",
  tags: ["Language_English"],
  title: "Card",
  imageUrl: null,
  value: 80,
  inventoryItemId: "i",
  locationId: "l",
  available: 2,
  ...over,
});

describe("periodFor", () => {
  it("before the draw time belongs to today's draw", () => {
    // 3pm ET on Oct 12 (EDT, UTC-4)
    const p = periodFor(new Date("2026-10-12T19:00:00Z"), NY, "21:00");
    expect(p.key).toBe("2026-10-12");
    expect(p.drawAt.toISOString()).toBe("2026-10-13T01:00:00.000Z");
    expect(p.opensAt.toISOString()).toBe("2026-10-12T01:00:00.000Z");
  });

  it("after the draw time rolls to tomorrow's draw", () => {
    const p = periodFor(new Date("2026-10-13T01:30:00Z"), NY, "21:00");
    expect(p.key).toBe("2026-10-13");
    expect(p.opensAt.toISOString()).toBe("2026-10-13T01:00:00.000Z");
  });

  it("handles the DST change (23-hour day)", () => {
    // DST ends Nov 1 2026 at 2am ET; the draw on Nov 1 is 9pm EST = 02:00Z Nov 2.
    const p = periodFor(new Date("2026-11-01T12:00:00Z"), NY, "21:00");
    expect(p.drawAt.toISOString()).toBe("2026-11-02T02:00:00.000Z");
    expect(p.opensAt.toISOString()).toBe("2026-11-01T01:00:00.000Z");
  });
});

describe("daily rules", () => {
  it("takes sealed in any language and English singles from $70 to $100", () => {
    expect(
      eligible(card({ productType: "Pokemon Sealed", tags: [] }), cfg),
    ).toBe(true);
    expect(eligible(card({}), cfg)).toBe(true);
    expect(eligible(card({ tags: ["Language_Japanese"] }), cfg)).toBe(false);
    expect(eligible(card({ value: 69.99 }), cfg)).toBe(false);
    expect(eligible(card({ value: 100.01 }), cfg)).toBe(false);
    expect(eligible(card({ productType: "Supplies" }), cfg)).toBe(false);
    expect(eligible(card({ available: 0 }), cfg)).toBe(false);
  });

  it("skips recently used products unless nothing else fits", () => {
    const a = card({ productId: "a" });
    const b = card({ productId: "b" });
    expect(pickPrize([a, b], cfg, new Set(["a"]), () => 0.99)?.productId).toBe(
      "b",
    );
    expect(pickPrize([a], cfg, new Set(["a"]), () => 0)?.productId).toBe("a");
    expect(pickPrize([card({ value: 5 })], cfg, new Set(), () => 0)).toBeNull();
  });
});
