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
