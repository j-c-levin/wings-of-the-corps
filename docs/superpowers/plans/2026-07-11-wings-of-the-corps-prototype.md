# Wings of the Corps Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phone-first, text-only Svelte web game implementing the full compressed arc of the Wings of the Corps design spec (`docs/superpowers/specs/2026-07-11-wings-of-the-corps-prototype-design.md`).

**Architecture:** Pure deterministic sim core in `src/sim/` (seeded RNG carried in JSON-serializable state, `tick(state)` advances one second, player verbs in `actions.ts`), thin Svelte 5 UI in `src/ui/` that renders state and calls actions, and a headless balance bot in `scripts/simulate.ts`. Mission risk reads and the resolver share the same functions so the forecast cannot lie.

**Tech Stack:** Svelte 5 + TypeScript + Vite, Vitest, tsx (for the bot). No runtime dependencies.

## Global Constraints

- **Sim purity:** nothing in `src/sim/` imports DOM, Svelte, or uses `Math.random()`/`Date.now()`. All randomness flows through the seeded RNG whose state lives in `GameState.rngState`. Same seed → same run.
- **`GameState` is JSON-serializable** — no classes, Maps, Sets, functions, or `undefined`-only fields. Bump `SCHEMA_VERSION` in `balance.ts` on any shape change.
- **Every tuning constant lives in `balance.ts`** — no magic numbers in tick/actions/resolution code.
- **Forecast honesty:** `projection.ts` exports the risk/availability functions; both the UI's risk read and the mission resolver call the same functions.
- **UI computes no game logic** and every button is disabled/hidden for each throw path of the action it calls (sim actions throw on invalid input; the UI has no try/catch).
- **Decision cards are serializable**: `pendingCards` holds `{templateId, params}`; behavior lives in a card registry in `src/sim/cards.ts`.
- Tests: `npm test` (Vitest) green after every task. TypeScript strict.
- Commit after every task with a conventional-commit message.

## File Structure

```
package.json / vite.config.ts / tsconfig*.json / index.html / src/main.ts
src/sim/rng.ts          — mulberry32 PRNG (copied pattern from merc-company)
src/sim/types.ts        — all shared types (locked in Task 2)
src/sim/balance.ts      — SCHEMA_VERSION + every tuning constant
src/sim/content.ts      — names, breeds, patrons, flavor/log lines, mission templates
src/sim/newRun.ts       — newRun(seed): initial GameState incl. sponsorship card
src/sim/tick.ts         — tick(state): time, upkeep, healing/training, log, schedulers
src/sim/missions.ts     — offer generation, resolution (uses projection.ts)
src/sim/projection.ts   — successChance(), riskLabel(), availabilityForecast()
src/sim/auction.ts      — auction state machine (tickAuction, claim logic)
src/sim/patrons.ts      — tier/goodwill mutations, unprompted gift/sabotage rolls
src/sim/cards.ts        — decision-card registry: scripted + generated cards
src/sim/actions.ts      — every player verb; throws on invalid input
src/sim/war.ts          — war heat escalation, finale sequence, endings/scoring
src/ui/store.svelte.ts  — $state store, tick loop w/ scrub speed, localStorage
src/ui/App.svelte       — header (date/coin/feed/standing/scrub) + tab bar + overlays
src/ui/CovertTab.svelte / MissionsTab.svelte / RosterTab.svelte / PeopleTab.svelte
src/ui/CardOverlay.svelte — decision card full-screen overlay
src/ui/AuctionScene.svelte — the real-time auction set-piece
src/ui/EndScreen.svelte
scripts/simulate.ts     — headless balance bot
tests/*.test.ts         — Vitest over sim core (one file per sim module)
```

---

### Task 1: Scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `index.html`, `src/main.ts`, `src/ui/App.svelte`, `src/sim/rng.ts`, `tests/rng.test.ts`, `.gitignore`

