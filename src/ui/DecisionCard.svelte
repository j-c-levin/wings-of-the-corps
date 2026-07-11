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
