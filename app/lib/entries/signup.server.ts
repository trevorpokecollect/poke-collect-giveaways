import { randomBytes } from "node:crypto";
import type { Campaign, Entrant } from "@prisma/client";
import db from "../../db.server";
import {
  isDisposableEmail,
  isValidEmailSyntax,
  looksGenerated,
  normalizeEmail,
} from "../bot/email";
import { hashId, subnetOf } from "../bot/fingerprint.server";
import { isLimited } from "../bot/rate-limit.server";
import {
  SIGNAL_WEIGHTS,
  decide,
  parsePolicy,
  scoreSignals,
  type Signal,
} from "../bot/risk";
import { verifyTurnstile } from "../bot/turnstile.server";
import { issueOtp } from "../otp.server";
import { issueEntrantToken } from "../token.server";
import { queueKlaviyoSync } from "../klaviyo.server";
import { emitWebhook } from "../webhook-out.server";
import { award, entrantTotal } from "./ledger.server";
import { slugify } from "../slug";
import { normalizeUsPhone } from "../phone";
import { parseSettings } from "../settings";
import { isArchived } from "./actions";
import { mirrorEntrant } from "./linked.server";

/** At least a first and a last name (two words with a letter each). */
export function hasFullName(name: string | undefined | null) {
  return (
    (name ?? "")
      .trim()
      .split(/\s+/)
      .filter((w) => /\p{L}/u.test(w)).length >= 2
  );
}

export interface SignupInput {
  shop: string;
  campaignSlug: string;
  email: string;
  name?: string;
  referralCode?: string;
  turnstileToken?: string;
  honeypot?: string;
  /** ms since the form was rendered, measured by the widget. */
  elapsedMs?: number;
  deviceId?: string;
  ip: string;
  userAgent?: string;
  /** Set when the visitor is signed in to a Shopify customer account (verified via app proxy). */
  shopifyCustomerId?: string;
  marketingConsent?: boolean;
  /** Optional mobile number from the sign-up form; only kept when smsConsent is true. */
  phone?: string;
  smsConsent?: boolean;
  utm?: Record<string, string>;
}

export type SignupResult =
  | { ok: false; error: string; status: number }
  | {
      ok: true;
      state: "active" | "verify" | "held";
      token: string;
      referralCode: string;
      entries: number;
    };

const MIN_FILL_MS = 2500;
const LIMITS = {
  ipPerHour: 20,
  ipEntrantsBurst: 3,
  subnetEntrantsBurst: 8,
  deviceEntrants: 2,
};

/**
 * Finds the open giveaway for a storefront request. Accepts the link name in
 * any form a merchant might type it ("Delta Reign", "delta-reign"), or the
 * giveaway title; "latest" picks the newest open giveaway.
 */
export async function findLiveCampaign(shop: string, slug: string) {
  const now = new Date();
  const include = { actions: { orderBy: { sortOrder: "asc" as const } } };
  const isOpen = (c: Campaign | null) =>
    !!c &&
    c.status === "ACTIVE" &&
    (!c.startsAt || c.startsAt <= now) &&
    (!c.endsAt || c.endsAt >= now);
  const wanted = slugify(slug);

  if (wanted && wanted !== "latest") {
    const bySlug = await db.campaign.findUnique({
      where: { shop_slug: { shop, slug: wanted } },
      include,
    });
    if (bySlug) return isOpen(bySlug) ? bySlug : null;
    const byTitle = await db.campaign.findFirst({
      where: { shop, title: { equals: slug.trim(), mode: "insensitive" } },
      orderBy: { createdAt: "desc" },
      include,
    });
    return isOpen(byTitle) ? byTitle : null;
  }

  const latest = await db.campaign.findFirst({
    where: {
      shop,
      status: "ACTIVE",
      OR: [{ startsAt: null }, { startsAt: { lte: now } }],
      AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
    },
    orderBy: { createdAt: "desc" },
    include,
  });
  return latest;
}

