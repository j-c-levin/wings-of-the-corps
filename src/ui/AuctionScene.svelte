<script lang="ts">
  import { flip } from 'svelte/animate'
  import { game, act } from './store.svelte'
  import { auctionClaim } from '../sim/auction'
  import { auctionSpendGoodwill } from '../sim/actions'
  import { BREEDS } from '../sim/content'
  import { AUCTION_GOODWILL_COST } from '../sim/balance'
  import type { BreedId } from '../sim/types'

  // App.svelte only mounts this component while state.auction is live and
  // unconcluded, so `auction` is never null here — but Svelte's reactivity
  // needs the null-safe access anyway since the type is Auction | null.
  const auction = $derived(game.state.auction!)

  const candidate = $derived(game.state.officers.find((o) => o.id === auction.candidateOfficerId))

  const bestUnclaimedBreed = $derived(auction.eggs.find((e) => e.claimedBy === null)?.breed ?? null)

  const rivalsLeft = $derived(auction.bidders.some((b) => !b.you))
  const youTop = $derived(auction.bidders.length > 0 && auction.bidders[0].you)
  // Mirrors auctionClaim's exact guard (auction.ts) so the CLAIM affordance
  // never offers something the sim would reject.
  const canClaim = $derived((youTop && auction.nextClaimIn <= 0) || !rivalsLeft)

  const patronsWithGoodwill = $derived(game.state.patrons.filter((p) => p.goodwill > 0))

  const recentLog = $derived(game.state.log.slice(-4))

  function claim(breed: BreedId): void {
    act(() => auctionClaim(game.state, breed))
  }

  function spend(patronId: string): void {
    act(() => auctionSpendGoodwill(game.state, patronId))
  }
</script>

<div class="auction-scene">
  <section class="eggs">
    {#each auction.eggs as egg (egg.breed)}
      <div class="egg-chip" class:claimed={egg.claimedBy !== null} class:best={egg.breed === bestUnclaimedBreed}>
        <span class="egg-name" class:struck={egg.claimedBy !== null}>{BREEDS[egg.breed].name}</span>
        {#if egg.claimedBy !== null}
          <span class="claimant dim">{egg.claimedBy}</span>
        {:else if canClaim}
          <button type="button" class="claim-btn" onclick={() => claim(egg.breed)}>CLAIM</button>
        {/if}
      </div>
    {/each}
  </section>

  <section class="ticker" class:waiting={canClaim}>
    {#if canClaim}
      <p>The list waits on you.</p>
    {:else if rivalsLeft && auction.nextClaimIn > 0}
      <p class="dim">next claim in {auction.nextClaimIn}t</p>
    {:else}
      <p class="dim">a rival holds the lead — the reckoning waits.</p>
    {/if}
  </section>

  <section class="ladder">
    {#each auction.bidders as bidder (bidder.name)}
      <div class="bidder-row" class:you={bidder.you} animate:flip={{ duration: 350 }}>
        <div class="bidder-main">
          <span class="bidder-name">{bidder.name}{bidder.you ? ' (you)' : ''}</span>
          <span class="bidder-influence">{bidder.influence.toFixed(1)}</span>
        </div>
        {#if bidder.you}
          <p class="bidder-sub dim">your candidate: {candidate?.name ?? '—'}</p>
        {/if}
      </div>
    {/each}
  </section>

  <section class="goodwill-row">
    {#if patronsWithGoodwill.length === 0}
      <p class="empty dim">No one owes you anything.</p>
    {:else}
      {#each patronsWithGoodwill as patron (patron.id)}
        <button
          type="button"
          class="goodwill-btn"
          disabled={patron.goodwill < AUCTION_GOODWILL_COST}
          onclick={() => spend(patron.id)}
        >
          <span class="gw-label">{patron.name} · {patron.goodwill} goodwill</span>
          <span class="gw-sub dim">
            spend {AUCTION_GOODWILL_COST} — {candidate?.relatedPatronId === patron.id ? 'family interest' : "cools their regard"}
          </span>
        </button>
      {/each}
    {/if}
  </section>

  <section class="feed">
    {#each recentLog as line, i (line.day + '-' + i + '-' + line.text)}
      <p class="feed-line dim">{line.text}</p>
    {/each}
  </section>
</div>

<style>
  .auction-scene {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 0.8rem;
    gap: 0.6rem;
  }

  .eggs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    flex-shrink: 0;
  }

  .egg-chip {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    background: var(--bg-raised);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 0.4rem 0.6rem;
    min-width: 90px;
  }

  .egg-chip.best {
    border-color: var(--accent-dim);
  }

  .egg-chip.claimed {
    opacity: 0.7;
  }

  .egg-name {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 0.9rem;
  }

  .egg-name.struck {
    text-decoration: line-through;
  }

  .claimant {
    font-size: 0.72rem;
  }

  .claim-btn {
    min-height: 32px;
    padding: 0.2rem 0.5rem;
    font-size: 0.8rem;
    background: var(--accent-dim);
    border-color: var(--accent);
    font-weight: 600;
  }

  .ticker {
    text-align: center;
    flex-shrink: 0;
    font-size: 0.9rem;
  }

  .ticker.waiting p {
    color: var(--accent);
    font-weight: 600;
    font-family: var(--font-display);
    font-size: 1.05rem;
  }

  .ladder {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-height: 0;
  }

  .bidder-row {
    background: var(--bg-raised);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 0.45rem 0.7rem;
  }

  .bidder-row.you {
    border-color: var(--accent);
  }

  .bidder-main {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .bidder-row.you .bidder-name {
    color: var(--accent);
    font-weight: 600;
  }

  .bidder-influence {
    font-variant-numeric: tabular-nums;
  }

  .bidder-sub {
    font-size: 0.78rem;
    margin-top: 0.1rem;
  }

  .goodwill-row {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    flex-shrink: 0;
  }

  .goodwill-btn {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
    text-align: left;
    padding: 0.5rem 0.7rem;
  }

  .gw-label {
    font-weight: 600;
  }

  .gw-sub {
    font-size: 0.78rem;
  }

  .empty {
    text-align: center;
    font-style: italic;
    padding: 0.3rem 0;
  }

  .feed {
    flex-shrink: 0;
    max-height: 5.2em;
    overflow-y: auto;
  }

  .feed-line {
    font-size: 0.76rem;
    margin: 0 0 0.2rem;
    line-height: 1.3;
  }
</style>
