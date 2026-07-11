<script lang="ts">
  import { onMount } from 'svelte'
  import { game, setSpeed, openSheet, startLoop, type Speed } from './store.svelte'
  import AuctionScene from './AuctionScene.svelte'
  import EndScreen from './EndScreen.svelte'
  import Feed from './Feed.svelte'
  import MenuBar from './MenuBar.svelte'
  import PeopleSheet from './PeopleSheet.svelte'
  import ProvisionsSheet from './ProvisionsSheet.svelte'
  import ResetButton from './ResetButton.svelte'
  import RosterSheet from './RosterSheet.svelte'
  import WingStrip from './WingStrip.svelte'

  onMount(() => {
    startLoop()
  })

  const ended = $derived(game.state.status === 'ended')
  const auctionLive = $derived(game.state.auction !== null && !game.state.auction.concluded)

  // "Fuzzy red line": a soft gradient band centred on expectation, never a
  // hard tick — the player should feel the danger zone, not read a number.
  const ZONE_HALF_WIDTH = 8
  const zoneStops = $derived.by(() => {
    const center = Math.max(0, Math.min(100, game.state.expectation))
    const outer = Math.max(0, center - ZONE_HALF_WIDTH)
    const inner = Math.min(100, center + ZONE_HALF_WIDTH)
    return `linear-gradient(to right, transparent 0%, transparent ${outer}%, var(--danger-soft) ${center}%, transparent ${inner}%, transparent 100%)`
  })
</script>

<div class="shell">
  <header class="header">
    <div class="row row-day">
      <div class="day-group">
        <span class="day">Day {game.state.day}</span>
        <ResetButton />
      </div>
      <div class="scrub">
        <button class:active={game.speed === 0} disabled={ended} onclick={() => setSpeed(0 as Speed)}>⏸</button>
        <button class:active={game.speed === 1} disabled={ended} onclick={() => setSpeed(1 as Speed)}>▶</button>
        <button class:active={game.speed === 4} disabled={ended} onclick={() => setSpeed(4 as Speed)}>▶▶</button>
        <button class:active={game.speed === 16} disabled={ended} onclick={() => setSpeed(16 as Speed)}>▶▶▶</button>
      </div>
    </div>
    <div class="row row-resources">
      <button type="button" class="resources" onclick={() => openSheet('provisions')}>
        <span>🪙 {game.state.coin}</span>
        <span>🥩 {game.state.feed}</span>
        <span>💰 {game.state.treasure}</span>
      </button>
    </div>
    <div class="standing-wrap">
      <div class="standing-track" style="background: {zoneStops}">
        <div class="standing-fill" style="width: {game.state.standing}%"></div>
      </div>
      <div class="standing-label dim">standing {Math.round(game.state.standing)}</div>
    </div>
  </header>

  {#if auctionLive}
    <AuctionScene />
  {:else}
    <WingStrip />
    <Feed />
    <MenuBar />
  {/if}
</div>

{#if ended}
  <EndScreen />
{/if}

{#if game.sheet === 'roster'}
  <RosterSheet />
{:else if game.sheet === 'people'}
  <PeopleSheet />
{:else if game.sheet === 'provisions'}
  <ProvisionsSheet />
{/if}

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    max-width: 480px;
    margin: 0 auto;
    overflow: hidden;
  }

  .header {
    position: sticky;
    top: 0;
    z-index: 5;
    background: var(--bg-raised);
    border-bottom: 1px solid var(--line);
    padding: 0.6rem 0.8rem;
    flex-shrink: 0;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .row-day {
    margin-bottom: 0.4rem;
  }

  .day-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .day {
    font-family: var(--font-display);
    font-size: 1.1rem;
  }

  .scrub {
    display: flex;
    gap: 0.3rem;
  }

  .scrub button {
    min-width: 48px;
    padding: 0.4rem 0.5rem;
  }

  .row-resources {
    margin-bottom: 0.4rem;
  }

  .resources {
    display: flex;
    gap: 0.9rem;
    font-variant-numeric: tabular-nums;
    background: transparent;
    border: none;
    border-radius: 0;
    min-height: 0;
    padding: 0;
    font-size: 1rem;
    text-align: left;
  }

  .standing-wrap {
    position: relative;
  }

  .standing-track {
    position: relative;
    height: 10px;
    border-radius: 5px;
    background-color: var(--line);
    overflow: hidden;
  }

  .standing-fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--accent);
    opacity: 0.85;
  }

  .standing-label {
    font-size: 0.75rem;
    margin-top: 0.2rem;
  }
</style>