export async function signup(input: SignupInput): Promise<SignupResult> {
  const campaign = await findLiveCampaign(input.shop, input.campaignSlug);
  if (!campaign)
    return {
      ok: false,
      error: "This giveaway isn't open right now.",
      status: 404,
    };

  const email = input.email.trim();
  if (!isValidEmailSyntax(email))
    return { ok: false, error: "Please enter a valid email.", status: 400 };
  if (parseSettings(campaign.settings).requireName && !hasFullName(input.name))
    return {
      ok: false,
      error: "Enter your first and last name.",
      status: 400,
    };
  if (
    parseSettings(campaign.settings).requireEmailConsent &&
    !input.marketingConsent
  )
    return {
      ok: false,
      error: "Tick the email box to enter.",
      status: 400,
    };
  let phone: string | null = null;
  if (input.smsConsent && input.phone?.trim()) {
    phone = normalizeUsPhone(input.phone);
    if (!phone)
      return {
        ok: false,
        error: "Enter a valid US mobile number, or leave it blank.",
        status: 400,
      };
  }

  const ipHash = hashId(input.ip);
  const subnetHash = hashId(subnetOf(input.ip));
  const deviceHash = input.deviceId ? hashId(input.deviceId) : null;

  // Hard flood limit before doing any real work.
  if (await isLimited(`signup:ip:${ipHash}`, LIMITS.ipPerHour, 3600)) {
    return {
      ok: false,
      error: "Too many attempts. Please try again later.",
      status: 429,
    };
  }

  const emailNormalized = normalizeEmail(email);
  const existing = await db.entrant.findUnique({
    where: {
      campaignId_emailNormalized: { campaignId: campaign.id, emailNormalized },
    },
  });
  if (existing) return returning(campaign, existing, email);

  const signals: Signal[] = [];
  const turnstile = await verifyTurnstile(input.turnstileToken, input.ip);
  if (!turnstile.success)
    signals.push({
      code: turnstile.errorCodes.every((c) =>
        ["missing-input-response", "timeout-or-duplicate"].includes(c),
      )
        ? "turnstile_missing"
        : "turnstile_failed",
      detail: turnstile.errorCodes.join(","),
    });
  if (input.honeypot) signals.push({ code: "honeypot" });
  if (input.elapsedMs !== undefined && input.elapsedMs < MIN_FILL_MS) {
    signals.push({ code: "too_fast", detail: `${input.elapsedMs}ms` });
  }
  if (isDisposableEmail(email)) signals.push({ code: "disposable_email" });
  if (looksGenerated(email)) signals.push({ code: "generated_email" });

  const hourAgo = new Date(Date.now() - 3600_000);
  const [ipCount, subnetCount, deviceCount] = await Promise.all([
    db.entrant.count({
      where: { campaignId: campaign.id, ipHash, createdAt: { gte: hourAgo } },
    }),
    db.entrant.count({
      where: {
        campaignId: campaign.id,
        subnetHash,
        createdAt: { gte: hourAgo },
      },
    }),
    deviceHash
      ? db.entrant.count({ where: { campaignId: campaign.id, deviceHash } })
      : 0,
  ]);
  if (ipCount >= LIMITS.ipEntrantsBurst)
    signals.push({ code: "ip_burst", detail: `${ipCount} in 1h` });
  if (subnetCount >= LIMITS.subnetEntrantsBurst)
    signals.push({ code: "subnet_burst", detail: `${subnetCount} in 1h` });
  if (deviceCount >= LIMITS.deviceEntrants)
    signals.push({ code: "device_reuse", detail: `${deviceCount} entrants` });

  const referrer = input.referralCode
    ? await db.entrant.findUnique({
        where: { referralCode: input.referralCode },
      })
    : null;
  const validReferrer =
    referrer && referrer.campaignId === campaign.id ? referrer : null;
  if (
    validReferrer &&
    (validReferrer.ipHash === ipHash ||
      (deviceHash && validReferrer.deviceHash === deviceHash))
  ) {
    signals.push({ code: "self_referral" });
  }

  const policy = parsePolicy(campaign.riskPolicy);
  const { score, signals: scored } = scoreSignals(signals);
  let decision = decide(score, policy);
  // A signed-in Shopify customer has already proven they own the email.
  if (
    decision === "verify" &&
    input.shopifyCustomerId &&
    score < policy.verifyAt
  )
    decision = "allow";

  if (decision === "block") {
    // Blocked sign-ups aren't saved, so log why (no personal data) for tuning.
    console.warn("signup blocked", {
      campaign: campaign.slug,
      score,
      signals: scored.map((s) => `${s.code}${s.detail ? `(${s.detail})` : ""}`),
    });
    return { ok: false, error: "We couldn't accept this entry.", status: 403 };
  }

  const status =
    decision === "allow"
      ? "ACTIVE"
      : decision === "hold"
        ? "HELD"
        : "PENDING_VERIFICATION";
  const entrant = await db.entrant.create({
    data: {
      campaignId: campaign.id,
      email,
      emailNormalized,
      name: input.name?.trim() || null,
      shopifyCustomerId: input.shopifyCustomerId ?? null,
      status,
      verifiedAt: status === "ACTIVE" ? new Date() : null,
      referralCode: randomBytes(5).toString("base64url"),
      referredById: validReferrer?.id ?? null,
      riskScore: score,
      ipHash,
      subnetHash,
      deviceHash,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      utm: input.utm ?? undefined,
      marketingConsent: !!input.marketingConsent,
      // A number already entered by someone else is dropped rather than refused, so the
      // sign-up still goes through (and doesn't reveal who else entered).
      ...(phone && !(await phoneTaken(campaign.id, phone))
        ? { phone, smsConsentAt: new Date() }
        : {}),
      riskSignals: {
        create: scored.map((s) => ({
          code: s.code,
          detail: s.detail,
          weight: SIGNAL_WEIGHTS[s.code],
        })),
      },
    },
  });

  emitWebhook(campaign.id, "entrant.created", {
    entrantId: entrant.id,
    status,
  });
  if (status === "ACTIVE") await activate(entrant.id);
  if (status === "PENDING_VERIFICATION")
    await issueOtp(entrant, campaign.title);

  return {
    ok: true,
    state:
      status === "ACTIVE" ? "active" : status === "HELD" ? "held" : "verify",
    token: issueEntrantToken(entrant.id, campaign.id),
    referralCode: entrant.referralCode,
    entries: await entrantTotal(entrant.id),
  };
}

