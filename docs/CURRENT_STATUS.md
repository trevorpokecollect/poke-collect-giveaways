# CURRENT_STATUS — snapshot (update after every session)

_Last updated: 2026-10-13 ~18:40Z · code @ `3bfd44f` (docs @ `ec24403`+) · Shopify app version **poke-collect-giveaways-26** · Railway
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

## Daily re-entry fix (live 2026-10-13: Railway `615ef46`, Shopify deploy run by Trevor)
Bug (Trevor 10-13): anyone who signed up on an earlier day had no way into today's draw (the sign-up entry only
counts on the day it was earned; only Bookmark and purchases repeat). Fix: `enterToday()` (`signup.server.ts`) gives the
sign-up entries once per daily period (dedupe `signup:<entrantId>:<periodKey>`, skipped if any `signup:<id>…` event is
already in today's window). Called by the new POST intent `enter-today` (widget button **Enter Today's Giveaway**, shown
when `daily.enteredToday === false`) and after a returning entrant confirms their email code. The popup treats
`enteredToday` as "entered". Linked monthly is unaffected. Test: `test/daily-reenter.integration.test.ts`.

## Winner prize order (live 2026-10-13: Railway `3bfd44f` with SCOPES += write_orders; Shopify deploy + store approvals done by Trevor)
Trevor picked "when they claim" (10-13). When a daily winner submits the claim form, `createPrizeOrder`
(`app/lib/prize-order.server.ts`) creates a $0 PAID Shopify order for the prize variant (`orderCreate`, tag "Giveaway
Prize", shipping address from the claim; `app/lib/address.ts` maps typed country/state to codes; full address also in the
note; no receipt email). Inventory BYPASS because the unit is already reserved; "Mark Sent" still removes it. Saved on
`Winner.prizeOrderId/prizeOrderName` (migration `20261013190000_winner_prize_order`). Failure never blocks the claim
(logged `[claim] prize order failed`); the Draws section shows "Order #…" or a **Create Order** button (intent
`prizeOrder`, also for winners who claimed before this). Monthly winners get no order. Needs scope `write_orders`:
Shopify deploy, Trevor approves in each store, add `write_orders` to Railway `SCOPES`. Tests: `prize-order.integration`,
`address`.

## Entry warnings review (live 2026-10-13: Railway `de47854`; also fixed the red CI lint step)
Trevor's CSV (892 daily entrants): 151 carry a signal (turnstile_missing 88, honeypot 45, generated_email 35, ip_burst 1,
duplicate_email_alias 1); 147 verified their email code and behave like unflagged entrants (consent, phone, tasks). No
blocks logged since the honeypot fix (8af9e1e). One entrant HELD at score 55 from three weak signals (Trevor to approve).
Changes: `riskTone(score, status)` shows weak signals on ACTIVE (verified) entrants in grey; sign-up refuses known
provider typos (`suggestEmail` in `bot/email.ts`, e.g. gmail.con, any ".con") with "Did you mean …?".

## Bug check fixes (live 2026-10-14 03:16Z: Railway `2ab2615`, PR #13)
From the 10-13 Mac bug check (report: project file giveaway-bug-check-2026-10-13.md). Needs Trevor's "deploy" (Railway only;
no widget or Shopify changes).
- **Turnstile errors no longer block**: only `invalid-input-response` is `turnstile_failed`; network errors, a missing
  secret or Cloudflare internal errors are `turnstile_missing` → email code (`turnstileSignal` in `bot/risk.ts`).
- **Daily Forfeit And Redraw**: replacement drawn from that day's `dayTickets` (minus everyone in the draw and recent
  winners) and added to the SAME Draw (`redrawDailyWinner`), so the email, claim page and $0 order use the day's
  product. Claim page now shows the daily prize title/image.
- **One prize per day**: `ensurePrize` re-checks and creates under `pg_advisory_xact_lock` per campaign+day; a losing
  racer reserves nothing (scheduler returns the existing prize; Pick/Swap say "Today's prize just changed").
