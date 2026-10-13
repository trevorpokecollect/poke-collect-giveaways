# ARCHITECTURE — technical reference

Verified against source at commit `8af9e1e` (2026-10-13). File headers in `app/` carry good one-line purpose comments —
`head -5 <file>` is the cheapest way to confirm what a file does.

## 1. System overview
```
Shopper ─▶ poke-collect.com (theme + app embed/blocks: giveaway.js, daily-popup.js, entries-badge.js)
             │  fetch /apps/giveaways/<slug>?format=json   (Shopify App Proxy, signed)
             ▼
        Railway "app" service (React Router server)  ◀── Shopify webhooks (orders/*, app/*, compliance)
             │  Prisma                                 ──▶ Shopify Admin GraphQL (inventory, customers, discounts)
             ▼                                         ──▶ Resend (emails) · Klaviyo (profiles/SMS) · Turnstile verify
        Railway Postgres                               ──▶ outbound webhooks (optional, signed)
Admin ─▶ Shopify admin ▶ embedded app (/app/*, Polaris web components, App Bridge)
Checkout ▶ giveaway-thank-you UI extension ─▶ POST https://app-production-2322.up.railway.app/api/order-entries
```
- Shopify app: client_id `0e0ba5328cb24247e2b03e9468d5e102`, name "Poke-Collect Giveaways", embedded, URL
  `https://app-production-2322.up.railway.app` (`shopify.app.toml`). Installed on live store `poke-collect-al.myshopify.com`
  (poke-collect.com, Advanced plan) and test store `poke-collect-packs-test.myshopify.com`.
- Scopes: `read_orders,write_orders,read_customers,read_products,write_discounts,read_inventory,write_inventory,read_locations`.
  Changing scopes needs a Shopify deploy + Trevor re-approving in each store's admin.
- App proxy: `https://<store>/apps/giveaways/*` → `/proxy/*`. Webhooks API version 2026-10: `orders/create|updated|cancelled`
  → `/webhooks/orders`; `app/uninstalled`; `app/scopes_update`; compliance → `/webhooks/compliance`.
- Railway: project `poke-collect-giveaways` (id `acb61a4a-e097-45a2-80b9-bf7094472f87`), services `app`
  (id `881f805d-db0e-43b8-8e0f-0e53dae14cd6`) and `Postgres`, env `production`. Start = `npm run docker-start`
  (`prisma generate && prisma migrate deploy` then `react-router-serve`). Railway deploys from GitHub `main`
  (`trevorpokecollect/poke-collect-giveaways`, **public repo**) only when triggered (`connect-service-source`), not on push.

