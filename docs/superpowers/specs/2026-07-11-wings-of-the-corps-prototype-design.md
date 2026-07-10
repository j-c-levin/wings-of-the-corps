# Wings of the Corps — text prototype design

*A phone-first, text-only web prototype of the Temeraire management game described in
`temeraire-game-design-doc.md` (the "vision doc"). No graphics; the end game is 3D but this
prototype proves the systems in pure text. Structural inspiration: merc-company (simple
web page, a few tabs, choices, real-time consequences).*

Status: approved design, pre-implementation.

---

## 1. What this prototype must prove

The whole arc, compressed: choosing whose career to back, winning eggs through influence,
sending dragons on missions with legible risk and live timers, climbing the rungs, and
surviving (or not) the invasion under the overcommitment red line. Nothing is a stub of a
different game — every system present is the real mechanic at small scale.

Two claims from the vision doc are under test:

1. **The pacing rhythm works** — time-scrub boredom punctuated by decision crises holds
   attention in pure text (§3 of the vision doc).
2. **Every loss reads as a verdict on the player's decision**, never a mugging by dice
   (§10) — enforced structurally by sharing forecast and resolver code.

## 2. Shape of a run

One seeded, restartable campaign, **~30–45 minutes**, ending at the invasion.

### Setup (~min 0–2): the sponsorship choice

You are a newly-grounded commander with a berth, **no dragons**, a small candidate pool,
and one patron's goodwill. An egg allocation approaches. You choose which candidate to
sponsor for the captaincy:

Two patrons frame the choice. **Patron A** starts at tier **+1 with a goodwill balance**.
**Patron B** starts at **tier 0 with no goodwill**. Each has a mediocre relative among the
candidates; the third candidate is a talented, unconnected nobody.

| You sponsor | Patron A (+1, has goodwill) | Patron B (0, none) | Your captain |
|---|---|---|---|
| **The best candidate** | Goodwill spent promoting a stranger → cools to **0** (no hatred, just no further interest) | Relative passed over → slides to **−1** | Excellent |
| **A's relative** | Goodwill *increases*; even after spending some at the auction, stays **+1** | Relative passed over → slides to **−1** | Mediocre |
| **B's relative** | Goodwill spent on a stranger → cools to **0** | Becomes **+1** and grants goodwill (which funds the auction) | Mediocre |

There is no clean option — that is the lesson. The tier and goodwill numbers move visibly
on the People tab as the choice is made: this is the FTUE for the entire relationship
economy.

**Captains grow.** All officers, mediocre ones included, level with experience. The
sponsorship choice sets the *difficulty slope* of the run, not a permanent ceiling. The
balance bot must verify all three openings are winnable (see §12).

### First auction (~min 2–5): the crucial beat

The allocation scene runs. Your candidate — a nobody backed by a nobody — is bumped down
the list by better-connected officers, and without spending patron goodwill you get
*nothing*. Burning goodwill secures the **last pick: always a tiny messenger dragon**
(Winchester). Even the dregs cost influence. The lesson — build reputation to give your
officers a chance — is delivered mechanically, not in a tooltip.

### Hatching (~min 5–6)

The egg hatches as an event card. **At allocation you knew only the breed**; hatching
reveals the individual dragon (qualities, temperament flavor). Harnessing is assumed to
succeed — your sponsored candidate bonds, becomes a captain, and the pair enters the
roster. No ceremony scene (cut for UI simplicity; see §11).

### Rung 1 (~min 6–15): the single berth

Dispatch cycles with the courier: messages, scouting, escort. Officers level, coin
trickles, standing climbs, patrons reveal their natures through events. The setup choice
keeps paying interest — the grateful patron gifts unprompted; the slighted one is simply
absent; a −1 slide starts to needle.

### Rung 2 (~min 15–25): the pairing

Second egg allocation. Same auction, but the player has *built* standing — a real combat
dragon (Grey Copper / Yellow Reaper) is winnable on merit, or relationships can be spent
again. Combat missions open; prize money enters the economy.

### Rung 3 (~min 25–33): the formation

A heavyweight or Longwing berth opens — which one depends on the officer pool (the
Longwing path requires a senior female candidate; if the player's best officer is a woman,
that path is live). Formation missions: bigger promises, bigger prizes, first missions
that can kill a named officer.

### Finale (~min 33–45): the invasion

The war arrives. A compressed authored sequence where mission demands deliberately exceed
any possible capacity, refusals also cost standing, and the player chooses which fires to
let burn. Whether they survive is a referendum on what they built.

### Endings

