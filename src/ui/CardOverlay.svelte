<script lang="ts">
  import { game, act } from './store.svelte'
  import { CARDS } from '../sim/cards'
  import { chooseCardOption } from '../sim/actions'

  const card = $derived(game.state.pendingCards[0])
  const template = $derived(card ? CARDS[card.templateId] : undefined)
  const title = $derived(card && template ? template.title(game.state, card.params) : '')
  const body = $derived(card && template ? template.body(game.state, card.params) : '')
  const options = $derived(card && template ? template.options(game.state, card.params) : [])

  function choose(index: number): void {
    const c = card
    if (!c) return
    act(() => chooseCardOption(game.state, c.id, index))
  }
</script>

{#if card}
  <div class="scrim">
    <div class="card">
      <h2>{title}</h2>
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
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 30;
    padding: 1rem;
  }

  .card {
    background: var(--bg-raised);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 1.2rem;
    width: 100%;
    max-width: 420px;
    max-height: 90dvh;
    overflow-y: auto;
  }

  .card h2 {
    font-size: 1.3rem;
  }

  .body {
    color: var(--ink);
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.8rem;
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
