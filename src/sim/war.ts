import type { GameState, Id, Mission, Officer } from './types'
import type { Rng } from './rng'
import { addLog } from './tick'
import { BREEDS, LOG_LINES, RANK_ORDER, pickUniqueMissionName } from './content'
import type { LogContext } from './content'
import {
  TICKS_PER_DAY,
  WAR_HEAT_PER_DAY,
  WAR_HEAT_NOISE,
  FINALE_HEAT,
  WAR_RUMOR_LOW_HEAT,
  WAR_RUMOR_MID_HEAT,
  WAR_RUMOR_HIGH_HEAT,
  WAR_LOG_CHANCE,
  FINALE_LENGTH_DAYS,
  FINALE_MISSION_INTERVAL_DAYS,
  FINALE_MISSION_COUNT,
  WAR_ENEMY_MIN,
  WAR_ENEMY_MAX,
  WAR_MISSION_DURATION_MIN_DAYS,
  WAR_MISSION_DURATION_MAX_DAYS,
  WAR_OFFER_WINDOW_DAYS,
  WAR_DEADLINE_SLACK_DAYS,
  WAR_REWARD_MULT,
  COIN_REWARD_BASE,
  COIN_REWARD_PER_ENEMY,
  TREASURE_REWARD,
  STANDING_REWARD_BASE,
  SCORE_PER_DRAGON_WEIGHT,
  SCORE_PER_OFFICER,
  SCORE_PER_PATRON_TIER,
  TREASURE_KAZILIK_CONSOLATION,
} from './balance'

/**
 * The war clock: a hidden daily heat value that climbs toward the finale,
 * escalating rumor cards along the way, then an authored ~20-day invasion
 * sequence of war-kind missions arriving faster than one dragon can absorb
 * them. Endings ('wing-destroyed', 'survived') and their scoring live here
 * too; 'relieved' is tick.ts's red-line ending but shares computeScore.
 */

/** True only when nothing is already queued for the player's attention —
 * the same gate generateOffers/tickCards use before adding more. */
function cardsClear(state: GameState): boolean {
  return state.auction === null && state.pendingCards.length === 0
}

function pushCard(state: GameState, templateId: string, params: Record<string, string | number>): void {
  state.pendingCards.push({ id: `c${state.nextId}`, templateId, params })
  state.nextId += 1
}

/** The finale's end day lives key-encoded in a `finale-end-day-<D>` flag
 * (flags are boolean-only) — set once, the moment the finale starts. */
function finaleEndDay(state: GameState): number | null {
  const prefix = 'finale-end-day-'
  const key = Object.keys(state.flags).find((k) => k.startsWith(prefix))
  return key ? Number(key.slice(prefix.length)) : null
}

/** Dedupes a mission name against what's already on the board, same idiom
 * as content.ts's pickUniqueMissionName but for a single fixed base name
 * (the Kazilik quest's "The Istanbul Run" isn't drawn from a name pool). */
function uniqueName(state: GameState, base: string): string {
  const existingNames = new Set(state.missions.map((m) => m.name))
  if (!existingNames.has(base)) return base
  let n = 2
  while (existingNames.has(`${base} ${n}`)) n += 1
  return `${base} ${n}`
}

/**
 * Builds and pushes a severity-2/3 war-kind mission directly onto
 * state.missions, bypassing generateOffers' MAX_OPEN_OFFERS gate entirely —
 * queue pressure during the finale is the point. Rewards mirror the normal
 * offer formula (missions.ts's buildMissionOffer) scaled by WAR_REWARD_MULT.
 * `nameOverride` lets the Kazilik quest name its mission "The Istanbul Run"
 * instead of drawing from MISSION_NAMES.war.
 */
