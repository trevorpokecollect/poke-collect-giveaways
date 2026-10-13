# DEVELOPMENT_HISTORY — decisions, bugs, lessons

Built 2026-10-11 → 2026-10-13. `git log --oneline` has ~58 descriptive commits; commit bodies explain most fixes.
This file keeps what git doesn't: why, what failed, and Trevor's corrections.

## Timeline (condensed)
- **10-11**: scaffold, Railway + Shopify config, first deploy (v1–v2), Turnstile + Resend + Klaviyo keys set up.
  Widget themed to match poke-collect.com (red/ink, Oswald, Title Case).
- **10-12 early**: full editor, analytics, CSV import/export, backfill, winner emails/claims/redraws, consolation
  codes, Klaviyo, outbound webhooks, new action types (poll, question, video, share), hosted page, entry badges,
  thank-you block, recommended presets, daily draw (inventory-reserved prize, nightly 9pm ET draw, popup app embed),
  SMS opt-in, linked giveaways, mobile bottom sheet.
- **10-12 day**: daily giveaway launched on the LIVE store (~15:44Z) with prize Japanese Storm Emeralda Booster Box,
  GiveawayNinja entry amounts. Then rapid fixes and features (see bugs below), prize queue, safety stock.
- **10-12 21:00 ET**: first automatic daily draw succeeded (winner "Steven I.", Storm Emeralda); next prize auto-set
  from Trevor's queue (Pokémon 30th Celebration ETB; then JP 30th Celebration Booster Box, 30th Celebration Booster Bundle).
- **10-13**: analytics per draw day + date ranges; daily rules wording; honeypot autofill fix. Shopify app version 26.

