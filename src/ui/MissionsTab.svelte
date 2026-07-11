<script lang="ts">
  import { game, act } from './store.svelte'
  import { acceptMission, declineMission } from '../sim/actions'
  import { availabilityForecast, successChance, riskLabel } from '../sim/projection'
  import { TICKS_PER_DAY, REFUSAL_WAR_HEAT_GATE, TRAP_DISPLAY_SPREAD_LOW, TRAP_DISPLAY_SPREAD_HIGH } from '../sim/balance'
  import type { Dragon, Mission } from '../sim/types'

  // Per-mission selected dragon id, for the accept picker.
  let selected = $state<Record<string, string>>({})

  function dragonName(id: string | null): string {
    if (!id) return 'unknown'
    return game.state.dragons.find((d) => d.id === id)?.name ?? 'unknown'
  }

  function patronName(id: string | null): string {
    if (!id) return ''
    return game.state.patrons.find((p) => p.id === id)?.name ?? ''
  }

  function forecastNote(entry: { freeOnDay: number; note: string }): string {
    if (entry.note === 'ready') return 'ready'
    if (entry.note === 'healing') return `healing until ~D${entry.freeOnDay}`
    // "ready ~D{n}" not "returns D{n}": freeOnDay already folds in the sev>=2
    // healing-padding estimate from availabilityForecast, so promising an
    // exact return day would overclaim precision the sim doesn't have.
    return `ready ~D${entry.freeOnDay}`
  }

  const forecast = $derived(availabilityForecast(game.state))

  const activeMissions = $derived(game.state.missions.filter((m) => m.status === 'active'))
  const offeredMissions = $derived(game.state.missions.filter((m) => m.status === 'offered'))
  const homeDragons = $derived(game.state.dragons.filter((d) => d.status === 'home'))

  function countdown(m: Mission): string {
    const remaining = Math.max(0, (m.returnTick ?? game.state.tickCount) - game.state.tickCount)
    const d = Math.floor(remaining / TICKS_PER_DAY)
    const t = remaining % TICKS_PER_DAY
    return `${d}d ${t}t to return`
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

  function isTrap(missionId: string): boolean {
    return game.state.flags[`trap:${missionId}`] === true
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

  function enemyDisplay(m: Mission): string {
    if (isTrap(m.id)) {
      const lo = Math.max(0, m.enemyStrength - TRAP_DISPLAY_SPREAD_LOW)
      const hi = Math.min(10, m.enemyStrength + TRAP_DISPLAY_SPREAD_HIGH)
      return `enemy ${lo}–${hi}/10 (uncertain)`
    }
    return `enemy ${m.enemyStrength}/10`
  }

  function weatherLabel(w: number): string {
    if (w < 0.33) return 'calm'
    if (w < 0.66) return 'rough'
    return 'foul'
  }

  function rewardLine(m: Mission): string {
    const parts = [`${m.rewardCoin} coin`]
    if (m.rewardTreasure > 0) parts.push(`+${m.rewardTreasure} treasure`)
    parts.push(`+${m.rewardStanding} standing`)
    return parts.join(' · ')
  }

  function pickDragon(missionId: string, dragonId: string): void {
    selected[missionId] = dragonId
  }

  function canAccept(m: Mission): boolean {
    const dragonId = selected[m.id]
    if (!dragonId) return false
    const dragon = game.state.dragons.find((d) => d.id === dragonId)
    if (!dragon || dragon.status !== 'home') return false
    if (m.status !== 'offered') return false
    if (game.state.day > m.offerExpiresDay) return false
    return true
  }

  function accept(m: Mission): void {
    const dragonId = selected[m.id]
    if (!dragonId) return
    act(() => acceptMission(game.state, m.id, dragonId))
    delete selected[m.id]
  }

  function decline(m: Mission): void {
    act(() => declineMission(game.state, m.id))
  }
</script>

<section class="availability">
  {#if forecast.length === 0}
    <p class="empty dim">No dragons on the roster.</p>
  {:else}
    {#each forecast as entry (entry.dragonId)}
      <div class="avail-line">
        <span class="name">{dragonName(entry.dragonId)}</span>
        <span class="dim">{forecastNote(entry)}</span>
      </div>
    {/each}
  {/if}
</section>

<section class="active-missions">
  <h3>Active</h3>
  {#if activeMissions.length === 0}
    <p class="empty dim">No dragons afield.</p>
  {:else}
    {#each activeMissions as m (m.id)}
      {@const assigned = game.state.dragons.find((d) => d.id === m.assignedDragonId)}
      <div class="mission-card">
        <div class="mission-head">
          <span class="name">{m.name}</span>
          <span class="kind dim">{m.kind}</span>
        </div>
        <div class="mission-row dim">{dragonName(m.assignedDragonId)}</div>
        <div class="mission-row">{countdown(m)}</div>
        {#if assigned}
          <div class="mission-row {riskClass(riskLabel(successChance(game.state, m, assigned)))}">
            {riskLabel(successChance(game.state, m, assigned))}
          </div>
        {/if}
        <div class="mission-row" class:danger={game.state.day > m.deadlineDay}>promise: D{m.deadlineDay}</div>
      </div>
    {/each}
  {/if}
</section>

<section class="board">
  <h3>The Board</h3>
  {#if offeredMissions.length === 0}
    <p class="empty dim">No dispatches await.</p>
  {:else}
    {#each offeredMissions as m (m.id)}
      <div class="mission-card">
        <div class="mission-head">
          <span class="name">{m.name}</span>
          <span class="kind dim">{m.kind}</span>
        </div>
        {#if severityCopy(m.severityTier)}
          <div class="mission-row" class:danger={m.severityTier === 3}>{severityCopy(m.severityTier)}</div>
        {/if}
        <div class="mission-row">{rewardLine(m)}</div>
        {#if m.patronId}
          <div class="mission-row dim">for {patronName(m.patronId)}</div>
        {/if}
        <div class="mission-row dim">answer by D{m.offerExpiresDay} · promise: D{m.deadlineDay}</div>
        <div class="mission-row dim">{enemyDisplay(m)} · {weatherLabel(m.weather)}</div>

        <div class="picker">
          {#if homeDragons.length === 0}
            <p class="empty dim">No dragon is home to fly it.</p>
          {:else}
            {#each homeDragons as d (d.id)}
              {@const chance = isTrap(m.id)
                ? successChance(game.state, pessimisticMission(m), d)
                : successChance(game.state, m, d)}
              <button
                type="button"
                class="dragon-row"
                class:picked={selected[m.id] === d.id}
                onclick={() => pickDragon(m.id, d.id)}
              >
                <span class="name">{d.name}</span>
                <span class="{riskClass(riskLabel(chance))}">
                  {riskLabel(chance)}{isTrap(m.id) ? ' (uncertain)' : ` ${Math.round(chance * 100)}%`}
                </span>
              </button>
            {/each}
          {/if}
        </div>

        <div class="actions">
          <button
            type="button"
            class="action"
            disabled={!canAccept(m)}
            onclick={() => accept(m)}
          >
            Accept
          </button>
          <button type="button" onclick={() => decline(m)}>
            Decline{game.state.warHeat > REFUSAL_WAR_HEAT_GATE ? ' (costs standing)' : ''}
          </button>
        </div>
      </div>
    {/each}
  {/if}
</section>

<style>
  section {
    margin-bottom: 1rem;
  }

  h3 {
    font-size: 1rem;
    margin-bottom: 0.4rem;
  }

  .availability {
    background: var(--bg-raised);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 0.6rem 0.7rem;
  }

  .avail-line {
    display: flex;
    justify-content: space-between;
    padding: 0.2rem 0;
    font-size: 0.9rem;
  }

  .name {
    font-family: var(--font-display);
    font-weight: 600;
  }

  .empty {
    font-style: italic;
    text-align: center;
    padding: 0.6rem 0;
  }

  .mission-card {
    background: var(--bg-raised);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 0.7rem 0.8rem;
    margin-bottom: 0.6rem;
  }

  .mission-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.3rem;
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

  .actions {
    display: flex;
    gap: 0.5rem;
  }

  .actions button {
    flex: 1;
  }
</style>
