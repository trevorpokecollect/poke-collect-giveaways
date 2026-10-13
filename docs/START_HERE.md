# START_HERE — onboarding for a fresh Claude session

**What this is:** Poke-Collect Giveaways, a custom embedded Shopify app (live on poke-collect.com) that replaced
GiveawayNinja. It runs an automated **daily giveaway** (a real inventory product reserved as each day's prize, drawn every
night at 9pm ET from that day's entries) and will run the **monthly giveaway** (currently still on GiveawayNinja).
Entrants earn entries by signing up, social/channel tasks, referrals and purchases. Owner: Trevor — non-technical,
wants plain-English updates, Title Case storefront copy, and asks before anything goes live ("deploy").

## Where everything is
| Need | Read |
|---|---|
| Rules that always apply | `CLAUDE.md` (repo root; auto-loaded) |
| Code map, data model, integrations, env var names | `docs/ARCHITECTURE.md` |
| How to run/test/deploy/debug/roll back | `docs/WORKFLOWS.md` |
| Look & feel, Trevor's UI preferences | `docs/UI_DESIGN.md` |
| Why things are the way they are; past bugs | `docs/DEVELOPMENT_HISTORY.md` |
| What's live, open items, next steps | `docs/CURRENT_STATUS.md` |
Read `CURRENT_STATUS.md` + the one doc matching your task. Don't read all of them.

## Approach by task type
- **Bug fix**: reproduce from evidence first — Railway logs (WORKFLOWS › Debug), the storefront JSON, or Shopify data.
  Check DEVELOPMENT_HISTORY for a known cause (theme `.pcg` collision, bot false-blocks, old-order webhooks). Find code via
  ARCHITECTURE §2, fix narrowly, add a test, `npm run typecheck && npm test`.
- **New feature**: confirm the business rule with Trevor if ambiguous; put pure logic in `app/lib/*.ts` with tests;
  settings in `settings.ts` with safe defaults; admin UI with Polaris components; storefront per UI_DESIGN.
  Respect the ledger, daily-window and inventory-reservation invariants in CLAUDE.md.
- **UI change**: UI_DESIGN rules (scoped selectors, tokens, Title Case, no prices); check phone + desktop, popup +
  3-column block + hosted page; preview locally with a mocked fetch before deploying.
- **Testing without breaking things**: unit tests always; integration tests with `DATABASE_URL`; verify on the test
  store `poke-collect-packs-test` when possible; after deploy, verify on live via the storefront JSON and a quick
  visual check. Never test by creating real entries with personal data without Trevor's OK.

## Who does what
The cloud project thread (claude.ai project "Shopify giveaway app") writes code, pushes `main` and deploys Railway; the
Mac session (Remote Control, `~/Documents/poke-collect-giveaways`) runs `shopify app deploy`, store checks and listings
unless Trevor assigns it a build. Know which one you are before changing code.

## Inspect the codebase safely
`git pull origin main` first (another Claude session may have pushed). Use `rg` and file headers; open only files on the
path of your task. Don't run `shopify app deploy`, push to `main`, change Railway variables, or touch store
inventory/settings unless Trevor asked in this turn. Never print or commit secrets (public repo).

## After finishing work
1. Update `docs/CURRENT_STATUS.md` (version, commit, what changed, open items).
2. Add a row to DEVELOPMENT_HISTORY if you fixed a non-obvious bug or made a decision; update ARCHITECTURE/UI_DESIGN only
   if structure or design rules changed.
3. If customer/staff-facing behavior changed, update the Staff Guide (see Claude memory "staff-guide-keep-current").
4. Tell Trevor in plain English: what changed, what's live, what he needs to do.

## Reusable starting prompt
```
You're continuing development of the Poke-Collect Giveaways Shopify app.
Repo: ~/Documents/poke-collect-giveaways (GitHub trevorpokecollect/poke-collect-giveaways, branch main).
Read CLAUDE.md, docs/START_HERE.md and docs/CURRENT_STATUS.md, then only the other docs/ files relevant to the task.
git pull first. Don't deploy or push to main until I say "deploy". Explain results to me in plain English.
Task: <describe the bug / feature / UI change>
```
