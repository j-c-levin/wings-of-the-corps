<script lang="ts">
  import { onMount } from 'svelte'
  import { game, setSpeed, startLoop, type Speed } from './store.svelte'
  import CardOverlay from './CardOverlay.svelte'
  import CovertTab from './CovertTab.svelte'
  import EndScreen from './EndScreen.svelte'
  import MissionsTab from './MissionsTab.svelte'
  import RosterTab from './RosterTab.svelte'
  import PeopleTab from './PeopleTab.svelte'

  onMount(() => {
    startLoop()
  })

  const ended = $derived(game.state.status === 'ended')
  const auctionLive = $derived(game.state.auction !== null && !game.state.auction.concluded)
  const missionsBadge = $derived(game.state.missions.some((m) => m.status === 'offered'))

  // "Fuzzy red line": a soft gradient band centred on expectation, never a
  // hard tick — the player should feel the danger zone, not read a number.
  const ZONE_HALF_WIDTH = 8
  const zoneStops = $derived.by(() => {
    const center = Math.max(0, Math.min(100, game.state.expectation))
    const outer = Math.max(0, center - ZONE_HALF_WIDTH)
    const inner = Math.min(100, center + ZONE_HALF_WIDTH)
    return `linear-gradient(to right, transparent 0%, transparent ${outer}%, var(--danger-soft) ${center}%, transparent ${inner}%, transparent 100%)`
  })

  function tabClick(tab: typeof game.tab): void {
    game.tab = tab
  }
</script>

<div class="shell">
  <header class="header">
    <div class="row row-day">
      <span class="day">Day {game.state.day}</span>
      <div class="scrub">
        <button class:active={game.speed === 0} disabled={ended} onclick={() => setSpeed(0 as Speed)}>⏸</button>
        <button class:active={game.speed === 1} disabled={ended} onclick={() => setSpeed(1 as Speed)}>▶</button>
        <button class:active={game.speed === 4} disabled={ended} onclick={() => setSpeed(4 as Speed)}>▶▶</button>
        <button class:active={game.speed === 16} disabled={ended} onclick={() => setSpeed(16 as Speed)}>▶▶▶</button>
      </div>
    </div>
    <div class="row row-resources">
      <div class="resources">
        <span>🪙 {game.state.coin}</span>
        <span>🥩 {game.state.feed}</span>
        <span>💰 {game.state.treasure}</span>
      </div>
    </div>
    <div class="standing-wrap">
      <div class="standing-track" style="background: {zoneStops}">
        <div class="standing-fill" style="width: {game.state.standing}%"></div>
      </div>
      <div class="standing-label dim">standing {Math.round(game.state.standing)}</div>
    </div>
  </header>

  <main class="main">
    {#if auctionLive}
      <div class="auction-placeholder">
        <p>The allocation is under way — auction scene lands in Task 12.</p>
        <ul>
          {#each game.state.auction!.bidders as bidder (bidder.name)}
            <li class:you={bidder.you}>{bidder.name} — influence {bidder.influence}{bidder.you ? ' (you)' : ''}</li>
          {/each}
        </ul>
      </div>
    {:else if game.tab === 'covert'}
      <CovertTab />
    {:else if game.tab === 'missions'}
      <MissionsTab />
    {:else if game.tab === 'roster'}
      <RosterTab />
    {:else}
      <PeopleTab />
    {/if}
  </main>

  <footer class="tabs">
    <button class:active={game.tab === 'covert'} onclick={() => tabClick('covert')}>Covert</button>
    <button class:active={game.tab === 'missions'} onclick={() => tabClick('missions')}>
      Missions
      {#if missionsBadge}<span class="badge"></span>{/if}
    </button>
    <button class:active={game.tab === 'roster'} onclick={() => tabClick('roster')}>Roster</button>
    <button class:active={game.tab === 'people'} onclick={() => tabClick('people')}>People</button>
  </footer>
</div>

{#if ended}
  <EndScreen />
{/if}

{#if game.state.pendingCards.length > 0}
  <CardOverlay />
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

  .main {
    flex: 1;
    overflow-y: auto;
    padding: 0.8rem;
  }

  .auction-placeholder ul {
    list-style: none;
    padding: 0;
  }

  .auction-placeholder li {
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--line);
  }

  .auction-placeholder li.you {
    color: var(--accent);
    font-weight: 600;
  }

  .tabs {
    display: flex;
    flex-shrink: 0;
    border-top: 1px solid var(--line);
    background: var(--bg-raised);
  }

  .tabs button {
    flex: 1;
    border: none;
    border-radius: 0;
    min-height: 52px;
    position: relative;
    background: transparent;
  }

  .tabs button.active {
    color: var(--accent);
  }

  .badge {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--danger);
    margin-left: 0.3rem;
    vertical-align: middle;
  }
</style>
