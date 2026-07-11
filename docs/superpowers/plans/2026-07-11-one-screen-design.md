# One-Screen "Dispatch Ledger" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the four-tab UI into a single feed-driven screen: log history + live actionable cards pinned at the tail, persistent wing strip, detail in bottom sheets.

**Architecture:** The sim (`src/sim/`) is untouched except for log-line additions (Task 1). Everything else is `src/ui/`: the store gains sheet state, new leaf components are built additively (each task leaves `npm run check` green), and the final task rewires `App.svelte` and deletes the old tabs. Spec: `docs/superpowers/specs/2026-07-11-one-screen-design.md`.

**Tech Stack:** Svelte 5 (runes: `$state`, `$derived`, `$effect`, `$props`, snippets), TypeScript, Vite, Vitest.

## Global Constraints

- Sim purity: `src/sim/` has no DOM access, no non-seeded randomness; `GameState` stays JSON-serializable. `addLog` (from `src/sim/tick.ts`) is the only way to write log lines.
- No `SCHEMA_VERSION` bump: Task 1 adds log *calls* only, no state-shape changes.
- Forecast honesty: the UI reads mission odds ONLY via `successChance`/`riskLabel` from `src/sim/projection.ts`.
- UI computes no game logic; every mutation goes through `act(() => simAction(...))` from `store.svelte.ts`.
- Phone-first: `.shell` stays `max-width: 480px; height: 100dvh`.
- Global CSS classes available everywhere (theme.css): `dim`, `danger`, `button.action`, `button.active`.
- Balance bands (verify in Task 7): bot win rate 40–70%, timeouts <5% (`npm run sim -- 300`).
- Commit signing is disabled repo-locally; commit normally, never enable signing.
- Run all commands from the repo root (the worktree). All paths below are repo-relative.

---

### Task 1: Sim log completeness (TDD)

Every actionable's arrival and resolution must leave a `state.log` line — the feed's history layer depends on it. Currently missing: offer arrival, mission departure, quiet/trap declines, and a uniform card-choice record.

**Files:**
- Modify: `src/sim/missions.ts` (`generateOffers` ~line 137, `departMission` ~line 122)
- Modify: `src/sim/actions.ts` (`declineMission` ~line 38, `chooseCardOption` ~line 110)
- Test: `tests/missions.test.ts` (uses its existing `makeDragon`/`makeMission` helpers)

**Interfaces:**
- Consumes: `addLog(state, text)` from `src/sim/tick.ts` (already imported in both files).
- Produces: log-line conventions later tasks rely on — arrival: `` `Dispatch on the board: the ${m.name}. Answer by D${m.offerExpiresDay}.` ``; departure: `` `${d.name} departs on the ${m.name}.` ``; decline: `` `You decline the ${m.name}.` `` (war-heat variant keeps existing text); card choice: `` `${title} — ${option.label}.` ``

- [ ] **Step 1: Write the failing tests**

Append inside the top-level `describe` in `tests/missions.test.ts`. Add `declineMission` to the existing `import { chooseCardOption } from '../src/sim/actions'` line, and add `import { CARDS } from '../src/sim/cards'`.

```ts
describe('feed log completeness', () => {
  it('logs each new offer posted to the board', () => {
    const state = newRun(1)
    state.pendingCards = []
    state.auction = null
    state.day = OFFER_INTERVAL_DAYS
    const known = new Set(state.missions.map((m) => m.id))
    const before = state.log.length
    generateOffers(state, createRng(42))
    const fresh = state.missions.filter((m) => !known.has(m.id))
    expect(fresh.length).toBeGreaterThan(0)
    for (const m of fresh) {
      expect(state.log.slice(before).some((l) => l.text.includes(m.name))).toBe(true)
    }
  })

  it('logs the departure when a dragon takes a mission', () => {
    const state = newRun(1)
    const dragon = makeDragon(state, { name: 'Vindicatus' })
    const mission = makeMission(state, { name: 'Coastal Patrol' })
    departMission(state, mission, dragon)
    expect(
      state.log.some((l) => l.text.includes('Vindicatus') && l.text.includes('Coastal Patrol'))
    ).toBe(true)
  })

  it('logs a quiet decline below the war-heat gate', () => {
    const state = newRun(1)
    state.warHeat = 0
    const mission = makeMission(state, { name: 'Quiet Errand' })
    declineMission(state, mission.id)
    expect(state.log.some((l) => l.text.includes('Quiet Errand'))).toBe(true)
  })

  it('logs the decline of a trap offer', () => {
    const state = newRun(1)
    const mission = makeMission(state, { name: 'Baited Errand' })
    state.flags[`trap:${mission.id}`] = true
    declineMission(state, mission.id)
    expect(state.log.some((l) => l.text.includes('Baited Errand'))).toBe(true)
  })

  it('logs the chosen option when a decision card is answered', () => {
    const state = newRun(1)
    while (state.pendingCards.length === 0 && state.tickCount < 200 * TICKS_PER_DAY) {
      tick(state)
    }
    expect(state.pendingCards.length).toBeGreaterThan(0)
    const card = state.pendingCards[0]
    const template = CARDS[card.templateId]!
    const options = template.options(state, card.params)
    const idx = options.findIndex((o) => o.enabled)
    expect(idx).toBeGreaterThanOrEqual(0)
    const label = options[idx].label
    const before = state.log.length
    chooseCardOption(state, card.id, idx)
    expect(state.log.slice(before).some((l) => l.text.includes(label))).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/missions.test.ts -t 'feed log completeness'`
