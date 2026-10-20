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

## Past Draws in Entries By Method (live 2026-10-20 15:10Z: Railway `f09dca1`, PR #31; no Shopify deploy needed)
- Daily giveaway page, Entries By Method: **Current Draw / Past Draws / All Time**. Past Draws shows a Draw picker
  ("Mon, Oct 19 · <prize>", newest first, up to 120 drawn days) and counts only entries in that draw's 9pm-to-9pm
  window; New Sign-Ups follows the same choice. URL `?methods=draw&draw=YYYY-MM-DD`. Logic: `app/lib/method-window.ts`
  (`test/method-window.test.ts`); `listGrowth` takes an optional `until`.

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

## Prize orders require shipping + Redo Order (live 2026-10-14 ~12:50Z: Railway `866ed31`, PR #16, #17)
`orderCreate` defaults line-item `requiresShipping` to false, so #258275 (Ryne) and #258279 (Steven) said "Shipping not
required" (no labels). New prize orders set `requiresShipping: true` + a $0 "Giveaway Prize Shipping" line. Draws tab has
**Redo Order** (`replacePrizeOrder`): new $0 order, then `orderCancel` of the old one (no restock, no email). The
Shopify MCP connector lacks `write_orders` (and orderCreate needs an offline token), so orders are made through the app.
Redo Order now confirms inline (PR #18, Railway `41d5943`). 10-14 14:51Z: Ryne #258275 → #258315, Steven #258279 → #258316
(new ones require shipping with a SHIPPING delivery method; old ones cancelled, no restock).

## Giveaway Winners page (feed + button live 2026-10-14 16:47Z: Railway `a84bc7b`, Shopify **poke-collect-giveaways-32**, PR #21; theme v2 155481931959 published by Trevor 16:34Z; page live 16:50Z)
Replaces the old "Giveaway Info & Winners" page (/pages/giveaway-info-winners, full names, YouTube winners from 2023).
- App: `GET /apps/giveaways/winners` (`proxy.winners.tsx` → `winnersFeed()` in `winners.server.ts` → pure
  `buildWinnersFeed()` in `app/lib/winners-feed.ts`) returns `{daily:[{date, prize, imageUrl, productHandle, winners}],
  monthly:[{drawnAt, title, prize, imageUrl, winners}]}` for every draw of ACTIVE/SCHEDULED/ENDED giveaways with "Show
  winners" on. Names are `publicName()` ("Steven I."); forfeited and disqualified winners are left out; no emails,
  addresses or prize values. Cached 60s. Test: `winners-feed.test.ts`. Branch `claude/winners-feed`.
- Theme: draft "Storepass - Giveaway Winners Page v2 (draft)" (155481931959, fresh copy of live 155480752311 at 16:28Z, after
  the monthly widget swap; the older draft 155481276599 is stale, don't publish it): `sections/pc-giveaway-winners.liquid`,
  `templates/page.giveaway-winners.json`, `assets/pc-giveaway-winners.{css,js}` (new files only). No GiveawayNinja-era
  winners (Trevor removed the archive 10-14); the imported monthly's winner shows once it's drawn in the app. Preview:
  `/pages/giveaway-info-winners?view=giveaway-winners&preview_theme_id=155481931959` (shows "Couldn't Load" until the
  Railway deploy). Source: `~/Documents/poke-collect-theme/giveaway-winners/new`.
- **See All Winners button** on the giveaway panels (popup, theme block, hosted page): `winnersLink()` in giveaway.js, inside
  the Last Winner box, or on its own above the rules when nobody has won yet. URL = `campaign.winnersPage` from setting
  `winnersPageUrl` (default `/pages/giveaway-info-winners`; no editor field yet), hidden when Show winners is off. Needs a
  Shopify deploy + Railway deploy.
- Live: page "Giveaway Winners" (handle still `giveaway-info-winners`, template `giveaway-winners`; old body kept on the page,
  unused). Footer Help menu item renamed "Giveaway Winners" (16:52Z, Trevor OK). Staff Guide not updated.

## Signed-in one-tap entry, winners button, wider 2-column (live 2026-10-14 ~17:15Z: Railway `b1e11db`, Shopify **poke-collect-giveaways-33**, PR #22)
- Signed-in shoppers (`logged_in_customer_id`, signed by the app proxy): loader returns their entrant token if they already
  entered (by `shopifyCustomerId`, or by account email, which then gets the id saved), else `customer: {firstName,
  needsName, needsConsent}`. Widget `renderCustomerEntry()` = one "Enter Today's Giveaway"/"Enter Giveaway" button + "Use
  A Different Email". Intent `customer-signup` reads email/name/consent from the Admin API (`customer.server.ts`, cached
  60s) and calls `signup({signedInCustomer})`, which skips Turnstile/honeypot/fill-time. Untested while signed in; Trevor to try.
- **Text alerts box restored on the one-tap entry** (live 2026-10-16 ~22:57Z: Railway `38aa5c0`, Shopify
  **poke-collect-giveaways-35**, PR #25). Without it new SMS subscribers fell (Klaviyo: 306 on 10-13 → 188 on 10-15 while
  entries rose 864 → 2,897). `smsFields()` in giveaway.js now builds the optional phone + consent for both forms; checked on
  the live hosted page with a mocked signed-in customer (phone size).
- `.pcg__winners-link` width auto (ran off the right on iPhone); `.pcg--wide` max-width 1120 → 1400px.
- Theme "Storepass - Monthly Giveaway Two Columns (draft)" 155482456247 (copy of 155481931959; only
  `templates/page.giveaway.json` block layout three → wide) **published 2026-10-14 ~17:20Z on Trevor's "publish"** — now MAIN.

## Email countdown timer (2026-10-14, Railway deploy requested by Trevor)
- `GET /countdown.gif` (public, never cached): a 60-second animated GIF counting down to the next daily draw, drawn
  like the widget's daily timer (Hours / Mins / Secs boxes on #111114). Optional `?slug=` (default `daily-giveaway`)
  reads that giveaway's timezone and draw time. Used in Klaviyo newsletters as
  `<img src="https://app-production-2322.up.railway.app/countdown.gif">`. Code: `app/lib/countdown.ts`,
  `app/lib/gif.ts` (tiny GIF encoder), glyphs in `app/lib/countdown-glyphs.ts` (regenerate with
  `scripts/countdown-glyphs.py`). No DB writes; the only read is the campaign's timezone/settings.

## Image Background (live 2026-10-14 ~17:20Z: Railway `1d3c496`, Shopify **poke-collect-giveaways-34**, PR #23)
Setting `imageBackdrop` ("light" | "rain", invalid → light) under the prize image in the editor. "rain" renders the
giveaway's own image with `prizeStage()` (the daily's red digital rain, glow, float). Monthly set to Red Matrix Rain
(10-14). Trevor is redoing the monthly image (transparent PNG suggested); November may want its own look.

