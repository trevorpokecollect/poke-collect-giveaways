@AGENTS.md

# Poke-Collect Giveaways — master instructions

Custom embedded Shopify app (replaces GiveawayNinja) for poke-collect.com: monthly + automated **daily** giveaways with
entry tasks, purchase entries, bot protection, weighted draws, winner claims. Owner: Trevor (non-technical; explain in
plain English, Title Case for storefront copy). **Read `docs/START_HERE.md` first; then only the doc your task needs.**

## Stack (verified)
React Router 7 (Shopify app template) + Polaris web components (`s-*`) · Prisma 6 + Postgres · Node ≥22.12 ·
Railway (app service, Postgres) · Theme app extension `extensions/giveaway-widget` (vanilla JS/CSS, Liquid) ·
Checkout UI extension `extensions/giveaway-thank-you` · Resend (email) · Klaviyo · Cloudflare Turnstile · vitest.

## Non-negotiable rules
- **Entries = append-only ledger** (`EntryEvent`). Never edit/delete events; reverse with negative events (ROLLBACK/
  ADJUSTMENT). Totals are always derived. Dedupe keys prevent double awards.
- **Daily draw counts only entries whose `EntryEvent.createdAt` is in `[opensAt, drawAt)`** (prev 9pm → 9pm ET,
  `dayTickets`). Purchase entries are dated at the order's placed time; rollbacks/voids at the original entry's day;
  imports/manual adjustments at the time added. Locked by `test/daily-window.integration.test.ts`.
- **Eligibility** also needs every mandatory action done and the email opt-in when `requireEmailConsent` is on
  (`onlyFullyEntered` in `ledger.server.ts`).
- **Time math**: 9pm ET = 01:00Z next day. Never derive store dates from `drawAt.toISOString()`; use `periodFor` /
  `periodForKey` / `addDays` in `app/lib/daily.ts` (the widget's "Tomorrow" uses server-sent `daily.tomorrow`).
- **Linked giveaways** (`settings.linkedSlug`): one sign-up enters daily + monthly; never build features that split
  sign-ups between them; new shared action types go in `shareKey()` (`entries/linked.server.ts`).
- **Only orders placed after a giveaway's start earn entries** (`ordersCountFrom`). orders/updated fires for old orders.
- **Prize stock is reserved in Shopify** (available or safety_stock → reserved via `inventoryMoveQuantities`); release
  returns it to the same state (`DailyPrize.reservedFrom`); "Mark Sent" removes it. Never adjust stock any other way.
- **Bot protection must not block real people**: no single client-side signal may block on its own except
  `turnstile_failed` (an invalid token). Missing token / honeypot → email code. Blocked attempts log
  `signup blocked {campaign, score, signals}`. See `app/lib/bot/risk.ts`.
- **CSS: every widget selector scoped to `.pcg[data-pcg]` / `.pcg-pop` etc.** The live theme uses a `.pcg` class on its
  header logo — bare `.pcg` rules break the logo and the widget. Never style bare `.pcg`.
- **Storefront copy: Title Case on buttons/titles/headers/sub text** (`tc()` in giveaway.js for merchant labels); full
  sentences, errors and consent/SMS text stay sentence case. **Never show prize value/price** on the storefront.
- **SMS consent is optional** (never required to enter). Required steps = email opt-in, name (first+last), Whatnot follow.
- **Repo is PUBLIC on GitHub — never commit secrets.** Only `TURNSTILE_SITE_KEY`-style public values may appear.
- Don't change app code during docs-only tasks; don't deploy without Trevor's explicit "deploy".

## Working conventions
- Pure logic lives in `app/lib/*.ts` (unit-tested, browser-safe); DB/Shopify in `*.server.ts`. Keep `node:crypto` out of
  files imported by components (see `app/lib/names.ts`).
- Edit theme widget code in `extensions/giveaway-widget/assets/*`; the hosted page (`/apps/giveaways/<slug>`) inlines
  the same files from the server build, so widget changes need **both** a Shopify deploy and a Railway deploy.
- After pulling schema changes run `npx prisma generate` before `tsc`. New tables → add a migration in `prisma/migrations`.
- Before every push: `npx tsc --noEmit`, `npx eslint app test extensions/giveaway-widget/assets`, `npm run build`,
  `npx vitest run` (with `DATABASE_URL` for integration tests; 159 tests at 8af9e1e), `npx prettier --write` touched files.
  Tests importing anything that pulls in `app/shopify.server.ts` must `vi.mock("../app/shopify.server", …)`.
- **Roles**: the cloud project thread writes app code, pushes `main` and deploys Railway; Trevor's Mac only runs
  `shopify app deploy`, store checks and listings unless Trevor assigns it a build. **Pushing `main` does not deploy**;
  Railway deploys via Railway MCP `connect-service-source`, only after Trevor says "deploy". Coordinate before editing —
  both sessions built the same feature twice.
- After a change that affects customers/staff, update `docs/CURRENT_STATUS.md` (and the Staff Guide, see WORKFLOWS).

## Docs (read only what you need)
`docs/START_HERE.md` (onboarding + reusable prompt) · `docs/ARCHITECTURE.md` (code map, data model, integrations) ·
`docs/WORKFLOWS.md` (run/test/deploy/debug/rollback) · `docs/UI_DESIGN.md` (design system, Trevor's preferences) ·
`docs/DEVELOPMENT_HISTORY.md` (decisions, bugs, lessons) · `docs/CURRENT_STATUS.md` (state, open items).
