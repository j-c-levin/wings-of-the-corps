# Wings of the Corps

A phone-first, text-only web prototype. You command a covert of the Aerial Corps —
Temeraire-inspired, dragons and their bonded captains — building a wing of two
or three beasts out of nothing while the drumbeat of an approaching war gets
louder. One run is a slow burn from a threadbare clearing and a borrowed egg
to the finale muster before the invasion.

Svelte 5 + TypeScript + Vite. Fully static, client-side only; saves live in
localStorage.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (append `?seed=1&speed=20` for a deterministic, fast-forwarded run — `speed` scales the wall-clock tick interval, independent of the in-game play-speed buttons) |
| `npm test` | Vitest suite over the simulation core |
| `npm run build` | Production build to `dist/` |
| `npm run check` | svelte-check + tsc over the app and scripts |
| `npm run sim -- 300` | Headless balance harness: a bot plays N seeded runs through the public sim surface and prints win rate, loss breakdown, opening-choice win rates, finale timing, and auction outcomes |

## Architecture

- `src/sim/` — the whole game as a pure, deterministic state machine. No DOM,
  no Svelte, no `Math.random()`/`Date.now()`; all randomness flows through a
  seeded serializable RNG carried in `state.rngState`. Same seed, same player
  actions, same run, every time. `newRun(seed)` builds the starting state;
  `tick(state)` advances one tick (`TICKS_PER_DAY` ticks per day); player
  verbs live in `actions.ts` (accept/decline a mission, buy feed, spend
  patron goodwill, answer a decision card, claim an auction egg, …); every
  tuning number lives in `balance.ts`. `auction.ts` is the hatching-auction
  state machine that every dragon arrives through; `missions.ts` generates
  and resolves dispatches; `patrons.ts` and `cards.ts` drive the
  relationship/decision-card economy; `war.ts` runs the background heat
  clock and the authored finale.
- `src/ui/` — a thin Svelte 5 layer. Renders state, calls sim actions,
  computes no game logic of its own. `store.svelte.ts` drives the tick loop,
  auto-pauses on notable moments (a card appears, an auction opens, a
  mission returns), and persists to `localStorage` after every action.
- `src/sim/projection.ts` — the dispatch forecast (`successChance`,
  `riskLabel`, `dragonPower`). It is read by both the missions board (to show
  odds before you commit) and the mission resolver (to decide the outcome) —
  the same function, not two copies that could drift apart.
- `scripts/simulate.ts` — the balance harness bot (test tooling, not game
  code). Plays entirely through the public sim surface — `newRun`/`tick`/
  `actions.ts` — with a simple competent policy, never touching state
  directly.

Design docs: `docs/superpowers/specs/` (the game spec) and
`docs/superpowers/plans/` (the implementation plan it was built from).

### Invariants (do not break)

1. **Sim purity, determinism, and serializability.** `src/sim/` has no DOM
   access and no non-seeded randomness; every run is `newRun(seed)` +
   a sequence of `tick`/action calls, fully reproducible. `GameState` stays
   JSON-serializable (no classes, `Map`s, or functions on it) — it is written
   to `localStorage` verbatim after every action. Bump `SCHEMA_VERSION` in
   `balance.ts` on any shape change (old saves are discarded by design, not
   migrated).
2. **Forecast honesty:** `projection.ts`'s `successChance` is the single
   source of truth for a dragon's odds on a mission. The missions board reads
   it to show a percentage before you dispatch; `missions.ts`'s resolver
   reads the *same* function to decide the roll. They must never be two
   independently-tuned copies — a displayed 83% that isn't really 83% is a
   broken promise to the player.
3. **Every tuning constant lives in `balance.ts`.** No magic numbers in
   `src/sim/` or `scripts/simulate.ts` — a literal price, chance, or
   threshold buried in logic is a number nobody will find when it's time to
   retune.
4. **UI buttons are disabled/hidden for every throw path of the action they
   call.** Sim actions throw on invalid input (insufficient coin, no live
   auction, wrong turn to claim, …) and the UI has no try/catch — an
   `Accept`/`Claim`/`Buy` button must never be clickable in a state where the
   underlying action would throw.
5. **Scripted-auction guarantee:** the first (FTUE) hatching auction can
   neither be lost nor won early on a better egg than the promised one — see
   the design-ruling comment at the top of `src/sim/auction.ts`. Any change
   to the auction state machine must re-verify this against
   `tests/auction.test.ts`'s FTUE-guarantee suite, including the early-spend
   case.
6. **Re-run `npm run sim -- 300` after any balance or auction-maths change**
   and confirm it stays in band: overall win rate 40–70%, every opening's win
   rate ≥25%, median finale-start day in the 300–380 window, and a timeout
   rate under 5%.