- **Relieved of duty** — standing falls below the risen expectation line (the common loss).
- **Wing destroyed** — rare, only via chosen-into top-tier risks.
- **Survived the invasion** — scored by what remains: dragons, officers, standing, patrons.

## 3. Time and pacing

- The sim ticks **once per real second** (merc-company's engine). One in-game day ≈ 3
  ticks at 1×.
- The UI owns a **speed scrub**: pause / 1× / 4× / 16× — implemented as ticks-per-real-
  second, so the simulation is identical at every speed.
- Any decision card or returning mission **auto-pauses** the scrub.
- While time runs, the Covert tab streams a one-line **covert log** (feeding, training
  gains, gossip, wounds healing, funerals) — the text stand-in for the vision doc's 3D
  covert, and where grief is *seen, not measured*.

## 4. UI: the tabs

Phone-first, thumb-reachable, deliberately super-simple. A persistent header (in-game
date, coin, feed, standing bar, scrub control — always under the thumb) over four tabs:

1. **Covert** — the live log; each dragon's at-a-glance condition (health, contentment,
   availability).
2. **Missions** — the board (offers with risk read + deadline) and active missions with
   **live countdown timers and a danger read** while dragons are away.
3. **Roster** — dragons and officers; assign training and crew; sponsor candidates for
   upcoming allocations.
4. **People** — patrons and rivals: tier (±3) and goodwill balance visible, plus a memory
   line ("remembers: you passed over his son").

Decision cards render as full-screen overlays above any tab. The **auction** is the one
special full-screen real-time scene (see §8).

## 5. Missions

A mission is a **promise**:

- **Offer:** shows reward (coin / prize money / treasure / standing), deadline, duration,
  and a **risk read** — likely enemy strength vs. the assigned pair's readiness, the
  captain's nerve, weather. The read and the resolver share the same functions
  (merc-company's `projection.ts` invariant), so **the forecast cannot lie**.
- **Accept:** the dragon departs; a **live timer** counts down on the Missions tab with
  the danger read alongside. The absence is the drama — no battle is shown.
- **Return:** an aftermath card. Graduated severity (vision doc §10):
  - Most missions: wounds + ground-crew casualty numbers (recoverable).
  - Harder tier: a named **officer** at risk.
  - Top tier only (flagged up front): a **dragon** can be lost outright.
- **Refusal** is free early, but in the late game every refusal also costs standing — the
  two-sided squeeze of §12 of the vision doc.

Captain death → dragon lost (grieves out of service). One scripted event card mid-run
offers the **insurance-officer** dilemma in single-shot form (bench a lieutenant against
one specific dragon), demonstrating the mechanic without building the full system.

## 6. Standing and the red line

- **Standing rises only by delivering on promises.** Every accepted mission is a promise
  with a deadline against finite capacity, so the only way up is to be slightly
  overextended.
- The **expectation threshold rises with success** — early failures are shrugs, late
  failures are scandals. Self-scaling difficulty, no rubber-banding.
- The threshold is **visible but fuzzy**: the player sees their standing bar and feels the
  danger zone, but gets no exact "two failures left" counter.
- **Availability forecast:** before accepting, the player can always see who is free, who
  is committed, who returns when and in what likely state. The squeeze must be understood,
  never sprung.
- **Soft floor:** standing craters to the bottom of the current rung, not below — a
  collapse knocks the player down a rung, not out. Only sustained failure at the floor
  ends the run.

## 7. Patrons: tier + goodwill

Every patron is **two numbers**:

- **Tier** (−3 … +3): attitude. Symmetric and mechanically loud at both poles —
  high-tier gratitude patrons *grant goodwill and gifts unprompted* (auction bumps,
  warnings off trap missions, coin in lean seasons); negative tiers bring sabotage
  (auction bump-downs, trap missions, withheld support). Tier 0 = the tap is off.
- **Goodwill**: a spendable balance. Earned by serving the patron's interests (their
  missions, their relatives, tribute for the transactional type); spent on
  **interventions** — auction bumps, mission intel, emergency coin. Spending a patron's
  goodwill on things they don't care about cools their tier.

Three named patrons in the prototype: one **gratitude-type** (helped once, generous
forever), one **transactional** (requires tribute, distances from failure), one **rival**
who can slide to nemesis. The first two are Patron A and Patron B from the setup choice.

## 8. The auction (the set-piece)

Egg allocations run as a real-time full-screen scene — the game's structural spine, since
**every dragon arrives this way** and the first one is the tutorial:

- A vertical list of competing candidates jostles in rank order in real time; eggs
  (breed-labelled) are claimed top-down; your candidate is highlighted.
