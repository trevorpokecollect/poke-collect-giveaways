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
    .default({}),
  consolation: z
    .object({
      enabled: z.boolean().default(false),
      percentOff: z.number().min(1).max(100).default(10),
      daysValid: z.number().int().positive().default(14),
      minEntries: z.number().int().nonnegative().default(1),
    })
    .default({}),
  klaviyo: z
    .object({
      enabled: z.boolean().default(false),
      listId: z.string().default(""),
      onlyConsented: z.boolean().default(true),
    })
    .default({}),
  webhookUrl: z.string().url().or(z.literal("")).default(""),
  showLeaderboard: z.boolean().default(false),
  showWinners: z.boolean().default(true),
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
 * DAILY_CHECKIN, SIGNUP, REFERRAL: none
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
} as const;