Expected: the five new tests FAIL on the log assertions (departure/arrival/quiet-decline/trap/card-choice lines don't exist yet). If the card-choice one passes because that particular option already logs its label, that's fine — the other four must fail.

- [ ] **Step 3: Implement the log calls**

In `src/sim/missions.ts`, `departMission` — add the log as the last line of the function:

```ts
export function departMission(state: GameState, m: Mission, d: Dragon): void {
  m.status = 'active'
  m.assignedDragonId = d.id
  m.returnTick = state.tickCount + m.durationTicks
  d.status = 'mission'
  d.missionId = m.id
  delete state.flags[`trap:${m.id}`]
  delete state.flags[`warned:${m.id}`]
  addLog(state, `${d.name} departs on the ${m.name}.`)
}
```

In `generateOffers`, replace the push inside the while-loop so each new offer logs:

```ts
  let toGenerate = rng.int(1, 2)
  while (toGenerate > 0) {
    const openOffers = state.missions.filter((m) => m.status === 'offered').length
    if (openOffers >= MAX_OPEN_OFFERS) break
    const offer = buildMissionOffer(state, rng)
    state.missions.push(offer)
    addLog(state, `Dispatch on the board: the ${offer.name}. Answer by D${offer.offerExpiresDay}.`)
    toGenerate -= 1
  }
```

In `src/sim/actions.ts`, `declineMission` — every path logs exactly one line (the war-heat branch keeps its existing, more pointed text):

```ts
export function declineMission(state: GameState, missionId: Id): void {
  const mission = state.missions.find((m) => m.id === missionId)
  if (!mission) throw new Error(`declineMission: no mission with id ${missionId}`)
  if (mission.status !== 'offered') throw new Error(`declineMission: mission ${missionId} is not offered`)

  const trapFlag = `trap:${missionId}`
  const isTrap = state.flags[trapFlag] === true

  state.missions = state.missions.filter((m) => m.id !== missionId)
  delete state.flags[`warned:${missionId}`] // trap-warning's one-shot marker leaves with the mission

  if (isTrap) {
    delete state.flags[trapFlag]
    addLog(state, `You decline the ${mission.name}.`)
    return
  }

  if (state.warHeat > REFUSAL_WAR_HEAT_GATE) {
    state.standing = Math.max(0, state.standing - REFUSAL_STANDING_COST)
    addLog(state, `You decline the ${mission.name} — the Admiralty notices the refusal.`)
  } else {
    addLog(state, `You decline the ${mission.name}.`)
  }

  if (mission.patronId) {
    adjustTier(state, mission.patronId, -1, `Remembers: declined the ${mission.name}.`)
  }
}
```

In `chooseCardOption` — log the choice BEFORE `option.apply` so the decision precedes its consequences in the ledger (and before `apply` mutates the state the title renders from):

```ts
  const options = template.options(state, card.params)
  const option = options[optionIndex]
  if (!option) throw new Error(`chooseCardOption: invalid option index ${optionIndex}`)
  if (!option.enabled) throw new Error(`chooseCardOption: option ${optionIndex} is disabled`)

  addLog(state, `${template.title(state, card.params)} — ${option.label}.`)

  // Same reconstruct/writeback dance tick.ts does — chooseCardOption is the
  // one player action that needs the RNG.
  const rng = createRng(state.rngState)
  option.apply(state, rng)
  state.rngState = rng.getState()

  state.pendingCards = state.pendingCards.filter((c) => c.id !== cardId)
```

`chooseCardOption` needs `addLog` — it's already imported at the top of `actions.ts`.

- [ ] **Step 4: Run the full suite and check**

Run: `npm test`
Expected: ALL tests pass. If a pre-existing test asserts on exact log contents or log length and now fails, update that test's expectation to accommodate the new line — the new log lines are the spec'd behaviour.

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/sim/missions.ts src/sim/actions.ts tests/missions.test.ts
git commit -m "feat(sim): log offer arrival, departure, decline, and card choice"
```

---

### Task 2: Sheet state in the store (additive)

**Files:**
- Modify: `src/ui/store.svelte.ts`

**Interfaces:**
- Produces: `game.sheet: SheetId | null`, `game.focusDragonId: string | null`, `openSheet(id: SheetId, focusDragonId?: string | null): void`, `closeSheet(): void`, `export type SheetId = 'roster' | 'people' | 'provisions'`. The existing `tab`/`Tab` stay until Task 6 (so the old App keeps compiling).

- [ ] **Step 1: Add the sheet state**

In `src/ui/store.svelte.ts`, add below `export type Tab = ...`:

```ts
export type SheetId = 'roster' | 'people' | 'provisions'
```

Extend the `game` object literal (keep `tab` for now):

```ts
export const game = $state<{
  state: GameState
  speed: Speed
  tab: Tab
  sheet: SheetId | null
  focusDragonId: string | null
}>({
  // A ?seed= in the URL always starts a fresh run with that seed and ignores
  // any existing save (see seedFromQuery above); otherwise resume the save,
  // falling back to a fresh random-seeded run if there isn't one.
  state: seedFromQuery !== null ? newRun(seedFromQuery) : (load() ?? newRun(Date.now() % 0xffffffff)),
  speed: 0,
  tab: 'covert',
  sheet: null,
  focusDragonId: null,
})
```

Add next to `setSpeed`:

```ts
export function openSheet(id: SheetId, focusDragonId: string | null = null): void {
  game.sheet = id
  game.focusDragonId = focusDragonId
}

export function closeSheet(): void {
  game.sheet = null
  game.focusDragonId = null
}
```

In `restart()`, after `game.tab = 'covert'` add:

```ts
  game.sheet = null
  game.focusDragonId = null
```

- [ ] **Step 2: Verify**

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/store.svelte.ts
git commit -m "feat(ui): sheet open/close state in store"
```

---

### Task 3: WingStrip component

**Files:**
- Create: `src/ui/WingStrip.svelte`

**Interfaces:**
- Consumes: `game`, `openSheet` from `./store.svelte`; `availabilityForecast` from `../sim/projection` (returns `{ dragonId, freeOnDay, note }[]`); `TICKS_PER_DAY` from `../sim/balance`.
- Produces: `<WingStrip />` — no props. Tapping a dragon line calls `openSheet('roster', dragon.id)`.

- [ ] **Step 1: Create `src/ui/WingStrip.svelte`**

```svelte
<script lang="ts">
  import { game, openSheet } from './store.svelte'
  import { availabilityForecast } from '../sim/projection'
  import { TICKS_PER_DAY } from '../sim/balance'
  import type { Dragon } from '../sim/types'

  const forecast = $derived(availabilityForecast(game.state))

  function statusNote(d: Dragon): string {
    if (d.status === 'home') return 'home'
    if (d.status === 'mission') {
      const m = game.state.missions.find((mm) => mm.id === d.missionId)
      if (!m || m.returnTick === null) return 'afield'
      const remaining = Math.max(0, m.returnTick - game.state.tickCount)
      return `afield · ~${Math.ceil(remaining / TICKS_PER_DAY)}d`
    }
    const entry = forecast.find((f) => f.dragonId === d.id)
    return entry ? `healing · ready ~D${entry.freeOnDay}` : 'healing'
  }
</script>

<section class="wing-strip">
  {#if game.state.dragons.length === 0}
    <p class="empty dim">The clearing stands empty. No wings darken it yet.</p>
  {:else}
    {#each game.state.dragons as dragon (dragon.id)}
      <button type="button" class="dragon-line" onclick={() => openSheet('roster', dragon.id)}>
        <span class="name">{dragon.name}</span>
        <span class="cond dim">
          wnd {Math.round(dragon.woundsTemp)} · cnt {Math.round(dragon.contentment)} · {statusNote(dragon)}
        </span>
      </button>
    {/each}
  {/if}
</section>

<style>
  .wing-strip {
    flex-shrink: 0;
    background: var(--bg-raised);
    border-bottom: 1px solid var(--line);
    padding: 0.3rem 0.8rem;
  }

  .dragon-line {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    border-radius: 0;
    min-height: 36px;
    padding: 0.25rem 0;
  }

  .dragon-line + .dragon-line {
    border-top: 1px solid var(--line);
  }

  .name {
    font-family: var(--font-display);
    font-weight: 600;
  }

  .cond {
    font-size: 0.82rem;
    text-align: right;
  }

  .empty {
    font-style: italic;
    text-align: center;
    padding: 0.4rem 0;
    margin: 0;
  }
</style>
```

- [ ] **Step 2: Verify**

Run: `npm run check`
Expected: 0 errors (component is not yet mounted anywhere — that's fine).

- [ ] **Step 3: Commit**

```bash
git add src/ui/WingStrip.svelte
git commit -m "feat(ui): wing strip — persistent per-dragon status line"
```

---

### Task 4: Feed with OfferCard and DecisionCard

**Files:**
- Create: `src/ui/OfferCard.svelte`
- Create: `src/ui/DecisionCard.svelte`
- Create: `src/ui/Feed.svelte`

**Interfaces:**
- Consumes: sim actions `acceptMission`, `declineMission`, `chooseCardOption` (via `act`); `successChance`, `riskLabel` from `../sim/projection`; `CARDS` from `../sim/cards`; balance constants as in the code below.
- Produces: `<Feed />` (no props) — renders `state.log` history plus one `<OfferCard mission={m} />` per `status === 'offered'` mission and one `<DecisionCard card={c} />` per pending card, pinned after history. `OfferCard` takes `{ mission: Mission }`; `DecisionCard` takes `{ card: CardInstance }`.

- [ ] **Step 1: Create `src/ui/OfferCard.svelte`**

This ports the board card from `MissionsTab.svelte` for a single mission. The trap/pessimism logic must stay verbatim (forecast-honesty invariant).

```svelte
<script lang="ts">
  import { game, act } from './store.svelte'
  import { acceptMission, declineMission } from '../sim/actions'
  import { successChance, riskLabel } from '../sim/projection'
  import {
    REFUSAL_WAR_HEAT_GATE,
    TRAP_DISPLAY_SPREAD_LOW,
    TRAP_DISPLAY_SPREAD_HIGH,
  } from '../sim/balance'
  import type { Mission } from '../sim/types'

  let { mission }: { mission: Mission } = $props()

  let selected = $state<string | null>(null)

  const homeDragons = $derived(game.state.dragons.filter((d) => d.status === 'home'))
  const isTrap = $derived(game.state.flags[`trap:${mission.id}`] === true)

  function patronName(id: string | null): string {
    if (!id) return ''
    return game.state.patrons.find((p) => p.id === id)?.name ?? ''
  }

  function riskClass(label: ReturnType<typeof riskLabel>): string {
    if (label === 'safe') return 'dim'
    if (label === 'risky') return ''
    return 'danger'
  }

  function severityCopy(sev: 1 | 2 | 3): string {
    if (sev === 2) return 'A named officer may not return — and a dragon does not outlive its captain.'
    if (sev === 3) return 'You could lose the dragon.'
    return ''
  }

  /**
   * Trap offers hide their true enemy strength; this builds a display-only
   * shallow copy at the pessimistic end (enemyStrength = min(10, n+HIGH)) so
   * the dragon picker's risk label reflects the worst case the player might
   * face, never the real (hidden) value. The mask is asymmetric — see
   * TRAP_DISPLAY_SPREAD_LOW/HIGH in balance.ts — so the displayed midpoint no
   * longer equals the true value either.
   */
  function pessimisticMission(m: Mission): Mission {
    return { ...m, enemyStrength: Math.min(10, m.enemyStrength + TRAP_DISPLAY_SPREAD_HIGH) }
  }

  const enemyDisplay = $derived.by(() => {
    if (isTrap) {
      const lo = Math.max(0, mission.enemyStrength - TRAP_DISPLAY_SPREAD_LOW)
      const hi = Math.min(10, mission.enemyStrength + TRAP_DISPLAY_SPREAD_HIGH)
      return `enemy ${lo}–${hi}/10 (uncertain)`
    }
    return `enemy ${mission.enemyStrength}/10`
  })

  function weatherLabel(w: number): string {
    if (w < 0.33) return 'calm'
    if (w < 0.66) return 'rough'
    return 'foul'
  }

  const rewardLine = $derived.by(() => {
    const parts = [`${mission.rewardCoin} coin`]
    if (mission.rewardTreasure > 0) parts.push(`+${mission.rewardTreasure} treasure`)
    parts.push(`+${mission.rewardStanding} standing`)
    return parts.join(' · ')
  })

  const canAccept = $derived.by(() => {
    if (!selected) return false
    const dragon = game.state.dragons.find((d) => d.id === selected)
    if (!dragon || dragon.status !== 'home') return false
    if (mission.status !== 'offered') return false
    if (game.state.day > mission.offerExpiresDay) return false
    return true
  })

  function accept(): void {
    if (!selected) return
    const dragonId = selected
    act(() => acceptMission(game.state, mission.id, dragonId))
  }

  function decline(): void {
    act(() => declineMission(game.state, mission.id))
  }
</script>

<div class="mission-card">
  <div class="mission-head">
    <span class="name">{mission.name}</span>
    <span class="kind dim">{mission.kind}</span>
  </div>
  {#if severityCopy(mission.severityTier)}
    <div class="mission-row" class:danger={mission.severityTier === 3}>{severityCopy(mission.severityTier)}</div>
  {/if}
  <div class="mission-row">{rewardLine}</div>
  {#if mission.patronId}
    <div class="mission-row dim">for {patronName(mission.patronId)}</div>
  {/if}
  <div class="mission-row dim">answer by D{mission.offerExpiresDay} · promise: D{mission.deadlineDay}</div>
  <div class="mission-row dim">{enemyDisplay} · {weatherLabel(mission.weather)}</div>

  <div class="picker">
    {#if homeDragons.length === 0}
      <p class="empty dim">No dragon is home to fly it.</p>
    {:else}
      {#each homeDragons as d (d.id)}
        {@const chance = isTrap
          ? successChance(game.state, pessimisticMission(mission), d)
          : successChance(game.state, mission, d)}
        <button
          type="button"
          class="dragon-row"
          class:picked={selected === d.id}
          onclick={() => (selected = d.id)}
        >
          <span class="name">{d.name}</span>
          <span class="{riskClass(riskLabel(chance))}">
            {riskLabel(chance)}{isTrap ? ' (uncertain)' : ` ${Math.round(chance * 100)}%`}
          </span>
        </button>
      {/each}
    {/if}
  </div>

  <div class="actions">
    <button type="button" class="action" disabled={!canAccept} onclick={accept}>
      Accept
    </button>
    <button type="button" onclick={decline}>
      Decline{game.state.warHeat > REFUSAL_WAR_HEAT_GATE ? ' (costs standing)' : ''}
    </button>
  </div>
</div>

<style>
  .mission-card {
    background: var(--bg-raised);
    border: 1px solid var(--accent-dim);
    border-radius: 8px;
    padding: 0.7rem 0.8rem;
    margin: 0.4rem 0 0.6rem;
  }

  .mission-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.3rem;
  }

  .name {
    font-family: var(--font-display);
    font-weight: 600;
  }

  .mission-row {
    font-size: 0.88rem;
    padding: 0.1rem 0;
  }

  .picker {
    margin: 0.5rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .dragon-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    text-align: left;
    padding: 0.5rem 0.6rem;
  }

  .dragon-row.picked {
    border-color: var(--accent);
    color: var(--accent);
  }

  .empty {
    font-style: italic;
    text-align: center;
    padding: 0.6rem 0;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
  }

  .actions button {
    flex: 1;
  }
</style>
```

- [ ] **Step 2: Create `src/ui/DecisionCard.svelte`**

Ports `CardOverlay.svelte`'s logic without the scrim — an inline feed card.

```svelte
<script lang="ts">
  import { game, act } from './store.svelte'
  import { CARDS } from '../sim/cards'
  import { chooseCardOption } from '../sim/actions'
  import type { CardInstance } from '../sim/types'

  let { card }: { card: CardInstance } = $props()

  const template = $derived(CARDS[card.templateId])
  const title = $derived(template ? template.title(game.state, card.params) : '')
  const body = $derived(template ? template.body(game.state, card.params) : '')
  const options = $derived(template ? template.options(game.state, card.params) : [])

  function choose(index: number): void {
    act(() => chooseCardOption(game.state, card.id, index))
  }
</script>

<div class="decision-card">
  <h3>{title}</h3>
  <p class="body">{body}</p>
  <div class="options">
    {#each options as opt, i (i)}
      <button class="option" disabled={!opt.enabled} onclick={() => choose(i)}>
        <span class="label">{opt.label}</span>
        <span class="detail dim">{opt.detail}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .decision-card {
    background: var(--bg-raised);
    border: 1px solid var(--accent);
    border-radius: 8px;
    padding: 0.8rem;
    margin: 0.4rem 0 0.6rem;
  }

  .decision-card h3 {
    font-size: 1.1rem;
  }

  .body {
    color: var(--ink);
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.6rem;
  }

  .option {
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.6rem 0.7rem;
    min-height: 48px;
  }

  .label {
    font-weight: 600;
  }

  .detail {
    font-size: 0.82rem;
  }
</style>
```

- [ ] **Step 3: Create `src/ui/Feed.svelte`**

History (log lines) then live actionables pinned at the tail. The autoscroll effect extends CovertTab's ring-buffer-aware version: it must also fire when an actionable appears or resolves, so the tail stays in view.

```svelte
<script lang="ts">
  import { game } from './store.svelte'
  import OfferCard from './OfferCard.svelte'
  import DecisionCard from './DecisionCard.svelte'

  let feedEl: HTMLElement | undefined = $state()

  const offers = $derived(game.state.missions.filter((m) => m.status === 'offered'))

  $effect(() => {
    // Re-run whenever the log changes. Length alone is not enough: once the
    // log reaches LOG_CAP it becomes a front-trimmed ring whose length never
    // changes again, so also read the newest line's identity. Actionables
    // pin at the tail, so their appearance/resolution must also re-scroll.
    void game.state.log.length
    const last = game.state.log[game.state.log.length - 1]
    void last?.text
    void last?.day
    void offers.length
    void game.state.pendingCards.length
    if (feedEl) feedEl.scrollTop = feedEl.scrollHeight
  })
</script>

<section class="feed" bind:this={feedEl}>
  {#each game.state.log as line, i (i)}
    <p class="log-line">D{line.day} — {line.text}</p>
  {/each}

  {#each offers as mission (mission.id)}
    <OfferCard {mission} />
  {/each}

  {#each game.state.pendingCards as card (card.id)}
    <DecisionCard {card} />
  {/each}
</section>

<style>
  .feed {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: 0.8rem;
  }

  .log-line {
    margin: 0 0 0.5rem;
    line-height: 1.4;
  }
</style>
```

- [ ] **Step 4: Verify**

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/OfferCard.svelte src/ui/DecisionCard.svelte src/ui/Feed.svelte
git commit -m "feat(ui): feed with inline offer and decision cards"
```

---

### Task 5: Sheets and menu bar

**Files:**
- Create: `src/ui/Sheet.svelte`
- Create: `src/ui/RosterSheet.svelte`
- Create: `src/ui/PeopleSheet.svelte`
- Create: `src/ui/ProvisionsSheet.svelte`
- Create: `src/ui/MenuBar.svelte`

**Interfaces:**
- Consumes: `game`, `act`, `openSheet`, `closeSheet` from `./store.svelte`; sim actions `buyFeed`, `giveTreasure`, `payTribute`; `BREEDS`, `RANK_SEQUENCE` from `../sim/content`; `FEED_COST`, `FEED_PRICE`, `TRIBUTE_COST` from `../sim/balance`.
- Produces: `<Sheet title onclose>{children}</Sheet>` generic host; `<RosterSheet />` (reads `game.focusDragonId` to scroll to a dragon); `<PeopleSheet />`; `<ProvisionsSheet />`; `<MenuBar />` with Roster/People buttons.

- [ ] **Step 1: Create `src/ui/Sheet.svelte`**

The scrim is a button (a11y: clickable elements must be interactive elements, or svelte-check warns).

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    title,
    onclose,
    children,
  }: { title: string; onclose: () => void; children: Snippet } = $props()
</script>

<button type="button" class="scrim" aria-label="Close {title}" onclick={onclose}></button>
<div class="sheet" role="dialog" aria-label={title}>
  <div class="sheet-head">
    <h3>{title}</h3>
    <button type="button" class="close" onclick={onclose}>Close</button>
  </div>
  <div class="sheet-body">
    {@render children()}
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    border: none;
    border-radius: 0;
    z-index: 20;
    cursor: default;
  }

  .sheet {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    bottom: 0;
    width: 100%;
    max-width: 480px;
    max-height: 80dvh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border: 1px solid var(--line);
    border-bottom: none;
    border-radius: 12px 12px 0 0;
    z-index: 21;
  }

  .sheet-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.7rem 0.8rem 0.4rem;
    border-bottom: 1px solid var(--line);
    flex-shrink: 0;
  }

  .sheet-head h3 {
    margin: 0;
  }

  .close {
    min-height: 36px;
    padding: 0.3rem 0.7rem;
    font-size: 0.9rem;
  }

  .sheet-body {
    overflow-y: auto;
    padding: 0.8rem;
  }
</style>
```

- [ ] **Step 2: Create `src/ui/RosterSheet.svelte`**

RosterTab's content minus the feed row, wrapped in `Sheet`, with focus-scroll to `game.focusDragonId`.

```svelte
<script lang="ts">
  import Sheet from './Sheet.svelte'
  import { game, act, closeSheet } from './store.svelte'
  import { giveTreasure } from '../sim/actions'
  import { BREEDS, RANK_SEQUENCE } from '../sim/content'
  import type { Dragon, Officer, Rank } from '../sim/types'

  let bodyEl: HTMLElement | undefined = $state()

  $effect(() => {
    if (!game.focusDragonId || !bodyEl) return
    const el = bodyEl.querySelector(`[data-dragon-id="${game.focusDragonId}"]`)
    el?.scrollIntoView({ block: 'start' })
  })

  function give(dragonId: string): void {
    act(() => giveTreasure(game.state, dragonId))
  }

  function statusWord(status: Dragon['status']): string {
    if (status === 'home') return 'home'
    if (status === 'mission') return 'afield'
    return 'healing'
  }

  // Rank groups, descending seniority; empty groups are skipped in the markup.
  const rankGroups: Rank[] = [...RANK_SEQUENCE].reverse()

  function officersOfRank(rank: Rank): Officer[] {
    return game.state.officers.filter((o) => o.alive && o.rank === rank)
  }

  const lostOfficers = $derived(game.state.officers.filter((o) => !o.alive))

  function captainDragonName(officer: Officer): string | null {
    if (officer.rank !== 'captain') return null
    const dragon = game.state.dragons.find((d) => d.captainId === officer.id)
    return dragon ? dragon.name : null
  }

  function isCandidate(officer: Officer): boolean {
    return officer.rank !== 'captain' && game.state.flags[`sponsored:${officer.id}`] === true
  }
</script>

<Sheet title="Roster" onclose={closeSheet}>
  <div bind:this={bodyEl}>
    <section class="dragons">
      <h3>Dragons</h3>
      {#if game.state.dragons.length === 0}
        <p class="empty dim">No dragons on the roster.</p>
      {:else}
        {#each game.state.dragons as dragon (dragon.id)}
          <div class="dragon-card" data-dragon-id={dragon.id}>
            <div class="dragon-head">
              <span class="name">{dragon.name}</span>
              <span class="breed dim">{BREEDS[dragon.breed].name}</span>
              <span class="tag dim">{BREEDS[dragon.breed].weightClass}</span>
            </div>

            <div class="bar-row">
              <span class="bar-label dim">training</span>
              <div class="bar">
                <div class="bar-fill" style="width: {dragon.training}%"></div>
              </div>
            </div>

            <div class="stat-row" class:danger={dragon.woundsTemp > 30}>
              wounds {Math.round(dragon.woundsTemp)} (+{Math.round(dragon.woundsLasting)} lasting)
            </div>

            <div class="bar-row">
              <span class="bar-label dim">contentment</span>
              <div class="bar">
                <div class="bar-fill" style="width: {dragon.contentment}%"></div>
              </div>
            </div>

            <div class="stat-row dim">{statusWord(dragon.status)}</div>

            <button
              type="button"
              disabled={game.state.treasure < 1}
              onclick={() => give(dragon.id)}
            >
              Give treasure ({game.state.treasure} held)
            </button>
          </div>
        {/each}
      {/if}
    </section>

    <section class="officers">
      <h3>Officers</h3>
      {#each rankGroups as rank (rank)}
        {@const group = officersOfRank(rank)}
        {#if group.length > 0}
          <div class="rank-group">
            <div class="rank-label dim">{rank}</div>
            {#each group as officer (officer.id)}
              <div class="officer-line">
                <span class="name">{officer.name}</span>
                <span class="stats" class:danger={officer.morale < 30}>
                  skl {officer.skill} · nrv {officer.nerve} · mor {officer.morale}
                </span>
                {#if captainDragonName(officer)}
                  <span class="dim">— captain of {captainDragonName(officer)}</span>
                {/if}
                {#if isCandidate(officer)}
                  <span class="badge">candidate</span>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      {/each}

      {#if lostOfficers.length > 0}
        <div class="rank-group">
          <div class="rank-label dim">Lost</div>
          {#each lostOfficers as officer (officer.id)}
            <div class="officer-line lost">
              <span class="name struck">{officer.name}</span>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  </div>
</Sheet>

<style>
  section {
    margin-bottom: 1rem;
  }

  h3 {
    font-size: 1rem;
    margin-bottom: 0.4rem;
  }

  .dragon-card {
    background: var(--bg-raised);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 0.7rem 0.8rem;
    margin-bottom: 0.6rem;
  }

  .dragon-head {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    margin-bottom: 0.4rem;
  }

  .name {
    font-family: var(--font-display);
    font-weight: 600;
  }

  .tag {
    font-size: 0.78rem;
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 0 0.3rem;
  }

  .bar-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.3rem 0;
  }

  .bar-label {
    font-size: 0.78rem;
    width: 5.5rem;
    flex-shrink: 0;
  }

  .bar {
    flex: 1;
    height: 8px;
    border-radius: 4px;
    background: var(--line);
    overflow: hidden;
  }

  .bar-fill {
    height: 100%;
    background: var(--accent);
    opacity: 0.85;
  }

  .stat-row {
    font-size: 0.88rem;
    margin: 0.2rem 0 0.5rem;
  }

  .empty {
    font-style: italic;
    text-align: center;
    padding: 0.6rem 0;
  }

  .rank-group {
    margin-bottom: 0.6rem;
  }

  .rank-label {
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.2rem;
  }

  .officer-line {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: baseline;
    padding: 0.25rem 0;
    border-top: 1px solid var(--line);
  }

  .stats {
    font-size: 0.85rem;
  }

  .badge {
    font-size: 0.72rem;
    background: var(--accent-dim);
    color: var(--ink);
    border-radius: 4px;
    padding: 0.05rem 0.35rem;
  }

  .struck {
    text-decoration: line-through;
    color: var(--ink-dim);
  }
</style>
```

- [ ] **Step 3: Create `src/ui/PeopleSheet.svelte`**

PeopleTab wholesale, wrapped in `Sheet`.

```svelte
<script lang="ts">
  import Sheet from './Sheet.svelte'
  import { game, act, closeSheet } from './store.svelte'
  import { payTribute } from '../sim/actions'
  import { TRIBUTE_COST } from '../sim/balance'
  import type { Patron } from '../sim/types'

  function epithet(tier: number): string {
    if (tier > 0) return 'warm'
    if (tier < 0) return 'hostile'
    return 'cool'
  }

  function flavorCaption(kind: Patron['kind']): string {
    if (kind === 'gratitude') return 'remembers kindnesses'
    if (kind === 'transactional') return 'keeps accounts'
    return 'keeps grudges'
  }

  // 7 dots for -3..+3: dots between 0 and the patron's tier are filled too,
  // so the meter reads as a fill-from-center bar, not a single marker.
  const dotValues = [-3, -2, -1, 0, 1, 2, 3]

  function dotFilled(dotValue: number, tier: number): boolean {
    if (tier === 0) return dotValue === 0
    if (tier > 0) return dotValue > 0 && dotValue <= tier
    return dotValue < 0 && dotValue >= tier
  }

  function dotClass(dotValue: number): string {
    if (dotValue < 0) return 'danger'
    if (dotValue > 0) return 'accent'
    return 'neutral'
  }

  function tribute(patronId: string): void {
    act(() => payTribute(game.state, patronId))
  }
</script>

<Sheet title="People" onclose={closeSheet}>
  <section class="patrons">
    {#if game.state.patrons.length === 0}
      <p class="empty dim">No patrons remain.</p>
    {:else}
      {#each game.state.patrons as patron (patron.id)}
        <div class="patron-card">
          <div class="patron-head">
            <span class="name">{patron.name}</span>
            <span class="epithet dim">{epithet(patron.tier)}</span>
          </div>

          <div class="tier-meter">
            {#each dotValues as dotValue (dotValue)}
              <span
                class="dot"
                class:filled={dotFilled(dotValue, patron.tier)}
                class:danger={dotFilled(dotValue, patron.tier) && dotClass(dotValue) === 'danger'}
                class:accent={dotFilled(dotValue, patron.tier) && dotClass(dotValue) === 'accent'}
              ></span>
            {/each}
          </div>

          <div class="goodwill dim">goodwill {patron.goodwill}/10</div>

          {#if patron.memory}
            <p class="memory dim">remembers: {patron.memory}</p>
          {/if}

          <p class="flavor dim">{flavorCaption(patron.kind)}</p>

          {#if patron.kind === 'transactional'}
            <button
              type="button"
              disabled={game.state.coin < TRIBUTE_COST}
              onclick={() => tribute(patron.id)}
            >
              Send his cut ({TRIBUTE_COST} coin)
            </button>
          {/if}
        </div>
      {/each}
    {/if}
  </section>
</Sheet>

<style>
  .patron-card {
    background: var(--bg-raised);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 0.7rem 0.8rem;
    margin-bottom: 0.6rem;
  }

  .patron-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.4rem;
  }

  .name {
    font-family: var(--font-display);
    font-weight: 600;
  }

  .epithet {
    font-style: italic;
  }

  .tier-meter {
    display: flex;
    gap: 0.3rem;
    margin: 0.4rem 0;
  }

  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: transparent;
    border: 1px solid var(--line);
  }

  .dot.filled {
    background: var(--ink-dim);
    border-color: var(--ink-dim);
  }

  .dot.filled.danger {
    background: var(--danger);
    border-color: var(--danger);
  }

  .dot.filled.accent {
    background: var(--accent);
    border-color: var(--accent);
  }

  .goodwill {
    font-size: 0.88rem;
    margin-bottom: 0.3rem;
  }

  .memory {
    font-style: italic;
    margin-bottom: 0.3rem;
  }

  .flavor {
    font-size: 0.82rem;
    margin-bottom: 0.5rem;
  }

  .empty {
    font-style: italic;
    text-align: center;
    padding: 0.6rem 0;
  }
</style>
```

- [ ] **Step 4: Create `src/ui/ProvisionsSheet.svelte`**

The feed-economy row from RosterTab, promoted to its own sheet.

```svelte
<script lang="ts">
  import Sheet from './Sheet.svelte'
  import { game, act, closeSheet } from './store.svelte'
  import { buyFeed } from '../sim/actions'
  import { FEED_COST, FEED_PRICE } from '../sim/balance'

  const dailyFeed = $derived(game.state.dragons.reduce((sum, d) => sum + FEED_COST[d.breed], 0))
  const buyCost = $derived(5 * FEED_PRICE)

  function buy(): void {
    act(() => buyFeed(game.state, 5))
  }
</script>

<Sheet title="Provisions" onclose={closeSheet}>
  <div class="provisions">
    <div class="line"><span>Coin</span><span>🪙 {game.state.coin}</span></div>
    <div class="line"><span>Feed on hand</span><span>🥩 {Math.round(game.state.feed)}</span></div>
    <div class="line"><span>Daily consumption</span><span class="dim">−{dailyFeed}/day</span></div>
    <div class="line"><span>Treasure</span><span>💰 {game.state.treasure}</span></div>
    <button type="button" class="action" disabled={game.state.coin < buyCost} onclick={buy}>
      Buy 5 feed ({buyCost} coin)
    </button>
  </div>
</Sheet>

<style>
  .provisions {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .line {
    display: flex;
    justify-content: space-between;
    font-variant-numeric: tabular-nums;
  }
</style>
```

- [ ] **Step 5: Create `src/ui/MenuBar.svelte`**

```svelte
<script lang="ts">
  import { openSheet } from './store.svelte'
</script>

<footer class="menu-bar">
  <button type="button" onclick={() => openSheet('roster')}>Roster</button>
  <button type="button" onclick={() => openSheet('people')}>People</button>
</footer>

<style>
  .menu-bar {
    display: flex;
    flex-shrink: 0;
    border-top: 1px solid var(--line);
    background: var(--bg-raised);
  }

  .menu-bar button {
    flex: 1;
    border: none;
    border-radius: 0;
    min-height: 52px;
    background: transparent;
  }
</style>
```

- [ ] **Step 6: Verify**

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/ui/Sheet.svelte src/ui/RosterSheet.svelte src/ui/PeopleSheet.svelte src/ui/ProvisionsSheet.svelte src/ui/MenuBar.svelte
git commit -m "feat(ui): bottom sheets (roster, people, provisions) and menu bar"
```

---

### Task 6: Rewire App.svelte, delete the tabs

**Files:**
- Modify: `src/ui/App.svelte` (full rewrite below)
- Modify: `src/ui/store.svelte.ts` (remove `tab`/`Tab`)
- Delete: `src/ui/CovertTab.svelte`, `src/ui/MissionsTab.svelte`, `src/ui/RosterTab.svelte`, `src/ui/PeopleTab.svelte`, `src/ui/CardOverlay.svelte`

**Interfaces:**
- Consumes: everything Tasks 2–5 produced.
- Produces: the final one-screen app. `AuctionScene` still replaces the main area (feed + menu bar) while live; `EndScreen` and the header behave as before.

- [ ] **Step 1: Rewrite `src/ui/App.svelte`**

Replace the whole file with:

```svelte
<script lang="ts">
  import { onMount } from 'svelte'
  import { game, setSpeed, openSheet, startLoop, type Speed } from './store.svelte'
  import AuctionScene from './AuctionScene.svelte'
  import EndScreen from './EndScreen.svelte'
  import Feed from './Feed.svelte'
  import MenuBar from './MenuBar.svelte'
  import PeopleSheet from './PeopleSheet.svelte'
  import ProvisionsSheet from './ProvisionsSheet.svelte'
  import RosterSheet from './RosterSheet.svelte'
  import WingStrip from './WingStrip.svelte'

  onMount(() => {
    startLoop()
  })

  const ended = $derived(game.state.status === 'ended')
  const auctionLive = $derived(game.state.auction !== null && !game.state.auction.concluded)

  // "Fuzzy red line": a soft gradient band centred on expectation, never a
  // hard tick — the player should feel the danger zone, not read a number.
  const ZONE_HALF_WIDTH = 8
  const zoneStops = $derived.by(() => {
    const center = Math.max(0, Math.min(100, game.state.expectation))
    const outer = Math.max(0, center - ZONE_HALF_WIDTH)
    const inner = Math.min(100, center + ZONE_HALF_WIDTH)
    return `linear-gradient(to right, transparent 0%, transparent ${outer}%, var(--danger-soft) ${center}%, transparent ${inner}%, transparent 100%)`
  })
</script>

<div class="shell">
  <header class="header">
    <div class="row row-day">
      <span class="day">Day {game.state.day}</span>
      <div class="scrub">
        <button class:active={game.speed === 0} disabled={ended} onclick={() => setSpeed(0 as Speed)}>⏸</button>
        <button class:active={game.speed === 1} disabled={ended} onclick={() => setSpeed(1 as Speed)}>▶</button>
        <button class:active={game.speed === 4} disabled={ended} onclick={() => setSpeed(4 as Speed)}>▶▶</button>
        <button class:active={game.speed === 16} disabled={ended} onclick={() => setSpeed(16 as Speed)}>▶▶▶</button>
      </div>
    </div>
    <div class="row row-resources">
      <button type="button" class="resources" onclick={() => openSheet('provisions')}>
        <span>🪙 {game.state.coin}</span>
        <span>🥩 {game.state.feed}</span>
        <span>💰 {game.state.treasure}</span>
      </button>
    </div>
    <div class="standing-wrap">
      <div class="standing-track" style="background: {zoneStops}">
        <div class="standing-fill" style="width: {game.state.standing}%"></div>
      </div>
      <div class="standing-label dim">standing {Math.round(game.state.standing)}</div>
    </div>
  </header>

  {#if auctionLive}
    <AuctionScene />
  {:else}
    <WingStrip />
    <Feed />
    <MenuBar />
  {/if}
</div>

{#if ended}
  <EndScreen />
{/if}

{#if game.sheet === 'roster'}
  <RosterSheet />
{:else if game.sheet === 'people'}
  <PeopleSheet />
{:else if game.sheet === 'provisions'}
  <ProvisionsSheet />
{/if}

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    max-width: 480px;
    margin: 0 auto;
    overflow: hidden;
  }

  .header {
    position: sticky;
    top: 0;
    z-index: 5;
    background: var(--bg-raised);
    border-bottom: 1px solid var(--line);
    padding: 0.6rem 0.8rem;
    flex-shrink: 0;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .row-day {
    margin-bottom: 0.4rem;
  }

  .day {
    font-family: var(--font-display);
    font-size: 1.1rem;
  }

  .scrub {
    display: flex;
    gap: 0.3rem;
  }

  .scrub button {
    min-width: 48px;
    padding: 0.4rem 0.5rem;
  }

  .row-resources {
    margin-bottom: 0.4rem;
  }

  .resources {
    display: flex;
    gap: 0.9rem;
    font-variant-numeric: tabular-nums;
    background: transparent;
    border: none;
    border-radius: 0;
    min-height: 0;
    padding: 0;
    font-size: 1rem;
    text-align: left;
  }

  .standing-wrap {
    position: relative;
  }

  .standing-track {
    position: relative;
    height: 10px;
    border-radius: 5px;
    background-color: var(--line);
    overflow: hidden;
  }

  .standing-fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--accent);
    opacity: 0.85;
  }

  .standing-label {
    font-size: 0.75rem;
    margin-top: 0.2rem;
  }
</style>
```

Note the sheets render even during the auction takeover or after the run ends — that is acceptable (they're read-only detail plus low-stakes verbs, and `EndScreen`'s overlay sits above them; keep `EndScreen`'s z-index higher than the sheet's 21 if it isn't — check `EndScreen.svelte` and bump its z-index to 30 if needed).

- [ ] **Step 2: Remove `tab` from the store**

In `src/ui/store.svelte.ts`:
- Delete the line `export type Tab = 'covert' | 'missions' | 'roster' | 'people'`.
- Remove `tab: Tab` from the `game` type literal and `tab: 'covert',` from the initializer.
- Remove `game.tab = 'covert'` from `restart()`.

- [ ] **Step 3: Delete the old components**

```bash
git rm src/ui/CovertTab.svelte src/ui/MissionsTab.svelte src/ui/RosterTab.svelte src/ui/PeopleTab.svelte src/ui/CardOverlay.svelte
```

- [ ] **Step 4: Verify**

Run: `npm run check`
Expected: 0 errors.

Run: `npm test`
Expected: all pass (UI changes don't touch the sim).

- [ ] **Step 5: Commit**

```bash
git add src/ui/App.svelte src/ui/store.svelte.ts
git commit -m "feat(ui): one-screen dispatch ledger — feed + wing strip + sheets replace tabs"
```

---

### Task 7: Full verification (main session, not a subagent)

**Files:** none created; fixes go wherever the smoke test finds problems.

- [ ] **Step 1: Static + unit + balance**

Run: `npm run check` — expected 0 errors.
Run: `npm test` — expected all pass.
Run: `npm run sim -- 300` — expected: win rate 40–70%, timeouts <5% (log lines must not have moved the bands; they don't touch policy or RNG).

- [ ] **Step 2: Browser smoke (dev server + Playwright MCP or manual)**

Run: `npm run dev`, open `http://localhost:5173/?seed=1&speed=20`. Verify:

1. Header shows day/speed/resources/standing; tapping the resource row opens Provisions; buying feed works and the sheet's numbers update.
2. Wing strip appears once the first dragon hatches; tapping a dragon line opens Roster scrolled to that dragon; Give treasure works.
3. Press ▶▶▶: log lines stream, feed stays scrolled to the tail.
4. A decision card appears inline at the feed tail and pauses the game; answering it collapses it and its log line appears.
5. A mission offer appears inline with picker; Accept with a selected dragon logs the departure; Decline logs the decline.
6. Menu bar: Roster and People sheets open and close (button and scrim).
7. The auction still takes over the whole main area, and concludes back to the ledger.
8. Let a mission return: auto-pause fires, wing strip countdown reached ~0d.

- [ ] **Step 3: Commit any smoke fixes, then final commit if needed**

```bash
git add -A && git commit -m "fix(ui): one-screen smoke-test fixes"
```
