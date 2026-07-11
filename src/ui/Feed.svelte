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
