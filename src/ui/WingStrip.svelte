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
