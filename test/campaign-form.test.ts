import { describe, expect, it } from "vitest";
import {
  generateOfficialRules,
  newAction,
  rulesFromForm,
  rulesToForm,
  selectionIds,
  targetFromSelection,
  validateActions,
  validateCampaignForm,
  type CampaignFormValues,
} from "../app/lib/campaign-form";
import { purchaseRulesSchema, scoreOrder } from "../app/lib/entries/rules";
import { parseSettings } from "../app/lib/settings";

const TZ = "America/New_York";
const P = (n: number) => `gid://shopify/Product/${n}`;
const V = (n: number) => `gid://shopify/ProductVariant/${n}`;

const values = (
  over: Partial<CampaignFormValues> = {},
): CampaignFormValues => ({
  title: "Win a Booster Box",
  prize: "1x sealed booster box",
  description: "",
  slug: "",
  startsAt: "2026-11-01T09:00",
  endsAt: "2026-11-30T23:59",
  timezone: TZ,
  imageUrl: null,
  removeImage: false,
  rulesText: "",
  actions: [newAction("SIGNUP"), newAction("REFERRAL")],
  rules: rulesToForm(purchaseRulesSchema.parse({}), TZ),
  settings: parseSettings(null),
  resources: {},
  ...over,
});

describe("rules form", () => {
  it("round-trips stored rules, reading dates in the campaign timezone", () => {
    const stored = purchaseRulesSchema.parse({
      dateRange: { start: "2026-11-01T14:00:00.000Z" },
      productRules: [
        {
          name: "Booster boxes",
          productIds: [P(1)],
          mode: "per_unit",
          entries: 10,
          bonusThreshold: 100,
          bonusEntries: 5,
        },
      ],
      periodMultipliers: [
        {
          start: "2026-11-27T05:00:00.000Z",
          end: "2026-11-28T05:00:00.000Z",
          multiplier: 2,
        },
      ],
    });
    const form = rulesToForm(stored, TZ);
    expect(form.dateRange.start).toBe("2026-11-01T09:00");
    expect(form.periodMultipliers[0].start).toBe("2026-11-27T00:00");
    const back = rulesFromForm(form, TZ);
    expect(back.ok && back.value).toEqual(stored);
  });

  it("treats a 0 bonus as no bonus", () => {
    const form = rulesToForm(purchaseRulesSchema.parse({}), TZ);
    form.productRules.push({
      key: "a",
      name: "Packs",
      productIds: [P(2)],
      variantIds: [],
      mode: "per_unit",
      entries: 1,
      amount: 1,
      dateRange: { start: "", end: "" },
      bonusThreshold: 0,
      bonusEntries: 0,
      skipIfBundleMatched: true,
    });
    const r = rulesFromForm(form, TZ);
    expect(r.ok && r.value.productRules[0].bonusThreshold).toBeUndefined();
  });

  it("rejects rules with no products and bad periods", () => {
    const form = rulesToForm(null, TZ);
    form.aovBoosters.push({
      key: "b",
      name: "Sleeves",
      productIds: [],
      variantIds: [],
      multiplier: 2,
      excludeFromOrderTotal: true,
    });
    expect(rulesFromForm(form, TZ)).toEqual({
      ok: false,
      error: "Sleeves: pick at least one product.",
    });
    form.aovBoosters = [];
    form.periodMultipliers.push({
      key: "p",
      start: "2026-11-02T00:00",
      end: "",
      multiplier: 2,
    });
    expect(rulesFromForm(form, TZ).ok).toBe(false);
  });

  it("stored null rules load as disabled", () => {
    expect(rulesToForm(null, TZ).enabled).toBe(false);
  });

  it("feeds scoreOrder the same way the server does", () => {
    const r = rulesFromForm(values().rules, TZ);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const score = scoreOrder(r.value, {
      createdAt: new Date(),
      sourceName: "web",
      subtotal: 42.5,
      total: 50,
      giftCardAmount: 0,
      lines: [],
    });
    expect(score.entries).toBe(42);
  });
});

describe("validateActions", () => {
  it("requires exactly one sign-up and forces it mandatory", () => {
    expect(validateActions([newAction("REFERRAL")]).ok).toBe(false);
    const signup = { ...newAction("SIGNUP"), mandatory: false };
    const r = validateActions([signup]);
    expect(r.ok && r.value[0].mandatory).toBe(true);
  });

  it("validates config with actionConfigSchema", () => {
    const visit = newAction("VISIT_URL");
    expect(validateActions([newAction("SIGNUP"), visit])).toMatchObject({
      ok: false,
    });
    visit.config.url = "https://poke-collect.com/collections/new";
    visit.repeatable = true;
    const r = validateActions([newAction("SIGNUP"), visit]);
    expect(r.ok && r.value[1]).toMatchObject({
      config: { url: "https://poke-collect.com/collections/new" },
      repeatable: true,
    });
  });

  it("drops blank poll options and needs two", () => {
    const poll = newAction("POLL");
    poll.config = { question: "Next set?", options: ["Surging Sparks", " "] };
    expect(validateActions([newAction("SIGNUP"), poll]).ok).toBe(false);
    poll.config.options = ["Surging Sparks", "Prismatic Evolutions", ""];
    const r = validateActions([newAction("SIGNUP"), poll]);
    expect(r.ok && r.value[1].config).toEqual({
      question: "Next set?",
      options: ["Surging Sparks", "Prismatic Evolutions"],
    });
  });

  it("ignores repeatable where it doesn't apply and allows one referral", () => {
    const poll = { ...newAction("QUESTION"), repeatable: true };
    poll.config = { question: "Favourite starter?" };
    const r = validateActions([newAction("SIGNUP"), poll]);
    expect(r.ok && r.value[1].repeatable).toBe(false);
    expect(
      validateActions([
        newAction("SIGNUP"),
        newAction("REFERRAL"),
        newAction("REFERRAL"),
      ]).ok,
    ).toBe(false);
  });
});