**Interfaces:**
- Produces: `createRng(seedOrState: number): Rng` with `next(): number` (0..1), `int(min,max)`, `pick<T>(arr: T[]): T`, `getState(): number`, `setState(s: number)`.

- [ ] **Step 1:** Copy merc-company's devDependency set (svelte ^5, vite ^8, vitest ^4, tsx, svelte-check, typescript ~6, @sveltejs/vite-plugin-svelte, @tsconfig/svelte, @types/node) into `package.json` with scripts `dev/build/preview/check/test/test:watch/sim` (sim = `tsx scripts/simulate.ts`). Name: `wings-of-the-corps`.
- [ ] **Step 2:** `vite.config.ts` with svelte plugin; `index.html` with `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`, dark background, mount `#app`; `src/main.ts` mounts `App.svelte` (Svelte 5 `mount()`); `App.svelte` renders `<h1>Wings of the Corps</h1>` placeholder. tsconfigs copied from merc-company pattern (strict).
- [ ] **Step 3:** `src/sim/rng.ts`: mulberry32 exactly as merc-company plus a `pick` helper:

```ts
pick<T>(arr: T[]): T { return arr[Math.floor(this.next() * arr.length)] }
```

- [ ] **Step 4:** `tests/rng.test.ts`: same seed → same first 5 floats; `setState(getState())` roundtrip continues identically; `int(1,3)` stays in bounds over 100 draws.
- [ ] **Step 5:** `npm install`, `npm test` → PASS, `npm run build` → succeeds, commit `feat: scaffold svelte+vite+vitest with seeded rng`.

---

### Task 2: Types, balance, content, newRun

**Files:**
- Create: `src/sim/types.ts`, `src/sim/balance.ts`, `src/sim/content.ts`, `src/sim/newRun.ts`, `tests/newRun.test.ts`

**Interfaces (Produces — this is the vocabulary every later task consumes; copy exactly):**

```ts
// types.ts
export type Id = string
export type BreedId = 'winchester' | 'greyling' | 'grey-copper' | 'yellow-reaper' | 'longwing' | 'chequered-nettle' | 'kazilik'
export type Rank = 'runner' | 'ensign' | 'midwingman' | 'lieutenant' | 'captain'

export interface Officer {
  id: Id; name: string; gender: 'm' | 'f'
  rank: Rank; xp: number
  skill: number        // 1..10, derived-but-stored, grows with xp
  nerve: number        // 1..10, fixed at creation
  morale: number       // 0..100
  dragonId: Id | null  // set when captain
  relatedPatronId: Id | null
  alive: boolean
}

export interface Dragon {
  id: Id; name: string; breed: BreedId
  training: number       // 0..100
  woundsTemp: number     // 0..100, heals over time; 100 = out of action
  woundsLasting: number  // 0..30, permanent penalty
  contentment: number    // 0..100
  captainId: Id
  status: 'home' | 'mission' | 'healing'
  missionId: Id | null
}

export type PatronKind = 'gratitude' | 'transactional' | 'rival'
export interface Patron {
  id: Id; name: string; kind: PatronKind
  tier: number      // -3..3
  goodwill: number  // 0..10 spendable
  memory: string    // one-line last grievance/favour, shown on People tab
}

export type MissionKind = 'dispatch' | 'combat' | 'formation' | 'war'
export interface MissionOutcome {
  success: boolean
  woundsTemp: number; woundsLasting: number
  crewLost: number             // unnamed ground-crew count
  officerLostId: Id | null     // severity 2+
  dragonLost: boolean          // severity 3 only
  narrative: string
}
export interface Mission {
  id: Id; name: string; kind: MissionKind
  severityTier: 1 | 2 | 3
  rewardCoin: number; rewardTreasure: number; rewardStanding: number
  patronId: Id | null
  offerExpiresDay: number      // accept by this day or it vanishes (late: refusal cost)
  deadlineDay: number          // must RESOLVE by this day or promise broken
  durationTicks: number
  enemyStrength: number        // 0..10 visible
  weather: number              // 0..1 visible, higher = worse
  status: 'offered' | 'active' | 'done'
  assignedDragonId: Id | null
  returnTick: number | null
  outcome: MissionOutcome | null
}

export interface AuctionEgg { breed: BreedId; claimedBy: string | null }
export interface AuctionBidder { name: string; influence: number; you: boolean }
export interface Auction {
  eggs: AuctionEgg[]              // ordered best→worst
  bidders: AuctionBidder[]        // sorted desc by influence each tick
  ticksRemaining: number
  ticksPerClaim: number
  nextClaimIn: number
  concluded: boolean
  wonBreed: BreedId | null
  candidateOfficerId: Id
}

export interface CardInstance { id: Id; templateId: string; params: Record<string, string | number> }
export interface LogLine { day: number; text: string }

export interface GameState {
  schemaVersion: number
  seed: number; rngState: number
  status: 'running' | 'ended'
  ending: 'relieved' | 'wing-destroyed' | 'survived' | null
  score: number
  tickCount: number; day: number
  rung: 1 | 2 | 3 | 4
  coin: number; feed: number; treasure: number
  standing: number       // 0..100
  expectation: number    // 0..100 rising red line
  failStreakDays: number // days spent with standing < expectation
  officers: Officer[]; dragons: Dragon[]; patrons: Patron[]
  missions: Mission[]; auction: Auction | null
  pendingCards: CardInstance[]
  log: LogLine[]         // capped ring, newest last
  warHeat: number        // 0..100 hidden
  finaleStarted: boolean
  flags: Record<string, boolean>
  nextId: number         // monotonic id counter ("o1","d2","m3"…)
}
```

