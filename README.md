# Poke-Collect Giveaways

A Shopify app for running giveaways on Poke-Collect, built to replace GiveawayNinja. It has automatic bot
protection, purchase-based entries, and an auditable winner draw.

Built on Shopify's [React Router app template](https://github.com/Shopify/shopify-app-template-react-router)
with Polaris web components, Prisma and Postgres.

## What's here

| Area | Where |
| --- | --- |
| Admin: giveaway list, create, entrant review, draws, order log | `app/routes/app.*.tsx` |
| Storefront API (via the Shopify app proxy at `/apps/giveaways/<slug>`) | `app/routes/proxy.$slug.tsx` |
| Storefront widget (theme app block) | `extensions/giveaway-widget` |
| Purchase-entry scoring engine | `app/lib/entries/rules.ts` |
| Order webhooks (create, edit, cancel; idempotent) | `app/lib/entries/orders.server.ts` |
| Signup, verification, referrals, actions | `app/lib/entries/signup.server.ts`, `actions.server.ts` |
| Bot protection | `app/lib/bot/*` |
| Winner draw | `app/lib/draw.ts`, `app/lib/draw.server.ts` |
| Data model | `prisma/schema.prisma` |

### How entries work

Entries live in an append-only ledger (`EntryEvent`). Order edits, cancellations and bot clawbacks are written as
negative events, so totals are always explainable. Purchase scoring follows the same model GiveawayNinja documents:

```
(base + bundle + product-rule points) × period multiplier × AOV booster multiplier
```

The base can be fixed per order or per $ spent (gift cards excluded), with up to 10 bundle rules, up to 15
product/variant rules, additive AOV boosters, and the highest overlapping date multiplier. Buyers who haven't
signed up are created as entrants automatically.

### How bot protection works

Every signup is scored as it arrives; nobody has to run a scan:

- Cloudflare Turnstile (invisible unless suspicious), a honeypot field, and a minimum time to fill the form
- Email checks: disposable domains, generated-looking addresses, and alias normalization, so
  `a.s.h+1@gmail.com` and `ash@gmail.com` are the same person
- Limits per IP, per /24 subnet and per device (IPs and devices are stored only as keyed hashes)
- Self-referral detection, plus clawback of referral entries when a referrer is disqualified
- A one-time email code before any entry counts; customers signed in to their Shopify account skip it when
  they're low risk

Signals add up to a 0–100 risk score. The campaign's policy then **allows** the entry, asks for
**verification**, **holds** it for review in the admin, or **blocks** it (defaults are in
`app/lib/bot/risk.ts`). Only active entrants can win.

### Draws

`runDraw` picks weighted winners with a crypto-random seed. It stores the seed and a hash of the eligible
snapshot, so a draw can be re-run and checked later. Previous winners are excluded from redraws.

## Setup

1. Create the app in the Shopify Partner dashboard (custom distribution, Poke-Collect only), then run
   `npm run config:link` to fill `client_id`.
2. Request access to **protected customer data** (email) for the app; order webhooks need it to match buyers.
3. Copy `.env.example` to `.env`, then fill in the database URL, the Turnstile keys and the two secrets.
4. Run `npm install`, then `npx prisma migrate deploy`, then `npm run dev`.
5. In the theme editor, add the **Giveaway** block to a page and set its link name to the giveaway's slug.

## Scripts

- `npm run dev`: start the app with the Shopify CLI tunnel
- `npm test`: run unit tests. The database flow test also runs when `DATABASE_URL` points at a Postgres
  database it can write to.
- `npm run typecheck`, `npm run lint`, `npm run build`

## Setup notes

- Consolation discount codes need the `write_discounts` scope (in `shopify.app.toml`); run `shopify app deploy` and re-approve the app.
- Klaviyo sync needs `KLAVIYO_PRIVATE_KEY`; signed outbound webhooks need `OUTBOUND_WEBHOOK_SECRET` (see `.env.example`).
- Have the generated official rules reviewed before a public launch.
