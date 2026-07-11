import { describe, it, expect } from 'vitest'
import { newRun } from '../src/sim/newRun'
import { tick } from '../src/sim/tick'
import { createRng } from '../src/sim/rng'
import type { Rng } from '../src/sim/rng'
import { departMission, resolveMission, generateOffers } from '../src/sim/missions'
import { successChance, dragonPowerForKind, riskLabel, availabilityForecast } from '../src/sim/projection'
import { chooseCardOption, declineMission } from '../src/sim/actions'
import { CARDS } from '../src/sim/cards'
import {
  TICKS_PER_DAY,
  MAX_OPEN_OFFERS,
  OFFER_INTERVAL_DAYS,
  RISK_SAFE,
  RISK_RISKY,
  RISK_DANGEROUS,
  HEALING_THRESHOLD,
  WOUND_HEAL_PER_DAY,
  AVG_WOUND_ESTIMATE,
  LATE_STANDING_COST,
  RANK_XP,
  CREW_XP_PER_MISSION,
  REFUSAL_WAR_HEAT_GATE,
} from '../src/sim/balance'
import type { Dragon, GameState, Mission } from '../src/sim/types'

function makeDragon(state: GameState, overrides: Partial<Dragon> = {}): Dragon {
  const id = `d${state.nextId}`
  state.nextId += 1
  const dragon: Dragon = {
    id,
    name: 'Test Dragon',
    breed: 'winchester',
    training: 50,
    woundsTemp: 0,
    woundsLasting: 0,
    contentment: 50,
    captainId: state.officers[0].id,
    status: 'home',
    missionId: null,
    ...overrides,
  }
  state.dragons.push(dragon)
  return dragon
}

function makeMission(state: GameState, overrides: Partial<Mission> = {}): Mission {
  const id = `m${state.nextId}`
  state.nextId += 1
  const mission: Mission = {
    id,
    name: 'Test Mission',
    kind: 'dispatch',
    severityTier: 1,
    rewardCoin: 10,
    rewardTreasure: 0,
    rewardStanding: 3,
    patronId: null,
    offerExpiresDay: state.day + 4,
    deadlineDay: state.day + 10,
    durationTicks: 6,
    enemyStrength: 2,
    weather: 0.2,
    status: 'offered',
    assignedDragonId: null,
    returnTick: null,
    outcome: null,
    ...overrides,
  }
  state.missions.push(mission)
  return mission
}

/**
 * A fully deterministic Rng test double: `next()` returns pre-scripted
 * values in order (repeating the last value once exhausted). `int`/`pick`
 * are implemented identically to the production RNG (funneled through
 * `next()`), so scripting a sequence of `next()` values pins the exact
 * outcome of every downstream `int`/`pick` call in resolveMission.
 */
function scriptedRng(queue: number[]): Rng {
  const values = [...queue]
  const self: Rng = {
    next: () => (values.length > 0 ? values.shift()! : 0),
    int(min, max) {
      return min + Math.floor(self.next() * (max - min + 1))
    },
    pick<T>(arr: T[]): T {
      return arr[Math.floor(self.next() * arr.length)]
    },
    getState: () => 0,
    setState: () => {},
  }
  return self
}

describe('departMission', () => {
  it('sets active status, assigns the dragon, and computes returnTick', () => {
    const state = newRun(9)
    const dragon = makeDragon(state)
    const mission = makeMission(state, { durationTicks: 9 })
    const tickCountBefore = state.tickCount

    departMission(state, mission, dragon)

    expect(mission.status).toBe('active')
    expect(mission.assignedDragonId).toBe(dragon.id)
    expect(mission.returnTick).toBe(tickCountBefore + 9)
    expect(dragon.status).toBe('mission')
    expect(dragon.missionId).toBe(mission.id)
  })
})

describe('resolveMission — forecast honesty', () => {
  it('observed success rate matches successChance within +-0.05 over 400 seeded resolutions', () => {
    const N = 400
    const seedPicker = createRng(12345)
    let successes = 0
    let chance = 0

    for (let i = 0; i < N; i++) {
      const state = newRun(1)
      const dragon = makeDragon(state, { training: 50, contentment: 50 })
      const mission = makeMission(state, {
        severityTier: 1,
        enemyStrength: 3,
        weather: 0.3,
        assignedDragonId: dragon.id,
        status: 'active',
        returnTick: state.tickCount + 1,
      })
      chance = successChance(state, mission, dragon)

      const rngState = Math.floor(seedPicker.next() * 0xffffffff)
      resolveMission(state, mission, createRng(rngState))
      if (mission.outcome?.success) successes += 1
    }

    const observed = successes / N
    // ±0.05 is the two-sigma binomial bound at worst-case p=0.5 for N=400 (sigma = 0.025).
    expect(Math.abs(observed - chance)).toBeLessThanOrEqual(0.05)
  })
})