export function buildWarMission(state: GameState, rng: Rng, severity: 2 | 3, nameOverride?: string): Mission {
  const enemyStrength = rng.int(WAR_ENEMY_MIN, WAR_ENEMY_MAX)
  const weather = Math.round(rng.next() * 100) / 100
  const durationDays = rng.int(WAR_MISSION_DURATION_MIN_DAYS, WAR_MISSION_DURATION_MAX_DAYS)
  const durationTicks = durationDays * TICKS_PER_DAY
  const offerExpiresDay = state.day + WAR_OFFER_WINDOW_DAYS
  const deadlineDay = state.day + durationDays + WAR_DEADLINE_SLACK_DAYS

  const rewardCoin = Math.round((COIN_REWARD_BASE * severity + COIN_REWARD_PER_ENEMY * enemyStrength) * WAR_REWARD_MULT)
  const rewardTreasure = Math.round(TREASURE_REWARD * (severity - 1) * WAR_REWARD_MULT)
  const rewardStanding = Math.round(STANDING_REWARD_BASE * severity * WAR_REWARD_MULT)

  const name = nameOverride !== undefined ? uniqueName(state, nameOverride) : pickUniqueMissionName(state, 'war', rng)
  const id = `m${state.nextId}`
  state.nextId += 1

  const mission: Mission = {
    id,
    name,
    kind: 'war',
    severityTier: severity,
    rewardCoin,
    rewardTreasure,
    rewardStanding,
    patronId: null,
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
  return mission
}

/**
 * Injects the authored war-mission sequence, one per FINALE_MISSION_INTERVAL_DAYS
 * starting FINALE_MISSION_INTERVAL_DAYS after the finale begins, for
 * FINALE_MISSION_COUNT missions total. Each is gated only by pendingCards —
 * queue pressure past MAX_OPEN_OFFERS is deliberate — and a mission due
 * while a card is pending simply waits for the next clear day boundary
 * (still catches up in sequence, one injection per call).
 */
function tickFinaleMissions(state: GameState, rng: Rng): void {
  const endDay = finaleEndDay(state)
  if (endDay === null) return
  const startDay = endDay - FINALE_LENGTH_DAYS

  for (let i = 1; i <= FINALE_MISSION_COUNT; i++) {
    const dueDay = startDay + i * FINALE_MISSION_INTERVAL_DAYS
    if (state.day < dueDay) break
    const flag = `finale-mission-${i}-injected`
    if (state.flags[flag]) continue
    if (state.pendingCards.length > 0) return

    state.flags[flag] = true
    const severity: 2 | 3 = i <= 2 ? 2 : 3
    buildWarMission(state, rng, severity)
    return
  }
}

/** Highest rank, then highest skill, among officers free to bond a dragon —
 * the same "best candidate" ordering the auction uses, duplicated locally
 * so war.ts doesn't need auction.ts's unexported helpers. */
function bestKazilikCandidate(state: GameState): Officer | null {
  const candidates = state.officers.filter((o) => o.alive && o.dragonId === null && o.rank !== 'captain')
  if (candidates.length === 0) return null
  return [...candidates].sort((a, b) => RANK_ORDER[b.rank] - RANK_ORDER[a.rank] || b.skill - a.skill)[0]
}

/**
 * Called by missions.ts's resolveMission after a mission resolves. A no-op
 * unless that mission carries a `kazilik-run:<id>` flag (set by the Kazilik
 * quest card's "fund" option). On success, offers the egg to the best free
 * candidate via a 'hatching' card (breed 'kazilik'), or — if no one is free
 * to bond — sells it on for TREASURE_KAZILIK_CONSOLATION treasure. On
 * failure, just mourns it. Either way the flag is a one-shot and is cleared.
 */
export function resolveKazilikRun(state: GameState, missionId: Id, success: boolean): void {
  const flagKey = `kazilik-run:${missionId}`
  if (!state.flags[flagKey]) return
  delete state.flags[flagKey]

  if (success) {
    const candidate = bestKazilikCandidate(state)
    if (candidate) {
      pushCard(state, 'hatching', { breed: 'kazilik', officerId: candidate.id })
    } else {
      state.treasure += TREASURE_KAZILIK_CONSOLATION
      addLog(state, 'The Kazilik egg arrives safely, but no officer stands free to bond it — it is sold on as treasure instead.')
    }
  } else {
    addLog(state, 'Word comes at last from Istanbul: the Kazilik egg is lost, and the courier along with it.')
  }
}

/**
 * Score formula, shared by every ending (survived, wing-destroyed, and
 * tick.ts's relieved): dragons weighted by breed weight class, living
 * officers, current standing as-is, and the summed value of every patron
 * tier still in the player's favour.
 */
export function computeScore(state: GameState): number {
  const dragonScore = state.dragons.reduce((sum, d) => sum + SCORE_PER_DRAGON_WEIGHT[BREEDS[d.breed].weightClass], 0)
  const officerScore = state.officers.filter((o) => o.alive).length * SCORE_PER_OFFICER
  const patronTierSum = state.patrons.filter((p) => p.tier > 0).reduce((sum, p) => sum + p.tier, 0)
  const patronScore = patronTierSum * SCORE_PER_PATRON_TIER
  return dragonScore + officerScore + state.standing + patronScore
}

function endRun(state: GameState, ending: 'wing-destroyed' | 'survived'): void {
  state.status = 'ended'
  state.ending = ending
  state.score = computeScore(state)
}

/** Daily ending checks specific to the war clock. 'relieved' is tick.ts's
 * red-line ending and is checked there instead. */
function checkEndings(state: GameState): void {
  if (state.status !== 'running') return

  if (state.finaleStarted && state.dragons.length === 0 && state.flags['had-dragon']) {
    addLog(state, 'The last dragon of your covert is gone; there is no wing left to fly.')
    endRun(state, 'wing-destroyed')
    return
  }

  const endDay = finaleEndDay(state)
  if (endDay !== null && state.day > endDay) {
    addLog(state, 'The invasion is thrown back. Against every expectation, your covert has survived the war.')
    endRun(state, 'survived')
  }
}

/**
 * Advances the war clock by one day boundary (a no-op on any other tick, or
 * once the run has ended):
 *  1. Heat climbs by WAR_HEAT_PER_DAY plus a small rng noise term, capped at
 *     FINALE_HEAT — this is what makes the finale day fuzzy across seeds.
 *  2. Escalating rumor cards fire once each, in order, as heat crosses 30/55/80,
 *     deferring (via their own one-shot flags) while another card is pending.
 *  3. An occasional war-flavor log line, independent of the rumor cards.
 *  4. The finale trigger: heat at FINALE_HEAT and rung >= 2. A rung-1 covert
 *     holds at capped heat until it reaches rung 2 (turtling can't dodge the
 *     war, only delay which day it starts).
 *  5. The one-shot Kazilik quest card, pushed the day the finale starts (or
 *     the next clear day boundary after, if something else is pending).
 *  6. The authored war-mission injection sequence, while the finale is live.
 *  7. Ending checks: wing-destroyed, survived.
 */
export function tickWar(state: GameState, rng: Rng): void {
  if (state.status !== 'running') return
  if (state.tickCount % TICKS_PER_DAY !== 0) return

  if (state.dragons.length > 0) state.flags['had-dragon'] = true

  state.warHeat = Math.min(FINALE_HEAT, state.warHeat + WAR_HEAT_PER_DAY + rng.next() * WAR_HEAT_NOISE)

  if (cardsClear(state)) {
    if (state.warHeat >= WAR_RUMOR_LOW_HEAT && !state.flags['rumor-low-done']) {
      state.flags['rumor-low-done'] = true
      pushCard(state, 'war-rumor-low', {})
    } else if (state.warHeat >= WAR_RUMOR_MID_HEAT && !state.flags['rumor-mid-done']) {
      state.flags['rumor-mid-done'] = true
      pushCard(state, 'war-rumor-mid', {})
    } else if (state.warHeat >= WAR_RUMOR_HIGH_HEAT && !state.flags['rumor-high-done']) {
      state.flags['rumor-high-done'] = true
      pushCard(state, 'war-rumor-high', {})
    }
  }

  if (state.warHeat >= WAR_RUMOR_LOW_HEAT && rng.next() < WAR_LOG_CHANCE) {
    const band: LogContext =
      state.warHeat >= WAR_RUMOR_HIGH_HEAT ? 'war-high' : state.warHeat >= WAR_RUMOR_MID_HEAT ? 'war-mid' : 'war-low'
    addLog(state, rng.pick(LOG_LINES[band]))
  }

  if (!state.finaleStarted && state.warHeat >= FINALE_HEAT && state.rung >= 2) {
    state.finaleStarted = true
    state.flags[`finale-end-day-${state.day + FINALE_LENGTH_DAYS}`] = true
    addLog(state, "INVASION: the beacons burn from Kent to Cornwall — Bonaparte's fleet is in the Channel at last.")
  }

  if (state.finaleStarted && !state.flags['kazilik-card-pushed'] && cardsClear(state)) {
    state.flags['kazilik-card-pushed'] = true
    pushCard(state, 'kazilik-quest', {})
  }

  if (state.finaleStarted) {
    tickFinaleMissions(state, rng)
  }

  checkEndings(state)
}
