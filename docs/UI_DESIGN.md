# UI_DESIGN — design system and Trevor's preferences

## Two surfaces, two systems
1. **Admin (embedded app)**: Shopify Polaris **web components** (`<s-page>`, `<s-section>`, `<s-button>`, `<s-badge>`,
   `<s-table>`, `<s-grid>`, `<s-stack>`, `<s-thumbnail>`, App Bridge `shopify.resourcePicker`). Match the Mystery Packs
   admin: standard Polaris, no custom theming. Use `app/components/fields.tsx` wrappers (React 18 only reliably gets
   `input` events from custom elements, so wrappers listen to input+change). Layout: giveaway page in tabs (Overview,
   Entrants, Activity, Orders, Draws); editor 2 columns with a sticky live preview (`GiveawayPreview` renders the real
   widget). Tones: success/info/warning/critical badges; fewer banners; Title Case labels.
2. **Storefront (theme extension)**: vanilla JS/CSS, no dependencies, matching poke-collect.com's newer sections
   (Newsletter Card, Social Follow Band, Review Reward) and the Mystery Packs blocks.

## Storefront tokens (`extensions/giveaway-widget/assets/giveaway.css`, on `.pcg[data-pcg]`)
`--pcg-accent #e22f39` · `--pcg-accent-dark #b91c25` · `--pcg-ink #111114` (dark card) · `--pcg-yellow #facc15`
(highlights, "Today's Prize", entry counts) · `--pcg-green #4ade80` (done states) · `--pcg-panel rgba(255,255,255,.06)` ·
`--pcg-line rgba(255,255,255,.1)` · `--pcg-soft rgba(255,255,255,.72)` · `--pcg-radius 22px`.
- Site brand (project memory): Oswald, red #e22f39, ink #1a1a1a, yellow #ffd800, cream #f1eee4 (hosted page background).
  The widget's dark card uses the slightly different tokens above — keep using the tokens, not raw brand hexes.
- Font: inherited from the theme (Oswald on poke-collect.com, `--font-heading-family`); headings uppercase/bold.
- Social buttons are brand-colored (`.pcg__soc--whatnot` yellow #ffe11d/#ffb800 with dark text, `--discord` #6b75ff,
  `--facebook` #2d88ff, `--instagram` gradient) with a "+N" pill.
- Primary buttons red gradient → ink on hover; pills for kickers/badges; dark card with soft red/blue glows.
- Daily prize stage: Mystery Packs "digital rain" (red katakana/digits/POKECOLLECT canvas, source
  `poke-collect-mystery-packs/public/packs/opener.js` `matrixRain`) + shape-following `filter: drop-shadow` glow + slow float.
  Only when a prize is set; respects `prefers-reduced-motion`; paused when hidden.
- Breakpoints: 480px, 520px, 749/750px (phone vs desktop, matches the Dawn-style theme), reduced-motion.

## Layouts
- Page/homepage block: `three` (prize+countdown+Upcoming Prizes | entry form or "Your Entries" | ways to enter), `wide`
  2-col, `narrow`. Stacks on phones.
- Popup (app embed): desktop 2 columns, launcher button bottom-left **above the Shop chatbot** (black, mini digital
  rain, prize thumbnail, "Drawn in Xh Ym"); phones: bottom sheet (~85% height, sticky X 44px, bottom Close, swipe down),
  first screen = prize, countdown, name, email, phone opt-in button, big sticky "Enter Free"; tasks slide in after entry.
  Phone launcher = gift icon injected into the theme header next to the cart with a red dot until entered today.
- Order within the entrant view: Your Entries Today → required steps → Earn More Entries (brand buttons) → Text Alerts →
  Shop & Earn (rate, Shop Now, example products with "+N entries") → Upcoming Prizes/winner → **Referral box last**.
- Footer line: "No Purchase Necessary · Official Rules".

## Trevor's standing preferences
- **Title Case** for all storefront buttons, titles, headers and sub text (`tc()` in giveaway.js converts merchant labels;
  write new copy in Title Case anyway). Full sentences, error messages and consent/SMS disclosure text stay sentence case.
- **Never show prize value/price** on the storefront (API still returns `value`; widget hides it).
- Sleek, cohesive with the site and sister apps (Mystery Packs, Collector Coins); dark cards, red/yellow accents.
- Minimal screen clutter on mobile (site already has Shop chatbot bottom-left and Collector Coins bottom-right).
- No auto-opening popup (setting exists, default off).
- Entry badges on product page/cart drawer: "Enter Today's Giveaway Free To Earn +N Entries With This Purchase · Enter
  Free" until entered, then "This Earns +N Entries In Today's Draw · See Today's Prize"; whole bar opens the giveaway.

## Rules for new UI work
1. Scope every storefront selector under `.pcg[data-pcg]`, `.pcg-pop…`, `.pcg-badge…` — **never bare `.pcg`** (theme
   collision, see DEVELOPMENT_HISTORY). Test on a real theme page, not just the hosted page.
2. Reuse tokens above; no new colors without reason. Brand buttons via `.pcg__soc--<network>`.
3. Check phone (375px) and desktop; check the popup, the 3-column block and the hosted page.
4. Remember the hosted page inlines the same JS/CSS from the server build → needs a Railway deploy too.
5. Preview locally: copy `assets/*` to a scratch folder with a mock `window.fetch` returning proxy JSON, serve via
   `python3 -m http.server`, open in the Claude browser pane (`resize_window` mobile/desktop).
6. Admin: Polaris components only; keep tabs; Title Case labels.