describe('projection — kind-aware power', () => {
  it('gives a courier breed a higher successChance on dispatch than on combat, all else equal', () => {
    const state = newRun(16)
    const dragon = makeDragon(state, { breed: 'winchester', training: 50, contentment: 50 })
    const dispatchMission = makeMission(state, { kind: 'dispatch', enemyStrength: 4, weather: 0.3 })
    const combatMission = makeMission(state, { kind: 'combat', enemyStrength: 4, weather: 0.3 })

    expect(dragonPowerForKind(state, dragon, 'dispatch')).toBeGreaterThan(
      dragonPowerForKind(state, dragon, 'combat')
    )
    expect(successChance(state, dispatchMission, dragon)).toBeGreaterThan(
      successChance(state, combatMission, dragon)
    )
  })
})

describe('resolveMission — severity gating', () => {
  it('sev1 failures never set officerLostId or dragonLost, over 200 seeded resolutions', () => {
    const seedPicker = createRng(555)
    for (let i = 0; i < 200; i++) {
      const state = newRun(2)
      const dragon = makeDragon(state, { training: 0, contentment: 0 })
      const mission = makeMission(state, {
        severityTier: 1,
        enemyStrength: 9,
        weather: 1,
        assignedDragonId: dragon.id,
        status: 'active',
        returnTick: state.tickCount + 1,
      })
      const rngState = Math.floor(seedPicker.next() * 0xffffffff)
      resolveMission(state, mission, createRng(rngState))
      expect(mission.outcome?.officerLostId).toBeNull()
      expect(mission.outcome?.dragonLost).toBe(false)
    }
  })

  it('sev3 failures sometimes remove the dragon, and the captain always survives it', () => {
    const seedPicker = createRng(888)
    let dragonLostCount = 0

    for (let i = 0; i < 200; i++) {
      const state = newRun(3)
      const dragon = makeDragon(state, { training: 0, contentment: 0 })
      const captainId = dragon.captainId
      const mission = makeMission(state, {
        severityTier: 3,
        enemyStrength: 9,
        weather: 1,
        assignedDragonId: dragon.id,
        status: 'active',
        returnTick: state.tickCount + 1,
      })
      const rngState = Math.floor(seedPicker.next() * 0xffffffff)
      resolveMission(state, mission, createRng(rngState))

      if (mission.outcome?.dragonLost) {
        dragonLostCount += 1
        expect(state.dragons.find((d) => d.id === dragon.id)).toBeUndefined()
        const captain = state.officers.find((o) => o.id === captainId)
        expect(captain?.alive).toBe(true)
        expect(mission.outcome?.officerLostId).toBeNull()
      }
    }

    expect(dragonLostCount).toBeGreaterThan(0)
  })
})

describe('resolveMission — captain-death cascade (sev2)', () => {
  function scenario(withInsurance: boolean) {
    const state = newRun(4)
    const dragon = makeDragon(state, { training: 0, contentment: 0 })
    if (withInsurance) state.flags[`insurance:${dragon.id}`] = true
    const mission = makeMission(state, {
      severityTier: 2,
      enemyStrength: 9,
      weather: 1,
      assignedDragonId: dragon.id,
      status: 'active',
      returnTick: state.tickCount + 1,
    })
    // Scripted draws, in the exact order resolveMission consumes them on a
    // sev2 failure that hits the officer-death roll:
    //   1. success roll (>= MAX_SUCCESS clamp guarantees failure)
    //   2. woundsTemp roll
    //   3. woundsLasting roll
    //   4. crewLost roll
    //   5. officer-death roll (< OFFICER_DEATH_CHANCE triggers the cascade)
    //   6. skill-growth roll (only drawn if the captain is still alive)
    const rng = scriptedRng([0.99, 0.5, 0.5, 0.5, 0.0, 0.99])
    resolveMission(state, mission, rng)
    return { state, dragon, mission }
  }

  it('kills the captain and loses the dragon without insurance', () => {
    const { state, dragon, mission } = scenario(false)
    expect(mission.outcome?.dragonLost).toBe(true)
    expect(mission.outcome?.officerLostId).toBe(dragon.captainId)
    expect(state.dragons.find((d) => d.id === dragon.id)).toBeUndefined()
    const captain = state.officers.find((o) => o.id === dragon.captainId)
    expect(captain?.alive).toBe(false)
  })

  it('the dragon survives and the flag clears (one-shot) with insurance set', () => {
    const { state, dragon } = scenario(true)
    expect(state.dragons.find((d) => d.id === dragon.id)).toBeDefined()
    expect(state.flags[`insurance:${dragon.id}`]).toBe(false)
    const captain = state.officers.find((o) => o.id === dragon.captainId)
    expect(captain?.alive).toBe(true)
  })
})

