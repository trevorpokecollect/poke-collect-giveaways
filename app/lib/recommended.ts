import type { ActionType } from "@prisma/client";
import {
  newAction,
  newKey,
  type ActionConfigForm,
  type CampaignFormValues,
} from "./campaign-form";
import { parseLocalDateTime, toLocalInput } from "./time";

// Poke-Collect's recommended giveaway setups (see
// /mnt/project-files/plans/giveaway-recommended-settings.md and
// giveaway-daily-recommended-settings.md). The monthly one is applied to new
// giveaways; the editor's "Use recommended settings" button applies the daily one
// when the daily draw is on.

const INSTAGRAM = "https://instagram.com/pokecollectcards";
const FACEBOOK = "https://www.facebook.com/pokecollectcards";
const WHATNOT = "https://whatnot.com/invite/pokecollectcards";
const DISCORD = "https://discord.gg/Tk4zVvyHan";

interface Recommended {
  type: ActionType;
  label: string;
  entries: number;
  repeatable?: boolean;
  config?: ActionConfigForm;
}

const ACTIONS: Recommended[] = [
  { type: "SIGNUP", label: "Enter the giveaway", entries: 1 },
  { type: "REFERRAL", label: "Refer a friend", entries: 5 },
  {
    type: "DAILY_CHECKIN",
    label: "Daily check-in",
    entries: 1,
    repeatable: true,
  },
  {
    type: "SOCIAL_FOLLOW",
    label: "Follow us on Instagram",
    entries: 2,
    config: { url: INSTAGRAM },
  },
  {
    type: "SOCIAL_FOLLOW",
    label: "Follow us on Whatnot",
    entries: 2,
    config: { url: WHATNOT },
  },
  {
    type: "SOCIAL_FOLLOW",
    label: "Follow us on Facebook",
    entries: 2,
    config: { url: FACEBOOK },
  },
  {
    type: "SOCIAL_SHARE",
    label: "Share the giveaway",
    entries: 2,
    config: { network: "any" },
  },
  {
    type: "POLL",
    label: "Help pick our next giveaway",
    entries: 1,
    config: {
      question: "What should we give away next?",
      options: [
        "Sealed booster box",
        "Elite Trainer Box",
        "Graded slab",
        "Mystery packs",
      ],
    },
  },
];

// The daily popup is kept short: sign-ups that each grow a channel Poke-Collect owns,
// plus two reasons to come back every day (check-in and the Whatnot show code).
const DAILY_ACTIONS: Recommended[] = [
  { type: "SIGNUP", label: "Enter today's giveaway", entries: 1 },
  { type: "SMS_OPTIN", label: "Get text alerts for drops", entries: 5 },
  {
    type: "SOCIAL_FOLLOW",
    label: "Join our Discord",
    entries: 3,
    config: { url: DISCORD },
  },
  {
    type: "SOCIAL_FOLLOW",
    label: "Follow us on Whatnot",
    entries: 3,
    config: { url: WHATNOT },
  },
  {
    type: "DAILY_CHECKIN",
    label: "Daily check-in",
    entries: 1,
    repeatable: true,
  },
  {
    type: "SECRET_CODE",
    label: "Code from tonight's Whatnot show",
    entries: 3,
    repeatable: true,
    // A starting value so the giveaway saves; change it before each show.
    config: { code: "WHATNOT" },
  },
  { type: "REFERRAL", label: "Refer a friend", entries: 3 },
];

const sameAction = (
  a: { type: ActionType; config: ActionConfigForm },
  r: Recommended,
) =>
  a.type === r.type &&
  (r.type !== "SOCIAL_FOLLOW" || a.config.url === r.config?.url);

