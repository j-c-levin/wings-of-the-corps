<script lang="ts">
  import { game, restart } from './store.svelte'
  import { BREEDS } from '../sim/content'
  import { SCORE_PER_DRAGON_WEIGHT, SCORE_PER_OFFICER, SCORE_PER_PATRON_TIER } from '../sim/balance'

  const headline = $derived(
    game.state.ending === 'relieved'
      ? 'Relieved of Duty'
      : game.state.ending === 'wing-destroyed'
        ? 'The Wing Is Lost'
        : game.state.ending === 'survived'
          ? 'You Held the Channel'
          : 'The Run Ends'
  )

  const epitaph = $derived(
    game.state.ending === 'relieved'
      ? "The Admiralty's letter is brief."
      : game.state.ending === 'wing-destroyed'
        ? 'The clearing stands empty.'
        : game.state.ending === 'survived'
          ? 'The wing you built held.'
          : ''
  )

  // Display-only breakdown: every row here mirrors war.ts's computeScore
  // formula exactly (same constants, same filters), but the sim's own
  // state.score is always what's shown as the total — if a future change
  // to computeScore ever drifts from this table, the total still reflects
  // reality rather than a stale re-derivation.
  const dragonRows = $derived(
    game.state.dragons.map((d) => ({
      name: d.name,
      breedName: BREEDS[d.breed].name,
      points: SCORE_PER_DRAGON_WEIGHT[BREEDS[d.breed].weightClass],
    }))
  )
  const dragonTotal = $derived(dragonRows.reduce((sum, r) => sum + r.points, 0))

  const livingOfficers = $derived(game.state.officers.filter((o) => o.alive).length)
  const officerTotal = $derived(livingOfficers * SCORE_PER_OFFICER)

  const standingPoints = $derived(Math.round(game.state.standing))

  const positivePatronTierSum = $derived(
    game.state.patrons.filter((p) => p.tier > 0).reduce((sum, p) => sum + p.tier, 0)
  )
  const patronTotal = $derived(positivePatronTierSum * SCORE_PER_PATRON_TIER)
</script>

<div class="overlay">
  <div class="panel">
    <h1>{headline}</h1>
    <p class="epitaph dim">{epitaph}</p>

    <table class="breakdown">
      <tbody>
        {#each dragonRows as row, i (row.name + i)}
          <tr>
            <td>{row.name} <span class="dim">({row.breedName})</span></td>
            <td class="num">{row.points}</td>
          </tr>
        {/each}
        {#if dragonRows.length > 1}
          <tr class="subtotal">
            <td class="dim">dragons</td>
            <td class="num dim">{dragonTotal}</td>
          </tr>
        {/if}
        <tr>
          <td>officers ({livingOfficers} × {SCORE_PER_OFFICER})</td>
          <td class="num">{officerTotal}</td>
        </tr>
        <tr>
          <td>standing</td>
          <td class="num">{standingPoints}</td>
        </tr>
        <tr>
          <td>patron favour ({positivePatronTierSum} tiers × {SCORE_PER_PATRON_TIER})</td>
          <td class="num">{patronTotal}</td>
        </tr>
        <tr class="total">
          <td>total</td>
          <td class="num">{game.state.score}</td>
        </tr>
      </tbody>
    </table>

    <p class="seed dim">seed {game.state.seed}</p>

    <button class="action" onclick={restart}>Start a New Covert</button>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.88);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 25;
    padding: 1rem;
  }

  .panel {
    background: var(--bg-raised);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 1.5rem;
    width: min(90vw, 380px);
    max-height: 90dvh;
    overflow-y: auto;
    text-align: center;
  }

  .epitaph {
    font-style: italic;
    margin-bottom: 1rem;
  }

  .breakdown {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    font-size: 0.85rem;
    margin-bottom: 0.6rem;
  }

  .breakdown td {
    padding: 0.3rem 0;
    border-bottom: 1px solid var(--line);
  }

  .breakdown .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .breakdown tr.subtotal td {
    font-style: italic;
  }

  .breakdown tr.total td {
    border-bottom: none;
    border-top: 1px solid var(--line);
    font-weight: 700;
    color: var(--accent);
    font-size: 1.05rem;
  }

  .seed {
    font-size: 0.78rem;
    margin-bottom: 1rem;
  }
</style>