```ts
// balance.ts (initial values; the bot task will retune)
export const SCHEMA_VERSION = 1
export const TICKS_PER_DAY = 3
export const LOG_CAP = 60
export const START_COIN = 60
export const RUNG_STANDING = { 2: 20, 3: 45, 4: 70 } as const  // auction triggers at 2/3; 4 = finale eligibility
export const RUNG_RANK_GATE: Record<2 | 3, Rank> = { 2: 'midwingman', 3: 'lieutenant' }
export const EXPECTATION_RISE_PER_STANDING = 0.55 // expectation trails standing growth
export const EXPECTATION_FLOOR_BY_RUNG = { 1: 0, 2: 12, 3: 30, 4: 50 } as const
export const FAIL_DAYS_TO_RELIEVED = 30           // sustained standing<expectation ends run
export const FEED_COST: Record<BreedId, number> = { winchester: 1, greyling: 1, 'grey-copper': 2, 'yellow-reaper': 3, longwing: 3, 'chequered-nettle': 6, kazilik: 6 }
export const WAR_HEAT_PER_DAY = 0.28              // ~360 days to finale
export const FINALE_HEAT = 100
// mission maths
export const BASE_SUCCESS = 0.95
export const ENEMY_WEIGHT = 0.06
export const READINESS_WEIGHT = 0.05
export const WEATHER_WEIGHT = 0.10
export const MIN_SUCCESS = 0.05
export const MAX_SUCCESS = 0.98
// …plus every other constant referenced in later tasks
```

`content.ts` provides: `BREEDS` metadata (display name, weight class, dispatch/combat power multipliers), 30+ officer names (mixed gender), dragon names per breed, the three patrons (Lady Allendale — gratitude; Lord Barham — transactional; Captain Rankin — rival), mission name/flavor generators, ~40 covert log flavor lines keyed by context (feeding, training, gossip, wounded, funeral, war-rumor tiers).

