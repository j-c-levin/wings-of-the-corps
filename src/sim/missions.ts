import type { Dragon, GameState, Id, Mission, MissionKind } from './types'
import type { Rng } from './rng'
import { successChance } from './projection'
import { addLog } from './tick'
import { adjustTier, earnGoodwill } from './patrons'
import { LOG_LINES, pickUniqueMissionName, nextRank } from './content'
import {
  TICKS_PER_DAY,
  REFUSAL_WAR_HEAT_GATE,
  REFUSAL_STANDING_COST,
  OFFER_INTERVAL_DAYS,
  MAX_OPEN_OFFERS,
  OFFER_WINDOW_DAYS,
  DEADLINE_SLACK_DAYS,
  DISPATCH_DURATION_MIN_DAYS,
  DISPATCH_DURATION_MAX_DAYS,
  COMBAT_DURATION_MIN_DAYS,
  COMBAT_DURATION_MAX_DAYS,
  FORMATION_DURATION_MIN_DAYS,
  FORMATION_DURATION_MAX_DAYS,
  ENEMY_STRENGTH_SEV1_MIN,
  ENEMY_STRENGTH_SEV1_MAX,
  ENEMY_STRENGTH_SEV2_MIN,
  ENEMY_STRENGTH_SEV2_MAX,
  ENEMY_STRENGTH_SEV3_MIN,
  ENEMY_STRENGTH_SEV3_MAX,
  COIN_REWARD_BASE,
  COIN_REWARD_PER_ENEMY,
  TREASURE_REWARD,
  STANDING_REWARD_BASE,
  PATRON_MISSION_STANDING_BONUS,
  PATRON_MISSION_CHANCE,
  LIGHT_WOUND_MAX,
  CREW_LOST_SUCCESS_MAX,
  FAIL_WOUND_MIN,
  FAIL_WOUND_MAX,
  FAIL_LASTING_MAX,
  FAIL_STANDING_COST,
  CREW_LOST_FAIL_SEV1_MIN,
  CREW_LOST_FAIL_SEV1_MAX,
  CREW_LOST_FAIL_SEV2_MIN,
  CREW_LOST_FAIL_SEV2_MAX,
  CREW_LOST_FAIL_SEV3_MIN,
  CREW_LOST_FAIL_SEV3_MAX,
  OFFICER_DEATH_CHANCE,
  DRAGON_LOSS_CHANCE,
  CAPTAIN_MORALE_LOSS_ON_DRAGON_DEATH,
  LATE_STANDING_COST,
  PATRON_SUCCESS_GOODWILL,
  XP_PER_MISSION,
  SKILL_GROWTH_CHANCE,
  SKILL_MAX,
  DONE_MISSION_CAP,
  CREW_XP_PER_MISSION,
  RANK_XP,
} from './balance'

type OfferableKind = Exclude<MissionKind, 'war'>

/**
 * Advances mission state by one tick:
 *  (a) resolves any active mission whose returnTick has arrived — every tick.
 *  (b) on the tick that rolls the day over: expires offers past their
 *      offerExpiresDay (late-game refusal cost above REFUSAL_WAR_HEAT_GATE),
 *      then calls generateOffers.
 */
export function tickMissions(state: GameState, rng: Rng): void {
  for (const m of state.missions) {
    if (m.status === 'active' && m.returnTick !== null && m.returnTick <= state.tickCount) {
      resolveMission(state, m, rng)
    }
  }

  // state.day is already advanced to the post-rollover value by tick.ts
  // before subsystems run, so a day-boundary tick is exactly one where
  // tickCount is a multiple of TICKS_PER_DAY.
  if (state.tickCount % TICKS_PER_DAY === 0) {
    const expiredIds: Id[] = []
    for (const m of state.missions) {
      if (m.status === 'offered' && state.day > m.offerExpiresDay) {
        expiredIds.push(m.id)
        delete state.flags[`trap:${m.id}`] // expired trap offers must not leak their flag
        delete state.flags[`warned:${m.id}`] // nor the trap-warning's one-shot marker
        if (state.warHeat > REFUSAL_WAR_HEAT_GATE) {
          state.standing = Math.max(0, state.standing - REFUSAL_STANDING_COST)
          addLog(state, `The ${m.name} offer lapses unanswered — the Admiralty notices the refusal.`)
        }
      }
    }
    if (expiredIds.length > 0) {
      const removeSet = new Set(expiredIds)
      state.missions = state.missions.filter((m) => !removeSet.has(m.id))
    }

    generateOffers(state, rng)
  }
}

