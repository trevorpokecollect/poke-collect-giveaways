import { describe, expect, it } from "vitest";
import { previewData } from "../app/lib/preview";
import { applyRecommendedDaily } from "../app/lib/recommended";
import { DEFAULT_TIMEZONE, newAction, rulesToForm } from "../app/lib/campaign-form";
import { purchaseRulesSchema } from "../app/lib/entries/rules";
import { parseSettings } from "../app/lib/settings";

const daily = () =>
  applyRecommendedDaily({
    title: "Daily",
    prize: "",
    description: "",
    slug: "daily-giveaway",
    startsAt: "",
    endsAt: "",
    timezone: DEFAULT_TIMEZONE,
    imageUrl: null,
    removeImage: false,
    rulesText: "",
    actions: [newAction("SIGNUP"), newAction("REFERRAL")],
    rules: rulesToForm(purchaseRulesSchema.parse({}), DEFAULT_TIMEZONE),
    settings: parseSettings(null),
    resources: {},
  });

describe("previewData", () => {
  it("shapes unsaved editor values like the storefront API, required steps first", () => {
    const now = new Date("2026-10-12T15:00:00Z");
    const d = previewData(daily(), {
      imageUrl: null,
      entered: false,
      dailyPrize: { title: "Storm Emeralda Booster Box", imageUrl: null },
      now,
    });
    expect(d.campaign.requireEmailConsent).toBe(true);
    expect(d.campaign.actions.some((a) => a.type === "SIGNUP")).toBe(false);
    expect(d.campaign.actions[0]).toMatchObject({ mandatory: true, entries: 100 });
    expect(d.daily).toMatchObject({
      drawAt: "2026-10-13T01:00:00.000Z",
      prize: { title: "Storm Emeralda Booster Box" },
      yourEntries: null,
    });
    expect(d.entrant).toBeNull();
  });

  it("shows the shop box with each example's entries", () => {
    const v = daily();
    v.settings.shop.products = [
      { id: "gid://shopify/Product/1", title: "Booster box", imageUrl: null, price: 98.95 },
    ];
    const d = previewData(v, { imageUrl: null, entered: false });
    expect(d.shop).toMatchObject({
      rate: "50 entries for every $10 you spend",
      items: [{ title: "Booster box", price: 98.95, entries: 450 }],
    });
  });

  it("can show the entered view", () => {
    const d = previewData(daily(), { imageUrl: null, entered: true });
    expect(d.entrant).toMatchObject({ state: "active", entries: 1 });
    expect(d.daily?.yourEntries).toBe(1);
  });
});
