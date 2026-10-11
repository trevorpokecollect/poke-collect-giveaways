import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  processOrder,
  type OrderWebhookPayload,
} from "../lib/entries/orders.server";

// Handles orders/create, orders/updated (including order edits) and orders/cancelled.
// processOrder is idempotent, so Shopify's retries and duplicate deliveries are safe.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  await processOrder(shop, payload as OrderWebhookPayload, {
    cancelled: topic === "ORDERS_CANCELLED",
  });
  return new Response();
};
