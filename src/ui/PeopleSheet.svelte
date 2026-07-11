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
