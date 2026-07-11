# One-Screen Design — "The Dispatch Ledger"

**Date:** 2026-07-11
**Status:** Approved direction; supersedes the four-tab layout of the prototype spec.

## Goal

Collapse the four-tab UI (Covert / Missions / Roster / People) into a single
main screen. The game's feed and every player action live on that one screen;
detail (officer lists, dragon stats, patron ledgers) hides behind drill-in
sheets. Orientation stays portrait, phone-first, as today. The sim layer is
untouched except where noted (log-line additions only — no state-shape
changes, no `SCHEMA_VERSION` bump expected).

## Decisions already ratified with the user

1. **Inline feed model** — the log IS the screen; actionable events render as
   interactive cards in the stream (chosen over an action dock or a
   landscape cockpit).
2. **Auction stays a full-screen takeover** — a rare, high-drama set-piece,
   deliberately exempt from the one-screen rule (like the end screen).
3. **Economy verbs live in menus** — buy feed via the resource readout,
   give treasure in the dragon sheet, tribute in the patron sheet. No
   persistent action bar.
4. **Persistent chrome = header + wing strip** — day/speed/resources/standing
   on top, one compact status line per dragon below it, feed fills the rest.

## Screen anatomy (top to bottom)

### Header (existing, one change)
Day, speed scrub (⏸ ▶ ▶▶ ▶▶▶), resource counters, standing bar with the
fuzzy expectation zone — all as today. **Change:** the resource row becomes a
button that opens the Provisions sheet.

### Wing strip (new, persistent)
One line per dragon: `name · wnd N · cnt N · home/healing/afield`. When
afield, append the return countdown (`· ~2d`), reusing the countdown maths
currently in MissionsTab. When healing, append the ready-day estimate from
`availabilityForecast` (`· ready ~D34`). Tapping a line opens that dragon's
detail sheet. Empty state: the existing "The clearing stands empty" line.
This strip absorbs CovertTab's condition strip, MissionsTab's availability
forecast, and MissionsTab's active-mission countdown.

### The feed (the spine)
A single scrolling stream, auto-scrolled to the tail exactly as CovertTab's
log is today (including the ring-buffer-aware scroll effect). Two layers:

- **History:** `state.log` lines rendered chronologically (`D{n} — text`),
  unchanged.
- **Live actionables, pinned at the tail:** below the newest log line, in
  arrival order:
  - one **offer card** per mission with `status === 'offered'`
  - one **decision card** per entry in `state.pendingCards`

Pinned-at-tail (rather than woven at their arrival day) is deliberate: the
sim deletes declined offers and answered cards from state, the log line the
sim writes at resolution becomes the permanent record in place, and a
pending action can never scroll up out of view while it still needs an
answer. The auto-pause behaviour in `store.svelte.ts` is already correct for
this design and must not change.

**Offer card** (ports MissionsTab's board card wholesale): name, kind,
severity copy, reward line, patron attribution, answer-by/promise days,
enemy display (including the trap uncertainty range), weather word, the
dragon picker with per-dragon chance %/risk label (trap-pessimistic where
flagged), Accept (disabled until a valid home dragon is picked) and Decline
(with the war-heat refusal-cost warning). All projection/trap logic moves
verbatim — it must keep reading `successChance` from `src/sim/projection.ts`
(forecast-honesty invariant).

**Decision card** (replaces CardOverlay): prompt text and option buttons
inline in the feed. It no longer blocks the whole screen; auto-pause already
freezes time when one appears. CardOverlay is deleted.

**Log-line completeness (only sim change):** every actionable's resolution
must leave a trace in `state.log` so the ledger never has gaps — offer
arrival, acceptance (departure), decline, offer expiry, and card choice.
Audit the sim for which of these already log (mission returns and several
others already do) and add plain `pushLog` calls for any missing. Log-only
additions; no state shape changes. Balance harness (`npm run sim -- 300`)
must stay green afterwards — log lines don't affect balance, this is a
regression tripwire.

### Menu bar (bottom, slim)
Two buttons, replacing the four tabs: **Roster** and **People**. Each opens
a bottom sheet over the feed. No attention badges: actions never hide in
menus — only detail does.

## Sheets (bottom sheets over the feed)

All sheets are dismissible (swipe-down affordance optional; a close button
suffices), render over the feed without unmounting it, and pause nothing —
time keeps running unless auto-pause fires.

- **Roster sheet:** RosterTab's content minus the feed-buying row — dragon
  cards (training/wounds/contentment bars, give-treasure button) and the
  officer rank groups including the Lost section and candidate badges.
- **Dragon focus:** tapping a wing-strip line opens the Roster sheet
  scrolled to that dragon's card (no separate per-dragon sheet). One tap
  from strip to that dragon's full stats + give treasure.
- **People sheet:** PeopleTab wholesale — patron cards, tier dots, goodwill,
  memory line, tribute button.
- **Provisions sheet:** the feed row from RosterTab — current feed, daily
  burn, buy-5 button — opened from the header resource readout.

## Out of scope / unchanged

- `AuctionScene` full-screen takeover, `EndScreen`, the store's tick loop,
  auto-pause rules, save/load, seed handling.
- No landscape-specific layout work.
- Sim state shape, balance values, `SCHEMA_VERSION`.

## Component plan

| Component | Fate |
|---|---|
| `App.svelte` | Restructures: header + WingStrip + Feed + MenuBar + sheet host |
| `CovertTab.svelte` | Deleted (strip → WingStrip, log → Feed) |
| `MissionsTab.svelte` | Deleted (board card → OfferCard, forecast/countdown → WingStrip) |
| `RosterTab.svelte` | Becomes RosterSheet (minus feed row) |
| `PeopleTab.svelte` | Becomes PeopleSheet |
| `CardOverlay.svelte` | Deleted (→ DecisionCard in feed) |
| New | `WingStrip.svelte`, `Feed.svelte`, `OfferCard.svelte`, `DecisionCard.svelte`, `Sheet.svelte` (host), `ProvisionsSheet.svelte`, `MenuBar.svelte` |
| `store.svelte.ts` | `tab` field replaced by `openSheet: 'roster' \| 'people' \| 'provisions' \| null` (+ optional focus dragon id) |

## Error handling

Nothing new: all actions already guard in the sim and throw on illegal
calls; the UI keeps the existing pattern of disabling buttons that the sim
would reject (accept-gate, coin/treasure gates, claim-gate).

## Testing

- Existing Vitest sim suite untouched and green.
- `npm run check` green.
- Existing Playwright e2e (if any assert on tabs) updated to the new
  structure; the `window.__game` / `window.__actions` hooks stay.
- Manual smoke via `?seed=1&speed=20`: offer card appears in feed and is
  acceptable/declinable; decision card answerable inline; sheets open/close;
  wing strip counts down an active mission; auction takeover still fires.