describe('resolveMission — late resolution', () => {
  const DEADLINE = 5

  /** Forced-success resolution at an exact tickCount (state.day kept consistent). */
  function resolveAtTick(tickCount: number) {
    const state = newRun(5)
    const dragon = makeDragon(state, { training: 100, contentment: 100 })
    const mission = makeMission(state, {
      severityTier: 1,
      enemyStrength: 0,
      weather: 0,
      deadlineDay: DEADLINE,
      rewardStanding: 5,
      assignedDragonId: dragon.id,
      status: 'active',
      returnTick: tickCount,
    })
    state.tickCount = tickCount
    state.day = Math.floor(tickCount / TICKS_PER_DAY)
    const standingBefore = state.standing

    // 1. success roll (0.0 always beats a positive chance) 2. light-wound roll
    // 3. skill-growth roll (sev1 success draws no crewLost roll)
    const rng = scriptedRng([0.0, 0.5, 0.99])
    resolveMission(state, mission, rng)
    expect(mission.outcome?.success).toBe(true)
    return { state, mission, standingBefore }
  }

  it('is NOT late on the 2nd tick of the deadline day itself', () => {
    const { state, mission, standingBefore } = resolveAtTick(DEADLINE * TICKS_PER_DAY + 1)
    expect(state.standing).toBe(standingBefore + mission.rewardStanding)
    expect(mission.outcome?.narrative.toLowerCase()).not.toContain('broken')
  })

  it('is NOT late on the 3rd (final) tick of the deadline day itself', () => {
    const { state, mission, standingBefore } = resolveAtTick(DEADLINE * TICKS_PER_DAY + TICKS_PER_DAY - 1)
    expect(state.standing).toBe(standingBefore + mission.rewardStanding)
    expect(mission.outcome?.narrative.toLowerCase()).not.toContain('broken')
  })

  it('costs standing even on success, resolved the day after the deadline', () => {
    const { state, mission, standingBefore } = resolveAtTick((DEADLINE + 1) * TICKS_PER_DAY)
    expect(state.standing).toBe(standingBefore + mission.rewardStanding - LATE_STANDING_COST)
    expect(mission.outcome?.narrative.toLowerCase()).toContain('broken')
  })
})

