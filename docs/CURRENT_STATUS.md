# CURRENT_STATUS — snapshot (update after every session)

_Last updated: 2026-10-13 ~15:10Z · code @ `8af9e1e` (docs @ `ec24403`+) · Shopify app version **poke-collect-giveaways-26** · Railway
deployed `8af9e1e` (SUCCESS)._

## Live now (poke-collect.com)
- **Daily giveaway** "Poke-Collect Daily Giveaway", link name `daily-giveaway`, live since 2026-10-12 ~15:44Z, no end
  date. Draw 9:00pm ET nightly. Entry amounts copied from GiveawayNinja: sign-up 1 (name + email opt-in required),
  Whatnot follow +100 (required), Text Alerts +100 (optional), Discord +50, Bookmark Our Next Live Show +20/day
  (Whatnot invite URL), Facebook +10, Instagram +10, Refer A Friend +25, purchases 50 per $10 of subtotal (order-channel setting unverified — check the editor).
- Draw #1 (10-12): winner Steven I. — Japanese Storm Emeralda Booster Box (status should be DRAWN until Trevor marks Sent).
- Today (10-13): Pokémon 30th Celebration Elite Trainer Box. Queue: 10-14 Japanese 30th Celebration Booster Box,
  10-15 Pokémon 30th Celebration Booster Bundle (Trevor's picks, above the $70–$100 rule — queue ignores rules).
- Popup app embed (auto-open off; phone header gift icon; product + cart drawer entry lines), hosted page
  `/apps/giveaways/daily-giveaway`. "Popular Picks" manual collection (handle `popular-picks`, 10 products) created for
  Shop & Earn; daily currently shows 6 Shop & Earn products with Shop Now → `/collections/all`.
- **Monthly**: still on GiveawayNinja (/pages/monthly-giveaway, "30th Celebration UPC Case", draw Nov 1). The app has a
  one-click preset `New monthly (GiveawayNinja setup)` (`/app/campaigns/new?type=monthly`), not yet created/migrated.

## Recently completed (10-12 → 10-13)
Prize queue + Upcoming Prizes; safety stock prizes; per-draw analytics + date ranges (**Analytics page only** — the
giveaway page tabs have just a "Current draw / All time" toggle for Entries By Method and New Sign-Ups); daily rules wording;
Turnstile/honeypot false-block fixes; pre-start order cleanup; entries-by-method, activity feed, disqualify entry/entrant;
new-vs-existing sign-ups; tabs UI; mobile sheet/header icon; Title Case; theme `.pcg` collision fixes.

## Follow button click counts (live 2026-10-13: Railway `7dc1a48`, Shopify **poke-collect-giveaway-27**)
Trevor's weekly ad report uses "Follow On Whatnot" clicks as a stand-in for Whatnot sign-ups. The widget sends a
fire-and-forget beacon (`navigator.sendBeacon`, fetch keepalive fallback) to `/apps/giveaways/follow-click` after the
link opens, once per button per browser per day. `proxy.follow-click.tsx` → `recordFollowClick` (`app/lib/follow-clicks*.ts`)
works out the platform from the action's own URL on the server, rate-limits 10/hour per hashed IP per giveaway+platform
(RateLimitHit), and upserts `FollowClickDay` {shop, date (America/Chicago), giveaway slug, platform, clicks}. No personal
data or IPs in that table. Report endpoint `GET /stats/follow-clicks?days=14&key=<FOLLOW_STATS_KEY>[&shop=][&giveaway=]`
(no Shopify login) returns `[{date, giveaway, platform, clicks, shop}]`, newest first. Admin Analytics page shows a
"Follow Button Clicks (Last 14 Days)" table. Clicks before sign-up don't count (the button doesn't open the link then).
`FOLLOW_STATS_KEY` is set in Railway (random; Trevor reads it there, never paste it in chat). Trevor's weekly report uses
`?days=7&key=…&shop=poke-collect-al.myshopify.com`. CI `lint` is red on main from the thank-you extension (pre-existing;
fix proposed on PR #8).

## Daily re-entry fix (branch `claude/giveaway-bug-fixes-v8bwqr`, awaiting "deploy": Railway, then Shopify)
Bug (Trevor 10-13): anyone who signed up on an earlier day had no way into today's draw (the sign-up entry only
counts on the day it was earned; only Bookmark and purchases repeat). Fix: `enterToday()` (`signup.server.ts`) gives the
sign-up entries once per daily period (dedupe `signup:<entrantId>:<periodKey>`, skipped if any `signup:<id>…` event is
already in today's window). Called by the new POST intent `enter-today` (widget button **Enter Today's Giveaway**, shown
when `daily.enteredToday === false`) and after a returning entrant confirms their email code. The popup treats
`enteredToday` as "entered". Linked monthly is unaffected. Test: `test/daily-reenter.integration.test.ts`.
Deploy Railway first (the widget only shows the button when the server sends `enteredToday`).

## Open items / next steps
1. **Add a daily repeatable task** (e.g. Daily Check-In) so returning players can earn entries each day — Trevor: "we'll
   add one when my credits reset" (10-13). Today only Bookmark (+20/day) and purchases repeat.
2. **Regenerate the daily giveaway's Official Rules** in the editor (button) so the saved text uses the new daily-drawing
   wording (`fea166d` changed the generator only). Unverified whether Trevor did this.
3. **Monthly cutover from GiveawayNinja** (live page /pages/monthly-giveaway, GN embed data-id `6abe956be8561616e8f7f773`,
   ends Oct 31 11:59pm ET, draw Nov 1): create from preset as **draft** → import GN CSV (`$id_.import`; re-import tops up
   deltas) → swap the widget on the page → go live → final top-up import → link daily↔monthly (`linkedSlug`).
   **Don't backfill pre-switch orders.** Don't touch the live page or theme without Trevor's OK. GN script still loads
   site-wide. (Cloud project memory "live-cutover-monthly" has the plan.)
4. **Debug checks**: cloud routine "Giveaway Debug Check" (8:54am ET daily, through 10-19, self-deletes) is the main one.
   The Mac task `giveaway-daily-debug-check` (~9:38pm ET) got stuck on permission prompts; recommended Trevor delete it
   (his decision pending).
5. Ran "Remove entries from orders placed before the start"? Unverified; order #252736 (placed 07-22) had been scored.
6. **Staff Guide** not yet updated for giveaways (memory rule says it must be).
7. Recommend rotating the Turnstile secret (it was pasted in chat on 10-12). Unverified if done.
8. Promised, not built: $0 draft order when a winner claims (for now ship manually + "Mark Sent"). Trevor reported it missing 10-13.
9. Safety-stock prize moves are untested on the live store until the first such pick — check logs that night.
10. Imports and manual adjustments on a daily giveaway count in the day they're added.
11. Later/deferred: Discord OAuth join verification; merging giveaway/Collector Coins/chat launchers; Near Mint-only
   filter for singles (auto-pick can choose any condition variant in range); Prisma 8 upgrade (ignore banner for now).

## Warnings
- Repo is public. Shopify connector is on the LIVE store. Changing scopes requires re-approval in each store.
- Hosted page needs Railway deploy for widget changes; popup/blocks need Shopify deploy.
- DST ends 2026-11-01: draw time stays 9pm ET (logic uses timezone; tested in `test/daily.test.ts`).