## Safety stock prize fix (live 2026-10-14 ~23:05Z: Railway `5ef4f6c`, PR #24)
Choosing a prize only in safety stock failed: "A ledger document URI is required except when adjusting available".
Shopify needs `ledgerDocumentUri` for every quantity name except `available`; `moveOne` and `removeOne` now send it for
safety_stock too. The failed choose had released the day's prize; the scheduler picked the next queue item (Booster
Bundle) for 10-14. Test: `daily-safety-stock.integration`.

## Verified buylist daily task (live 2026-10-16: Railway `3c9f74e`; ticked on the live "Submit A Buylist" task)
Trevor 10-16: "Try Our New Scan & Sell" (+20/day, opens /apps/buylist/cards/app.html, counts on tap) and "Submit A
Buylist" (+50/day, opens /apps/buylist, claim "I Submitted My Buylist") added to the daily giveaway in the editor (live
settings). Trevor chose to verify real submissions: editor checkbox "Only count real buylist submissions"
(`config.verifyBuylist`). On claim, `buylistSubmittedSince` (`app/lib/buylist-verify.server.ts`) asks the buylist app
`GET BUYLIST_VERIFY_URL?email=&since=<task day start>` with header `x-verify-secret: BUYLIST_VERIFY_SECRET` and expects
`{submitted: boolean}`; not set up / error → claim refused ("couldn't check"). The endpoint lives in poke-collect-singles
(built by its thread 10-16: `https://app-production-cd07.up.railway.app/api/giveaway/buylist-submitted`, customer
submissions only, not DRAFT/CANCELLED; `GIVEAWAY_COUNT_STAFF=true` there would count walk-ins). Railway vars set:
`BUYLIST_VERIFY_URL` (giveaway app) and `BUYLIST_VERIFY_SECRET` (both apps, same value; copied by Trevor). Failures log
`[buylist-verify] check failed`. `TaskDay.startsAt` added. Test:
`buylist-verify.integration.test.ts`.

