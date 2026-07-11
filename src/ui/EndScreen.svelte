<script lang="ts">
  import { game, restart } from './store.svelte'

  const headline = $derived(
    game.state.ending === 'relieved'
      ? 'Relieved of Duty'
      : game.state.ending === 'wing-destroyed'
        ? 'The Wing Is Lost'
        : game.state.ending === 'survived'
          ? 'You Held the Channel'
          : 'The Run Ends'
  )
</script>

<div class="overlay">
  <div class="panel">
    <h1>{headline}</h1>
    <p class="score">Score: {game.state.score}</p>
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
    text-align: center;
  }

  .score {
    font-size: 1.4rem;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }
</style>