describe('resolveMission — patron effects', () => {
  it('bumps patron tier +1 (clamped at +3), grants goodwill, and writes a memory line on success', () => {
    const state = newRun(17)
    const patron = state.patrons.find((p) => p.kind === 'gratitude')!
    patron.tier = 3 // already at the cap — clamp must hold
    const goodwillBefore = patron.goodwill
    const dragon = makeDragon(state, { training: 100, contentment: 100 })
    const mission = makeMission(state, {
      severityTier: 1,
      enemyStrength: 0,
      weather: 0,
      patronId: patron.id,
      assignedDragonId: dragon.id,
      status: 'active',
      returnTick: state.tickCount + 1,
    })

    const rng = scriptedRng([0.0, 0.5, 0.99]) // success, light wound, no skill growth
    resolveMission(state, mission, rng)

    expect(mission.outcome?.success).toBe(true)
    expect(patron.tier).toBe(3)
    expect(patron.goodwill).toBe(Math.min(10, goodwillBefore + 1))
    expect(patron.memory).toContain(mission.name)
    expect(patron.memory.toLowerCase()).toContain('flown well')
  })

  it('bumps patron tier from below the cap on success', () => {
    const state = newRun(18)
    const patron = state.patrons.find((p) => p.kind === 'transactional')!
    expect(patron.tier).toBe(0)
    const dragon = makeDragon(state, { training: 100, contentment: 100 })
    const mission = makeMission(state, {
      severityTier: 1,
      enemyStrength: 0,
      weather: 0,
      patronId: patron.id,
      assignedDragonId: dragon.id,
      status: 'active',
      returnTick: state.tickCount + 1,
    })

    resolveMission(state, mission, scriptedRng([0.0, 0.5, 0.99]))
    expect(patron.tier).toBe(1)
  })

  it('writes a broken-promise memory line on late resolution of a patron mission', () => {
    const state = newRun(19)
    const patron = state.patrons.find((p) => p.kind === 'gratitude')!
    const dragon = makeDragon(state, { training: 100, contentment: 100 })
    const mission = makeMission(state, {
      severityTier: 1,
      enemyStrength: 0,
      weather: 0,
      deadlineDay: 2,
      patronId: patron.id,
      assignedDragonId: dragon.id,
      status: 'active',
      returnTick: state.tickCount + 1,
    })
    state.tickCount = 3 * TICKS_PER_DAY
    state.day = 3 // one day past the deadline

    resolveMission(state, mission, scriptedRng([0.0, 0.5, 0.99]))

    expect(mission.outcome?.success).toBe(true)
    expect(patron.memory).toContain(mission.name)
    expect(patron.memory.toLowerCase()).toContain('broken')
  })
})

describe('resolveMission — aftermath surfacing (final review item 1)', () => {
  it('logs the outcome narrative and pushes a matching aftermath card on success', () => {
    const state = newRun(23)
    const dragon = makeDragon(state, { training: 100, contentment: 100 })
    const mission = makeMission(state, {
      severityTier: 1,
      enemyStrength: 0,
      weather: 0,
      assignedDragonId: dragon.id,
      status: 'active',
      returnTick: state.tickCount + 1,
    })

    resolveMission(state, mission, scriptedRng([0.0, 0.5, 0.99])) // success, light wound, no skill growth

    expect(mission.outcome).not.toBeNull()
    const narrative = mission.outcome!.narrative
    expect(state.log[state.log.length - 1].text).toBe(narrative)

    const card = state.pendingCards.find((c) => c.templateId === 'aftermath')
    expect(card).toBeDefined()
    expect(card!.params).toEqual({ name: mission.name, success: 1, narrative })
  })

  it('logs the outcome narrative and pushes a matching aftermath card on failure, narrative including the late addendum', () => {
    const state = newRun(24)
    const dragon = makeDragon(state, { training: 0, contentment: 0 })
    const mission = makeMission(state, {
      severityTier: 1,
      enemyStrength: 9,
      weather: 1,
      deadlineDay: 0, // any resolution day is already past the deadline
      assignedDragonId: dragon.id,
      status: 'active',
      returnTick: state.tickCount + 1,
    })
    state.tickCount = TICKS_PER_DAY
    state.day = 1

    resolveMission(state, mission, scriptedRng([0.99, 0.5, 0.5, 0.5])) // failure, wound rolls, crew-lost roll

    const narrative = mission.outcome!.narrative
    expect(narrative).toContain('A promise broken.')
    expect(state.log[state.log.length - 1].text).toBe(narrative)

    const card = state.pendingCards.find((c) => c.templateId === 'aftermath')
    expect(card).toBeDefined()
    expect(card!.params).toEqual({ name: mission.name, success: 0, narrative })
  })

  it('choosing the aftermath card\'s single option removes it and mutates nothing else', () => {
    const state = newRun(25)
    const dragon = makeDragon(state, { training: 100, contentment: 100 })
    const mission = makeMission(state, {
      severityTier: 1,
      enemyStrength: 0,
      weather: 0,
      assignedDragonId: dragon.id,
      status: 'active',
      returnTick: state.tickCount + 1,
    })
    resolveMission(state, mission, scriptedRng([0.0, 0.5, 0.99]))
    const card = state.pendingCards.find((c) => c.templateId === 'aftermath')!
    const cardIndex = state.pendingCards.indexOf(card)
    const before = JSON.parse(JSON.stringify(state))

    chooseCardOption(state, card.id, 0)

    expect(state.pendingCards.some((c) => c.id === card.id)).toBe(false)
    expect(state.log[state.log.length - 1].text).toBe('Test Mission — returned — So noted..')
    // Nothing else on state changed besides the pending-card removal and the
    // card-choice log line — the option itself is a pure no-op.
    const after = JSON.parse(JSON.stringify(state))
    before.pendingCards.splice(cardIndex, 1)
    before.log.push(after.log[after.log.length - 1])
    expect(after).toEqual(before)
  })

  it('the missing-assigned-dragon fallback path also logs and pushes an aftermath card', () => {
    const state = newRun(26)
    const mission = makeMission(state, {
      status: 'active',
      assignedDragonId: 'no-such-dragon',
      returnTick: state.tickCount + 1,
    })

    resolveMission(state, mission, scriptedRng([]))

    const narrative = mission.outcome!.narrative
    expect(state.log[state.log.length - 1].text).toBe(narrative)
    const card = state.pendingCards.find((c) => c.templateId === 'aftermath')
    expect(card).toBeDefined()
    expect(card!.params).toEqual({ name: mission.name, success: 0, narrative })
  })
})

