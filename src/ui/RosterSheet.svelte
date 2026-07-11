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
