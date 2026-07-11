import { newRun } from '../sim/newRun'
import { tick } from '../sim/tick'
import type { GameState } from '../sim/types'
import { SCHEMA_VERSION } from '../sim/balance'
import { auctionSpendGoodwill, chooseCardOption } from '../sim/actions'
import { auctionClaim } from '../sim/auction'

const SAVE_KEY = 'wings-of-the-corps-save-v1'

export type Speed = 0 | 1 | 4 | 16
export type Tab = 'covert' | 'missions' | 'roster' | 'people'
export type SheetId = 'roster' | 'people' | 'provisions'

function params(): URLSearchParams {
  return new URLSearchParams(window.location.search)
}

/** The `?seed=` query param, if present and a finite number — else null. */
function urlSeed(): number | null {
  const seedParam = params().get('seed')
  if (seedParam === null) return null
  const parsed = Number(seedParam)
  return Number.isFinite(parsed) ? parsed : null
}

// Computed once at module load: a URL seed is a request to reproduce a
// specific run (e.g. a shared bug report or a balance-check link), which
// beats resuming whatever save happens to be in localStorage — seed-sharing
// beats resume when both are asked for.
const seedFromQuery = urlSeed()

function load(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const state = JSON.parse(raw) as GameState
    if (state.schemaVersion !== SCHEMA_VERSION) return null
    return state
  } catch {
    return null
  }
}

export const game = $state<{
  state: GameState
  speed: Speed
  tab: Tab
  sheet: SheetId | null
  focusDragonId: string | null
}>({
  // A ?seed= in the URL always starts a fresh run with that seed and ignores
  // any existing save (see seedFromQuery above); otherwise resume the save,
  // falling back to a fresh random-seeded run if there isn't one.
  state: seedFromQuery !== null ? newRun(seedFromQuery) : (load() ?? newRun(Date.now() % 0xffffffff)),
  speed: 0,
  tab: 'covert',
  sheet: null,
  focusDragonId: null,
})

export function saveNow(): void {
  localStorage.setItem(SAVE_KEY, JSON.stringify(game.state))
}

/** Runs a sim action, then saves. Wrap every call into src/sim/actions.ts with this. */
export function act(fn: () => void): void {
  fn()
  saveNow()
}

export function setSpeed(s: Speed): void {
  game.speed = s
}

export function openSheet(id: SheetId, focusDragonId: string | null = null): void {
  game.sheet = id
  game.focusDragonId = focusDragonId
}

export function closeSheet(): void {
  game.sheet = null
  game.focusDragonId = null
}

export function restart(): void {
  localStorage.removeItem(SAVE_KEY)
  // Same seed-sharing precedence as the initial load: a URL seed wins.
  game.state = newRun(seedFromQuery ?? Date.now() % 0xffffffff)
  game.speed = 0
  game.tab = 'covert'
  game.sheet = null
  game.focusDragonId = null
  saveNow()
}

interface AutoPauseSnapshot {
  pendingCards: number
  auctionLive: boolean
  activeMissions: number
}

function snapshot(state: GameState): AutoPauseSnapshot {
  return {
    pendingCards: state.pendingCards.length,
    auctionLive: state.auction !== null && !state.auction.concluded,
    // Active count, not done count: resolveMission prunes done missions down
    // to DONE_MISSION_CAP, so a "done count grew" check stops firing once the
    // cap is reached. Departures only happen via player actions — never inside
    // a tick batch — so a drop in active missions always means a return.
    activeMissions: state.missions.filter((m) => m.status === 'active').length,
  }
}

function shouldAutoPause(before: AutoPauseSnapshot, after: AutoPauseSnapshot): boolean {
  const cardsAppeared = before.pendingCards === 0 && after.pendingCards > 0
  const auctionAppeared = !before.auctionLive && after.auctionLive
  const missionFinished = after.activeMissions < before.activeMissions
  return cardsAppeared || auctionAppeared || missionFinished
}

let started = false

/** Idempotent: safe to call from App.svelte's onMount even across hot-reloads. */
export function startLoop(): void {
  if (started) return
  started = true

  // ?speed= scales the wall-clock interval for e2e speed-running; it is NOT
  // the same knob as game.speed (which controls ticks-per-burst).
  const speedParam = Number(params().get('speed'))
  const intervalMs = Number.isFinite(speedParam) && speedParam > 0 ? 1000 / speedParam : 1000

  setInterval(() => {
    if (game.speed > 0 && game.state.status === 'running') {
      const before = snapshot(game.state)
      for (let i = 0; i < game.speed; i++) {
        tick(game.state)
      }
      saveNow()
      if (shouldAutoPause(before, snapshot(game.state))) {
        setSpeed(0)
      }
    }
  }, intervalMs)

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      setSpeed(0)
      saveNow()
    }
  })

  // e2e hook: lets Playwright assert on raw state.
  ;(window as any).__game = game

  // e2e + Task-12 bridge; auction UI lands next task.
  ;(window as any).__actions = { auctionSpendGoodwill, auctionClaim, chooseCardOption, act }
}