/**
 * Sends a dragon out on an offered mission. No validation — callers (actions)
 * validate. Clears any `trap:` flag here (rather than in acceptMission) so
 * EVERY depart path — player action or future scripted content — drops the
 * flag the moment the offer stops being an offer; the range-masking only
 * ever applied to the offered state.
 */
export function departMission(state: GameState, m: Mission, d: Dragon): void {
  m.status = 'active'
  m.assignedDragonId = d.id
  m.returnTick = state.tickCount + m.durationTicks
  d.status = 'mission'
  d.missionId = m.id
  delete state.flags[`trap:${m.id}`]
  delete state.flags[`warned:${m.id}`]
}

/**
 * Generates new mission offers on a fixed cadence. A no-op while a
 * decision card is pending or the auction is running — the FTUE
 * determinism gate — so nothing new can appear mid-scripted-sequence.
 */
export function generateOffers(state: GameState, rng: Rng): void {
  // Offers pause during scripted card sequences and while an auction is being
  // BID on, but may resume once an egg is merely incubating (concluded auction).
  if (state.pendingCards.length > 0 || (state.auction !== null && !state.auction.concluded)) return
  if (state.day % OFFER_INTERVAL_DAYS !== 0) return

  const dayFlag = `offers-day-${state.day}`
  if (state.flags[dayFlag]) return
  // Track only the latest cadence marker — drop stale ones so flags don't grow.
  for (const key of Object.keys(state.flags)) {
    if (key.startsWith('offers-day-')) delete state.flags[key]
  }
  state.flags[dayFlag] = true

  let toGenerate = rng.int(1, 2)
  while (toGenerate > 0) {
    const openOffers = state.missions.filter((m) => m.status === 'offered').length
    if (openOffers >= MAX_OPEN_OFFERS) break
    state.missions.push(buildMissionOffer(state, rng))
    toGenerate -= 1
  }
}

function pickKindAndSeverity(state: GameState, rng: Rng): { kind: OfferableKind; severity: 1 | 2 | 3 } {
  if (state.rung === 1) {
    return { kind: 'dispatch', severity: 1 }
  }
  if (state.rung === 2) {
    const kind = rng.pick<OfferableKind>(['dispatch', 'combat'])
    const severity = rng.int(1, 2) as 1 | 2
    return { kind, severity }
  }
  // rung 3+: also formation, at severity 2-3
  const kind = rng.pick<OfferableKind>(['dispatch', 'combat', 'formation'])
  const severity = kind === 'formation' ? (rng.int(2, 3) as 2 | 3) : (rng.int(1, 2) as 1 | 2)
  return { kind, severity }
}

function enemyStrengthRange(sev: 1 | 2 | 3): [number, number] {
  if (sev === 1) return [ENEMY_STRENGTH_SEV1_MIN, ENEMY_STRENGTH_SEV1_MAX]
  if (sev === 2) return [ENEMY_STRENGTH_SEV2_MIN, ENEMY_STRENGTH_SEV2_MAX]
  return [ENEMY_STRENGTH_SEV3_MIN, ENEMY_STRENGTH_SEV3_MAX]
}

function durationDayRange(kind: OfferableKind): [number, number] {
  if (kind === 'dispatch') return [DISPATCH_DURATION_MIN_DAYS, DISPATCH_DURATION_MAX_DAYS]
  if (kind === 'combat') return [COMBAT_DURATION_MIN_DAYS, COMBAT_DURATION_MAX_DAYS]
  return [FORMATION_DURATION_MIN_DAYS, FORMATION_DURATION_MAX_DAYS]
}

function pickPatronForMission(state: GameState, rng: Rng): Id | null {
  if (rng.next() >= PATRON_MISSION_CHANCE) return null
  const eligible = state.patrons.filter((p) => p.kind !== 'rival' && p.tier >= 0)
  if (eligible.length === 0) return null
  return rng.pick(eligible).id
}

