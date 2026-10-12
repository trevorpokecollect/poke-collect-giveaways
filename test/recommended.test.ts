import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMEZONE,
  generateOfficialRules,
  newAction,
  rulesToForm,
  validateCampaignForm,
  type CampaignFormValues,
} from "../app/lib/campaign-form";
import { purchaseRulesSchema } from "../app/lib/entries/rules";
import {
  applyLiveMonthly,
  applyRecommended,
  applyRecommendedDaily,
} from "../app/lib/recommended";
import { parseSettings } from "../app/lib/settings";

const base = (): CampaignFormValues => ({
  title: "Win a booster box",
  prize: "Booster box ($160 value)",
  description: "",
  slug: "",
  startsAt: "2026-11-01T09:00",
  endsAt: "2026-11-15T20:00",
  timezone: DEFAULT_TIMEZONE,
  imageUrl: null,
  removeImage: false,
  rulesText: "",
  actions: [newAction("SIGNUP"), { ...newAction("REFERRAL"), entries: 50 }],
  rules: rulesToForm(purchaseRulesSchema.parse({}), DEFAULT_TIMEZONE),
  settings: parseSettings(null),
  resources: {},
});

describe("applyRecommended", () => {
  it("produces a giveaway the editor accepts", () => {
    const v = applyRecommended(base());
    const result = validateCampaignForm(v);
    expect(result.ok).toBe(true);
  });

  it("updates matching actions instead of duplicating them", () => {
    const v = applyRecommended(base());
    const referrals = v.actions.filter((a) => a.type === "REFERRAL");
    expect(referrals).toHaveLength(1);
    expect(referrals[0].entries).toBe(5);
    expect(applyRecommended(v).actions).toHaveLength(v.actions.length);
  });

  it("sets 2x for the first 48 hours and the purchase basics", () => {
    const v = applyRecommended(base());
    expect(v.rules.periodMultipliers[0]).toMatchObject({
      start: "2026-11-01T09:00",
      end: "2026-11-03T09:00",
      multiplier: 2,
    });
    expect(v.rules.minOrderValue).toBe(10);
    expect(v.settings.consolation).toMatchObject({
      enabled: true,
      minEntries: 3,
    });
  });
});

describe("applyRecommendedDaily", () => {
  it("produces a daily giveaway the editor accepts", () => {
    const v = applyRecommendedDaily(base());
    expect(validateCampaignForm(v).ok).toBe(true);
    expect(v.settings.daily).toMatchObject({
      enabled: true,
      drawTime: "21:00",
      minPrice: 70,
      maxPrice: 100,
    });
    expect(v.settings.winnerEmail.claimDays).toBe(3);
    expect(v.settings.consolation.enabled).toBe(false);
    expect(v.rules).toMatchObject({ orderSource: "online", minOrderValue: 0 });
  });

  it("swaps the monthly defaults for the short daily list", () => {
    const monthly = applyRecommended(base());
    const custom = { ...newAction("VISIT_URL"), label: "See the new set" };
    const used = {
      ...monthly.actions.find((a) => a.type === "POLL")!,
      hasEvents: true,
    };
    const v = applyRecommendedDaily({
      ...monthly,
      actions: [
        ...monthly.actions.filter((a) => a.type !== "POLL"),
        used,
        custom,
      ],
    });
    const types = v.actions.map((a) => a.type);
    expect(types).toContain("SMS_OPTIN");
    expect(types).not.toContain("WATCH_VIDEO");
    expect(types).toContain("POLL"); // has entries, so kept
    expect(v.actions).toContainEqual(custom);
    const follows = v.actions
      .filter((a) => a.type === "SOCIAL_FOLLOW")
      .map((a) => a.config.url)
      .sort();
    expect(follows).toEqual([
      "https://discord.gg/Tk4zVvyHan",
      "https://instagram.com/pokecollectcards",
      "https://whatnot.com/invite/pokecollectcards",
      "https://www.facebook.com/pokecollectcards",
    ]);
    expect(applyRecommendedDaily(v).actions).toHaveLength(v.actions.length);
  });
});

describe("required steps", () => {
  it("daily uses the live monthly's amounts: texts 100, Whatnot 100 required, $10 = 50", () => {
    const v = applyRecommendedDaily(base());
    expect(v.actions.find((a) => a.type === "SMS_OPTIN")).toMatchObject({ mandatory: false, entries: 100 });
    const whatnot = v.actions.find((a) => a.type === "SOCIAL_FOLLOW" && a.config.url?.includes("whatnot"));
    expect(whatnot).toMatchObject({ mandatory: true, entries: 100 });
    expect(v.actions.some((a) => a.type === "DAILY_CHECKIN")).toBe(false);
    expect(v.rules.base).toMatchObject({ mode: "per_amount", entries: 50, amount: 10 });
    expect(v.settings.requireEmailConsent).toBe(true);
  });

  it("makes the Whatnot follow and email opt-in required, with texts as a +10 bonus", () => {
    for (const v of [applyRecommended(base())]) {
      const whatnot = v.actions.find((a) => a.config.url?.includes("whatnot"));
      expect(whatnot?.mandatory).toBe(true);
      expect(v.actions.find((a) => a.type === "SMS_OPTIN")).toMatchObject({
        mandatory: false,
        entries: 10,
      });
      expect(v.settings.requireEmailConsent).toBe(true);
      expect(v.actions.some((a) => a.type === "WATCH_VIDEO")).toBe(false);
    }
  });

  it("lists the required steps in the official rules", () => {
    const rules = generateOfficialRules(applyRecommended(base()));
    expect(rules).toContain(
      "To complete an entry, entrants must also agree to receive marketing emails from the Sponsor (you can unsubscribe at any time after entering) and follow us on whatnot.",
    );
  });
});

describe("applyLiveMonthly", () => {
  it("copies the GiveawayNinja amounts with texts at 100", () => {
    const v = applyLiveMonthly({ ...base(), actions: [] });
    expect(validateCampaignForm(v).ok).toBe(true);
    const by = Object.fromEntries(v.actions.map((a) => [a.label, a]));
    expect(by["Get text alerts for drops"]).toMatchObject({ entries: 100, mandatory: false });
    expect(by["Follow us on Whatnot"]).toMatchObject({ entries: 100, mandatory: true });
    expect(by["Join our Discord"].entries).toBe(50);
    expect(by["Bookmark our next live show"]).toMatchObject({ type: "VISIT_URL", entries: 20, repeatable: true });
    expect(by["Like us on Facebook"].entries).toBe(10);
    expect(by["Follow us on Instagram"].entries).toBe(10);
    expect(by["Refer a friend"].entries).toBe(25);
    expect(v.actions.map((a) => a.type)).not.toContain("WATCH_VIDEO");
    expect(v.rules.base).toMatchObject({ mode: "per_amount", entries: 50, amount: 10 });
    expect(v.settings.requireEmailConsent).toBe(true);
  });
});
