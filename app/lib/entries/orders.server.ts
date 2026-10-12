import { randomBytes } from "node:crypto";
import type { Campaign } from "@prisma/client";
import db from "../../db.server";
import { normalizeEmail } from "../bot/email";
import { award } from "./ledger.server";
import { emitWebhook } from "../webhook-out.server";
import { purchaseRulesSchema, scoreOrder, type ScorableOrder } from "./rules";

/** Subset of the Shopify `orders/*` webhook payload that we use. */
export interface OrderWebhookPayload {
  id: number | string;
  name?: string;
  email?: string | null;
  contact_email?: string | null;
  created_at: string;
  cancelled_at?: string | null;
  source_name?: string;
  subtotal_price?: string;
  total_price?: string;
  payment_gateway_names?: string[];
  customer?: {
    id?: number | string;
    first_name?: string | null;
    last_name?: string | null;
  } | null;
  billing_address?: {
    first_name?: string | null;
    last_name?: string | null;
  } | null;
  line_items: {
    product_id: number | string | null;
    variant_id: number | string | null;
    quantity: number;
    current_quantity?: number;
    price: string;
  }[];
}

/** The buyer's name from the order (customer, else billing address), for winner display. */
export function orderBuyerName(p: OrderWebhookPayload) {
  for (const n of [p.customer, p.billing_address]) {
    const full = [n?.first_name, n?.last_name]
      .map((x) => x?.trim())
      .filter(Boolean)
      .join(" ");
    if (full) return full;
  }
  return null;
}

const gid = (type: string, id: number | string | null) =>
  id ? `gid://shopify/${type}/${id}` : "";

export function toScorableOrder(p: OrderWebhookPayload): ScorableOrder {
  return {
    createdAt: new Date(p.created_at),
    sourceName: p.source_name ?? "web",
    subtotal: Number(p.subtotal_price ?? 0),
    total: Number(p.total_price ?? 0),
    // The webhook doesn't itemize gift card amounts; refine via the Admin API if needed.
    giftCardAmount: 0,
    lines: p.line_items.map((l) => ({
      productId: gid("Product", l.product_id),
      variantId: gid("ProductVariant", l.variant_id),
      quantity: l.current_quantity ?? l.quantity,
      unitPrice: Number(l.price),
    })),
  };
}

async function liveCampaigns(shop: string, at: Date) {
  const campaigns = await db.campaign.findMany({
    where: { shop, status: "ACTIVE" },
  });
  return campaigns.filter(
    (c) =>
      c.purchaseRules &&
      (!c.startsAt || c.startsAt <= at) &&
      (!c.endsAt || c.endsAt >= at),
  );
}

async function netOrderEntries(orderLogId: string) {
  const { _sum } = await db.entryEvent.aggregate({
    where: { orderLogId },
    _sum: { entries: true },
  });
  return _sum.entries ?? 0;
}

async function findOrCreateEntrant(
  campaign: Campaign,
  email: string,
  customerId: string | null,
  auto: boolean,
  name: string | null,
) {
  const emailNormalized = normalizeEmail(email);
  const existing = await db.entrant.findUnique({
    where: {
      campaignId_emailNormalized: { campaignId: campaign.id, emailNormalized },
    },
  });
  // Buyers who signed up without a name get the one from their order.
  if (existing && !existing.name?.trim() && name)
    return db.entrant.update({ where: { id: existing.id }, data: { name } });
  if (existing || !auto) return existing;
  // A paid order is strong proof of a real person, so these start ACTIVE.
  const created = await db.entrant.create({
    data: {
      campaignId: campaign.id,
      email,
      emailNormalized,
      name,
      shopifyCustomerId: customerId,
      status: "ACTIVE",
      verifiedAt: new Date(),
      referralCode: randomBytes(5).toString("base64url"),
    },
  });
  emitWebhook(campaign.id, "entrant.created", {
    entrantId: created.id,
    status: "ACTIVE",
  });
  return created;
}

/** Handles orders/create, orders/updated (edits) and orders/cancelled. Idempotent. */
export async function processOrder(
  shop: string,
  payload: OrderWebhookPayload,
  opts: { cancelled?: boolean } = {},
) {
  const order = toScorableOrder(payload);
  const email = payload.email || payload.contact_email;
  const shopifyOrderId = String(payload.id);
  const cancelled = opts.cancelled || !!payload.cancelled_at;

  for (const campaign of await liveCampaigns(shop, order.createdAt)) {
    const parsed = purchaseRulesSchema.safeParse(campaign.purchaseRules);
    if (!parsed.success) continue;
    const rules = parsed.data;
    const log = await db.orderLog.findUnique({
      where: {
        campaignId_shopifyOrderId: { campaignId: campaign.id, shopifyOrderId },
      },
    });

    const entrant = email
      ? await findOrCreateEntrant(
          campaign,
          email,
          payload.customer?.id ? gid("Customer", payload.customer.id) : null,
          rules.autoSignupFromOrders && !cancelled,
          orderBuyerName(payload),
        )
      : null;

    if (!entrant) {
      if (!log) {
        await db.orderLog.create({
          data: {
            campaignId: campaign.id,
            shopifyOrderId,
            orderName: payload.name,
            email,
            status: "NO_USER",
          },
        });
      }
      continue;
    }

    const breakdown = cancelled ? null : scoreOrder(rules, order);
    const target = breakdown?.entries ?? 0;
    const orderLog =
      log ??
      (await db.orderLog.create({
        data: {
          campaignId: campaign.id,
          shopifyOrderId,
          orderName: payload.name,
          email,
          status: "NO_ENTRIES",
        },
      }));

    // Bring the ledger for this order to exactly `target` entries.
    const current = await netOrderEntries(orderLog.id);
    const delta = target - current;
    if (delta !== 0) {
      await award({
        campaignId: campaign.id,
        entrantId: entrant.id,
        entries: delta,
        source: delta > 0 && current === 0 ? "PURCHASE" : "ROLLBACK",
        orderLogId: orderLog.id,
        note: cancelled
          ? "order cancelled"
          : current === 0
            ? undefined
            : "order edited",
      });
      emitWebhook(campaign.id, "purchase.entries", {
        entrantId: entrant.id,
        orderId: shopifyOrderId,
        orderName: payload.name,
        entries: delta,
      });
    }

    await db.orderLog.update({
      where: { id: orderLog.id },
      data: {
        entries: target,
        // Order amounts ride along so analytics can report revenue.
        breakdown: (breakdown
          ? { ...breakdown, subtotal: order.subtotal, total: order.total }
          : { reason: "cancelled" }) as object,
        status: cancelled
          ? "ROLLED_BACK_CANCELLED"
          : current > 0 && delta !== 0
            ? "ROLLED_BACK_EDIT"
            : target > 0
              ? "ENTRIES"
              : "NO_ENTRIES",
      },
    });
  }
}
