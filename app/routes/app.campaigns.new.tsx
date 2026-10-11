import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, redirect, useActionData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { ActionType } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { purchaseRulesSchema } from "../lib/entries/rules";
import { DEFAULT_RISK_POLICY } from "../lib/bot/risk";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const get = (k: string) => String(form.get(k) ?? "").trim();

  const title = get("title");
  if (!title) return { error: "Give the giveaway a title." };
  const slug = slugify(get("slug") || title);
  if (
    await db.campaign.findUnique({
      where: { shop_slug: { shop: session.shop, slug } },
    })
  ) {
    return { error: `A giveaway with the link "${slug}" already exists.` };
  }

  const perDollar = Number(get("entriesPerDollar") || 0);
  const actions: {
    type: ActionType;
    label: string;
    entries: number;
    config?: object;
  }[] = [
    {
      type: "SIGNUP",
      label: "Enter the giveaway",
      entries: Number(get("signupEntries") || 1),
    },
  ];
  if (form.get("referral"))
    actions.push({
      type: "REFERRAL",
      label: "Refer a friend",
      entries: Number(get("referralEntries") || 5),
    });
  if (form.get("daily"))
    actions.push({
      type: "DAILY_CHECKIN",
      label: "Daily check-in",
      entries: 1,
    });
  if (get("instagram"))
    actions.push({
      type: "SOCIAL_FOLLOW",
      label: "Follow us on Instagram",
      entries: 2,
      config: { url: get("instagram") },
    });
  if (get("tiktok"))
    actions.push({
      type: "SOCIAL_FOLLOW",
      label: "Follow us on TikTok",
      entries: 2,
      config: { url: get("tiktok") },
    });
  if (get("secretCode"))
    actions.push({
      type: "SECRET_CODE",
      label: "Enter the secret code",
      entries: 5,
      config: { code: get("secretCode") },
    });

  const campaign = await db.campaign.create({
    data: {
      shop: session.shop,
      slug,
      title,
      prize: get("prize") || null,
      description: get("description") || null,
      imageUrl: get("imageUrl") || null,
      startsAt: get("startsAt") ? new Date(get("startsAt")) : null,
      endsAt: get("endsAt") ? new Date(get("endsAt")) : null,
      purchaseRules:
        perDollar > 0
          ? purchaseRulesSchema.parse({
              base: {
                mode: "per_amount",
                entries: perDollar,
                amount: 1,
                basis: "subtotal",
              },
            })
          : undefined,
      riskPolicy: DEFAULT_RISK_POLICY as object,
      actions: { create: actions.map((a, i) => ({ ...a, sortOrder: i })) },
    },
  });
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
  const result = useActionData<typeof action>();
  const saving = useNavigation().state === "submitting";

  return (
    <s-page heading="New giveaway">
      <Form method="post">
        <s-stack gap="base">
          {result?.error && <s-banner tone="critical">{result.error}</s-banner>}

          <s-section heading="Basics">
            <s-stack gap="base">
              <s-text-field
                name="title"
                label="Title"
                placeholder="Win a Prismatic Evolutions Booster Box"
                required
              />
              <s-text-field
                name="prize"
                label="Prize"
                placeholder="1x sealed booster box"
              />
              <s-text-area name="description" label="Description" rows={3} />
              <s-url-field name="imageUrl" label="Prize image URL" />
              <s-text-field
                name="slug"
                label="Link name"
                details="Used in the giveaway URL. Leave blank to use the title."
              />
              <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <s-text-field
                  name="startsAt"
                  label="Starts"
                  placeholder="2026-11-01T09:00"
                />
                <s-text-field
                  name="endsAt"
                  label="Ends"
                  placeholder="2026-11-30T23:59"
                />
              </s-grid>
            </s-stack>
          </s-section>

          <s-section heading="Ways to enter">
            <s-stack gap="base">
              <s-number-field
                name="signupEntries"
                label="Entries for signing up"
                value="1"
                min={0}
              />
              <s-checkbox
                name="referral"
                label="Refer a friend"
                defaultChecked
              />
              <s-number-field
                name="referralEntries"
                label="Entries per verified referral"
                value="5"
                min={0}
              />
              <s-checkbox
                name="daily"
                label="Daily check-in (1 entry per day)"
              />
              <s-url-field
                name="instagram"
                label="Instagram profile (optional)"
              />
              <s-url-field name="tiktok" label="TikTok profile (optional)" />
              <s-text-field
                name="secretCode"
                label="Secret code (optional)"
                details="Share it on a live show or in an email for bonus entries."
              />
            </s-stack>
          </s-section>

          <s-section heading="Purchases">
            <s-number-field
              name="entriesPerDollar"
              label="Entries per $1 spent"
              value="1"
              min={0}
              details="Set to 0 to turn off purchase entries. Product, bundle and booster rules can be added after creating the giveaway."
            />
          </s-section>

          <s-section heading="Bot protection">
            <s-paragraph>
              On by default: Cloudflare Turnstile, email verification codes,
              disposable and alias email checks, IP, subnet and device limits,
              and referral fraud checks. Suspicious entries are held for your
              review automatically.
            </s-paragraph>
          </s-section>

          <s-button
            type="submit"
            variant="primary"
            {...(saving ? { loading: true } : {})}
          >
            Create giveaway
          </s-button>
        </s-stack>
      </Form>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