`newRun(seed)` creates: 6 officers (the 3 candidates: `bestCandidate` skill 7 nerve 7 unconnected; patron A's relative skill 4; patron B's relative skill 4 — plus 3 juniors), patrons (A tier +1 goodwill 4; B tier 0 goodwill 0; rival tier −1 goodwill 0), no dragons, `pendingCards: [{templateId:'sponsorship', …}]`, coin 60, standing 5, expectation 0, rung 1.

- [ ] **Step 1:** Write `tests/newRun.test.ts`: same seed → deep-equal states; state survives `JSON.parse(JSON.stringify())` roundtrip deep-equal; contains 3 patrons with the spec's starting tiers/goodwill; zero dragons; first pending card is `sponsorship`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** implement the four files. **Step 4:** run → PASS, `npm run check` clean. **Step 5:** commit `feat: sim types, balance, content, newRun`.

---

### Task 3: Tick engine — time, upkeep, healing, training, log, red line

**Files:**
- Create: `src/sim/tick.ts`, `tests/tick.test.ts`

**Interfaces:**
- Consumes: Task 2 types/balance/content.
- Produces: `tick(state: GameState): void` (mutates in place); helper `addLog(state, text)`; `spendCoin/gainCoin` etc. NOT exported piecemeal — one `tick` plus `addLog`. Later tasks (missions/auction/war) register work inside tick via direct calls — Task 3 leaves clearly-marked call sites: `tickMissions(state, rng)`, `tickAuction(state, rng)`, `tickWar(state, rng)`, `tickPatrons(state, rng)` imported lazily as they land (stub no-op modules created here so tick.ts compiles and later tasks fill them).

Behavior per tick: `tickCount++`; recompute `day`; on each new day: feed upkeep (sum FEED_COST; feed shortfall → contentment −4/day each dragon + log), healing (`woundsTemp −2/day`, dragon at `woundsTemp ≥ 60` is status `healing` and unavailable), passive training gain for home dragons, contentment drift toward 50, expectation update (`expectation = max(floor, min(100, standing * EXPECTATION_RISE_PER_STANDING + rungBonus))`), red-line accounting (`failStreakDays` ± reset; at `FAIL_DAYS_TO_RELIEVED` → `status='ended', ending='relieved'`), flavor log roll (one contextual line/day), and the stubbed subsystem calls. Cards pending → nothing pauses inside the sim (pausing is UI-only), but **no new offers/auctions generate while a card is pending** (keeps FTUE deterministic).

- [ ] Steps: failing tests for — day rollover at TICKS_PER_DAY; feed deducted per breed; wounds heal; expectation floor by rung; relieved ending after sustained shortfall; determinism (two states same seed, 500 ticks, deep-equal). Then implement, pass, `npm run check`, commit `feat: tick engine with upkeep, healing, red line`.

---

### Task 4: Missions — projection, generation, resolution

**Files:**
- Create: `src/sim/projection.ts`, `src/sim/missions.ts`, `tests/missions.test.ts`
- Modify: `src/sim/tick.ts` (replace stub `tickMissions`)

**Interfaces:**
- Produces (projection.ts — THE shared honesty layer):

```ts
export function dragonPower(state: GameState, d: Dragon): number
// breed multiplier × (0.5 + training/200) × (1 − woundsTemp/150 − woundsLasting/100) × contentmentFactor × captainFactor(skill, nerve)
export function successChance(state: GameState, m: Mission, d: Dragon): number
// clamp(BASE_SUCCESS − ENEMY_WEIGHT*enemyStrength + READINESS_WEIGHT*dragonPower − WEATHER_WEIGHT*weather, MIN, MAX)
export function riskLabel(p: number): 'safe' | 'risky' | 'dangerous' | 'desperate'
export function availabilityForecast(state: GameState): { dragonId: Id; freeOnDay: number; note: string }[]
```

