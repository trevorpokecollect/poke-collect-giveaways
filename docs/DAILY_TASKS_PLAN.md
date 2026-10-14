# Daily Tasks: Audit And Plan

_2026-10-13 · branch `claude/daily-tasks` · nothing deployed_

## 1. How It Works Today

- **Giveaway ID / customer ID.** Each giveaway is a `Campaign`. A person is an `Entrant` (one per email per giveaway),
  identified in the browser by a signed entrant token. Shopify customer accounts are not used for entering, so the
  "customer ID" for Daily Tasks is the entrant. A new giveaway means new entrants, so its task history starts fresh.
- **Entries.** Every entry is a row in the append-only ledger `EntryEvent` (giveaway, entrant, task, entries, time,
  `dedupeKey`). Totals, the leaderboard and the draw all add these rows up. The database refuses two rows with the
  same `dedupeKey` in a giveaway, which is what stops double awards.
- **Tasks.** `EntryAction` rows on the giveaway. The live daily giveaway has: Follow Us On Whatnot (+100, required),
  Join Our Discord (+50), Like Us On Facebook (+10), Follow Us On Instagram (+10), Get Text Alerts (+100, optional),
  Bookmark Our Next Live Show (+20, already repeats once per day), Refer A Friend (+25).
- **Repeat tasks.** A repeatable task's key ends with the day, e.g. `action:<task>:<entrant>:2026-10-14`, so a second
  claim that day is ignored. For the daily giveaway "the day" is the draw day (9pm ET to 9pm ET).
- **Locking.** Today only the required Whatnot follow unlocks the other tasks (checked on the server).
- **Referrals.** Link with `?ref=<code>` + Copy button + X / Facebook / WhatsApp share buttons. Rewards are given when
  the friend verifies (`REFERRAL` ledger rows). The share buttons are only a front-end shortcut.

## 2. One Decision For Trevor: When Daily Tasks Reset

The daily draw runs 9pm ET to 9pm ET (8pm to 8pm Central) and only counts entries earned in that window. A midnight
Central reset doesn't line up with it:

- Someone could Bookmark at 9pm Central (counts in tomorrow's draw), then again at 12:01am (also tomorrow's draw):
  **2x the daily task entries in one draw**, and "Your Entries Today" would look wrong.
- Between the 8pm draw and midnight, a person who already claimed that calendar day can't earn anything for the new
  draw that just opened.

**Recommended:** reset Daily Tasks when the draw happens (9pm ET / 8pm CT), so it's "once per draw". The countdown on
the page shows the same time as the draw countdown. Midnight Central stays available as a setting (and is what a
giveaway without a daily draw, like the monthly, uses). The Friday live task uses its own window either way.

## 3. What I'm Building

| Piece | Change |
|---|---|
| **Daily Task flag** | New "Daily Task" checkbox on a task in the editor (`config.daily`). Daily tasks repeat once per day and show in the new Daily Tasks section. No database migration: it's stored in the task's existing settings. |
| **Unlock rule** | Daily tasks unlock when every one-time follow task is done (today: Whatnot, Discord, Facebook, Instagram). Text alerts are never part of it (SMS must stay optional). Checked on the server on every claim. |
| **Bookmark Our Next Show** | Converted to a daily task, +20, same link. |
| **Like & Comment On Instagram** | New daily task, +5. Editor holds one or more post/Reel links (one per line); the page rotates through them by day. Two steps: the button opens the post, then "I Liked & Commented" claims it. |
| **Join Our Live Whatnot Show** | New daily task, +50, with a schedule (Fridays 5:00–8:00pm, America/Chicago) and an on/off switch for canceled shows. Hidden outside the window; the server refuses claims outside it. Once per Friday per person per giveaway. |
| **Reset countdown** | "Resets In 3h 12m" on the Daily Tasks header; completed tasks show "Done Today" and "Back At 9pm ET". |
| **Referral box** | Keep the link and Copy button; remove the X / Facebook / WhatsApp buttons. Tracking and rewards untouched. |
| **Race fix** | If two claims arrive at the same instant, the second now returns "already counted" instead of an error. |
| **Official Rules** | Generator adds the Instagram release ("not sponsored, endorsed or administered by Instagram") when an Instagram task exists. |