describe('generateOffers', () => {
  it('is a no-op while a decision card is pending', () => {
    const state = newRun(6)
    state.day = OFFER_INTERVAL_DAYS
    expect(state.pendingCards.length).toBeGreaterThan(0)
    generateOffers(state, createRng(1))
    expect(state.missions).toHaveLength(0)
  })

  it('is a no-op while an auction is running', () => {
    const state = newRun(6)
    state.pendingCards = []
    state.day = OFFER_INTERVAL_DAYS
    state.auction = {
      eggs: [],
      bidders: [],
      ticksRemaining: 1,
      ticksPerClaim: 1,
      nextClaimIn: 1,
      concluded: false,
      wonBreed: null,
      candidateOfficerId: state.officers[0].id,
    }
    generateOffers(state, createRng(1))
    expect(state.missions).toHaveLength(0)
  })

  it('produces 1-2 offers once cards clear and a cadence day hits', () => {
    const state = newRun(6)
    state.pendingCards = []
    state.day = OFFER_INTERVAL_DAYS
    generateOffers(state, createRng(1))
    expect(state.missions.length).toBeGreaterThanOrEqual(1)
    expect(state.missions.length).toBeLessThanOrEqual(2)
    expect(state.missions.every((m) => m.status === 'offered')).toBe(true)
  })

  it('never exceeds MAX_OPEN_OFFERS across repeated cadence calls', () => {
    const state = newRun(7)
    state.pendingCards = []
    const rng = createRng(2)
    for (let day = 0; day <= 60; day += OFFER_INTERVAL_DAYS) {
      state.day = day
      generateOffers(state, rng)
      const openOffers = state.missions.filter((m) => m.status === 'offered').length
      expect(openOffers).toBeLessThanOrEqual(MAX_OPEN_OFFERS)
    }
  })

  it('never generates a war-kind mission, even at rung 3', () => {
    const state = newRun(8)
    state.pendingCards = []
    state.rung = 3
    const rng = createRng(3)
    for (let day = 0; day <= 300; day += OFFER_INTERVAL_DAYS) {
      state.day = day
      generateOffers(state, rng)
    }
    expect(state.missions.length).toBeGreaterThan(0)
    expect(state.missions.every((m) => m.kind !== 'war')).toBe(true)
  })

  it('resumes offers while an egg is incubating (a concluded auction)', () => {
    const state = newRun(6)
    state.pendingCards = []
    state.day = OFFER_INTERVAL_DAYS
    state.auction = {
      eggs: [{ breed: 'winchester', claimedBy: 'You' }],
      bidders: [{ name: 'You', influence: 5, you: true }],
      ticksRemaining: 6,
      ticksPerClaim: 5,
      nextClaimIn: 0,
      concluded: true, // incubating, not being bid on
      wonBreed: 'winchester',
      candidateOfficerId: state.officers[0].id,
    }
    generateOffers(state, createRng(1))
    expect(state.missions.length).toBeGreaterThanOrEqual(1)
  })
})