- **Railway health check**: `railway.json` → `/healthz` (`app/routes/healthz.tsx`), so deploys stop 502ing customers.
- Tests: `daily-redraw.integration`, `daily-prize-once.integration`, `bot.test` (186 total). Integration tests assume the
  database session timezone is UTC (Railway's default); set it locally (`ALTER DATABASE … SET timezone='UTC'`).
- Still open from that report: Release on a DRAWN prize, purchase-entry webhook race, void after rollback, $0 order
  idempotency, prize value in storefront JSON, `restoreEvent` hard delete, rate-limit pruning.
## Daily Tasks (live 2026-10-13: Railway `237ae38`, Shopify **poke-collect-giveaways-30**; plan: `docs/DAILY_TASKS_PLAN.md`)
Trevor's spec 10-13. A "Daily Tasks" section under the follow buttons: locked ("Complete All 4 Social Tasks To Unlock
Daily Entries!", progress bar) until every one-time follow task is done (Whatnot, Discord, Facebook, Instagram; texts
never count), then each task is claimable once per task day, with a "Resets In …" countdown and "Done Today. Back In …".
- Any VISIT_URL / DAILY_CHECKIN / WATCH_VIDEO / SECRET_CODE task can be ticked **Daily Task** in the editor. Extras:
  rotating links (one per day), a claim button for off-site tasks ("I Liked & Commented": opens the link, claim allowed
  5s later, honor system, rules say so), a weekly Central-time window (e.g. Fri 17:00–20:00) shown only while open, a
  "live show button" style (🔴 LIVE ON WHATNOT — JOIN NOW) and a **Turned off** switch for canceled shows.
- Reset: setting `dailyTasks.resetAt`, default **"draw"** (9pm ET, once per daily drawing; keys = draw day, so the
  old repeatable Bookmark claims carry over). "midnight" = midnight Central (`ct-YYYY-MM-DD` keys). Trevor chose
  **draw** (10-13) for a smooth hand-off to the next day's giveaway.
- Scheduled tasks dedupe per window (`win-YYYY-MM-DD`). Everything is checked on the server; completion records are
  the ledger rows (dedupe key = task + entrant + day/window, unique per giveaway). `award()` now returns false instead
  of erroring when two identical claims race (P2002, outside transactions).
- Referral box: link + Copy only (X / Facebook / WhatsApp share buttons removed). Referral tracking untouched.
- Official Rules generator: daily tasks wording (unlock, once per day/show, not verified) + release of Instagram,
  Facebook, Whatnot.
- No migration. Tests: `daily-tasks.test.ts`, `daily-tasks.integration.test.ts`, campaign-form (203 total).
- **Still to do in the daily giveaway editor** (the section only appears once a task is ticked Daily Task): tick Daily Task on "Bookmark Our
  Next Show" (+20); add Visit A Page "Like & Comment On Instagram" (+5, post link(s), claim button "I Liked &
  Commented"); add Visit A Page "Join Our Live Whatnot Show" (+50, Whatnot link, Daily Task, Only At Set Times Fri
  17:00–20:00, live show button); regenerate the Official Rules.
- **Newest Instagram post** (live 2026-10-13: Railway `d1b6945`; token set by Trevor 23:01Z; ticked on the live
  Instagram task): editor checkbox "Always open our newest
  Instagram post" (`config.latestInstagram`, VISIT_URL daily tasks). `app/lib/instagram.server.ts` asks the Instagram
  API (Instagram Login) for `/me/media?limit=1` permalink, cached 10 min (Trevor posts ~10:05am CT), falls back to the
  task's link. Needs Railway var `INSTAGRAM_ACCESS_TOKEN` (long-lived token for @pokecollectcards, Trevor pastes it;
  never in chat). The app refreshes it weekly and stores it in the new `AppValue` table (migration
  `20261013230000_app_value`). Test: `instagram.integration.test.ts`.
