import db from "../../db.server";
import { normalizeEmail } from "../bot/email";
import { checkOtp } from "../otp.server";
import { issueEntrantToken, readEntrantToken } from "../token.server";
import { award, entrantTotal } from "./ledger.server";
import { activate, findLiveCampaign } from "./signup.server";

export async function verifyEntrant(
  shop: string,
  campaignSlug: string,
  email: string,
  code: string,
) {
  const campaign = await findLiveCampaign(shop, campaignSlug);
  if (!campaign)
    return { ok: false as const, error: "This giveaway isn't open right now." };
  const entrant = await db.entrant.findUnique({
    where: {
      campaignId_emailNormalized: {
        campaignId: campaign.id,
        emailNormalized: normalizeEmail(email),
      },
    },
  });
  if (!entrant || !(await checkOtp(entrant.id, code))) {
    return {
      ok: false as const,
      error: "That code didn't match. Check your email and try again.",
    };
  }
  if (entrant.status === "PENDING_VERIFICATION") await activate(entrant.id);
  const fresh = await db.entrant.findUniqueOrThrow({
    where: { id: entrant.id },
  });
  return {
    ok: true as const,
    state: fresh.status === "ACTIVE" ? ("active" as const) : ("held" as const),
    token: issueEntrantToken(fresh.id, campaign.id),
    referralCode: fresh.referralCode,
    entries: await entrantTotal(fresh.id),
  };
}

/** Status for the widget: entries, completed actions, referral link. */
export async function entrantState(token: string) {
  const t = readEntrantToken(token);
  if (!t) return null;
  const entrant = await db.entrant.findUnique({
    where: { id: t.entrantId },
    include: { events: { select: { actionId: true, dedupeKey: true } } },
  });
  if (!entrant || entrant.campaignId !== t.campaignId) return null;
  return {
    state:
      entrant.status === "ACTIVE"
        ? "active"
        : entrant.status === "HELD"
          ? "held"
          : "verify",
    referralCode: entrant.referralCode,
    entries: await entrantTotal(entrant.id),
    completedActionIds: [
      ...new Set(entrant.events.map((e) => e.actionId).filter(Boolean)),
    ],
  };
}

const today = () => new Date().toISOString().slice(0, 10);

export async function completeAction(
  token: string,
  actionId: string,
  payload: { code?: string },
) {
  const t = readEntrantToken(token);
  if (!t) return { ok: false as const, error: "Please sign up first." };
  const [entrant, action] = await Promise.all([
    db.entrant.findUnique({ where: { id: t.entrantId } }),
    db.entryAction.findUnique({ where: { id: actionId } }),
  ]);
  if (!entrant || !action || action.campaignId !== t.campaignId) {
    return { ok: false as const, error: "Unknown action." };
  }
  if (entrant.status !== "ACTIVE")
    return { ok: false as const, error: "Verify your email first." };
  if (["SIGNUP", "REFERRAL"].includes(action.type)) {
    return { ok: false as const, error: "That one is awarded automatically." };
  }

  if (action.type === "SECRET_CODE") {
    const expected = String(
      (action.config as { code?: string } | null)?.code ?? "",
    )
      .trim()
      .toLowerCase();
    if (!expected || payload.code?.trim().toLowerCase() !== expected) {
      return { ok: false as const, error: "That's not the right code." };
    }
  }

  const repeatKey =
    action.type === "DAILY_CHECKIN" || action.repeatable ? `:${today()}` : "";
  const awarded = await award({
    campaignId: action.campaignId,
    entrantId: entrant.id,
    entries: action.entries,
    source: "ACTION",
    actionId: action.id,
    dedupeKey: `action:${action.id}:${entrant.id}${repeatKey}`,
  });
  return {
    ok: true as const,
    awarded,
    entries: await entrantTotal(entrant.id),
  };
}
