import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { countryCode, provinceCode, splitName } from "./address";
import type { ClaimData } from "./winners";

// Daily prizes: once the winner confirms their shipping details, a $0 paid order for the
// prize is created in Shopify so it ships through the normal fulfillment list. The unit is
// already reserved for the prize, so the order leaves inventory alone (BYPASS); "Mark Sent"
// still removes the reserved unit, as before.

const ORDER_CREATE = `#graphql
  mutation PrizeOrder($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
    orderCreate(order: $order, options: $options) {
      order { id name }
      userErrors { field message }
    }
  }`;

const SHOP_CURRENCY = `#graphql
  query { shop { currencyCode } }`;

/** The orderCreate input for a claimed daily prize (pure, so it can be tested). */
export function prizeOrderInput(opts: {
  email: string;
  claim: ClaimData;
  variantId: string;
  prizeTitle: string;
  giveawayTitle: string;
  drawDate: string;
  currencyCode: string;
}) {
  const c = opts.claim;
  const country = countryCode(c.country);
  const province = provinceCode(c.province, country);
  const address = [
    c.name,
    c.address1,
    c.address2,
    [c.city, c.province, c.zip].filter(Boolean).join(" "),
    c.country,
    c.phone,
  ]
    .filter(Boolean)
    .join(", ");
  return {
    email: opts.email,
    financialStatus: "PAID",
    tags: ["Giveaway Prize"],
    note: `Daily giveaway prize (${opts.prizeTitle}) from ${opts.giveawayTitle}, draw ${opts.drawDate}. Ship to: ${address}`,
    lineItems: [
      {
        variantId: opts.variantId,
        quantity: 1,
        // orderCreate defaults this to false, which makes the order "Shipping not required"
        // and blocks shipping labels.
        requiresShipping: true,
        priceSet: {
          shopMoney: { amount: "0.00", currencyCode: opts.currencyCode },
        },
      },
    ],
    shippingLines: [
      {
        title: "Giveaway Prize Shipping",
        priceSet: {
          shopMoney: { amount: "0.00", currencyCode: opts.currencyCode },
        },
      },
    ],
    shippingAddress: {
      ...splitName(c.name),
      address1: c.address1,
      address2: c.address2 || undefined,
      city: c.city,
      zip: c.zip,
      phone: c.phone,
      ...(country ? { countryCode: country } : {}),
      ...(province ? { provinceCode: province } : {}),
    },
  };
}

/**
 * Creates the $0 order for a claimed daily prize, once. Returns the order name, or null
 * when the winner hasn't claimed or the prize isn't a daily product prize.
 */
export async function createPrizeOrder(
  winnerId: string,
  admin?: AdminApiContext,
) {
  const winner = await db.winner.findUnique({
    where: { id: winnerId },
    include: {
      entrant: { select: { email: true } },
      draw: { include: { campaign: true, dailyPrize: true } },
    },
  });
  const prize = winner?.draw.dailyPrize;
  if (!winner || !prize || winner.forfeited || !winner.claimedAt) return null;
  if (winner.prizeOrderName) return winner.prizeOrderName;
  const claim = winner.claimData as ClaimData | null;
  if (!claim) return null;

  const api =
    admin ?? (await unauthenticated.admin(winner.draw.campaign.shop)).admin;
  const shop = await (await api.graphql(SHOP_CURRENCY)).json();
  const currencyCode = shop.data?.shop?.currencyCode ?? "USD";
  const res = await api.graphql(ORDER_CREATE, {
    variables: {
      order: prizeOrderInput({
        email: winner.entrant.email,
        claim,
        variantId: prize.variantId,
        prizeTitle: prize.title,
        giveawayTitle: winner.draw.campaign.title,
        drawDate: prize.periodKey,
        currencyCode,
      }),
      options: {
        inventoryBehaviour: "BYPASS",
        sendReceipt: false,
        sendFulfillmentReceipt: false,
      },
    },
  });
  const json = (await res.json()) as {
    data?: {
      orderCreate?: {
        order: { id: string; name: string } | null;
        userErrors: { message: string }[];
      };
    };
    errors?: unknown;
  };
  const out = json.data?.orderCreate;
  if (json.errors || !out?.order)
    throw new Error(
      out?.userErrors.map((e) => e.message).join("; ") ||
        `Shopify GraphQL error: ${JSON.stringify(json.errors)}`,
    );
  await db.winner.update({
    where: { id: winner.id },
    data: { prizeOrderId: out.order.id, prizeOrderName: out.order.name },
  });
  return out.order.name;
}