Files: `app/lib/entries/actions.ts`, `actions.server.ts`, `repeat.ts`, `ledger.server.ts`, new `app/lib/daily-tasks.ts`
(pure time/window/unlock logic + tests), `app/components/ActionsEditor.tsx`, `app/lib/campaign-form*.ts`, `app/routes/proxy.$slug.tsx`
(sends `dailyTasks` state), `extensions/giveaway-widget/assets/giveaway.js` + `giveaway.css`, rules generator. No new tables.

## 4. Verification Limits (Honest Version)

- **Instagram likes:** no official API lists who liked a post (only a count). **Not verifiable.**
- **Instagram comments:** the Instagram Graph API can list comments (with usernames) on our own posts, given a Meta app
  with `instagram_business_manage_comments` and the IG account as a professional account. Developers report the
  username field being flaky. Possible phase 2: entrant types their IG handle once, we check for their comment.
- **Whatnot live status / attendance:** Whatnot's Seller API is a closed developer preview (not taking applicants) and
  doesn't list live status or viewers. **Not verifiable.** The task runs on the schedule plus the on/off switch.
- So in v1, Bookmark, Instagram and Live are **rewarded clicks / self-confirmations**, and the page says so ("Tap after
  you like and comment"), never "verified". Admin activity shows them as ordinary task entries.
- The live button says "🔴 LIVE ON WHATNOT — JOIN NOW" only while the switch is on and inside the window. If Trevor
  doesn't flip the switch off for a canceled show, the page would still say live: the switch is the safeguard.

## 5. Rules And Compliance

- Free entry stays: sign-up and all daily tasks are free; the mail-in alternate entry is unaffected.
- Instagram promotion rules: Official Rules need a release of Instagram and a "not sponsored by Instagram" line
  (added by the generator); never ask people to tag themselves in photos they're not in.
- Facebook doesn't allow "share on your timeline to enter", which is one more reason to drop the share buttons.

## 6. Test Plan

Unit: reset boundaries (draw time and midnight CT), DST (Nov 1 2026, Mar 14 2027), Friday window edges (4:59 / 5:00 /
7:59 / 8:00pm CT), rotation by day, unlock rule. Integration (Postgres): unlock after 4 follows, double claim (same
tab, two parallel requests) awards once, next-day claim works, new giveaway gets fresh claims, Friday claim outside
window refused, switch off refused, entries land in the right daily draw, referral still awards. Visual: popup,
3-column block and hosted page on phone + desktop with a mocked response.

## 7. More Free Daily Entry Ideas (Not Building Without Approval)

| Idea | Entries | How | Verifiable | Effort | Why |
|---|---|---|---|---|---|
| **Quick wins** |||||
| Daily Check-In | +5 | Tap once a day on the giveaway | Yes (visit) | Tiny (type exists) | Daily return habit |
| Secret Code Of The Day | +10 | Code said on Whatnot / IG story / Discord | Yes (code) | Small (type exists) | Real proof of watching; best live-show verifier |
| Daily Pokémon Trivia | +5 | One question per day, 3 tries | Yes (answer) | Small (rotation) | Fun, no social needed |
| Watch Today's Reel | +5 | Timed video on the page | Partly (time) | Small (type exists) | Grows Reel views |
| **Medium** |||||
| 7-Day Streak Bonus | +25 | Claim a daily task 7 days running | Yes | Medium | Retention |
| Explore A Featured Product | +3 | Open today's product page | Yes (page visit) | Medium | Gets people browsing the store |
| Vote: Next Show's Packs | +3 | Daily poll | Yes | Medium (rotation) | Engagement + useful data |
| Daily Discord Check-In | +5 | `/checkin` in Discord | Yes (bot) | Medium-High | Discord activity |
| **Advanced** |||||
| Verified Instagram Comment | +5 | Enter IG handle once; we check comments | Yes (API) | High (Meta app review) | Replaces self-confirm |
| Referral Milestones | +50 | At 3 / 10 verified referrals | Yes | Medium | Organic sharing |

Compliance notes: keep every daily task free; streak and referral bonuses are fine but should be in the Official Rules;
avoid anything that requires a purchase or a public share on Facebook.
