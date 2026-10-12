import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { CampaignForm } from "../components/CampaignForm";
import {
  DEFAULT_TIMEZONE,
  generateOfficialRules,
  newAction,
  rulesToForm,
  type CampaignFormValues,
} from "../lib/campaign-form";
import {
  createCampaign,
  readCampaignForm,
  slugTaken,
} from "../lib/campaign-form.server";
import { purchaseRulesSchema } from "../lib/entries/rules";
import { parseSettings } from "../lib/settings";
import {
  applyLiveMonthly,
  applyRecommended,
  applyRecommendedDaily,
} from "../lib/recommended";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  // ?type=daily starts a daily giveaway (draw on, daily recommended settings);
  // ?type=monthly the live monthly giveaway copied from GiveawayNinja.
  const type = new URL(request.url).searchParams.get("type");
  const daily = type === "daily";
  const monthly = type === "monthly";
  const blank: CampaignFormValues = {
    title: daily
      ? "Poke-Collect Daily Giveaway"
      : monthly
        ? "Poke-Collect 30th Celebration UPC Case Giveaway!"
        : "",
    prize: daily
      ? "A new sealed product or English single every day ($70 to $100 value)"
      : monthly
        ? "Sealed Case of 30th Celebration Ultra Premium Collections"
        : "",
    description: "",
    slug: daily ? "daily-giveaway" : monthly ? "monthly-giveaway" : "",
    startsAt: "",
    // Drawn November 1.
    endsAt: monthly ? "2026-10-31T23:59" : "",
    timezone: DEFAULT_TIMEZONE,
    imageUrl: null,
    removeImage: false,
    rulesText: "",
    actions: [newAction("SIGNUP"), newAction("REFERRAL")],
    // 1 entry per $1 of subtotal, as before.
    rules: rulesToForm(purchaseRulesSchema.parse({}), DEFAULT_TIMEZONE),
    settings: parseSettings(null),
    resources: {},
  };
  const initial = daily
    ? applyRecommendedDaily(blank)
    : monthly
      ? applyLiveMonthly(blank)
      : applyRecommended(blank);
  // A first draft of the official rules, so a new giveaway can go live without that step.
  initial.rulesText = generateOfficialRules(initial);
  return { initial, daily };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const parsed = await readCampaignForm(await request.formData());
  if ("error" in parsed) return { error: parsed.error };
  const { data, image } = parsed;
  if (await slugTaken(session.shop, data.slug)) {
    return { error: `A giveaway with the link "${data.slug}" already exists.` };
  }

  const campaign = await createCampaign(session.shop, data, image);
  await db.auditLog.create({
    data: {
      shop: session.shop,
      action: "campaign.create",
      target: campaign.id,
    },
  });
  return redirect(`/app/campaigns/${campaign.id}`);
};

export default function NewCampaign() {
  const { initial, daily } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const saving = useNavigation().state === "submitting";

  return (
    <s-page heading={daily ? "New daily giveaway" : "New giveaway"}>
      <CampaignForm
        initial={initial}
        submitLabel="Create giveaway"
        saving={saving}
        error={result?.error}
      />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
