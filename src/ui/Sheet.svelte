<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    title,
    onclose,
    children,
  }: { title: string; onclose: () => void; children: Snippet } = $props()
</script>

<button type="button" class="scrim" aria-label="Close {title}" onclick={onclose}></button>
<div class="sheet" role="dialog" aria-label={title}>
  <div class="sheet-head">
    <h3>{title}</h3>
    <button type="button" class="close" onclick={onclose}>Close</button>
  </div>
  <div class="sheet-body">
    {@render children()}
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    border: none;
    border-radius: 0;
    z-index: 20;
    cursor: default;
  }

  .sheet {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    bottom: 0;
    width: 100%;
    max-width: 480px;
    max-height: 80dvh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border: 1px solid var(--line);
    border-bottom: none;
    border-radius: 12px 12px 0 0;
    z-index: 21;
  }

  .sheet-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.7rem 0.8rem 0.4rem;
    border-bottom: 1px solid var(--line);
    flex-shrink: 0;
  }

  .sheet-head h3 {
    margin: 0;
  }

  .close {
    min-height: 36px;
    padding: 0.3rem 0.7rem;
    font-size: 0.9rem;
  }

  .sheet-body {
    overflow-y: auto;
    padding: 0.8rem;
  }
</style>
