<script lang="ts">
  import { game } from './store.svelte'
  import { BREEDS } from '../sim/content'
  import type { Dragon } from '../sim/types'

  let logEl: HTMLElement | undefined = $state()

  $effect(() => {
    // Read game.state.log so this effect re-runs whenever the log changes.
    void game.state.log.length
    if (logEl) logEl.scrollTop = logEl.scrollHeight
  })

  function statusWord(status: Dragon['status']): string {
    if (status === 'home') return 'home'
    if (status === 'mission') return 'afield'
    return 'healing'
  }
</script>

<section class="condition-strip">
  {#if game.state.dragons.length === 0}
    <p class="empty dim">The clearing stands empty. No wings darken it yet.</p>
  {:else}
    {#each game.state.dragons as dragon (dragon.id)}
      <div class="dragon-line">
        <span class="name">{dragon.name}</span>
        <span class="breed dim">{BREEDS[dragon.breed].name}</span>
        <span class="cond dim">wnd {Math.round(dragon.woundsTemp)} · cnt {Math.round(dragon.contentment)} · {statusWord(dragon.status)}</span>
      </div>
    {/each}
  {/if}
</section>

<section class="log" bind:this={logEl}>
  {#each game.state.log as line, i (i)}
    <p class="log-line">D{line.day} — {line.text}</p>
  {/each}
</section>

<style>
  .condition-strip {
    background: var(--bg-raised);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 0.6rem 0.7rem;
    margin-bottom: 0.8rem;
  }

  .dragon-line {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: baseline;
    padding: 0.25rem 0;
  }

  .dragon-line + .dragon-line {
    border-top: 1px solid var(--line);
  }

  .name {
    font-family: var(--font-display);
    font-weight: 600;
  }

  .empty {
    font-style: italic;
    text-align: center;
    padding: 1rem 0;
  }

  .log {
    max-height: 55dvh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .log-line {
    margin: 0 0 0.5rem;
    line-height: 1.4;
  }
</style>
