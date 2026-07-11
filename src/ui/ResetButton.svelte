<script lang="ts">
  import { restart } from './store.svelte'

  // Two-tap confirm: the first tap arms the button, the second within the
  // window actually resets. A stray single tap disarms itself after DISARM_MS
  // so a mistaken press never sits waiting to nuke a run.
  const DISARM_MS = 3000

  let armed = $state(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  function clearTimer(): void {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  function onClick(): void {
    if (armed) {
      clearTimer()
      armed = false
      restart()
      return
    }
    armed = true
    clearTimer()
    timer = setTimeout(() => {
      armed = false
      timer = undefined
    }, DISARM_MS)
  }

  // Cancel a pending disarm if the button is ever torn down, so the timeout
  // can't flip state on a destroyed component.
  $effect(() => () => clearTimer())
</script>

<button
  type="button"
  class="reset"
  class:armed
  onclick={onClick}
  aria-label={armed ? 'Tap again to reset the run' : 'Reset run'}
  title={armed ? 'Tap again to reset' : 'Reset run'}
>
  {#if armed}Reset?{:else}<span class="glyph" aria-hidden="true">↻</span>{/if}
</button>

<style>
  .reset {
    min-height: 44px;
    min-width: 44px;
    padding: 0.4rem 0.55rem;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .glyph {
    font-size: 1.15rem;
  }

  .reset.armed {
    border-color: var(--danger);
    color: var(--danger);
    font-size: 0.85rem;
    font-weight: 600;
  }
</style>
