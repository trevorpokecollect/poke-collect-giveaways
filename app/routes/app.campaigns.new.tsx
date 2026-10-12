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
import { applyRecommended } from "../lib/recommended";

// Poke-Collect's preferred starting point for a new giveaway; everything stays editable.
const follow = (label: string, url: string) => ({
  ...newAction("SOCIAL_FOLLOW"),
  label,
  entries: 3,
  config: { url },
});

const defaultActions = () => [
  newAction("SIGNUP"),
  newAction("REFERRAL"),
  newAction("DAILY_CHECKIN"),
  follow(
    "Follow @pokecollectcards on Instagram",
    "https://www.instagram.com/pokecollectcards/",
  ),
  follow("Subscribe on YouTube", "https://www.youtube.com/@pokecollectcards"),
  follow("Follow us on Whatnot", "https://whatnot.com/invite/pokecollectcards"),
  newAction("SOCIAL_SHARE"),
  newAction("ALTERNATE_ENTRY"),
];

const defaultSettings = () => {
  const s = parseSettings(null);
  return {
    ...s,
    consolation: {
      ...s.consolation,
      enabled: true,
      daysValid: 7,
      minEntries: 2,
    },
    showLeaderboard: true,
  };
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const initial: CampaignFormValues = applyRecommended({
    title: "",
    prize: "",
    description: "",
    slug: "",
    startsAt: "",
    endsAt: "",
    timezone: DEFAULT_TIMEZONE,
    imageUrl: null,
    removeImage: false,
    rulesText: "",
    actions: defaultActions(),
    // 1 entry per $1 of subtotal (no shipping, tax or gift cards), online orders only.
    rules: rulesToForm(
      purchaseRulesSchema.parse({ orderSource: "online" }),
      DEFAULT_TIMEZONE,
    ),
    settings: defaultSettings(),
    resources: {},
  });
  return { initial };
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
  const { initial } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const saving = useNavigation().state === "submitting";

  return (
    <s-page heading="New giveaway">
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