## Add Entries (live 2026-10-19 ~16:30Z: Railway `56725aa`, PR #29)
Admin "Add Entries" on the entrant page and (by email) behind a button on the giveaway's Entrants tab, for purchases or
tasks that didn't attach. `addEntries()` (`app/lib/entries/adjust.server.ts`) writes an append-only ADJUSTMENT event
(whole numbers, ±100,000, optional reason shown as "Adjustment (reason)"; minus takes entries away). Per giveaway; counts
in the daily draw of the day added. Refuses disqualified entrants and emails not in the giveaway. Audit `entry.add`.

## Entrants search fix (live 2026-10-19 ~17:12Z: Railway `a9770ef`, PR #30)
The Entrants and Activity search boxes were `GET <Form>`s, which never submit from Polaris' `s-search-field` inside the
embedded admin. `SearchBox` (`app/components/SearchBox.tsx`, full width) drives the URL via `setParams` as you type
(400ms) or on Enter; `entrantSearchWhere()` (`app/lib/entries/search.ts`) needs every word in the email or name.
Not tried in the live admin (Claude's browser pane was signed out of Shopify).

## US-only giveaways (branch `claude/us-only`, NOT deployed)
Trevor 10-20: giveaways only for people in the US with a US shipping address. Setting `usOnly` (default **true**,
editor "US residents only"). (1) Both storefront sign-up forms have a required box "I live in the US and have a US
shipping address." (`usResident`, refused on the server when false). (2) Winner claims must be a US address: country US,
a state in the 50 + DC (no territories/APO), 5-digit ZIP (`usAddressProblem`, `app/lib/us-only.ts`); claim page says so.
(3) Orders with a shipping country other than US earn no purchase entries and don't auto-create entrants (pickup / no
address still counts). (4) Rules generator adds the US shipping line to Eligibility. Existing entrants aren't re-asked;
the claim check is the backstop (forfeit + redraw a non-US winner). No IP geolocation. Deploy order: Shopify first,
then Railway (old widgets don't send `usResident`). Tests: `us-only.test.ts`, flow + winners integration (250 total).

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
   **GN export findings (Mac session, 2026-10-14 ~15:30Z, nothing imported or created yet):** GN Users › Export ›
   "Current filter" calls `exportPrecheck` then `window.open('/users/export?…')`, which Chrome blocks when driven by
   Claude (no file saved; Trevor can click it himself). CSV columns: `Date,Email,Name,Phone,Confirmed,OptinNewsletter,
   OptinSMS,Entries,ReferralId,ReferrerId,Coupon,Country,SaleValue,…UTM…,Source` (rows have 20 cells vs 21 headers;
   Email/Name/Entries line up). 5,836 rows, 1,415,390 entries. **2,252 rows (442,680 entries, all signed up 10-01→10-08)
   have Email = "(removed on Shopify request)"**, so they can't be imported by email (the importer skips them as invalid).
   Leaves 3,584 importable emails, 972,710 entries. No eligibility/"Missing Mandatory" column; `Confirmed` is False for all.
   Importer gaps: `OptinNewsletter` isn't a consent alias (everyone would import with consent=false), and imported
   entrants have no Whatnot-follow event, so with the preset's `requireEmailConsent` + mandatory Whatnot follow
   `onlyFullyEntered` would make every imported entrant ineligible until they opt in and follow again in the new widget.
   Trevor chose to import (10-14). Fix on branch `claude/import-gn-eligibility`: `OptinNewsletter` → consent alias, and
   `onlyFullyEntered` treats an entrant with an IMPORT event as having done every required action (email opt-in still
   needed, so the 536 who didn't opt in at GN only count once they tick it). Imports land in the monthly only; the
   daily never sees them. Trevor's export: `~/Downloads/export-2026-10-14-15-34-34.csv` (5,842 rows, 3,590 importable).
   **Done 10-14 ~16:05Z:** deployed (Railway `dfabddb`, also shipped PR #19), monthly created from the preset as
   **DRAFT** (id `cmv8atisw002dlf3an41bpa95`, slug `monthly-giveaway`, ends 10-31 23:59 ET) and the CSV imported:
   3,589 entrants, 974,970 entries across 2,928 people (661 had 0). 2,253 rows skipped (2,252 removed emails + 1
   malformed row with 0 entries). Created/imported via the Claude browser pane (Claude in Chrome can't interact
   with the embedded admin iframe). Still to do, each with Trevor's OK: review the draft's settings (claim days,
   Klaviyo list, rules), swap the widget on /pages/monthly-giveaway, Go live, final top-up import from a fresh GN
   export (only deltas are added), link daily↔monthly (`linkedSlug`), turn off GN before its 11/1 charge.
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

## Bot farm block + live show task visible all week (2026-10-17)
- **Bot farm** (~10,600 fake entrants since 10-14 on 13 catch-all domains, e.g. putterkickz.com, google-o.com; won the
  10-14 and 10-15 dailies, orders #258459 shipped / #258673 held). PR #26 (Railway `110f25a`, live 18:29Z): `app/lib/bot/domains.ts`
  refuses the farm domains (+ env `BLOCKED_EMAIL_DOMAINS`) and any uncommon domain with 8+ sign-ups in 24h
  (`blocked_domain` / `domain_burst`, weight 100). Entrants tab: "Suspicious Email Domains" with Disqualify All / Restore.
  Trevor disqualified the farm domains on the daily and the monthly (10-17). Klaviyo segment `UUvikG` "Giveaway Bot Farm
  Domains (Do Not Mail)" (11,144 profiles) suppressed; Trevor to exclude it from campaigns.
- **Join Our Live Whatnot Show** had 0 claims on 10-16: it only rendered while open. PR #27 (Railway `0f08fcc`, Shopify
  **poke-collect-giveaways-36**, 10-18 ~00:45Z): scheduled tasks show all week dimmed ("Opens Fri 5:00 PM CT", countdown on
  the day, "Opens Soon") and the widget reloads itself when the window opens.

## Verified Vault Market task (live 2026-10-19 ~16:10Z: Railway `129f8d9`, Shopify **poke-collect-giveaways-37**)
Trevor 10-19: replace "Try Our New Scan & Sell" (+20) with "List A Card On Vault Marketplace" (+20), tracked. VISIT_URL daily
task option `verifyMarketListing` ("Only count real Vault Market listings"): claim asks the Mystery Packs app
`GET /api/giveaway/market-listed?shop&email&since[&customer]` (packs PR #51, `x-verify-secret`) via `app/lib/market-verify.server.ts`;
any listing created since the task day began counts. Railway vars `MARKET_VERIFY_URL` (packs public host) + `MARKET_VERIFY_SECRET`
here, `MARKET_VERIFY_SECRET` on packs. Tested live: wrong secret 401, unknown email false, Trevor's account true.
Verified tasks show "Tap once it's done. We check this one." Trevor swaps the task in the editor.
