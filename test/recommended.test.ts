import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMEZONE,
  newAction,
  rulesToForm,
  validateCampaignForm,
  type CampaignFormValues,
} from "../app/lib/campaign-form";
import { purchaseRulesSchema } from "../app/lib/entries/rules";
import { applyRecommended } from "../app/lib/recommended";
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