## Bugs and fixes (most important first)
| Symptom | Root cause | Fix (commit) | Lesson |
|---|---|---|---|
| Widget blank/garbled on poke-collect.com (popup + hosted page) | Theme header defines `.pcg {display:inline-block;line-height:0}` for its logo; with our `container-type:inline-size` the widget computed to width 0 | `ce2f8af` (`.pcg[data-pcg]` overrides) | Theme shares our class name |
| Logo disappeared on some pages (mobile) | Reverse collision: our bare `.pcg` rules styled the theme's logo `<span class="pcg">` | `b476946` scope every selector to the widget root | **Never write bare `.pcg` rules** |
| ~60 real entry attempts refused (403) | `turnstile_failed`=100 → block when token missing (submitted before check finished / retry reused token) | `3a96437` missing token → `turnstile_missing` (20, email code); wait ≤8s for token; log blocked attempts | Soft signals must never block |
| ~10 Android phones refused repeatedly | Android autofill fills the honeypot field (ignores autocomplete=off), keyed on "Website" label | `8af9e1e` honeypot weight 20, label removed | Don't trust honeypots alone |
| Old orders (e.g. #252736 from July) earned entries today | Giveaway with blank Starts → no lower bound; `orders/updated` fires on fulfil/tag of old orders | `9d197b1` Go live records start; `ordersCountFrom`; "Remove entries from orders placed before the start" | Webhooks ≠ new orders |
| Order log said "placed today" | Showed log time not order time | `6e5730b` show placed date, label cleanups | |
| Daily draw could include yesterday's order entries | Event time = processing time | order events backdated to placed time (`ledger.award({createdAt})`), `daily-window.integration.test.ts` | Window by event time |
| "Giveaway isn't open right now" | Widget link name didn't match slug (e.g. "DR", "Delta Reign") | `d39be3f` accept title/any casing/`latest` | |
| Create-form crash | Free-text dates unparseable | `d39be3f` date pickers in Eastern time | |
| Popup X untappable on phones | Sheet too tall, X under browser bar | `453785b` shorter sheet, bigger X, bottom Close | |
| Popup covered Shop chatbot (bottom-left) | Launcher position | `ce2f8af` launcher above chat; bottom offset setting | Chat bottom-left 20px/60px; Collector Coins bottom-right (#ccp-root) |
| Railway build failed 10-12 16:32Z | `node:crypto` pulled into browser bundle via `winners.ts` | `a5abbc8` `publicName` → `app/lib/names.ts` | Keep server-only imports out of components |
| tsc errors on missing Prisma fields after pull | Stale generated client | `npx prisma generate` | |
| Widget "Tomorrow" label / store dates off by a day | Deriving dates from `drawAt.toISOString()` (9pm ET = 01:00Z next day) | use `periodFor`/`periodForKey`/`addDays`; server sends `daily.tomorrow` | Never use UTC dates for store days |
| Theme-editor default change didn't apply | Existing setting values stick in the theme | renamed `auto_open` → `open_automatically` (default false) | Rename a setting to change its default |
| Zod 4 settings defaults | `.default({})` behavior changed | `5aa5bbc` use `.prefault({})` | |

## Decisions (with reasons)
- **Ledger, not counters**: auditable, rollbacks for edits/cancels/fraud, per-day windows possible.
- **Daily Tasks = action config + ledger, no new table** (10-13): the ledger row with its unique dedupe key already is
  the completion record (giveaway, entrant, task, day/window) and makes claims idempotent. Reset defaults to the daily
  draw, not midnight Central, so a task can't count twice in one drawing. Instagram likes and Whatnot attendance can't
  be verified, so those tasks are labeled honor-system rather than "verified".
- **Inventory reservation via `inventoryMoveQuantities`** (available/safety_stock → reserved), copied from the Mystery
  Packs app (`poke-collect-mystery-packs/app/lib/inventory.server.ts`) so prizes can't sell; "Mark Sent" removes the unit.
- **In-process scheduler** (`setInterval` 60s, single Railway replica) + `/jobs/daily` (CRON_SECRET) instead of a
  separate cron service. Draw is claimed by a guarded status update (no double draws).
- **Daily window** = previous 9pm → 9pm ET; repeatable task keys use the draw day.
- **Weighted, seeded HMAC draw** with stored seed + snapshot hash → re-verifiable.
- **Hosted page** returns `application/liquid` so it renders inside the theme.
- **Thank-you extension calls Railway directly** (app proxy not reachable from checkout).
- **Linked giveaways**: one sign-up enters both (monthly = acquisition via ads; daily = retention, popup).
- **Prize queue** before automatic pick; queue/chosen items ignore price range & product-type rules.
- **No automatic popup**; mobile uses a header gift icon (Trevor disliked the side tab; screen already has chatbot +
  Collector Coins widgets).

## Trevor's corrections and preferences (do not repeat these mistakes)
- Title Case every storefront button/title/header/sub text (also saved in Claude memory).
- Don't show prize value/price on the storefront. No price ranges on packs (memory: no-price-ranges-on-packs).
- SMS must stay optional (advised: TCPA/carrier rules); Whatnot follow + email opt-in + full name are required.
- Facebook replaces YouTube everywhere. Discord/Whatnot/IG/FB follows can't be verified (click = entry); Discord OAuth
  verification deferred ("worry about that later").
- Mail-in AMOE link removed from the box; keep "No Purchase Necessary · Official Rules" line; free online entry = AMOE.
- Referral box goes LAST (mobile + desktop). Desktop: popup 2 columns; page/homepage block 3 columns full width.
- Entry badges must say "Enter … Free To Earn +N" until the visitor has entered; whole bar clickable.
- Wants entries by method, per-entry disqualify, activity feed, new-vs-existing sign-ups, per-draw analytics, date ranges.
- Test on the test store first when possible; keep things sleek and consistent with the site and sister apps.
- Wants a nightly debug check for 7 days (now a cloud routine; see WORKFLOWS).
- Promised but not built: a $0 draft order when a winner claims (for now: ship manually, then "Mark Sent").
- Monthly purchases are 5 entries per $1; daily 50 per $10 (same rate, different wording).

## Process lessons (how we work)
- **Two Claude sessions** (rule agreed 2026-10-12): the cloud project thread writes all app code, runs checks, pushes
  `main` and deploys Railway (`connect-service-source`; pushing alone doesn't deploy). The Mac session (Remote Control)
  runs `shopify app deploy`, store checks and listings unless Trevor assigns it a build. Both built the same asks twice
  (daily draw, mobile popup) before this rule — wasted work and a near-duplicate Instagram task. Coordinate first.
- Railway and Shopify deploys are refused by the auto-mode classifier unless Trevor's latest message says "deploy",
  even for bug fixes.
- Shopify MCP can't write to the MAIN theme; the cloud agent proxy blocks curl to `*.railway.app` (use Railway logs).
- Never use GitHub create-repository or account-wide search tools from the cloud session; Trevor creates repos.
- Shopify `app deploy` is classed as a production deploy: run only on Trevor's explicit "deploy"; run it as its own
  command (bundling with npm install got blocked).
- Railway variable reads/listing are blocked for the Mac session (credential policy) — ask Trevor to check the Variables tab.
- Never type secrets into sites for Trevor and never ask him to paste them; he sets Railway variables himself. (Once, on
  10-12, a Turnstile secret was pasted in chat — rotation was recommended.)
- Claude-in-Chrome clicks/typing do not reach the embedded app iframe in Shopify admin (scroll works) — give Trevor
  click-by-click steps instead, or add one-click presets (`/app/campaigns/new?type=daily|monthly`).
- The Shopify MCP connector holds one store at a time; switching revokes the other. Trevor runs other chats on it — don't
  switch without asking. Product CSV import was used for test listings instead.
- Browser checks of the live site work from the Claude browser pane (`fetch('/apps/giveaways/<slug>?format=json')`).