describe('resolveMission — crew equity conversion', () => {
  it('awards crew xp to non-captains on success and promotes across a rank threshold', () => {
    const state = newRun(21)
    const runner = state.officers.find((o) => o.rank === 'runner')!
    runner.xp = RANK_XP.ensign - CREW_XP_PER_MISSION // one sev-1 success shy of ensign
    const dragon = makeDragon(state, { training: 100, contentment: 100 })
    const mission = makeMission(state, {
      severityTier: 1,
      enemyStrength: 0,
      weather: 0,
      assignedDragonId: dragon.id,
      status: 'active',
      returnTick: state.tickCount + 1,
    })

    resolveMission(state, mission, scriptedRng([0.0, 0.5, 0.99])) // success
    expect(mission.outcome?.success).toBe(true)
    expect(runner.xp).toBe(RANK_XP.ensign)
    expect(runner.rank).toBe('ensign')
  })

  it('never promotes an officer to captain via xp', () => {
    const state = newRun(22)
    const lt = state.officers[1]
    Object.assign(lt, { rank: 'lieutenant', xp: 100000 })
    const dragon = makeDragon(state, { training: 100, contentment: 100 })
    const mission = makeMission(state, {
      severityTier: 1,
      enemyStrength: 0,
      weather: 0,
      assignedDragonId: dragon.id,
      status: 'active',
      returnTick: state.tickCount + 1,
    })

    resolveMission(state, mission, scriptedRng([0.0, 0.5, 0.99]))
    expect(lt.rank).toBe('lieutenant')
  })

  it('grants no crew xp on a failure', () => {
    const state = newRun(23)
    const runner = state.officers.find((o) => o.rank === 'runner')!
    const xpBefore = runner.xp
    const dragon = makeDragon(state, { training: 0, contentment: 0 })
    const mission = makeMission(state, {
      severityTier: 1,
      enemyStrength: 9,
      weather: 1,
      assignedDragonId: dragon.id,
      status: 'active',
      returnTick: state.tickCount + 1,
    })

    resolveMission(state, mission, scriptedRng([0.99])) // failure
    expect(mission.outcome?.success).toBe(false)
    expect(runner.xp).toBe(xpBefore)
  })
})

describe('determinism', () => {
  it('produces deep-equal state across two identical seeds after 300 ticks with a dragon on mission', () => {
    function build(seed: number): GameState {
      const state = newRun(seed)
      state.pendingCards = []
      const dragon = makeDragon(state, { training: 50, contentment: 50 })
      const mission = makeMission(state, {
        severityTier: 2,
        enemyStrength: 4,
        weather: 0.4,
        durationTicks: 6,
      })
      departMission(state, mission, dragon)
      return state
    }

    const a = build(555)
    const b = build(555)
    for (let i = 0; i < 300; i++) tick(a)
    for (let i = 0; i < 300; i++) tick(b)
    expect(a).toEqual(b)
  })
})

describe('tickMissions', () => {
  it('resolves an active mission once its returnTick has passed', () => {
    const state = newRun(13)
    state.pendingCards = []
    const dragon = makeDragon(state)
    const mission = makeMission(state, { durationTicks: 2 })
    departMission(state, mission, dragon)

    tick(state)
    tick(state)

    expect(mission.status).toBe('done')
    expect(mission.outcome).not.toBeNull()
  })

  it('expires offers past offerExpiresDay and costs standing once warHeat exceeds the gate', () => {
    const state = newRun(14)
    state.pendingCards = []
    state.warHeat = REFUSAL_WAR_HEAT_GATE + 10
    const mission = makeMission(state, { offerExpiresDay: 1 })
    const standingBefore = state.standing

    for (let i = 0; i < TICKS_PER_DAY * 3; i++) tick(state)

    expect(state.missions.find((m) => m.id === mission.id)).toBeUndefined()
    expect(state.standing).toBeLessThan(standingBefore)
  })
})

describe('riskLabel', () => {
  it('maps probability thresholds to labels', () => {
    expect(riskLabel(0.9)).toBe('safe')
    expect(riskLabel(RISK_SAFE)).toBe('safe')
    expect(riskLabel(RISK_SAFE - 0.001)).toBe('risky')
    expect(riskLabel(RISK_RISKY)).toBe('risky')
    expect(riskLabel(RISK_RISKY - 0.001)).toBe('dangerous')
    expect(riskLabel(RISK_DANGEROUS)).toBe('dangerous')
    expect(riskLabel(RISK_DANGEROUS - 0.001)).toBe('desperate')
    expect(riskLabel(0)).toBe('desperate')
  })
})