- Produces (missions.ts): `generateOffers(state, rng)` (called from tick; respects rung → kind/severity mix, patron missions tagged, war missions during finale), `departMission(state, m, d)` (sets returnTick), `resolveMission(state, m, rng)` — rolls against **the same** `successChance`; graduated severity: tier 1 outcomes only wounds+crew; tier 2 can kill a named flight officer on failure (probability in balance.ts); tier 3 failure can lose the dragon (flagged in offer copy); success pays rewards (+patron tier bump if patron mission); missed `deadlineDay` while unresolved = broken promise → standing hit, patron memory update. Captain death → dragon lost (grieves out; log + card). Expired offers late-game cost standing (`REFUSAL_STANDING_COST` once `warHeat > 50`).
- Consumes: Task 2 vocabulary, Task 3 `addLog`.

- [ ] Steps: failing tests — forecast honesty (resolver success rate over 400 seeded resolutions of an identical mission within ±5pp of `successChance`); severity gating (tier 1 never kills officers/dragons, tier 3 dragon-loss only on failure); broken promise costs standing; determinism. Implement, pass, commit `feat: missions with honest projection and graduated severity`.

---

### Task 5: Patrons + actions core

**Files:**
- Create: `src/sim/patrons.ts`, `src/sim/actions.ts`, `tests/patrons.test.ts`, `tests/actions.test.ts`
- Modify: `src/sim/tick.ts` (replace stub `tickPatrons`)

**Interfaces:**
- Produces (patrons.ts): `adjustTier(state, patronId, delta, memory)`, `earnGoodwill(state, patronId, n)`, `spendGoodwill(state, patronId, n, forWhom: 'own-interest' | 'stranger')` — spending for a stranger also cools tier by 1 (min 0 from positive; the setup-choice mechanic, generalized); daily `tickPatrons`: gratitude patron at tier ≥ +2 occasionally gifts (coin, goodwill, mission warning card); transactional patron demands tribute card every ~60 days at tier ≥ +1, distance on failures; rival at tier ≤ −1 sabotage rolls (auction bump-down, trap mission with understated enemyStrength shown as a range, never a lie — shows "3–7" instead of a point value).
- Produces (actions.ts — every player verb, all `throw` on invalid input):

```ts
export function acceptMission(state, missionId, dragonId): void
export function declineMission(state, missionId): void
export function assignTraining(state, dragonId, on: boolean): void
export function giveTreasure(state, dragonId): void      // treasure → contentment
export function payTribute(state, patronId): void        // coin → goodwill (transactional)
export function auctionSpendGoodwill(state, patronId): void
export function chooseCardOption(state, cardId, optionIndex): void  // delegates to cards.ts registry
```

- [ ] Steps: failing tests — spend-for-stranger cools tier; gratitude gift fires within N seeded days at tier +2; every action throws on invalid ids/states (mission not offered, dragon on mission, insufficient coin/goodwill); accept assigns and departs. Implement, pass, commit `feat: patron tier+goodwill system and player actions`.

---

### Task 6: Auction state machine

**Files:**
- Create: `src/sim/auction.ts`, `tests/auction.test.ts`
- Modify: `src/sim/tick.ts` (replace stub `tickAuction`), `src/sim/actions.ts` (wire `auctionSpendGoodwill`)

**Interfaces:**
- Produces: `startAuction(state, rng, eggs: BreedId[], candidateOfficerId)`, `tickAuction(state, rng)`, plus scheduling inside tick: auction for rung 2 fires when `standing ≥ RUNG_STANDING[2]` and rank gate met; rung 3 likewise (egg list contains longwing only if a senior female candidate exists — the constraint from the spec).
- Behavior: 5–7 rival bidders with influence drawn near your candidate's effective influence (candidate skill + your standing/10). Each tick, small rng jitter to all influences; patron interventions (gratitude tier ≥ +2 may bump you once, rival tier ≤ −1 may bump you down once — logged into the auction as visible events). Every `ticksPerClaim`, top-influence bidder claims the best unclaimed egg and leaves. Player verb `auctionSpendGoodwill(patronId)` adds `AUCTION_BUMP` influence, costs `AUCTION_GOODWILL_COST` (and cools tier if the patron is unrelated to the candidate). Auction concludes when you claim (an egg you actually pick from remaining — see UI task; sim exposes `auctionClaim(state, breed)` valid only when you're top at a claim boundary or the only bidder left) or all eggs gone (`wonBreed: null` — a real, painful outcome except the **first** auction, which guarantees a winchester remains as the last pick per spec). First auction: scripted bidder strengths so you are always outbid for everything except the final winchester, and claiming it requires spending goodwill — the FTUE lesson.
- Egg → after `EGG_HATCH_DAYS`, hatching card fires: reveals generated dragon (name, quirk line), promotes candidate to captain, binds pair, adds dragon to roster.

