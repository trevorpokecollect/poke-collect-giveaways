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
import { findLiveCampaign, signup } from "../lib/entries/signup.server";
import { publicWinners } from "../lib/winners.server";
import { campaignSettingsSchema } from "../lib/settings";
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

  const token = request.headers.get("x-entrant-token");
  return json({
    campaign: {
      title: campaign.title,
      description: campaign.description,
      prize: campaign.prize,
      imageUrl: campaign.imageUrl,
      endsAt: campaign.endsAt,
      rulesText: campaign.rulesText,
      actions: visibleActions(campaign.actions).map(publicAction),
    },
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY ?? null,
    entrant: token ? await entrantState(token) : null,
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
        },
      );
      return result.ok ? json(result) : json(result, 400);
    }
    default:
      return json({ error: "Unknown request." }, 400);
  }
};
