import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useState } from "react";
import { Form, redirect, useActionData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { ActionType } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { purchaseRulesSchema } from "../lib/entries/rules";
import { DEFAULT_RISK_POLICY } from "../lib/bot/risk";
import { slugify } from "../lib/slug";
import { parseLocalDateTime } from "../lib/time";

const TIMEZONE = "America/New_York";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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

  // Prize image: stored in the app database and served from /images/<id>.
  const file = form.get("image");
  let imageUrl: string | null = null;
  if (file instanceof File && file.size > 0) {
    if (!IMAGE_TYPES.includes(file.type)) {
      return { error: "The prize image must be a PNG, JPG, WebP or GIF." };
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return { error: "The prize image must be 5 MB or smaller." };
    }
    const image = await db.campaignImage.create({
      data: {
        shop: session.shop,
        contentType: file.type,
        data: Buffer.from(await file.arrayBuffer()),
      },
    });
    imageUrl = `${process.env.SHOPIFY_APP_URL}/images/${image.id}`;
  }

  const startsAt = parseLocalDateTime(get("startsAt"), TIMEZONE);
  const endsAt = parseLocalDateTime(get("endsAt"), TIMEZONE);
  if (startsAt === null || endsAt === null) {
    return { error: "Pick the start and end dates with the date pickers." };
  }
  if (startsAt && endsAt && endsAt <= startsAt) {
    return { error: "The end date must be after the start date." };
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
      imageUrl,
      startsAt: startsAt ?? null,
      endsAt: endsAt ?? null,
      timezone: TIMEZONE,
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
  const [preview, setPreview] = useState<string | null>(null);

  return (
    <s-page heading="New giveaway">
      <Form method="post" encType="multipart/form-data">
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
              <s-stack gap="small-200">
                <s-text>Prize image</s-text>
                <input
                  type="file"
                  name="image"
                  accept={IMAGE_TYPES.join(",")}
                  onChange={(e) => {
                    const f = e.currentTarget.files?.[0];
                    setPreview(f ? URL.createObjectURL(f) : null);
                  }}
                />
                {preview && (
                  <img
                    src={preview}
                    alt="Prize preview"
                    style={{ maxWidth: 240, borderRadius: 8 }}
                  />
                )}
                <s-text color="subdued">
                  PNG, JPG, WebP or GIF, up to 5 MB.
                </s-text>
              </s-stack>
              <s-text-field
                name="slug"
                label="Link name"
                details="Used in the giveaway URL. Leave blank to use the title."
              />
              <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <label className="pcg-field">
                  <s-text>Starts (Eastern time)</s-text>
                  <input type="datetime-local" name="startsAt" />
                </label>
                <label className="pcg-field">
                  <s-text>Ends (Eastern time)</s-text>
                  <input type="datetime-local" name="endsAt" />
                </label>
              </s-grid>
              <s-text color="subdued">
                Leave Starts blank to open as soon as you click Go live.
              </s-text>
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
