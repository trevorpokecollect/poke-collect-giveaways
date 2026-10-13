# Cloud-thread knowledge for the handoff (verified against the repo at 8af9e1e unless marked)

Written by the cloud development thread for the handoff docs being assembled on the Mac. Fold these into docs/handoff/* and CLAUDE.md, then delete this file.

## Who does what (agreed 2026-10-12)
- The cloud thread (claude.ai project "Shopify giveaway app") writes all app code, runs the checks, pushes to `main` and deploys Railway.
- Trevor's Mac (Remote Control, ~/Documents/poke-collect-giveaways) only runs `shopify app deploy`, store checks and listings, unless Trevor assigns it a build. Both sessions started building the same asks twice (daily draw, mobile popup), which is why this rule exists.
- Pushing to `main` does NOT deploy. Railway deploys with Railway MCP `connect-service-source` (projectId acb61a4a-e097-45a2-80b9-bf7094472f87, serviceId 881f805d-db0e-43b8-8e0f-0e53dae14cd6, repo trevorpokecollect/poke-collect-giveaways, branch main). The auto-mode classifier refuses it unless Trevor's latest message says "deploy", even for bug fixes. Migrations run at container start (`npm run setup` = prisma generate + migrate deploy). Check the deploy with list-deployments, then get-logs with filter "migration" or `@level:error`.
- After any widget change (extensions/giveaway-widget/*), the storefront only changes after `shopify app deploy` from the Mac. App-only changes (admin, server) need only Railway.

## Checks before every push (all must pass)
```
npx tsc --noEmit
npx eslint app test extensions/giveaway-widget/assets
npm run build
DATABASE_URL=postgresql://postgres@localhost:5433/giveaways npx vitest run   # 159 tests at 8af9e1e
```
- Integration tests (`*.integration.test.ts`) skip without DATABASE_URL. The cloud container has a local Postgres on port 5433 (data in /home/claude/.pgtest). If it's down: remove /tmp/.s.PGSQL.5433.lock and /home/claude/.pgtest/data/postmaster.pid, then `pg_ctl -D /home/claude/.pgtest/data -o '-p 5433 -k /tmp' -w start` as user `claude`. Apply migrations with `npx prisma migrate deploy`. A drift check: `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url postgresql://postgres@localhost:5433/shadow --script` should print an empty migration.
- A test that imports anything pulling in `app/shopify.server.ts` (e.g. `daily.server.ts`) crashes on "empty appUrl". Either `vi.mock("../app/shopify.server", () => ({ unauthenticated: {} }))` (see test/daily-window.integration.test.ts) or move pure logic into a non-.server file (that's why `list-status.ts` is split from `list-status.server.ts`).
- Run `npx prettier --write` on touched files. ESLint flags unescaped `'` in JSX (use `&apos;`).

## Widget preview harness (cloud scratchpad only, not in the repo)
- Renders the real widget assets in Chromium/Playwright via `app/lib/preview.ts` (`previewData`) + GiveawayPreview's page HTML, with a fake theme header, desktop 1280 and phone 390. The iframe is sandboxed without allow-forms, so form submits must be patched in tests. `THEME=1` injects the live theme's `.pcg` logo rule to catch the collision bug.
- It's in the cloud session's scratchpad and won't survive the container. A new session should rebuild something similar if it needs screenshots; the admin preview (Edit page, right side) uses the same assets and is the simplest manual check.

## Lessons that aren't obvious from commit messages
1. Theme `.pcg` collision: the live theme's logo is `<span class="pcg">` with header styles (inline-block, line-height 0). Every widget CSS root selector must be `.pcg[data-pcg]`, never bare `.pcg`; there is a guard `.pcg[data-pcg]{display:block}`.
2. Bot protection blocked real people twice:
   - 2026-10-12: Turnstile token missing or already used (`missing-input-response`, `timeout-or-duplicate`) scored 100. Fix 3a96437: that's `turnstile_missing` (20 = email code), and the client waits up to 8s for the token ("One Moment…").
   - 2026-10-13: Android autofill (Google, Samsung Pass; Motorola and Samsung phones) fills the honeypot despite autocomplete="off" and retries 5–8 times. Fix 8af9e1e: honeypot weight 20 (asks for an email code) and no "Website" label.
   - Lesson: no single client-side signal should block on its own; only `turnstile_failed` (an actually invalid token) blocks alone. Check `signup blocked {campaign, score, signals}` warn lines in Railway logs; a real person shows up as the same UA retrying many times within a minute.
3. Daily time math: the draw is 9pm ET = 01:00 UTC the next day. Never derive store dates from `drawAt.toISOString()`. Use `periodFor` / `periodForKey` / `addDays` in app/lib/daily.ts. The widget's "Tomorrow" label uses the server-sent `daily.tomorrow` key for this reason.
4. Shopify MCP can't write to the MAIN theme (reads work), so the theme can't be changed from a session. Changing a theme-editor default needs a renamed setting (e.g. `auto_open` became `open_automatically`, default false) because existing values stick.
5. Railway: the agent proxy blocks curl to *.railway.app. Check health with Railway logs. Prisma's "Update available" box shows up as error-level lines on every boot; ignore it.
6. Klaviyo SMS subscribe returns 400 for numbers outside the account's SMS regions or that can't get texts. Logged as `[klaviyo] sync … failed`, harmless; the entry still counts.
7. The `/proxy` (bare) 404s in logs are bots/crawlers, harmless.
8. GitHub: never use create_repository or account-wide search tools from the cloud session. Trevor creates repos himself.

## Business rules verified in code
- Daily draw window: `[opensAt, drawAt)` = previous 9pm ET to 9pm ET (`dayTickets` in daily.server.ts). Entries are dated when earned. Purchase entries are dated at the order's placed time (`order.createdAt`). Rollbacks and voids are dated to the original entry's day. Locked by test/daily-window.integration.test.ts.
- Eligibility also needs every mandatory action done and the email opt-in when `requireEmailConsent` is on (`onlyFullyEntered` in entries/ledger.server.ts). SMS must stay optional (TCPA; Trevor chose this).
- Most actions are one-time; repeatable ones use the dedupe suffix `:periodKey` (entries/repeat.ts). So returning players can only earn daily via repeatable actions (bookmark the live show, 20/day) and purchases. A daily check-in action type exists (DAILY_CHECKIN); Trevor wants to add one (planned for 2026-10-13/14).
- Prize pick order (`ensurePrize`): the item pinned to today, then the next Upcoming Prizes item in stock, then the automatic pick ($70–100, Pokemon Sealed or English Pokemon Single, no repeat for 30 days). One unit moves available→reserved via inventoryMoveQuantities, or safety_stock→reserved (`DailyPrize.reservedFrom`). Queued and hand-chosen items can use safety stock always. The automatic pick only does with `daily.useSafetyStock`. Release puts it back where it came from. "Mark Sent" removes it from that state. Moving safety stock is untested on the live store until the first such pick.
- Queued items ignore the price range and product types.
- Risk: block ≥80, hold ≥50, verify ≥20; alwaysVerifyEmail on by default (app/lib/bot/risk.ts).

## State at 2026-10-13 14:10Z
- Live: Railway 8af9e1e, Shopify version poke-collect-giveaways-26.
- First daily draw 2026-10-13 01:00Z worked: Steven I. won the Storm Emeralda box. Today's prize: 30th Celebration ETB. Queue: Japanese 30th Celebration Booster Box (Oct 14), 30th Celebration Booster Bundle (Oct 15).
- Cloud routine "Giveaway Debug Check" (trigger trig_01BMKrTDE2YpVQVUrvKy56kW, 8:54am ET daily) runs through the 2026-10-19 check, then deletes itself. The Mac's nightly 9:38pm check was stuck on permission prompts; I recommended Trevor drop it.
- Trevor still needs to: click "Generate From Giveaway Details" and save in the daily giveaway's editor (new daily rules wording); decide whether to delete the Mac nightly check.
- Open: daily check-in action (Trevor: "when my credits reset"); monthly cutover from GiveawayNinja (ends Oct 31; plan in memory live-cutover-monthly); $0 draft order on prize claim (promised, not built; "Mark Sent" for now); Discord verification (Discord is a SOCIAL_FOLLOW click today, so honor system).
- Not built: date ranges on the giveaway page tabs (Overview/Activity/Orders). Only the Analytics page has the Draw Or Dates picker. Overview has a "Current draw / All time" toggle for Entries By Method and New Sign-Ups.
- Imports and manual adjustments are dated when added, so on a daily giveaway they count in that day's draw.

## From project memory (decisions Trevor made)
- Custom app for Poke-Collect only (not public). Stores: live poke-collect-al, test poke-collect-packs-test. Hosting Railway; Postgres on Railway.
- Linked giveaways (`settings.linkedSlug`, entries/linked.server.ts): one sign-up enters both daily and monthly. Shared: sign-up, SMS opt-in, daily check-ins, follows of the same URL. Ads run only on the monthly, and the daily popup is the daily reason to come back. Don't build features that split sign-ups between them. New shared action types go in `shareKey()`.
- Monthly cutover from GiveawayNinja (live page poke-collect.com/pages/monthly-giveaway, GN embed data-id 6abe956be8561616e8f7f773, ends Oct 31 11:59pm ET, draw Nov 1). Order: create as draft, import GN CSV, swap the widget on the page, go live, then a final top-up import (the CSV import tops up deltas). Don't backfill pre-switch orders. Ad tracking: Google Ads AW-10903141720/RrSaCJqVspgdENj6gs8o and Meta pixel 2752433665081400 Lead, fired by the giveaway block on a new entry. Don't touch the live page or theme without Trevor's OK.
- Entry amounts (monthly, copied to the daily): sign-up 1 (email opt-in required), SMS +100 optional, Whatnot follow +100 required, Discord +50, bookmark next live show +20/day, Facebook +10, Instagram +10, referral +25, purchases 5 per $1 on the monthly and 50 per $10 on the daily. The daily widget doesn't show prize value.
- Storefront copy is Title Case on buttons, titles, headers and sub text (`tc()` in giveaway.js for merchant labels). Full sentences, errors, consent/SMS text stay sentence case. Brand: Oswald, red #e22f39, ink #1a1a1a, yellow #ffd800, cream #f1eee4; popup launcher/header gift icon; "digital rain" backdrop on the daily prize.
- Trevor never pastes secrets in chat; he sets Railway variables himself.
