import type { ActionType } from "@prisma/client";
import {
  newAction,
  newKey,
  type ActionConfigForm,
  type CampaignFormValues,
} from "./campaign-form";
import { parseLocalDateTime, toLocalInput } from "./time";

// Poke-Collect's recommended giveaway setup (see
// /mnt/project-files/plans/giveaway-recommended-settings.md). Applied to new
// giveaways and by the "Use recommended settings" button in the editor.

const INSTAGRAM = "https://instagram.com/pokecollectcards";
const YOUTUBE = "https://www.youtube.com/@pokecollectcards";
const WHATNOT = "https://whatnot.com/invite/pokecollectcards";

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
    type: "WATCH_VIDEO",
    label: "Watch our latest pack opening",
    entries: 3,
    config: { url: YOUTUBE, seconds: 30 },
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
  {
    type: "ALTERNATE_ENTRY",
    label: "No purchase necessary: free entry",
    entries: 1,
  },
];

const sameAction = (
  a: { type: ActionType; config: ActionConfigForm },
  r: Recommended,
) =>
  a.type === r.type &&
  (r.type !== "SOCIAL_FOLLOW" || a.config.url === r.config?.url);

/**
 * Returns `v` with the recommended actions, purchase rules and settings.
 * Keeps the title, prize, dates, image, link name and rules text, keeps any
 * existing actions (updating the entries of matching ones) and keeps product
 * rules, bundles and the Klaviyo list id, which are store-specific.
 */
export function applyRecommended(v: CampaignFormValues): CampaignFormValues {
  const actions = v.actions.map((a) => {
    const r = ACTIONS.find((x) => sameAction(a, x));
    return r
      ? { ...a, entries: r.entries, repeatable: r.repeatable ?? a.repeatable }
      : a;
  });
  for (const r of ACTIONS) {
    if (actions.some((a) => sameAction(a, r))) continue;
    actions.push({
      ...newAction(r.type),
      label: r.label,
      entries: r.entries,
      repeatable: r.repeatable ?? false,
      config: { ...newAction(r.type).config, ...r.config },
    });
  }

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