/** Keeps existing actions (updating matching ones' entries) and adds missing ones. */
function mergeActions(
  current: CampaignFormValues["actions"],
  list: Recommended[],
) {
  const actions = current.map((a) => {
    const r = list.find((x) => sameAction(a, x));
    return r
      ? { ...a, entries: r.entries, repeatable: r.repeatable ?? a.repeatable }
      : a;
  });
  for (const r of list) {
    if (actions.some((a) => sameAction(a, r))) continue;
    actions.push({
      ...newAction(r.type),
      label: r.label,
      entries: r.entries,
      repeatable: r.repeatable ?? false,
      config: { ...newAction(r.type).config, ...r.config },
    });
  }
  return actions;
}

/**
 * Returns `v` with the recommended actions, purchase rules and settings.
 * Keeps the title, prize, dates, image, link name and rules text, keeps any
 * existing actions (updating the entries of matching ones) and keeps product
 * rules, bundles and the Klaviyo list id, which are store-specific.
 */
export function applyRecommended(v: CampaignFormValues): CampaignFormValues {
  const actions = mergeActions(v.actions, ACTIONS);

  // Double entries for the first 48 hours, when a start date is set.
  const start = parseLocalDateTime(v.startsAt, v.timezone);
  const periodMultipliers =
    start && v.rules.periodMultipliers.length === 0
      ? [
          {
            key: newKey(),
            start: v.startsAt,
            end: toLocalInput(
              new Date(start.getTime() + 48 * 3600_000),
              v.timezone,
            ),
            multiplier: 2,
          },
        ]
      : v.rules.periodMultipliers;

  return {
    ...v,
    actions,
    rules: {
      ...v.rules,
      enabled: true,
      autoSignupFromOrders: true,
      orderSource: "online_pos",
      minOrderValue: 10,
      base: { mode: "per_amount", entries: 1, amount: 1, basis: "subtotal" },
      periodMultipliers,
    },
    settings: {
      ...v.settings,
      winnerEmail: { ...v.settings.winnerEmail, enabled: true, claimDays: 7 },
      consolation: {
        enabled: true,
        percentOff: 10,
        daysValid: 14,
        minEntries: 3,
      },
      klaviyo: { ...v.settings.klaviyo, onlyConsented: true },
      showWinners: true,
      showLeaderboard: false,
    },
  };
}

/**
 * The daily giveaway's recommended setup: a 9pm Eastern draw of a $70 to $100 sealed
 * product or English single, the short daily action list, purchases counted toward
 * that night's draw, a 3-day claim window and no consolation codes. Keeps the same
 * fields applyRecommended keeps.
 */
export function applyRecommendedDaily(
  v: CampaignFormValues,
): CampaignFormValues {
  return {
    ...v,
    timezone: v.timezone || "America/New_York",
    // Drops monthly-only recommended actions that haven't earned anyone entries yet
    // (e.g. the defaults on a new giveaway), so the popup stays short.
    actions: mergeActions(
      v.actions.filter(
        (a) =>
          a.hasEvents ||
          DAILY_ACTIONS.some((r) => sameAction(a, r)) ||
          !ACTIONS.some((r) => sameAction(a, r)),
      ),
      DAILY_ACTIONS,
    ),
    rules: {
      ...v.rules,
      enabled: true,
      autoSignupFromOrders: true,
      orderSource: "online",
      minOrderValue: 0,
      base: { mode: "per_amount", entries: 1, amount: 1, basis: "subtotal" },
    },
    settings: {
      ...v.settings,
      daily: {
        ...v.settings.daily,
        enabled: true,
        drawTime: "21:00",
        minPrice: 70,
        maxPrice: 100,
        sources: [
          { productType: "Pokemon Sealed", languages: "" },
          { productType: "Pokemon Single", languages: "English" },
        ],
        noRepeatDays: 30,
        winCooldownDays: 30,
      },
      winnerEmail: { ...v.settings.winnerEmail, enabled: true, claimDays: 3 },
      consolation: { ...v.settings.consolation, enabled: false },
      klaviyo: { ...v.settings.klaviyo, enabled: true, onlyConsented: true },
      showWinners: true,
      showLeaderboard: false,
    },
  };
}