## 2. Code map (where things live)
| Area | Files |
|---|---|
| Data model | `prisma/schema.prisma`, `prisma/migrations/*` |
| Shopify auth/config | `app/shopify.server.ts`, `app/db.server.ts`, `shopify.app.toml` |
| Scheduler start | `app/entry.server.tsx` calls `startDailyScheduler()` (once per process, every 60s; `DAILY_SCHEDULER=off` disables) |
| Storefront API | `app/routes/proxy.$slug.tsx` (GET state; POST intents `signup`, `verify`, `action`), `proxy.estimate.tsx` (badge estimates), `proxy.claim.$token.tsx` (winner claim page, Liquid) |
| Hosted page | `app/lib/storefront/landing.server.ts` — returns `application/liquid`, **inlines `giveaway.css/js` via `?raw` imports** |
| Sign-up / verify | `app/lib/entries/signup.server.ts` (`signup`, `findLiveCampaign`, `activate`, `hasFullName`, `clawBackReferrals`), `app/lib/otp.server.ts`, `app/lib/token.server.ts` |
| Actions (tasks) | `app/lib/entries/actions.server.ts` (`completeAction`, `entrantState`, `verifyEntrant`, `leaderboard`), pure helpers `actions.ts`, repeat keys `repeat.ts` |
| Ledger | `app/lib/entries/ledger.server.ts` (`award` w/ optional backdated `createdAt`, `entrantTotal`, `eligibleTickets`) |
| Purchases | `app/lib/entries/orders.server.ts` (`processOrder` idempotent, `ordersCountFrom`, `removePreStartOrderEntries`), scoring `rules.ts`, estimates `estimate*.ts`, thank-you `order-entries.server.ts`, `app/lib/backfill.server.ts` |
| Bot protection | `app/lib/bot/risk.ts` (weights/policy), `turnstile.server.ts`, `email.ts`, `fingerprint.server.ts`, `rate-limit.server.ts` |
| Daily draw | `app/lib/daily.ts` (pure: `periodFor`, `eligible`, `pickPrize`), `app/lib/daily.server.ts` (`fetchCandidates`, `ensurePrize`, `choosePrize`, `swapPrize`, `releasePrize`, `markPrizeSent`, `dayTickets`, `drawPrize`, `runDailyJobs`, `storefrontDaily`, `drawHistory`), `app/lib/daily-queue.server.ts` (`queueFor`, `addToQueue`, `moveQueueItem`, `upcomingPlan`), `app/routes/jobs.daily.tsx` |
| Monthly/manual draw | `app/lib/draw.ts` (seeded HMAC weighted draw, `snapshotHash`), `draw.server.ts` (`runDraw`) |
| Winners | `app/lib/winners.server.ts` (emails, claims, forfeit+redraw, `publicWinners`), `winners.ts` (pure), `names.ts` (`publicName` "Emily S.", browser-safe) |
| Linked giveaways | `app/lib/entries/linked.server.ts` (`settings.linkedSlug`; mirrors sign-up/actions) |
| Disqualify entry | `app/lib/entries/void.server.ts` (`voidEvent`, `restoreEvent`, `activityFeed`) |
| Reporting | `app/lib/analytics.server.ts`, `analytics-range.ts`, `entries/methods*.ts` (entries by method), `entries/list-status*.ts` (new vs existing customers/subscribers) |
| Settings / presets | `app/lib/settings.ts` (zod schema, defaults), `app/lib/recommended.ts` (monthly, daily, GiveawayNinja-copy presets), `campaign-form.ts` (+ `.server.ts`), `preview.ts` |
| Integrations | `mailer.server.ts` (Resend), `klaviyo.server.ts`, `webhook-out.server.ts`, `discounts.server.ts` (consolation codes), `import.server.ts` (GiveawayNinja CSV) |
| Admin UI routes | `app/routes/app._index.tsx` (list + New buttons), `app.campaigns.new.tsx` (`?type=daily|monthly`), `app.campaigns.$id.tsx` (tabs: Overview/Entrants/Activity/Orders/Draws + all admin intents), `$id_.edit`, `$id_.analytics`, `$id_.import`, `$id_.entrants.$entrantId`, `$id.export` (CSV) |
| Admin components | `app/components/*` — `CampaignForm`, `ActionsEditor`, `PurchaseRulesEditor`, `SettingsEditor`, `ShopPromoEditor`, `DailySection`, `DrawsSection`, `EntriesByMethod`, `EntryActivity`, `GiveawayPreview`, `fields.tsx` (Polaris field wrappers) |
| Theme extension | `extensions/giveaway-widget/`: blocks `giveaway.liquid` (page/homepage block), `daily-popup.liquid` (app embed: launcher, header gift icon, product/cart lines), `product-entries.liquid`, `cart-entries.liquid`; assets `giveaway.js/css`, `daily-popup.js`, `entries-badge.js/css` |
| Checkout extension | `extensions/giveaway-thank-you/src/*` (calls Railway URL directly; app proxy unreachable from checkout) |