- [ ] Steps: failing tests — first-auction guarantee (any seed: without goodwill spend you win nothing; with one spend you win the winchester); rung-2 auction winnable on merit with high standing (seeded); longwing egg present only with senior female candidate; hatching creates captain+dragon bond; determinism. Implement, pass, commit `feat: hatching auction state machine`.

---

### Task 7: Decision cards + scripted content

**Files:**
- Create: `src/sim/cards.ts`, `tests/cards.test.ts`
- Modify: `src/sim/newRun.ts` (sponsorship card wiring), `src/sim/tick.ts`

**Interfaces:**
- Produces: card registry `CARDS: Record<string, CardTemplate>` where

```ts
export interface CardTemplate {
  title(state, params): string
  body(state, params): string
  options(state, params): { label: string; detail: string; enabled: boolean; apply(state, rng): void }[]
}
```

`chooseCardOption` (Task 5) resolves through this registry and removes the card. Scripted cards, each implemented with exact spec effects:
1. `sponsorship` — the three-way FTUE choice with the exact tier/goodwill matrix from spec §2 (best candidate: A→0 after auction spend, B→−1; A's relative: A goodwill +2 stays +1, B→−1; B's relative: B→+1 goodwill 4 [funds auction], A→0). Sets `flags.sponsored`, schedules first auction 2 days out.
2. `hatching` — from Task 6.
3. `insurance-officer` — mid-run one-shot: bench your best non-captain lieutenant against a named dragon (flag; if that dragon's captain later dies, dragon survives once) vs. keep them flying (morale +, no cover).
4. `bypassed-officer` — when a second+ captaincy goes to a candidate with lower rank than another eligible officer: the passed-over officer loses morale (the life-sim's one surfaced moment).
5. `tribute-demand`, `patron-gift`, `trap-warning` (from Task 5 patron ticks).
6. `war-rumor` tiers (flavor escalation keyed to warHeat bands — refugees, dispatch tone, patrons going quiet).

- [ ] Steps: failing tests — sponsorship matrix (all three options produce exactly the spec table's tiers/goodwill); insurance flag saves the dragon exactly once; card removal + throw on bad option index. Implement, pass, commit `feat: decision card registry with scripted FTUE and dilemma cards`.

---

### Task 8: War clock, finale, endings, scoring

**Files:**
- Create: `src/sim/war.ts`, `tests/war.test.ts`
- Modify: `src/sim/tick.ts` (replace stub `tickWar`)

**Interfaces:**
- Produces: `tickWar(state, rng)` — warHeat += WAR_HEAT_PER_DAY daily (+ small rng); rumor cards at heat 30/55/80 (once each, via flags); at `FINALE_HEAT` and rung ≥ 2: `finaleStarted = true`, then an authored sequence of 6 war missions over ~20 days arriving faster than capacity, every expiry/refusal costing standing, final mission `severityTier 3`. Survive to the end of the sequence with `status='running'` → `ending='survived'`, `score = ` weighted sum (dragons by weight class + living officers + standing + summed positive patron tiers). Losing all dragons after having ≥1 → `wing-destroyed` only if roster hits zero during finale; otherwise it's standing collapse that ends runs.
- Consumes: missions.ts generation helpers.

- [ ] Steps: failing tests — heat reaches finale in ~340–400 days across 5 seeds; finale mission pressure exceeds single-dragon capacity (assert ≥2 overlapping war missions); survived scoring monotonic in roster size; determinism. Implement, pass, commit `feat: war clock, authored finale, endings and scoring`.

---

### Task 9: Balance bot

**Files:**
- Create: `scripts/simulate.ts`
- Modify: `src/sim/balance.ts` (retuning only)

**Interfaces:**
- Consumes: entire sim public surface (newRun, tick, actions, projection).
- Produces: `npm run sim -- 500` → plays N seeded runs with a simple competent policy (accept offers whose `successChance ≥ 0.6` on best free dragon, always train idle dragons, give treasure below contentment 40, spend goodwill at auctions when below top-2, pay tribute when demanded and affordable, sponsorship option rotates per seed % 3) and prints: win rate overall and per sponsorship opening, loss breakdown by ending, median finale day, median dragons at end.

- [ ] Steps: write bot; run 500; **retune balance.ts** until (a) overall bot win rate 40–70%, (b) each sponsorship opening wins ≥ 25%, (c) median run reaches finale. Record final numbers in the commit message. Commit `feat: balance bot + initial tuning (win rate NN%)`.

---

### Task 10: UI shell — store, header, tabs, card overlay

**Files:**
- Create: `src/ui/store.svelte.ts`, `src/ui/CardOverlay.svelte`, `src/ui/CovertTab.svelte` (minimal), `src/ui/theme.css`
- Modify: `src/ui/App.svelte`, `src/main.ts`

**Interfaces:**
- Produces (store): `game = $state({ state, speed })` where `speed ∈ {0,1,4,16}`; `startLoop()` runs `setInterval(…, 1000)` firing `speed` ticks per interval (16 ticks in a burst at 16×); **auto-pause**: after any tick batch, if `pendingCards.length > 0` or a mission returned this batch or `auction` became non-null, set `speed = 0`; `act(fn)` wrapper saves to localStorage after every action; `?seed=` and `?speed=` URL params as in merc-company; visibilitychange → pause; `window.__game` e2e hook; restart().
- Produces (App): dark, phone-first layout — sticky header (day/date line, coin·feed·treasure, standing bar with fuzzy red zone rendered as a gradient band around `expectation`, scrub buttons ⏸ ▶ ▶▶ ▶▶▶), bottom tab bar (Covert/Missions/Roster/People) with thumb-height touch targets, `CardOverlay` rendered over everything when `pendingCards[0]` exists (title/body/option buttons with `detail` lines, disabled when `!enabled`), EndScreen placeholder when `status==='ended'`.
- CovertTab v1: the scrolling log (newest at bottom) + one condition line per dragon.

- [ ] Steps: build; `npm run check` clean; manual smoke via `npm run dev` + Playwright: load page, sponsorship card visible, choose option 1, auction… (auction scene lands Task 12 — assert card resolves and state advances at 1×). Commit `feat: ui shell with scrub, header, tabs, card overlay`.

---

### Task 11: Missions, Roster, People tabs

**Files:**
- Create: `src/ui/MissionsTab.svelte`, `src/ui/RosterTab.svelte`, `src/ui/PeopleTab.svelte`
- Modify: `src/ui/App.svelte`

**Interfaces:**
- MissionsTab: offers list — each shows name, kind, reward line, `riskLabel(successChance)` per eligible dragon in a dragon-picker, deadline day, severity warning copy for tier 2/3 ("a named officer may not return" / "you could lose the dragon"), accept (disabled with reason when no eligible dragon) / decline buttons; **availability forecast strip** (from `projection.availabilityForecast`); active missions with live countdown (`returnTick − tickCount` rendered as days:hours) and their risk label. Enemy strength shown as a range when the rival's trap distortion applies.
- RosterTab: dragons (name, breed, training bar, wounds, contentment, status) with train toggle + give-treasure button (disabled w/o treasure); officers grouped by rank with skill/nerve/morale, candidate badge when sponsorable.
- PeopleTab: patrons with tier meter (−3..+3), goodwill pips, kind revealed only through behavior (no label until first gift/tribute/sabotage — then a hint line), memory line.
- All buttons call `act(() => action(...))`; every throw path pre-checked and disabled.

- [ ] Steps: build; svelte-check clean; Playwright smoke: accept a dispatch at 16×, watch timer, aftermath card appears, standing moves. Commit `feat: missions, roster, people tabs`.

---

### Task 12: Auction scene + end screen

**Files:**
- Create: `src/ui/AuctionScene.svelte`, `src/ui/EndScreen.svelte`
- Modify: `src/ui/App.svelte`

**Interfaces:**
- AuctionScene (full-screen while `state.auction && !auction.concluded`): egg row across the top (breed names, claimed ones struck through with claimant), the live bidder list vertically ordered by influence (your candidate highlighted, rank motion animated with CSS transitions), a "next claim in Ns" ticker, intervention feed lines ("Lady Allendale speaks quietly to the Admiral — you rise"), and per-patron goodwill-spend buttons (cost + tier-cooling warning when unrelated, disabled at 0 goodwill). When you're claiming: remaining-egg picker → `auctionClaim`. Time runs at 1× regardless of scrub during the scene.
- EndScreen: ending headline (relieved / wing destroyed / survived), score breakdown table (dragons, officers, standing, patrons), seed display, restart button.

- [ ] Steps: build; Playwright: run FTUE at 16× to first auction, verify you get outbid for everything until goodwill spend, claim winchester, hatching card, dragon on roster. Commit `feat: auction set-piece and end screen`.

---

### Task 13: Full-run verification, polish, README

**Files:**
- Create: `README.md`
- Modify: whatever the run reveals (bug fixes only, no new systems)

- [ ] **Step 1:** `npm test`, `npm run check`, `npm run build`, `npm run sim -- 500` — all green/in band.
- [ ] **Step 2:** Playwright full-run smoke at `?speed=` accelerated: sponsorship → auction → rung 1 dispatches → rung 2 auction → (as far as a scripted bot-free click-through reasonably gets) → verify no console errors, save/reload mid-run restores state, restart works.
- [ ] **Step 3:** Phone-viewport pass (390×844): no horizontal scroll, tab bar reachable, header stable.
- [ ] **Step 4:** README: what it is, commands table, architecture section, invariants section (mirroring merc-company's), pointer to spec + this plan.
- [ ] **Step 5:** Commit `docs: readme + polish`, final `npm test` green.

---

## Self-Review Notes

- Spec §2 setup matrix → Task 7 card 1 (exact table asserted in tests). §2 first-auction guarantee → Task 6. Rungs → Tasks 3 (gates) + 6 (scheduling). §3 time/scrub → Tasks 3 + 10. §4 tabs → Tasks 10–12. §5 missions/severity/insurance card → Tasks 4 + 7. §6 red line/soft floor/forecast → Tasks 3 + 4. §7 patrons → Task 5. §8 auction → Tasks 6 + 12. §9 economy → Tasks 2–4. §10 breeds/officers → Task 2 + 6 (longwing gate). §11 cuts respected (no ceremony scene, no breeding). §12 architecture → Tasks 1, 9, invariants in Global Constraints.
- Type names cross-checked: `woundsTemp/woundsLasting`, `successChance`, `auctionSpendGoodwill`, `chooseCardOption` used consistently across tasks.
- Known intentional openness: exact flavor-copy volume and finale mission table values live in content.ts/balance.ts and are tuned in Tasks 8–9; structures and counts are specified above.
