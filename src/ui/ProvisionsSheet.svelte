<script lang="ts">
  import Sheet from './Sheet.svelte'
  import { game, act, closeSheet } from './store.svelte'
  import { buyFeed } from '../sim/actions'
  import { FEED_COST, FEED_PRICE } from '../sim/balance'

  const dailyFeed = $derived(game.state.dragons.reduce((sum, d) => sum + FEED_COST[d.breed], 0))
  const buyCost = $derived(5 * FEED_PRICE)

  function buy(): void {
    act(() => buyFeed(game.state, 5))
  }
</script>

<Sheet title="Provisions" onclose={closeSheet}>
  <div class="provisions">
    <div class="line"><span>Coin</span><span>🪙 {game.state.coin}</span></div>
    <div class="line"><span>Feed on hand</span><span>🥩 {Math.round(game.state.feed)}</span></div>
    <div class="line"><span>Daily consumption</span><span class="dim">−{dailyFeed}/day</span></div>
    <div class="line"><span>Treasure</span><span>💰 {game.state.treasure}</span></div>
    <button type="button" class="action" disabled={game.state.coin < buyCost} onclick={buy}>
      Buy 5 feed ({buyCost} coin)
    </button>
  </div>
</Sheet>

<style>
  .provisions {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .line {
    display: flex;
    justify-content: space-between;
    font-variant-numeric: tabular-nums;
  }
</style>