- Live store setup done 10-13: Bookmark Our Next Show (daily, +20), Join Our Live Whatnot Show (+50, Fri 17:00–20:00,
  live button, Whatnot invite link), Like & Comment On Instagram (+5, newest post via API, profile link as fallback,
  "I Liked & Commented"). Meta app "Poke-Collect Giveaways" (936934886163446), Instagram API use case, @pokecollectcards
  is its Instagram Tester. Lookup failures log `[instagram] newest post lookup failed`. Official
  Rules NOT yet regenerated (the Generate confirm popup can't be accepted from the Claude browser pane; Trevor to do).
- **iPhone outside links** (live 2026-10-13: Railway `6269242`, Shopify **poke-collect-giveaways-31**): on iOS, follow/daily-task/share links open in
  the same tab (`openExternal` in giveaway.js) because a new tab was left as about:blank when the app (Instagram,
  Whatnot, Discord) took over (Trevor, iPhone Chrome, 10-13). Claim requests use `keepalive` so they finish. Desktop
  and Android unchanged (new tab).
- Not verifiable: Instagram likes (no API), Whatnot live status/attendance (no public API). Possible later: verify
  Instagram comments via the Graph API with the entrant's IG handle.

## Shared-connection holds (live 2026-10-14 03:16Z: Railway `2ab2615`, PR #14)
10-13 ~7:38–8:02pm CT (pre-draw rush): 25 entrants HELD, almost all "ip burst, subnet burst" (35+20=55 ≥ hold 50).
They look like real people (varied real-looking emails, a phone number). Likely shared addresses (carrier NAT, iCloud
Private Relay); inferred, the production DB wasn't queried. Change: `ip_burst` 35→25 and `scoreSignals` drops
`subnet_burst` when `ip_burst` is present, so a busy connection alone (or with one weak signal) asks for an email code;
two other warning signs still hold. Already-held entrants need Approve in the Entrants tab (Needs Review filter).

## Admin Approve buttons (live 2026-10-14 ~03:25Z: Railway `ae5c28d`, PR #15)
`s-button-group` hid buttons without a slot (entrant list Approve/Disqualify) and primary buttons in
`secondary-actions` (selected tab/filter, expired winner's Forfeit and redraw). Replaced with inline `s-stack`; entrant
page has Approve Entrant for held/unverified. Used it to approve all 25 held entrants (Needs Review now 0).

## Bad email addresses no longer 500 (pushed 2026-10-14, NOT deployed: needs Trevor's "deploy", Railway only)
10-14 debug check: three sign-ups from one iPhone (10-13 22:19Z) got a 500 because Resend refused the address (422
"Invalid `to` field") after it passed our loose syntax check. `isValidEmailSyntax` (`bot/email.ts`) is now strict
(ASCII local part, no leading/trailing/double dots, letter/digit/hyphen domain labels, letters-only TLD), and a Resend
422 (`MailAddressRejected` in `mailer.server.ts`) returns "We couldn't send a code to that email. Please check it and
try again." (400) from sign-up instead of a 500. Tests in `email-typos.test.ts`.

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
8. $0 winner order on claim: built 10-13, see "Winner prize order" above.
9. Safety-stock prize moves are untested on the live store until the first such pick — check logs that night.
10. Imports and manual adjustments on a daily giveaway count in the day they're added.
11. Later/deferred: Discord OAuth join verification; merging giveaway/Collector Coins/chat launchers; Near Mint-only
   filter for singles (auto-pick can choose any condition variant in range); Prisma 8 upgrade (ignore banner for now).

## Warnings
- Repo is public. Shopify connector is on the LIVE store. Changing scopes requires re-approval in each store.
- Hosted page needs Railway deploy for widget changes; popup/blocks need Shopify deploy.
- DST ends 2026-11-01: draw time stays 9pm ET (logic uses timezone; tested in `test/daily.test.ts`).