describe("validateCampaignForm", () => {
  it("slugs the title and reads dates in Eastern time", () => {
    const r = validateCampaignForm(values());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.slug).toBe("win-a-booster-box");
    expect(r.value.startsAt?.toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });

  it("rejects end before start and a bad webhook URL", () => {
    expect(
      validateCampaignForm(values({ endsAt: "2026-10-01T00:00" })).ok,
    ).toBe(false);
    const settings = { ...parseSettings(null), webhookUrl: "nope" };
    expect(validateCampaignForm(values({ settings }))).toMatchObject({
      ok: false,
    });
  });
});

describe("resource picker mapping", () => {
  it("stores product GIDs for whole products and variant GIDs for partial picks", () => {
    const { target, labels } = targetFromSelection([
      {
        id: P(1),
        title: "Box",
        totalVariants: 1,
        hasOnlyDefaultVariant: true,
        variants: [{ id: V(11) }],
      },
      {
        id: P(2),
        title: "Sleeves",
        totalVariants: 3,
        hasOnlyDefaultVariant: false,
        variants: [{ id: V(21), title: "Red" }],
      },
    ]);
    expect(target).toEqual({ productIds: [P(1)], variantIds: [V(21)] });
    expect(labels[V(21)]).toEqual({ title: "Sleeves – Red", productId: P(2) });
    expect(selectionIds(target, labels)).toEqual([
      { id: P(1) },
      { id: P(2), variants: [{ id: V(21) }] },
    ]);
  });
});

describe("generateOfficialRules", () => {
  it("covers sponsor, eligibility, AMOE, odds, Eastern dates and prize", () => {
    const amoe = newAction("ALTERNATE_ENTRY");
    amoe.config.instructions = "Mail a 3x5 card to Poke-Collect.";
    const text = generateOfficialRules(
      values({ actions: [newAction("SIGNUP"), newAction("REFERRAL"), amoe] }),
    );
    expect(text).toContain("sponsored by Poke-Collect");
    expect(text).toContain("18 years of age or older");
    expect(text).toContain("NO PURCHASE NECESSARY");
    expect(text).toContain("Mail a 3x5 card to Poke-Collect.");
    expect(text).toContain("Odds of winning depend");
    expect(text).toContain("November 1, 2026 at 9:00 AM EST");
    expect(text).toContain("1x sealed booster box");
    expect(text).toContain("Refer a friend: 5 entries per verified referral");
  });

  it("describes a separate drawing each day for a daily giveaway", () => {
    const v = values({ actions: [newAction("SIGNUP")] });
    v.settings.daily = {
      ...v.settings.daily,
      enabled: true,
      drawTime: "21:00",
    };
    const text = generateOfficialRules(v);
    expect(text).toContain(
      "Each daily drawing takes place at 9:00 PM Eastern Time",
    );
    expect(text).toContain("entries do not carry over");
    expect(text).toContain("One prize is awarded in each daily drawing");
    expect(text).toContain("Odds of winning a daily drawing");
    expect(text).not.toContain("after the entry period ends. Winners");
  });
});

describe("daily task fields", () => {
  const signup = newAction("SIGNUP");
  const live = () => ({
    ...newAction("VISIT_URL"),
    label: "Join Our Live Whatnot Show",
    config: {
      url: "https://whatnot.com/live/x",
      daily: true,
      live: true,
      schedule: { days: [5], start: "17:00", end: "20:00" },
      urls: ["  ", "https://instagram.com/p/b"],
      confirm: " ",
    },
  });

  it("keeps the daily fields and makes the task repeat", () => {
    const r = validateActions([signup, live()]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value[1].repeatable).toBe(true);
    expect(r.value[1].config).toEqual({
      url: "https://whatnot.com/live/x",
      daily: true,
      live: true,
      schedule: { days: [5], start: "17:00", end: "20:00" },
      urls: ["https://instagram.com/p/b"],
    });
  });

  it("rejects a schedule with no days or an end before the start", () => {
    const noDays = live();
    noDays.config.schedule = { days: [], start: "17:00", end: "20:00" };
    expect(validateActions([signup, noDays]).ok).toBe(false);
    const backwards = live();
    backwards.config.schedule = { days: [5], start: "20:00", end: "17:00" };
    expect(validateActions([signup, backwards]).ok).toBe(false);
  });

  it("drops daily fields from non-daily tasks", () => {
    const plain = live();
    plain.config.daily = false;
    const r = validateActions([signup, plain]);
    expect(r.ok && r.value[1].config).toEqual({
      url: "https://whatnot.com/live/x",
    });
  });
});
