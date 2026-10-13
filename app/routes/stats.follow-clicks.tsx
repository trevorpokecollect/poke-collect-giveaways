import { createHash, timingSafeEqual } from "node:crypto";
import type { LoaderFunctionArgs } from "react-router";
import { parseDays } from "../lib/follow-clicks";
import { followClickStats } from "../lib/follow-clicks.server";

// Read-only follow-button click counts for the weekly ad report (no Shopify login).
//
//   GET /stats/follow-clicks?days=14&key=<FOLLOW_STATS_KEY>[&shop=<x.myshopify.com>][&giveaway=<link name>]
//
// Returns [{ date, giveaway, platform, clicks, shop }], newest first. Dates are Central Time.
// The key can also be sent as "Authorization: Bearer <key>".

function keyMatches(given: string) {
  const expected = process.env.FOLLOW_STATS_KEY;
  if (!expected || !given) return false;
  // Hash both so the comparison is constant-time whatever the lengths.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const q = new URL(request.url).searchParams;
  const auth = request.headers.get("Authorization") ?? "";
  const given = q.get("key") ?? auth.replace(/^Bearer\s+/i, "");
  if (!keyMatches(given))
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  const rows = await followClickStats({
    days: parseDays(q.get("days")),
    shop: q.get("shop"),
    giveaway: q.get("giveaway"),
  });
  return Response.json(rows, { headers: { "Cache-Control": "no-store" } });
};
