import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { clientIp } from "../lib/bot/fingerprint.server";
import {
  completeAction,
  entrantState,
  leaderboard,
  verifyEntrant,
} from "../lib/entries/actions.server";
import { publicAction, visibleActions } from "../lib/entries/actions";
import {
  activate,
  findLiveCampaign,
  signup,
} from "../lib/entries/signup.server";
import {
  entrantFromLinked,
  linkedCampaign,
} from "../lib/entries/linked.server";
import { publicWinners } from "../lib/winners.server";
import { currentPrize, storefrontDaily } from "../lib/daily.server";
import { issueEntrantToken, readEntrantToken } from "../lib/token.server";
import { campaignSettingsSchema, parseSettings } from "../lib/settings";
import {
  landingPage,
  wantsLandingPage,
} from "../lib/storefront/landing.server";

// Storefront API, reached through the Shopify app proxy at /apps/giveaways/<slug>.
// Shopify signs every proxied request, and authenticate.public.appProxy checks it.

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

function shopFrom(request: Request) {
  return new URL(request.url).searchParams.get("shop") ?? "";
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);
  const campaign = await findLiveCampaign(shopFrom(request), params.slug!);
  // Opened directly in the browser: a full page in the store's theme that mounts the widget.
  if (wantsLandingPage(request)) {
    return landingPage({
      slug: params.slug!,
      pathPrefix: new URL(request.url).searchParams.get("path_prefix"),
      campaign,
    });
  }
  if (!campaign)
    return json(
      {
        error: "This giveaway isn't open right now.",
        // Set (as [{ position, name: "Ash K." }]) when the giveaway has ENDED and showWinners is on.
        winners: await publicWinners(shopFrom(request), params.slug!),
      },
      404,
    );

  let token = request.headers.get("x-entrant-token");
  const t = readEntrantToken(token);
  let entrantId = t?.campaignId === campaign.id ? t.entrantId : null;
  // Not entered here yet, but entered in the linked giveaway: count them in this one too
  // (no second form) and hand back a token for it.
  let linkedToken: string | null = null;
  if (!entrantId) {
    for (const raw of (request.headers.get("x-linked-tokens") ?? "")
      .split(",")
      .slice(0, 5)) {
      const lt = readEntrantToken(raw.trim());
      if (!lt || lt.campaignId === campaign.id) continue;
      const here = await entrantFromLinked(
        campaign,
        lt.entrantId,
        lt.campaignId,
        activate,
      );
      if (!here) continue;
      linkedToken = token = issueEntrantToken(here.id, campaign.id);
      entrantId = here.id;
      break;
    }
  }
  const linked = await linkedCampaign(campaign);
  const linkedDaily = linked && (await currentPrize(linked));
  return json({
    linkedToken,
    // The giveaway this one is linked to (one sign-up enters both), for the "you're also in" note.
    linked: linked
      ? {
          title: linked.title,
          slug: linked.slug,
          daily: !!linkedDaily,
          prize: linkedDaily?.prize?.title ?? null,
        }
      : null,
    campaign: {
      title: campaign.title,
      description: campaign.description,
      prize: campaign.prize,
      imageUrl: campaign.imageUrl,
      endsAt: campaign.endsAt,
      rulesText: campaign.rulesText,
      requireEmailConsent: parseSettings(campaign.settings).requireEmailConsent,
      actions: visibleActions(campaign.actions).map(publicAction),
    },
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY ?? null,
    entrant: token ? await entrantState(token) : null,
    // Set for giveaways with the daily draw on: today's prize, when it's drawn, the last winner.
    daily: await storefrontDaily(campaign, entrantId),
    leaderboard: campaignSettingsSchema.safeParse(campaign.settings ?? {}).data
      ?.showLeaderboard
      ? await leaderboard(campaign.id, token)
      : null,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = shopFrom(request);
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const str = (k: string) =>
    typeof body[k] === "string" ? (body[k] as string) : undefined;

  switch (body.intent) {
    case "signup": {
      const result = await signup({
        shop,
        campaignSlug: params.slug!,
        email: str("email") ?? "",
        name: str("name"),
        referralCode: str("ref"),
        turnstileToken: str("turnstileToken"),
        honeypot: str("website"),
        elapsedMs:
          typeof body.elapsedMs === "number" ? body.elapsedMs : undefined,
        deviceId: str("deviceId"),
        ip: clientIp(request),
        userAgent: request.headers.get("user-agent") ?? undefined,
        // Shopify only sets this when the shopper is signed in, and it is covered by the proxy signature.
        shopifyCustomerId: url.searchParams.get("logged_in_customer_id")
          ? `gid://shopify/Customer/${url.searchParams.get("logged_in_customer_id")}`
          : undefined,
        marketingConsent: body.consent === true,
        phone: str("phone"),
        smsConsent: body.smsConsent === true,
        utm:
          typeof body.utm === "object" && body.utm
            ? (body.utm as Record<string, string>)
            : undefined,
      });
      return result.ok
        ? json(result)
        : json({ error: result.error }, result.status);
    }
    case "verify": {
      const result = await verifyEntrant(
        shop,
        params.slug!,
        str("email") ?? "",
        str("code") ?? "",
      );
      return result.ok ? json(result) : json({ error: result.error }, 400);
    }
    case "action": {
      const result = await completeAction(
        request.headers.get("x-entrant-token") ?? "",
        str("actionId") ?? "",
        {
          code: str("code"),
          answer: str("answer"),
          step: str("step"),
          started: str("started"),
          network: str("network"),
          phone: str("phone"),
          consent: body.consent === true,
        },
      );
      return result.ok ? json(result) : json(result, 400);
    }
    default:
      return json({ error: "Unknown request." }, 400);
  }
};
