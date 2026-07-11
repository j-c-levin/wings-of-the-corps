import { newRun } from '../sim/newRun'
import { tick } from '../sim/tick'
import type { GameState } from '../sim/types'
import { SCHEMA_VERSION } from '../sim/balance'

const SAVE_KEY = 'wings-of-the-corps-save-v1'

export type Speed = 0 | 1 | 4 | 16
export type Tab = 'covert' | 'missions' | 'roster' | 'people'

function params(): URLSearchParams {
  return new URLSearchParams(window.location.search)
}

function seedFromUrl(): number {
  const seedParam = params().get('seed')
  const parsed = seedParam !== null ? Number(seedParam) : NaN
  return Number.isFinite(parsed) ? parsed : Date.now() % 0xffffffff
}

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

export const game = $state<{ state: GameState; speed: Speed; tab: Tab }>({
  state: load() ?? newRun(seedFromUrl()),
  speed: 0,
  tab: 'covert',
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

export function restart(): void {
  localStorage.removeItem(SAVE_KEY)
  game.state = newRun(Date.now() % 0xffffffff)
  game.speed = 0
  game.tab = 'covert'
  saveNow()
}

interface AutoPauseSnapshot {
  pendingCards: number
  auctionLive: boolean
  doneMissions: number
}

function snapshot(state: GameState): AutoPauseSnapshot {
  return {
    pendingCards: state.pendingCards.length,
    auctionLive: state.auction !== null && !state.auction.concluded,
    doneMissions: state.missions.filter((m) => m.status === 'done').length,
  }
}

function shouldAutoPause(before: AutoPauseSnapshot, after: AutoPauseSnapshot): boolean {
  const cardsAppeared = before.pendingCards === 0 && after.pendingCards > 0
  const auctionAppeared = !before.auctionLive && after.auctionLive
  const missionFinished = after.doneMissions > before.doneMissions
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
}