- Patrons at high tier may bump your candidate **up** unprompted; the rival bumps you
  **down**.
- The player's verb: **spend goodwill to hold or improve the slot** — choosing whether,
  when, and *whose* goodwill to burn, live, as the list moves.
- Legibility is the tension: the player should always understand exactly why they are
  where they are in the list.

**Egg choice shows breed and nothing else.** The individual dragon is revealed at
hatching. Harnessing always succeeds; the player assigns the officer, the hatching event
card introduces the dragon.

## 9. Economy

Three currencies (vision doc's four, compressed — ordnance folds into coin):

- **Coin** — repairs, hiring, gear, tribute. Main inflow: dispatch pay, then prize money.
- **Feed** — daily upkeep scaling brutally with weight class (courier: cheap; heavy:
  ruinous). The reason a roster can't just grow unbounded.
- **Treasure** — mission spoils that buy **nothing except dragon contentment**. A
  treasure-starved dragon underperforms or refuses missions (the series' dragon-rights
  theme as a maintenance cost).

The run starts with a small coin stipend and no dragons (no feed cost, no income) until
the first courier starts flying dispatches.

## 10. Dragons and officers

**Breeds (six + one quest):** Winchester, Greyling (couriers); Grey Copper (light
combat); Yellow Reaper (middleweight backbone); **Longwing** (elite middle, acid,
**female captains only** — the constraint-satisfaction hook that reshuffles the candidate
pool); Chequered Nettle (heavy anchor). A **Kazilik egg quest** is an optional
high-risk finale gamble.

**Dragon state:** breed/weight class, training level, wounds (temporary and lasting),
contentment, bonded captain, availability (home / on mission / healing / training).

**Officers:** ~8–12 named people per run: rank (runner → ensign → midwingman →
lieutenant → captain), experience, nerve, morale, gender. Officers level by flying
missions — the **equity conversion**: rung gates check for an officer senior enough for
the next dragon class, so developing people *is* progression. All captains, including
mediocre ones, keep growing with experience.

## 11. Cut from the prototype (deliberately)

- **Harnessing ceremony scene** (dragon choosing among presented candidates, refusal,
  enforced harnessing) — harnessing is automatic; the egg choice is the acquisition
  moment. Cut for UI simplicity.
- **Breeding program** — no time for a bred egg to matter in one sitting.
- **Officer background life-sim** — its best moment (a bypassed officer resenting an
  outside recruit) becomes one scripted event.
- **Full insurance-officer system** — present as one scripted dilemma card only.
- **3D covert / all graphics** — the covert log carries the atmosphere.
- **War clock as a visible date** — the clock is a hidden escalation curve (the vision
  doc's stated lean: fuzzy), surfaced only through fiction: dispatch tone, refugee
  events, patrons going quiet, then the finale.

## 12. Architecture

New repo, merc-company's proven pattern and invariants copied wholesale:

- **`src/sim/`** — the whole game as a pure, deterministic state machine. No DOM, no
  Svelte, no `Math.random()`/`Date.now()`; all randomness through a seeded serializable
  RNG carried in state. Same seed → same run. `newRun(seed)` creates state;
  `tick(state)` advances one second; player verbs in `actions.ts`; every tuning constant
  in `balance.ts`.
- **`src/ui/`** — thin Svelte 5 + TypeScript layer. Renders state, calls sim actions,
  computes no game logic. A store drives ticks-per-second from the scrub speed and
  handles localStorage saves.
- **Forecast honesty invariant:** the mission risk read, the availability forecast, and
  the mission resolver share the same underlying functions — the UI can never promise
  odds the sim doesn't deliver.
- **`scripts/simulate.ts`** — headless balance bot playing N seeded runs, reporting win
  rate, loss breakdown, and rung-timing curves. Target: all three sponsorship openings
  winnable, overall bot win rate in a tunable band (start at 40–70%, merc-company's
  band). This is how the red-line tightrope gets tuned — it cannot be balanced by hand.
- **`GameState` stays JSON-serializable** (no classes/Maps/functions); schema version
  bumped on shape changes, old saves discarded by design.
- **UI verb safety:** sim actions throw on invalid input; every UI control is disabled or
  hidden for each throw path.
- Vitest over the sim core. Fully static Vite build; client-side only; saves in
  localStorage; phone-first CSS (desktop just gets a centered column).

## 13. Out of scope for this document

Implementation sequencing (which system is built first, milestones) belongs to the
implementation plan, written next. Content volume (exact event cards, mission tables,
flavor lines) is set during implementation within the structures above.
