import { z } from "zod";

// Per-campaign settings stored as JSON on Campaign.settings.
export const campaignSettingsSchema = z.object({
  winnerEmail: z
    .object({
      enabled: z.boolean().default(true),
      subject: z.string().default("You won {{prize}}!"),
      body: z
        .string()
        .default(
          "Congratulations! You won {{prize}} in {{title}}. Confirm your shipping details here: {{claim_url}}",
        ),
      claimDays: z.number().int().positive().default(7),
    })
    .prefault({}),
  consolation: z
    .object({
      enabled: z.boolean().default(false),
      percentOff: z.number().min(1).max(100).default(10),
      daysValid: z.number().int().positive().default(14),
      minEntries: z.number().int().nonnegative().default(1),
    })
    .prefault({}),
  klaviyo: z
    .object({
      enabled: z.boolean().default(false),
      listId: z.string().default(""),
      onlyConsented: z.boolean().default(true),
    })
    .prefault({}),
  webhookUrl: z.string().url().or(z.literal("")).default(""),
  showLeaderboard: z.boolean().default(false),
  showWinners: z.boolean().default(true),
  // Who may enter, used by the official rules generator in the editor.
  eligibility: z
    .string()
    .default(
      "legal residents of the 50 United States and the District of Columbia who are 18 years of age or older",
    ),
});

export type CampaignSettings = z.infer<typeof campaignSettingsSchema>;

export const parseSettings = (raw: unknown): CampaignSettings =>
  campaignSettingsSchema.parse(raw ?? {});

/**
 * EntryAction.config shapes by type (validated where actions are saved):
 * SOCIAL_FOLLOW / VISIT_URL: { url }
 * WATCH_VIDEO: { url, seconds? }  (entrant must keep the video open `seconds`)
 * SOCIAL_SHARE: { network?: "x" | "facebook" | "any" }
 * SECRET_CODE: { code }
 * POLL: { question, options: string[] }
 * QUESTION: { question, answer? }  (answer set = quiz, must match case-insensitively)
 * ALTERNATE_ENTRY: { instructions? }  (free method of entry, quoted in the official rules)
 * DAILY_CHECKIN, SIGNUP, REFERRAL: none
 *
 * Any type may also carry `archived: true`. The editor sets it (with entries 0)
 * instead of deleting an action that already has EntryEvents, so the ledger
 * keeps its actionId. Archived actions must not be shown on the storefront or
 * awarded again; use isArchivedAction().
 */
export const actionConfigSchema = {
  SOCIAL_FOLLOW: z.object({ url: z.string().url() }),
  VISIT_URL: z.object({ url: z.string().url() }),
  WATCH_VIDEO: z.object({
    url: z.string().url(),
    seconds: z.number().int().nonnegative().optional(),
  }),
  SOCIAL_SHARE: z.object({
    network: z.enum(["x", "facebook", "any"]).default("any"),
  }),
  SECRET_CODE: z.object({ code: z.string().min(1) }),
  POLL: z.object({
    question: z.string().min(1),
    options: z.array(z.string().min(1)).min(2).max(10),
  }),
  QUESTION: z.object({
    question: z.string().min(1),
    answer: z.string().optional(),
  }),
  ALTERNATE_ENTRY: z.object({ instructions: z.string().optional() }),
} as const;

export const isArchivedAction = (config: unknown) =>
  !!config &&
  typeof config === "object" &&
  (config as { archived?: unknown }).archived === true;