function buildMissionOffer(state: GameState, rng: Rng): Mission {
  const { kind, severity } = pickKindAndSeverity(state, rng)
  const [enemyMin, enemyMax] = enemyStrengthRange(severity)
  const enemyStrength = rng.int(enemyMin, enemyMax)
  const weather = Math.round(rng.next() * 100) / 100

  const [durMin, durMax] = durationDayRange(kind)
  const durationDays = rng.int(durMin, durMax)
  const durationTicks = durationDays * TICKS_PER_DAY

  const offerExpiresDay = state.day + OFFER_WINDOW_DAYS
  const deadlineDay = state.day + durationDays + DEADLINE_SLACK_DAYS

  const patronId = pickPatronForMission(state, rng)
  const rewardCoin = COIN_REWARD_BASE * severity + COIN_REWARD_PER_ENEMY * enemyStrength
  const rewardTreasure = severity >= 2 ? TREASURE_REWARD * (severity - 1) : 0
  const rewardStanding = STANDING_REWARD_BASE * severity + (patronId ? PATRON_MISSION_STANDING_BONUS : 0)

  const name = pickUniqueMissionName(state, kind, rng)
  const id = `m${state.nextId}`
  state.nextId += 1

  return {
    id,
    name,
    kind,
    severityTier: severity,
    rewardCoin,
    rewardTreasure,
    rewardStanding,
    patronId,
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
}

function crewLostForFailure(sev: 1 | 2 | 3, rng: Rng): number {
  if (sev === 1) return rng.int(CREW_LOST_FAIL_SEV1_MIN, CREW_LOST_FAIL_SEV1_MAX)
  if (sev === 2) return rng.int(CREW_LOST_FAIL_SEV2_MIN, CREW_LOST_FAIL_SEV2_MAX)
  return rng.int(CREW_LOST_FAIL_SEV3_MIN, CREW_LOST_FAIL_SEV3_MAX)
}

/**
 * Resolves an active mission: rolls against successChance() — THE SAME
 * function the offer's risk read used — then applies graduated-severity
 * outcomes. Severity gating is strict: tier 1 can never kill an officer
 * or lose a dragon; tier 2 failure can kill the assigned dragon's captain
 * (cascading to the dragon, unless an insurance flag absorbs it); tier 3
 * failure can lose the dragon outright while the captain survives.
 */
export function resolveMission(state: GameState, m: Mission, rng: Rng): void {
  const d = state.dragons.find((x) => x.id === m.assignedDragonId)
  if (!d) {
    m.status = 'done'
    m.outcome = {
      success: false,
      woundsTemp: 0,
      woundsLasting: 0,
      crewLost: 0,
      officerLostId: null,
      dragonLost: false,
      narrative: `${m.name}: the assigned dragon could not be found; the mission is written off.`,
    }
    pruneDoneMissions(state)
    return
  }

  const captain = state.officers.find((o) => o.id === d.captainId) ?? null
  const chance = successChance(state, m, d)
  const success = rng.next() < chance
  const sev = m.severityTier

  let officerLostId: Id | null = null
  let dragonLost = false
  const narrativeParts: string[] = []
  let crewLost: number

  if (success) {
    state.coin += m.rewardCoin
    state.treasure += m.rewardTreasure
    state.standing = Math.min(100, state.standing + m.rewardStanding)

    d.woundsTemp = Math.min(100, d.woundsTemp + rng.int(0, LIGHT_WOUND_MAX))
    crewLost = sev >= 2 ? rng.int(0, CREW_LOST_SUCCESS_MAX) : 0

    if (m.patronId) {
      earnGoodwill(state, m.patronId, PATRON_SUCCESS_GOODWILL)
      adjustTier(state, m.patronId, 1, `Remembers: the ${m.name} flown well.`)
    }

    narrativeParts.push(`${m.name} succeeds.`)

    // Equity conversion: a success lifts the whole covert, not just the flyer.
    // Every living non-captain officer banks a little xp and may promote one
    // rank (max one per mission) — this is what carries a runner up to the
    // midwingman/lieutenant ranks the rung-2/3 auctions gate on. Captaincy is
    // never reached this way; it comes only from bonding a dragon at hatch.
    awardCrewEquity(state, sev)
  } else {
    d.woundsTemp = Math.min(100, d.woundsTemp + rng.int(FAIL_WOUND_MIN, FAIL_WOUND_MAX))
    d.woundsLasting = Math.min(30, d.woundsLasting + rng.int(0, FAIL_LASTING_MAX))
    crewLost = crewLostForFailure(sev, rng)
    state.standing = Math.max(0, state.standing - FAIL_STANDING_COST * sev)

    if (m.patronId) {
      adjustTier(state, m.patronId, -1, `Your failure at ${m.name} has not gone unnoticed.`)
    }

    narrativeParts.push(`${m.name} fails.`)

    if (sev === 2 && captain && rng.next() < OFFICER_DEATH_CHANCE) {
      const insuranceFlag = `insurance:${d.id}`
      if (state.flags[insuranceFlag] === true) {
        state.flags[insuranceFlag] = false
        narrativeParts.push(`${captain.name} nearly falls, but a waiting insurance officer steps in and ${d.name} survives.`)
        addLog(state, `An unnamed officer throws himself into the breach — ${d.name} survives where ${captain.name} could not have.`)
      } else {
        captain.alive = false
        officerLostId = captain.id
        dragonLost = true
        state.dragons = state.dragons.filter((x) => x.id !== d.id)
        narrativeParts.push(`Captain ${captain.name} is killed, and ${d.name} is lost with him.`)
        addLog(state, rng.pick(LOG_LINES.funeral))
      }
    } else if (sev === 3 && rng.next() < DRAGON_LOSS_CHANCE) {
      dragonLost = true
      state.dragons = state.dragons.filter((x) => x.id !== d.id)
      if (captain) {
        captain.morale = Math.max(0, captain.morale - CAPTAIN_MORALE_LOSS_ON_DRAGON_DEATH)
      }
      narrativeParts.push(`${d.name} is lost outright${captain ? `; ${captain.name} survives, grieving` : ''}.`)
      addLog(state, rng.pick(LOG_LINES.funeral))
    }
  }

  m.outcome = {
    success,
    woundsTemp: d.woundsTemp,
    woundsLasting: d.woundsLasting,
    crewLost,
    officerLostId,
    dragonLost,
    narrative: narrativeParts.join(' '),
  }

  // Late iff resolution lands on a later DAY than the deadline — same
  // day-vs-day comparison as offer expiry; any tick of the deadline day
  // itself is still on time.
  if (state.day > m.deadlineDay) {
    state.standing = Math.max(0, state.standing - LATE_STANDING_COST)
    m.outcome.narrative += ' A promise broken.'
    addLog(state, `${m.name}: a promise broken — delivered too late to matter.`)
    if (m.patronId) {
      adjustTier(state, m.patronId, 0, `Remembers: your promise on the ${m.name}, broken.`)
    }
  }

  if (captain && captain.alive) {
    captain.xp += XP_PER_MISSION * sev
    if (rng.next() < SKILL_GROWTH_CHANCE) {
      captain.skill = Math.min(SKILL_MAX, captain.skill + 1)
    }
  }

  m.status = 'done'
  if (!dragonLost) {
    d.status = 'home'
    d.missionId = null
  }

  pruneDoneMissions(state)
}

/**
 * On a mission success, awards crew xp to every living non-captain officer and
 * promotes any who cross the next rank's RANK_XP threshold (one rank per
 * mission). Officers never reach 'captain' here — nextRank('lieutenant') is
 * 'captain', which has no RANK_XP entry, so the gate is impossible to pass.
 */
function awardCrewEquity(state: GameState, sev: 1 | 2 | 3): void {
  for (const o of state.officers) {
    if (!o.alive || o.rank === 'captain') continue
    o.xp += CREW_XP_PER_MISSION * sev
  }
  for (const o of state.officers) {
    if (!o.alive || o.rank === 'captain') continue
    const target = nextRank(o.rank)
    if (!target) continue
    const threshold = (RANK_XP as Record<string, number>)[target]
    if (threshold !== undefined && o.xp >= threshold) {
      o.rank = target
      addLog(state, `${o.name} is promoted to ${target}.`)
    }
  }
}

/** Keeps at most DONE_MISSION_CAP done missions, dropping the oldest by returnTick. */
function pruneDoneMissions(state: GameState): void {
  const done = state.missions.filter((m) => m.status === 'done')
  if (done.length <= DONE_MISSION_CAP) return

  done.sort((a, b) => (a.returnTick ?? 0) - (b.returnTick ?? 0))
  const toRemove = new Set(done.slice(0, done.length - DONE_MISSION_CAP).map((m) => m.id))
  state.missions = state.missions.filter((m) => !toRemove.has(m.id))
}