**Touch carefully** (many dependents): `schema.prisma`, `ledger.server.ts`, `signup.server.ts`, `orders.server.ts`,
`daily.server.ts`, `risk.ts`, `settings.ts` (defaults apply to existing campaigns' missing keys), `giveaway.css` (theme collisions),
`proxy.$slug.tsx` (public API the widget, popup and badges depend on).

## 3. Data model (prisma/schema.prisma)
- `Campaign` (shop, slug unique per shop, title, prize, imageUrl, status DRAFT|SCHEDULED|ACTIVE|ENDED|ARCHIVED, startsAt,
  endsAt, timezone default America/New_York, `purchaseRules` JSON, `riskPolicy` JSON, `theme` JSON, `settings` JSON, rulesText).
- `EntryAction` (type: SIGNUP, REFERRAL, SOCIAL_FOLLOW, VISIT_URL, DAILY_CHECKIN, SECRET_CODE, ALTERNATE_ENTRY, CUSTOM, POLL,
  QUESTION, WATCH_VIDEO, SOCIAL_SHARE, SMS_OPTIN; entries, config JSON, mandatory, repeatable, sortOrder). Removing an action
  with history **archives** it (`config.archived`) instead of deleting.
- `Entrant` (unique campaignId+emailNormalized; status PENDING_VERIFICATION|ACTIVE|HELD|DISQUALIFIED; referralCode; hashed
  ip/subnet/device; riskScore; marketingConsent; phone/smsConsentAt; discountCode; klaviyoSyncedAt; list-status fields).
- `EntryEvent` = ledger (source ACTION|PURCHASE|REFERRAL|ADJUSTMENT|ROLLBACK|IMPORT; entries ±; dedupeKey unique per campaign;
  orderLogId; actionId; createdAt may be backdated).
- `OrderLog` (unique campaign+shopifyOrderId; status; entries; breakdown JSON — the order's placed time is read via
  `orderPlacedAt()`; older logs lack it).
- `Draw` (seed, snapshotHash, totals) → `Winner` (position, notifiedAt, forfeited, claimedAt, claimData).
- `DailyPrize` (periodKey, opensAt, drawAt, product/variant, inventoryItemId, locationId, `reservedFrom`, status
  RESERVED|DRAWN|SENT|RELEASED, drawId). `DailyQueueItem` (position, pinnedDate, usedAt, prizeId, note).
- Also: `ActionResponse` (poll/quiz/address), `RiskSignal`, `EmailOtp`, `RateLimitHit`, `CampaignImage` (bytes, served
  `/images/<id>`), `AuditLog`, `Session`.

## 4. Key flows
- **Sign-up**: widget POST `signup` → rate limit → existing entrant? (`returning` requires OTP) → signals (Turnstile, honeypot,
  too fast, disposable/generated email, ip/subnet/device bursts, self-referral) → `decide()` allow/verify/hold/block
  (thresholds verifyAt 20, holdAt 50, blockAt 80; `alwaysVerifyEmail` true by default) → entrant created → `activate()` awards SIGNUP + referral. Required
  steps (email opt-in, name, mandatory actions) must be complete before entries count in draws (`onlyFullyEntered`).
- **Action**: POST `action` with entrant token → `completeAction` (mandatory-first gating, per-type validation) →
  `award` with dedupeKey `action:<id>:<entrant><repeatKey>`; repeatable keys use the draw day for daily giveaways.
- **Purchase**: webhook → `processOrder` → only campaigns live at the order's placed time and after `ordersCountFrom`
  → scoring `rules.ts` (base per $ of subtotal, product rules, bundles, boosters, period multipliers; gift cards excluded)
  → settles ledger to target (edits/cancels become rollbacks); buyers auto-entered if `autoSignupFromOrders`.
- **Daily**: every minute `runDailyJobs`: draw RESERVED prizes past `drawAt` (claim by status update; tickets =
  `dayTickets(opensAt..drawAt)` minus winners within `winCooldownDays`; none → release stock) → email winner → for each
  live daily campaign `ensurePrize` (pinned queue item → next in-stock queue item → automatic `pickPrize` by rules) →
  reserve 1 unit (available→reserved; queued and hand-chosen items may use safety stock always, the automatic pick only
  with `daily.useSafetyStock`; safety-stock moves untested on live until the first such pick). `periodFor(now, tz, drawTime)`: day = previous drawTime → drawTime, keyed by draw date.
- **Linked giveaways**: `settings.linkedSlug` on either side; verifying in one creates/activates the other; channel tasks
  (texts, follows of the same URL, check-ins) mirror via `shareKey()`. Imports and manual adjustments are dated when
  added, so on a daily giveaway they count in that day's draw.

## 5. Settings (`app/lib/settings.ts`, JSON on Campaign.settings)
winnerEmail{enabled,subject,body,claimDays} · consolation{enabled,percentOff,daysValid,minEntries} ·
klaviyo{enabled,listId,onlyConsented} · daily{enabled,drawTime "21:00",minPrice 70,maxPrice 100,sources[{productType,languages}],
noRepeatDays 30,winCooldownDays 30,useSafetyStock} · shop{enabled,url,products[]} (Shop & Earn) · webhookUrl ·
showLeaderboard · showWinners · linkedSlug · requireEmailConsent · requireName (default true) · eligibility.
Daily sources default: "Pokemon Sealed" (any language) + "Pokemon Single" with languages "English" (matches StorePass tag
`Language_English`). Store product types include "Pokemon Sealed", "Pokemon Single", "Pokemon Japanese Single".

## 6. Environment variables (names only — values live in Railway; never commit)
SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_APP_URL, SCOPES, DATABASE_URL, TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY,
RESEND_API_KEY, MAIL_FROM (default "Poke-Collect Giveaways <giveaways@poke-collect.com>"), KLAVIYO_PRIVATE_KEY,
ENTRANT_TOKEN_SECRET (falls back to SHOPIFY_API_SECRET), FINGERPRINT_SECRET, OUTBOUND_WEBHOOK_SECRET, CRON_SECRET,
FOLLOW_STATS_KEY (unset = /stats/follow-clicks answers 401),
DAILY_SCHEDULER, DISPOSABLE_EMAIL_DOMAINS, SHOP_CUSTOM_DOMAIN. Confirmed set by Trevor: Turnstile pair, RESEND_API_KEY,
KLAVIYO_PRIVATE_KEY. **Unverified** which of the others are set (Railway variable reads are blocked for the Mac session).
Turnstile site key (public): `0x4AAAAAAFUH08Ib9QEPgkz4`. Trevor sets Railway variables himself — never ask him to paste secrets. Resend domain poke-collect.com verified (DNS at GoDaddy).

## 7. Storefront embed settings (theme editor)
- App embed "Daily giveaway popup": slug, button_text, open_automatically (default off), delay, position, bottom offset,
  mobile_launcher (`tab` = gift icon in the theme header next to the cart — default; `button`; `none`), product_entries, cart_entries, monthly_url/label, accent.
- Block "Giveaway": slug (blank or `latest` = newest open), layout (`three` full-width 3-col default / `wide` 2-col / `narrow`), edge_to_edge,
  google_ads_send_to, meta_pixel_id (conversion on new entry; IDs in use: Google Ads `AW-10903141720/RrSaCJqVspgdENj6gs8o`,
  Meta pixel `2752433665081400` "Lead"), accent, radius.
- Blocks "Giveaway entries badge" (product) and "Giveaway entries (cart)".
