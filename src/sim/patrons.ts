import type { GameState, Id, Mission, MissionKind, Patron } from './types'
import type { Rng } from './rng'
import { addLog } from './tick'
import { pickUniqueMissionName } from './content'
import {
  TICKS_PER_DAY,
  TIER_MIN,
  TIER_MAX,
  GOODWILL_CAP,
  GIFT_TIER_MIN,
  GIFT_CHANCE,
  GIFT_COIN,
  GIFT_GOODWILL,
  RIVAL_SABOTAGE_TIER,
  TRAP_CHANCE,
  MAX_OPEN_OFFERS,
  TRAP_ENEMY_MIN,
  TRAP_ENEMY_MAX,
  TRAP_REWARD_MULT,
  DISPATCH_DURATION_MIN_DAYS,
  DISPATCH_DURATION_MAX_DAYS,
  COMBAT_DURATION_MIN_DAYS,
  COMBAT_DURATION_MAX_DAYS,
  OFFER_WINDOW_DAYS,
  DEADLINE_SLACK_DAYS,
  COIN_REWARD_BASE,
  COIN_REWARD_PER_ENEMY,
  TREASURE_REWARD,
  STANDING_REWARD_BASE,
  PATRON_MISSION_STANDING_BONUS,
} from './balance'

/** Every direct patron.tier/goodwill mutation in the sim funnels through
 * these three functions so clamping stays uniform everywhere. */

/** Adjusts a patron's tier by `delta`, clamped to [TIER_MIN, TIER_MAX]. Sets `memory` when given. */
export function adjustTier(state: GameState, patronId: Id, delta: number, memory?: string): void {
  const patron = findPatron(state, patronId, 'adjustTier')
  patron.tier = Math.max(TIER_MIN, Math.min(TIER_MAX, patron.tier + delta))
  if (memory !== undefined) patron.memory = memory
}

/** Adds (or removes, if `n` is negative) goodwill, clamped to [0, GOODWILL_CAP]. */
export function earnGoodwill(state: GameState, patronId: Id, n: number): void {
  const patron = findPatron(state, patronId, 'earnGoodwill')
  patron.goodwill = Math.max(0, Math.min(GOODWILL_CAP, patron.goodwill + n))
}

/**
 * Spends `n` goodwill from a patron. Throws if the patron doesn't have it.
 * Spending on behalf of a stranger (someone the patron has no stake in)
 * cools a warm patron by one tier — never below 0 from this rule alone.
 */
export function spendGoodwill(state: GameState, patronId: Id, n: number, forWhom: 'own-interest' | 'stranger'): void {
  const patron = findPatron(state, patronId, 'spendGoodwill')
  if (patron.goodwill < n) {
    throw new Error(`spendGoodwill: patron ${patronId} has insufficient goodwill (${patron.goodwill} < ${n})`)
  }
  patron.goodwill -= n
  if (forWhom === 'stranger' && patron.tier > 0) {
    adjustTier(state, patronId, -1, `Remembers: their goodwill was spent on a stranger's business.`)
  }
}

function findPatron(state: GameState, patronId: Id, fnName: string): Patron {
  const patron = state.patrons.find((p) => p.id === patronId)
  if (!patron) throw new Error(`${fnName}: no patron with id ${patronId}`)
  return patron
}

/**
 * Daily patron behaviour — runs only on the tick that rolls the day over
 * (the same day-boundary guard tickMissions uses).
 *  - gratitude patrons at tier >= GIFT_TIER_MIN occasionally send a gift.
 *  - rival patrons at tier <= RIVAL_SABOTAGE_TIER occasionally salt the
 *    mission board with a flattering, understated-enemy trap offer.
 *  - transactional patrons have no daily behaviour yet (Task 7's card).
 */
export function tickPatrons(state: GameState, rng: Rng): void {
  if (state.tickCount % TICKS_PER_DAY !== 0) return

  for (const patron of state.patrons) {
    if (patron.kind === 'gratitude' && patron.tier >= GIFT_TIER_MIN) {
      if (rng.next() < GIFT_CHANCE) {
        sendGift(state, rng, patron)
      }
    } else if (patron.kind === 'rival' && patron.tier <= RIVAL_SABOTAGE_TIER) {
      if (canInjectTrap(state) && rng.next() < TRAP_CHANCE) {
        injectTrapMission(state, rng, patron)
      }
    }
  }
}

function sendGift(state: GameState, rng: Rng, patron: Patron): void {
  const kind = rng.pick<'coin' | 'goodwill'>(['coin', 'goodwill'])
  if (kind === 'coin') {
    state.coin += GIFT_COIN
    addLog(state, `${patron.name} sends a gift of ${GIFT_COIN} coin, with her compliments.`)
  } else {
    earnGoodwill(state, patron.id, GIFT_GOODWILL)
    addLog(state, `${patron.name} sends word of her continued and growing favour.`)
  }
}

function canInjectTrap(state: GameState): boolean {
  if (state.pendingCards.length > 0) return false
  if (state.auction !== null) return false
  const openOffers = state.missions.filter((m) => m.status === 'offered').length
  return openOffers < MAX_OPEN_OFFERS
}

function injectTrapMission(state: GameState, rng: Rng, patron: Patron): void {
  const kind: MissionKind = state.rung >= 2 ? 'combat' : 'dispatch'
  const severity: 1 | 2 = state.rung >= 2 ? 2 : 1
  const enemyStrength = rng.int(TRAP_ENEMY_MIN, TRAP_ENEMY_MAX)
  const weather = Math.round(rng.next() * 100) / 100

  const [durMin, durMax] =
    kind === 'combat' ? [COMBAT_DURATION_MIN_DAYS, COMBAT_DURATION_MAX_DAYS] : [DISPATCH_DURATION_MIN_DAYS, DISPATCH_DURATION_MAX_DAYS]
  const durationDays = rng.int(durMin, durMax)
  const durationTicks = durationDays * TICKS_PER_DAY

  const offerExpiresDay = state.day + OFFER_WINDOW_DAYS
  const deadlineDay = state.day + durationDays + DEADLINE_SLACK_DAYS

  const rewardCoin = Math.round((COIN_REWARD_BASE * severity + COIN_REWARD_PER_ENEMY * enemyStrength) * TRAP_REWARD_MULT)
  const rewardTreasure = Math.round((severity >= 2 ? TREASURE_REWARD * (severity - 1) : 0) * TRAP_REWARD_MULT)
  const rewardStanding = Math.round((STANDING_REWARD_BASE * severity + PATRON_MISSION_STANDING_BONUS) * TRAP_REWARD_MULT)

  const name = pickUniqueMissionName(state, kind, rng)
  const id = `m${state.nextId}`
  state.nextId += 1

  const mission: Mission = {
    id,
    name,
    kind,
    severityTier: severity,
    rewardCoin,
    rewardTreasure,
    rewardStanding,
    patronId: patron.id,
    offerExpiresDay,
    deadlineDay,
    durationTicks,
    enemyStrength,
    weather,
    status: 'offered',
    assignedDragonId: null,
    returnTick: null,
    outcome: null,
  }
  state.missions.push(mission)
  state.flags[`trap:${id}`] = true
  addLog(state, `${patron.name} recommends you for a lucrative commission — the terms seem generous indeed.`)
}