describe('availabilityForecast', () => {
  it('reports home dragons as ready today', () => {
    const state = newRun(10)
    const dragon = makeDragon(state, { status: 'home' })
    const entry = availabilityForecast(state).find((f) => f.dragonId === dragon.id)
    expect(entry).toEqual({ dragonId: dragon.id, freeOnDay: state.day, note: 'ready' })
  })

  it('reports mission dragons using returnTick, plus healing days for severity >= 2', () => {
    const state = newRun(11)
    const dragon = makeDragon(state, { status: 'home' })
    const mission = makeMission(state, { severityTier: 2 })
    departMission(state, mission, dragon)

    const entry = availabilityForecast(state).find((f) => f.dragonId === dragon.id)!
    const expectedBase = Math.ceil(mission.returnTick! / TICKS_PER_DAY)
    const expectedHealing = Math.ceil(AVG_WOUND_ESTIMATE / WOUND_HEAL_PER_DAY)
    expect(entry.freeOnDay).toBe(expectedBase + expectedHealing)
    expect(entry.note).toBe('on mission')
  })

  it('does not add healing days for a severity 1 mission', () => {
    const state = newRun(15)
    const dragon = makeDragon(state, { status: 'home' })
    const mission = makeMission(state, { severityTier: 1 })
    departMission(state, mission, dragon)

    const entry = availabilityForecast(state).find((f) => f.dragonId === dragon.id)!
    expect(entry.freeOnDay).toBe(Math.ceil(mission.returnTick! / TICKS_PER_DAY))
  })

  it('reports healing dragons using the wound-heal formula', () => {
    const state = newRun(12)
    const dragon = makeDragon(state, { status: 'healing', woundsTemp: 70 })
    const entry = availabilityForecast(state).find((f) => f.dragonId === dragon.id)!
    expect(entry.freeOnDay).toBe(state.day + Math.ceil((70 - HEALING_THRESHOLD + 1) / WOUND_HEAL_PER_DAY))
    expect(entry.note).toBe('healing')
  })
})

describe('feed log completeness', () => {
  it('logs each new offer posted to the board', () => {
    const state = newRun(1)
    state.pendingCards = []
    state.auction = null
    state.day = OFFER_INTERVAL_DAYS
    const known = new Set(state.missions.map((m) => m.id))
    const before = state.log.length
    generateOffers(state, createRng(42))
    const fresh = state.missions.filter((m) => !known.has(m.id))
    expect(fresh.length).toBeGreaterThan(0)
    for (const m of fresh) {
      expect(state.log.slice(before).some((l) => l.text.includes(m.name))).toBe(true)
    }
  })

  it('logs the departure when a dragon takes a mission', () => {
    const state = newRun(1)
    const dragon = makeDragon(state, { name: 'Vindicatus' })
    const mission = makeMission(state, { name: 'Coastal Patrol' })
    departMission(state, mission, dragon)
    expect(
      state.log.some((l) => l.text.includes('Vindicatus') && l.text.includes('Coastal Patrol'))
    ).toBe(true)
  })

  it('logs a quiet decline below the war-heat gate', () => {
    const state = newRun(1)
    state.warHeat = 0
    const mission = makeMission(state, { name: 'Quiet Errand' })
    declineMission(state, mission.id)
    expect(state.log.some((l) => l.text.includes('Quiet Errand'))).toBe(true)
  })

  it('logs the decline of a trap offer', () => {
    const state = newRun(1)
    const mission = makeMission(state, { name: 'Baited Errand' })
    state.flags[`trap:${mission.id}`] = true
    declineMission(state, mission.id)
    expect(state.log.some((l) => l.text.includes('Baited Errand'))).toBe(true)
  })

  it('logs the chosen option when a decision card is answered', () => {
    const state = newRun(1)
    while (state.pendingCards.length === 0 && state.tickCount < 200 * TICKS_PER_DAY) {
      tick(state)
    }
    expect(state.pendingCards.length).toBeGreaterThan(0)
    const card = state.pendingCards[0]
    const template = CARDS[card.templateId]!
    const options = template.options(state, card.params)
    const idx = options.findIndex((o) => o.enabled)
    expect(idx).toBeGreaterThanOrEqual(0)
    const label = options[idx].label
    const before = state.log.length
    chooseCardOption(state, card.id, idx)
    expect(state.log.slice(before).some((l) => l.text.includes(label))).toBe(true)
  })
})
