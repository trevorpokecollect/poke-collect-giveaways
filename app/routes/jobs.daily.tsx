import type { ActionFunctionArgs } from "react-router";
import { tickDaily } from "../lib/daily.server";

// Runs the daily draw jobs on demand (the app also runs them itself every minute).
// curl -X POST -H "Authorization: Bearer $CRON_SECRET" $SHOPIFY_APP_URL/jobs/daily
export const action = async ({ request }: ActionFunctionArgs) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("Authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await tickDaily();
  return Response.json(result ?? { skipped: "already running" });
};
