import { createRng } from './rng'
import type { Rng } from './rng'
import type { Dragon, GameState } from './types'
import {
  TICKS_PER_DAY,
  LOG_CAP,
  FEED_COST,
  FEED_SHORTFALL_CONTENTMENT,
  WOUND_HEAL_PER_DAY,
  HEALING_THRESHOLD,
  TRAINING_PER_DAY,
  CONTENTMENT_BASELINE,
  EXPECTATION_RISE_PER_STANDING,
  EXPECTATION_FLOOR_BY_RUNG,
  FAIL_DAYS_TO_RELIEVED,
  WOUNDED_LOG_CHANCE,
} from './balance'
import { LOG_LINES } from './content'
import type { LogContext } from './content'
import { tickMissions } from './missions'
import { tickAuction } from './auction'
import { tickPatrons } from './patrons'
import { tickWar, computeScore } from './war'
import { tickCards } from './cards'

/**
 * Advances the simulation by one tick, mutating `state` in place.
 *
 * The RNG is reconstructed from `state.rngState` at the top of every call
 * and its resulting state is written back at the end — this round-trip is
 * the determinism backbone: replaying the same sequence of ticks from the
 * same starting state always produces the same result.
 */
export function tick(state: GameState): void {
  if (state.status !== 'running') return

  const rng = createRng(state.rngState)

  state.tickCount += 1
  const previousDay = state.day
  state.day = Math.floor(state.tickCount / TICKS_PER_DAY)

  // Stub subsystems run every tick; later tasks decide their own internal
  // cadence (e.g. only acting on certain ticks or days).
  tickMissions(state, rng)
  tickAuction(state, rng)
  tickPatrons(state, rng)
  tickWar(state, rng)
  tickCards(state, rng)

  if (state.day !== previousDay) {
    runDailyUpkeep(state, rng)
  }

  state.rngState = rng.getState()
}

function runDailyUpkeep(state: GameState, rng: Rng): void {
  // tickWar (run earlier this same tick) may already have ended the run
  // (wing-destroyed / survived) — daily upkeep has nothing left to do then.
  if (state.status !== 'running') return

  const dragons = state.dragons

  // 1. Feed upkeep.
  const totalFeedCost = dragons.reduce((sum, d) => sum + FEED_COST[d.breed], 0)
  state.feed -= totalFeedCost
  if (state.feed < 0) {
    state.feed = 0
    for (const dragon of dragons) {
      dragon.contentment = Math.max(0, dragon.contentment - FEED_SHORTFALL_CONTENTMENT)
    }
    addLog(state, `Short rations: ${rng.pick(LOG_LINES.feeding)}`)
  }

  // 2. Healing (never touches dragons out on mission).
  for (const dragon of dragons) {
    if (dragon.status === 'mission') continue

    if (dragon.woundsTemp > 0) {
      dragon.woundsTemp = Math.max(0, dragon.woundsTemp - WOUND_HEAL_PER_DAY)
    }

    if (dragon.woundsTemp >= HEALING_THRESHOLD && dragon.status === 'home') {
      dragon.status = 'healing'
    } else if (dragon.status === 'healing' && dragon.woundsTemp < HEALING_THRESHOLD) {
      dragon.status = 'home'
    }
  }

  // 3. Passive training for dragons at home.
  for (const dragon of dragons) {
    if (dragon.status === 'home') {
      dragon.training = Math.min(100, dragon.training + TRAINING_PER_DAY)
    }
  }

  // 4. Contentment drift toward baseline.
  for (const dragon of dragons) {
    if (dragon.contentment < CONTENTMENT_BASELINE) {
      dragon.contentment = Math.min(CONTENTMENT_BASELINE, dragon.contentment + 1)
    } else if (dragon.contentment > CONTENTMENT_BASELINE) {
      dragon.contentment = Math.max(CONTENTMENT_BASELINE, dragon.contentment - 1)
    }
  }

  // 5. Expectation update.
  state.expectation = Math.max(
    EXPECTATION_FLOOR_BY_RUNG[state.rung],
    Math.min(100, state.standing * EXPECTATION_RISE_PER_STANDING)
  )

  // 6. Red line accounting.
  if (state.standing < state.expectation) {
    state.failStreakDays += 1
  } else {
    state.failStreakDays = 0
  }
  if (state.failStreakDays >= FAIL_DAYS_TO_RELIEVED) {
    state.status = 'ended'
    state.ending = 'relieved'
    state.score = computeScore(state)
    addLog(state, 'The Admiralty relieves you of command; your covert is given to another.')
  }

  // 7. Flavor log — one contextual line per day. war-* lines are Task 8's job.
  addLog(state, rng.pick(LOG_LINES[pickDailyLogContext(state, rng)]))
}

function pickDailyLogContext(state: GameState, rng: Rng): LogContext {
  const anyWounded = state.dragons.some((d: Dragon) => d.woundsTemp > 0)
  if (anyWounded && rng.next() < WOUNDED_LOG_CHANCE) {
    return 'wounded'
  }
  if (state.dragons.length > 0) {
    return rng.pick<LogContext>(['feeding', 'training', 'gossip'])
  }
  return 'gossip'
}

/** Appends a log line and trims from the front so the log never exceeds LOG_CAP. */
export function addLog(state: GameState, text: string): void {
  state.log.push({ day: state.day, text })
  if (state.log.length > LOG_CAP) {
    state.log.splice(0, state.log.length - LOG_CAP)
  }
}
