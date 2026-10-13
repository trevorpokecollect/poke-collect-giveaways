# WORKFLOWS — run, change, test, deploy, debug, roll back

Paths: repo `~/Documents/poke-collect-giveaways` (Trevor's Mac) · GitHub `trevorpokecollect/poke-collect-giveaways`
(public, branch `main`) · sister app `~/Documents/poke-collect-mystery-packs` · ops playbook
`~/Documents/poke-collect-ops/PLAYBOOK.md` · Staff Guide (must be updated when giveaway behavior changes — see Claude memory
"staff-guide-keep-current") · nightly reports `~/Documents/giveaway-debug-reports/`.

## Setup / sync
```
cd ~/Documents/poke-collect-giveaways && git pull origin main && npm install && npx prisma generate
```
Local `npm run dev` (Shopify CLI tunnel) is not used day-to-day; work is verified on the test store or live store.

## Find code fast
`rg -n "<symbol>" app extensions` · read file headers (`head -8`) · ARCHITECTURE.md §2 code map. Storefront state shape:
`app/routes/proxy.$slug.tsx` loader. Admin actions: `intent` cases in `app/routes/app.campaigns.$id.tsx`.

## Implement a change
1. Pure logic in `app/lib/*.ts` + unit test in `test/*.test.ts`; server work in `*.server.ts`.
2. Schema change → edit `prisma/schema.prisma`, add `prisma/migrations/<timestamp>_<name>/migration.sql`
   (`npx prisma migrate diff --from-schema-datamodel <old> --to-schema-datamodel prisma/schema.prisma --script`;
   set a dummy `DATABASE_URL` for validate). Migrations run automatically on Railway start.
3. New setting → `app/lib/settings.ts` with a default (applies to old campaigns too — choose safe defaults) + editor UI
   in `SettingsEditor.tsx` + validation message in `campaign-form.ts`.
4. Storefront → `extensions/giveaway-widget/assets/*`; follow UI_DESIGN.md rules.
5. Verify (all must pass before a push): `npx tsc --noEmit` · `npx eslint app test extensions/giveaway-widget/assets` ·
   `npm run build` · `DATABASE_URL=postgresql://… npx vitest run` (integration tests skip without it) ·
   `npx prettier --write <touched files>` (ESLint flags unescaped `'` in JSX — use `&apos;`).
   - Tests that import anything pulling in `app/shopify.server.ts` (e.g. `daily.server.ts`) crash on "empty appUrl":
     `vi.mock("../app/shopify.server", () => ({ unauthenticated: {} }))` (see `test/daily-window.integration.test.ts`),
     or move pure logic to a non-`.server` file (why `list-status.ts` is split from `list-status.server.ts`).
   - Migration drift check: `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel
     prisma/schema.prisma --shadow-database-url <shadow db> --script` should print an empty migration.
   - Cloud container only: local Postgres on port 5433 (`/home/claude/.pgtest`); if down, remove
     `/tmp/.s.PGSQL.5433.lock` and `/home/claude/.pgtest/data/postmaster.pid`, then
     `pg_ctl -D /home/claude/.pgtest/data -o '-p 5433 -k /tmp' -w start` as user `claude`; `npx prisma migrate deploy`.
6. Commit with a descriptive message and push `main`. **Pushing does not deploy.**

## Deploy (only on Trevor's explicit "deploy")
- **Backend/admin (Railway)**: done by the cloud project thread with Railway MCP `connect-service-source`
  (projectId `acb61a4a-e097-45a2-80b9-bf7094472f87`, serviceId `881f805d-db0e-43b8-8e0f-0e53dae14cd6`, repo
  `trevorpokecollect/poke-collect-giveaways`, branch `main`). The auto-mode classifier refuses it unless Trevor's latest
  message says "deploy" (even for bug fixes). Migrations run at container start (`npm run setup`). Check with
  `list-deployments`, then `get-logs` filter `migration` or `@level:error`. Builds take ~1–4 min.
- **Theme/checkout extensions + app config/scopes (Shopify)**: from the Mac, run as its own command:
  `cd ~/Documents/poke-collect-giveaways && git pull origin main && npx --yes @shopify/cli@latest app deploy --allow-updates`
  → reports "poke-collect-giveaways-N" (latest known: **v26**). The Mac's auto-mode safety check treats this as a production
  deploy; it runs only after Trevor says "deploy" in the current turn.
- Widget changes (`extensions/giveaway-widget/*`) reach the storefront only after `shopify app deploy` from the Mac;
  the hosted page also needs the Railway deploy (it inlines the assets). Admin/server-only changes need only Railway.
- New scopes → after Shopify deploy, Trevor opens the app in each store and approves.
- After deploying: hard-refresh/private window (theme assets cache 1–2 min); verify (below); report version + commit.

## Verify on the live store
- Storefront JSON: in the Claude browser pane on poke-collect.com run
  `await (await fetch('/apps/giveaways/daily-giveaway?format=json',{headers:{Accept:'application/json'}})).json()`
  → `daily.prize`, `daily.drawAt`, `daily.lastWinner`, `daily.upcoming`, `campaign.actions`.
- Widget sanity: `document.querySelector('[data-pcg]').getBoundingClientRect().width` > 0; theme logo
  `span.pcg:not([data-pcg])` width > 0; product badge `[data-pcg-auto="product"]` text.
- Note: the browser pane's main theme is named "Storepass - Footer Restock Alerts (draft)" but has role `main` (live).

## Debug
- Railway logs (MCP `get-logs`): `types:["http"]`, filter `@httpStatus:>=400` (watch POST `/proxy/<slug>` 403 = blocked
  sign-ups; 400 = validation); deploy logs `@level:error OR @level:warn`, `[daily]` messages.
  **Ignore noise**: Prisma "Update available 6.19.3 → 8.0.0" boxes (logged as errors), `/robots.txt` 404, HTTP 499
  "client closed", one 502 during a redeploy.
- Blocked sign-ups are logged with their signals (since `3a96437`). Risk weights: `app/lib/bot/risk.ts`.
- Daily draw: logs at draw time (21:00 ET = 01:00Z, 02:00Z after DST ends Nov 1); admin Daily Draw panel; `/jobs/daily`
  (POST with `Authorization: Bearer $CRON_SECRET`) runs jobs on demand.
- Shopify data: Shopify MCP connector (`graphql_query`) — **one store at a time; it's on the live store; don't switch
  without asking**. Order lookups: `orders(query:"name:#123")`.
- Embedded admin can't be clicked by Claude-in-Chrome (iframe); give Trevor exact click paths.
- The cloud agent proxy blocks curl to `*.railway.app`; check health via Railway logs instead.
- Known harmless log lines: `[klaviyo] sync … failed` with 400 for SMS numbers outside Klaviyo's SMS regions (entry
  still counts); bare `/proxy` 404s (bots).