const phoneTaken = async (campaignId: string, phone: string) =>
  !!(await db.entrant.findFirst({
    where: { campaignId, phone },
    select: { id: true },
  }));

async function returning(
  campaign: Campaign,
  entrant: Entrant,
  rawEmail: string,
): Promise<SignupResult> {
  if (entrant.status === "DISQUALIFIED") {
    return { ok: false, error: "We couldn't accept this entry.", status: 403 };
  }
  if (entrant.email.toLowerCase() !== rawEmail.toLowerCase()) {
    await db.riskSignal.create({
      data: {
        entrantId: entrant.id,
        code: "duplicate_email_alias",
        weight: SIGNAL_WEIGHTS.duplicate_email_alias,
        detail: rawEmail,
      },
    });
  }
  // Returning visitors must prove they own the inbox before getting a token back.
  await issueOtp(entrant, campaign.title);
  return {
    ok: true,
    state: entrant.status === "HELD" ? "held" : "verify",
    token: "",
    referralCode: "",
    entries: 0,
  };
}

/**
 * Called once an entrant is verified: grants the signup entries and credits the referrer.
 * Safe to call more than once thanks to dedupe keys.
 */
export async function activate(
  entrantId: string,
  opts: { mirror?: boolean } = {},
) {
  const entrant = await db.entrant.update({
    where: { id: entrantId },
    data: { status: "ACTIVE", verifiedAt: new Date() },
    include: { campaign: { include: { actions: true } } },
  });
  const signupAction = entrant.campaign.actions.find(
    (a) => a.type === "SIGNUP",
  );
  await award({
    campaignId: entrant.campaignId,
    entrantId,
    entries: signupAction?.entries ?? 1,
    source: "ACTION",
    actionId: signupAction?.id,
    dedupeKey: `signup:${entrantId}`,
  });

  const referralAction = entrant.campaign.actions.find(
    (a) => a.type === "REFERRAL",
  );
  if (
    entrant.referredById &&
    referralAction &&
    entrant.riskScore < parsePolicy(entrant.campaign.riskPolicy).verifyAt
  ) {
    const referrer = await db.entrant.findUnique({
      where: { id: entrant.referredById },
    });
    if (referrer?.status === "ACTIVE") {
      await award({
        campaignId: entrant.campaignId,
        entrantId: referrer.id,
        entries: referralAction.entries,
        source: "REFERRAL",
        actionId: referralAction.id,
        note: `referred ${entrant.id}`,
        dedupeKey: `referral:${entrant.id}`,
      });
    }
  }
  // Texts agreed to on the sign-up form earn the SMS opt-in action's entries, with the
  // same dedupe key as completing that action, so they can't be earned twice.
  const smsAction = entrant.campaign.actions.find(
    (a) => a.type === "SMS_OPTIN" && !isArchived(a),
  );
  if (entrant.smsConsentAt && entrant.phone && smsAction) {
    await award({
      campaignId: entrant.campaignId,
      entrantId,
      entries: smsAction.entries,
      source: "ACTION",
      actionId: smsAction.id,
      dedupeKey: `action:${smsAction.id}:${entrantId}`,
    });
  }
  queueKlaviyoSync(entrantId);
  emitWebhook(entrant.campaignId, "entrant.activated", { entrantId });
  // One sign-up enters both linked giveaways.
  if (opts.mirror !== false) await mirrorEntrant(entrantId, activate);
}

/** Revokes every referral entry an entrant earned for others (used when disqualifying a bot). */
export async function clawBackReferrals(entrantId: string) {
  const credited = await db.entryEvent.findMany({
    where: { dedupeKey: `referral:${entrantId}` },
  });
  for (const ev of credited) {
    await award({
      campaignId: ev.campaignId,
      entrantId: ev.entrantId,
      entries: -ev.entries,
      source: "ROLLBACK",
      note: `referral clawback: ${entrantId} disqualified`,
      dedupeKey: `referral-clawback:${entrantId}`,
    });
  }
}
