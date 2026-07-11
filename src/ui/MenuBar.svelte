<script lang="ts">
  import { openSheet } from './store.svelte'
</script>

<footer class="menu-bar">
  <button type="button" onclick={() => openSheet('roster')}>Roster</button>
  <button type="button" onclick={() => openSheet('people')}>People</button>
</footer>

<style>
  .menu-bar {
    display: flex;
    flex-shrink: 0;
    border-top: 1px solid var(--line);
    background: var(--bg-raised);
  }

  .menu-bar button {
    flex: 1;
    border: none;
    border-radius: 0;
    min-height: 52px;
    background: transparent;
  }
</style>