- Shopify MCP can't write to the MAIN theme (reads work) — theme changes are Trevor's, via the theme editor. To change a
  theme-editor default, rename the setting (existing values stick; e.g. `auto_open` → `open_automatically`).
- Spotting a false block: the same user agent retrying many times within a minute in `signup blocked` warn lines.

## Roll back
- Railway: MCP `list-deployments` → redeploy a previous SUCCESS deployment (confirm with Trevor; destructive-ish), or
  `git revert <sha>` + push (preferred — keeps `main` == production; on the sister Mystery Packs app a Railway variable
change redeployed from `main` and silently undid a CLI-only deploy — assume the same here, unverified).
- Shopify extension: revert the commit and deploy again (new version), or release a prior version in the Partner/Dev
  Dashboard (dev.shopify.com → app → Versions).
- Data mistakes: never delete ledger rows; use admin tools (Disqualify entry/entrant, Restore, "Remove entries from orders
  placed before the start", Release prize).

## Daily operations (Trevor)
- Winner emailed automatically at 9pm ET; when they claim, ship, then click **Mark Sent** on that day's prize.
- Line up prizes in **Upcoming Prizes** (queue; pin dates); "Also Use Safety Stock" setting for safety-stock-only items.
- Theme editor: App embeds → Daily giveaway popup (slug `daily-giveaway`), blocks for product/cart badges.
- Debug checks: cloud routine "Giveaway Debug Check" (trigger `trig_01BMKrTDE2YpVQVUrvKy56kW`, 8:54am ET daily, through
  the 2026-10-19 check, then deletes itself). The Mac task `giveaway-daily-debug-check` (~9:38pm ET, through 10-18) got
  stuck on permission prompts; the cloud thread recommended Trevor delete it (his call).
- Widget preview: the admin Edit page's live preview uses the same assets (simplest manual check). The cloud thread had a
  Playwright harness (`previewData` from `app/lib/preview.ts`, desktop 1280 / phone 390, `THEME=1` injects the live
  theme's `.pcg` logo rule) in its scratchpad only — rebuild if screenshots are needed.

## Coordination with other Claude sessions
Cloud project thread (claude.ai project "Shopify giveaway app", session `session_01APxGeHdNAUAe7RTMNEHESi`) writes all
code, pushes `main`, deploys Railway. The Mac session (Remote Control) runs `shopify app deploy`, store checks and
listings unless assigned a build. Never use GitHub create-repository or account-wide search tools; Trevor creates repos. Before editing code, send a coordination note via `send_message` (`sent_to_shared_agent`) and
`git pull`; if `origin/main` moved with an overlapping change, keep theirs and drop yours.
