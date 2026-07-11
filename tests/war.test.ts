import { describe, it, expect } from 'vitest'
import { newRun } from '../src/sim/newRun'
import { tick } from '../src/sim/tick'
import { createRng } from '../src/sim/rng'
import type { Rng } from '../src/sim/rng'
import { tickWar, computeScore, resolveKazilikRun } from '../src/sim/war'
import { CARDS } from '../src/sim/cards'
import { chooseCardOption } from '../src/sim/actions'
import { resolveMission } from '../src/sim/missions'
import {
  TICKS_PER_DAY,
  FINALE_HEAT,
  WAR_RUMOR_LOW_HEAT,
  WAR_RUMOR_MID_HEAT,
  WAR_RUMOR_HIGH_HEAT,
  FINALE_LENGTH_DAYS,
  FINALE_MISSION_INTERVAL_DAYS,
  MAX_OPEN_OFFERS,
  KAZILIK_COST,
  SCORE_PER_DRAGON_WEIGHT,
  SCORE_PER_OFFICER,
  SCORE_PER_PATRON_TIER,
  TREASURE_EGG_CONSOLATION,
  EXPECTATION_FLOOR_BY_RUNG,
} from '../src/sim/balance'
import type { Dragon, GameState } from '../src/sim/types'

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

/** Same deterministic-queue Rng test double used by tests/missions.test.ts. */
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

/** Advances a state at a clean day boundary by calling tickWar directly. */
function stepWarDay(state: GameState, rng: Rng): void {
  state.tickCount += TICKS_PER_DAY
  state.day += 1
  tickWar(state, rng)
}

describe('war heat clock', () => {
  it('reaches FINALE_HEAT and starts the finale within 300-380 days at rung >= 2, across 5 seeds', () => {
    // Isolated to tickWar itself (via stepWarDay) rather than the full
    // tick() engine: at rung 2 with no dragons ever hatched, standing never
    // keeps pace with the rung-2 expectation floor and the run gets
    // 'relieved' by tick.ts's unrelated red line long before heat completes.
    // This test is about the war clock's own timing, not survival.
    for (const seed of [1, 2, 3, 4, 5]) {
      const state = newRun(seed)
      state.pendingCards = []
      state.rung = 2
      const rng = createRng(seed * 7919 + 1)

      let guard = 0
      while (!state.finaleStarted && guard < 400) {
        stepWarDay(state, rng)
        state.pendingCards = [] // rumor/kazilik cards auto-clear so they never block the clock
        guard += 1
      }

      expect(state.finaleStarted).toBe(true)
      expect(state.warHeat).toBeGreaterThanOrEqual(FINALE_HEAT)
      expect(state.day).toBeGreaterThanOrEqual(300)
      expect(state.day).toBeLessThanOrEqual(380)
    }
  })

  it('never exceeds FINALE_HEAT (caps at 100)', () => {
    const state = newRun(1)
    state.warHeat = 99.95
    const rng = createRng(1)
    stepWarDay(state, rng)
    expect(state.warHeat).toBeLessThanOrEqual(FINALE_HEAT)
  })
})

describe('rumor cards', () => {
  it('pushes war-rumor-low, -mid, -high exactly once each as heat crosses their thresholds', () => {
    const state = newRun(2)
    state.pendingCards = []
    const rng = createRng(9)

    state.warHeat = WAR_RUMOR_LOW_HEAT
    stepWarDay(state, rng)
    expect(state.pendingCards.map((c) => c.templateId)).toEqual(['war-rumor-low'])
    expect(state.flags['rumor-low-done']).toBe(true)
    state.pendingCards = []

    // Re-triggering the same day boundary must not push a duplicate.
    stepWarDay(state, rng)
    expect(state.pendingCards).toHaveLength(0)

    state.warHeat = WAR_RUMOR_MID_HEAT
    stepWarDay(state, rng)
    expect(state.pendingCards.map((c) => c.templateId)).toEqual(['war-rumor-mid'])
    expect(state.flags['rumor-mid-done']).toBe(true)
    state.pendingCards = []

    state.warHeat = WAR_RUMOR_HIGH_HEAT
    stepWarDay(state, rng)
    expect(state.pendingCards.map((c) => c.templateId)).toEqual(['war-rumor-high'])
    expect(state.flags['rumor-high-done']).toBe(true)
  })

  it('defers a rumor push while a card is already pending, then fires on the next clear day boundary', () => {
    const state = newRun(3)
    state.warHeat = WAR_RUMOR_LOW_HEAT
    state.pendingCards = [{ id: 'c999', templateId: 'tribute-demand', params: {} }]
    const rng = createRng(4)

    stepWarDay(state, rng)
    expect(state.flags['rumor-low-done']).toBeUndefined()
    expect(state.pendingCards.map((c) => c.templateId)).toEqual(['tribute-demand'])

    state.pendingCards = []
    stepWarDay(state, rng)
    expect(state.flags['rumor-low-done']).toBe(true)
    expect(state.pendingCards.map((c) => c.templateId)).toEqual(['war-rumor-low'])
  })

  it('defers while an auction is live', () => {
    const state = newRun(4)
    state.pendingCards = []
    state.warHeat = WAR_RUMOR_LOW_HEAT
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
    stepWarDay(state, createRng(5))
    expect(state.flags['rumor-low-done']).toBeUndefined()
    expect(state.pendingCards).toHaveLength(0)
  })
})

describe('finale trigger and the rung-1 hold', () => {
  it('holds heat at 100 without starting the finale while rung stays 1, then starts it the day rung reaches 2', () => {
    const state = newRun(5)
    state.pendingCards = []
    state.warHeat = 100
    state.rung = 1
    const rng = createRng(6)

    for (let i = 0; i < 10; i++) stepWarDay(state, rng)
    expect(state.warHeat).toBe(100)
    expect(state.finaleStarted).toBe(false)

    state.rung = 2
    stepWarDay(state, rng)
    expect(state.finaleStarted).toBe(true)
    const endDayFlag = Object.keys(state.flags).find((k) => k.startsWith('finale-end-day-'))
    expect(endDayFlag).toBeDefined()
    expect(Number(endDayFlag!.slice('finale-end-day-'.length))).toBe(state.day + FINALE_LENGTH_DAYS)
  })

  it('wires rung to 4 the moment the finale starts, giving expectation the rung-4 floor of 55', () => {
    const state = newRun(50)
    state.pendingCards = []
    state.warHeat = 100
    state.rung = 2
    state.standing = 0
    // Full tick() engine (not stepWarDay) so runDailyUpkeep's expectation
    // formula actually runs on the same day tickWar sets rung to 4.
    for (let i = 0; i < TICKS_PER_DAY; i++) tick(state)

    expect(state.finaleStarted).toBe(true)
    expect(state.rung).toBe(4)
    expect(EXPECTATION_FLOOR_BY_RUNG[4]).toBe(55)
    expect(state.expectation).toBe(55)
  })
})

describe('finale mission pressure', () => {
  function startFinale(state: GameState): void {
    state.pendingCards = []
    state.warHeat = 100
    state.rung = 2
    state.finaleStarted = true
    state.flags[`finale-end-day-${state.day + FINALE_LENGTH_DAYS}`] = true
    state.flags['kazilik-card-pushed'] = true // isolate this test from the kazilik card
    // A real playthrough reaches heat 100 only after gradually crossing
    // 30/55/80, so the rumor cards have already fired by then — pre-set
    // them here too, or the first one would fire on day 1 and permanently
    // occupy the single pendingCards slot the mission injector defers to.
    state.flags['rumor-low-done'] = true
    state.flags['rumor-mid-done'] = true
    state.flags['rumor-high-done'] = true
  }

  it('injects war missions ignoring MAX_OPEN_OFFERS, and >=2 coexist at some point during the window', () => {
    const state = newRun(6)
    startFinale(state)
    // Saturate the board with non-war offers past MAX_OPEN_OFFERS to prove
    // the finale injection ignores that cap.
    for (let i = 0; i < MAX_OPEN_OFFERS + 2; i++) {
      state.missions.push({
        id: `filler${i}`,
        name: `Filler ${i}`,
        kind: 'dispatch',
        severityTier: 1,
        rewardCoin: 1,
        rewardTreasure: 0,
        rewardStanding: 1,
        patronId: null,
        offerExpiresDay: state.day + 100,
        deadlineDay: state.day + 100,
        durationTicks: 3,
        enemyStrength: 0,
        weather: 0,
        status: 'offered',
        assignedDragonId: null,
        returnTick: null,
        outcome: null,
      })
    }

    const rng = createRng(7)
    let maxConcurrentWar = 0
    for (let i = 0; i < FINALE_LENGTH_DAYS; i++) {
      stepWarDay(state, rng)
      const warCount = state.missions.filter((m) => m.kind === 'war' && (m.status === 'offered' || m.status === 'active')).length
      maxConcurrentWar = Math.max(maxConcurrentWar, warCount)
    }

    expect(maxConcurrentWar).toBeGreaterThanOrEqual(2)
    const totalOpenOffers = state.missions.filter((m) => m.status === 'offered').length
    expect(totalOpenOffers).toBeGreaterThan(MAX_OPEN_OFFERS)
  })

  it('escalates severity: the first two injected war missions are tier 2, the rest tier 3', () => {
    const state = newRun(7)
    startFinale(state)
    const rng = createRng(8)

    for (let i = 0; i < FINALE_LENGTH_DAYS; i++) stepWarDay(state, rng)

    const warMissions = state.missions
      .filter((m) => m.kind === 'war')
      .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
    expect(warMissions.length).toBeGreaterThanOrEqual(3)
    expect(warMissions[0].severityTier).toBe(2)
    expect(warMissions[1].severityTier).toBe(2)
    expect(warMissions[warMissions.length - 1].severityTier).toBe(3)
  })

  it('defers an injection while a card is pending on its due day, then catches up once clear', () => {
    const state = newRun(8)
    startFinale(state) // day 0; first mission due on day FINALE_MISSION_INTERVAL_DAYS
    const rng = createRng(9)
    const dueDay = FINALE_MISSION_INTERVAL_DAYS

    for (let d = 1; d <= dueDay + 1; d++) {
      state.pendingCards = d === dueDay ? [{ id: 'block', templateId: 'tribute-demand', params: {} }] : []
      stepWarDay(state, rng)
      if (d === dueDay) {
        // Due today, but blocked by the pending card — deferred, not skipped.
        expect(state.missions.some((m) => m.kind === 'war')).toBe(false)
      }
    }

    // The day after: pendingCards clear again — the deferred mission catches up.
    expect(state.missions.some((m) => m.kind === 'war')).toBe(true)
  })
})

describe('endings and scoring', () => {
  function expectedScore(state: GameState): number {
    const dragonScore = state.dragons.reduce((sum, d) => {
      const weightClass = d.breed === 'chequered-nettle' || d.breed === 'kazilik' ? 'heavy' : d.breed === 'yellow-reaper' || d.breed === 'longwing' ? 'middle' : d.breed === 'grey-copper' ? 'light' : 'courier'
      return sum + SCORE_PER_DRAGON_WEIGHT[weightClass]
    }, 0)
    const officerScore = state.officers.filter((o) => o.alive).length * SCORE_PER_OFFICER
    const patronScore = state.patrons.filter((p) => p.tier > 0).reduce((sum, p) => sum + p.tier, 0) * SCORE_PER_PATRON_TIER
    return dragonScore + officerScore + state.standing + patronScore
  }

  it('computeScore matches the exact formula', () => {
    const state = newRun(9)
    makeDragon(state, { breed: 'winchester' }) // courier
    makeDragon(state, { breed: 'grey-copper' }) // light
    makeDragon(state, { breed: 'chequered-nettle' }) // heavy
    state.patrons[0].tier = 3
    state.patrons[1].tier = -2 // negative tiers must not contribute
    state.standing = 42

    expect(computeScore(state)).toBe(expectedScore(state))
  })

  it('"survived": run stays alive past the finale end day with a dragon alive, ending set with an exact score', () => {
    const state = newRun(10)
    state.pendingCards = []
    state.warHeat = 100
    state.rung = 2
    state.finaleStarted = true
    state.flags[`finale-end-day-${state.day + 5}`] = true
    state.flags['kazilik-card-pushed'] = true
    state.standing = 50
    makeDragon(state, { breed: 'longwing' })

    const rng = createRng(11)
    for (let i = 0; i < 10 && state.status === 'running'; i++) stepWarDay(state, rng)

    expect(state.status).toBe('ended')
    expect(state.ending).toBe('survived')
    expect(state.score).toBe(expectedScore(state))
  })

  it('"wing-destroyed": all dragons lost during the finale after having had at least one', () => {
    const state = newRun(11)
    state.pendingCards = []
    state.warHeat = 100
    state.rung = 2
    const dragon = makeDragon(state, { breed: 'yellow-reaper' })
    const rng = createRng(12)
    stepWarDay(state, rng) // starts the finale, sets had-dragon
    expect(state.finaleStarted).toBe(true)
    expect(state.flags['had-dragon']).toBe(true)

    state.dragons = state.dragons.filter((d) => d.id !== dragon.id)
    stepWarDay(state, rng)

    expect(state.status).toBe('ended')
    expect(state.ending).toBe('wing-destroyed')
    expect(state.score).toBe(expectedScore(state))
  })

  it('does not end wing-destroyed if the covert never had a dragon', () => {
    const state = newRun(12)
    state.pendingCards = []
    state.warHeat = 100
    state.rung = 2
    const rng = createRng(13)
    stepWarDay(state, rng)
    expect(state.finaleStarted).toBe(true)
    expect(state.dragons).toHaveLength(0)

    stepWarDay(state, rng)
    expect(state.status).toBe('running')
  })

  it('"relieved" also carries a score', () => {
    const state = newRun(13)
    state.rung = 2 // positive rung-2 floor, so standing 0 is always below expectation
    state.standing = 0
    for (let i = 0; i < TICKS_PER_DAY * 30; i++) tick(state)
    expect(state.status).toBe('ended')
    expect(state.ending).toBe('relieved')
    expect(typeof state.score).toBe('number')
    expect(state.score).toBe(expectedScore(state))
  })
})

describe('kazilik quest', () => {
  function financeAtFinaleStart(seed: number): GameState {
    const state = newRun(seed)
    state.pendingCards = []
    state.warHeat = 100
    state.rung = 2
    // As in the finale-mission-pressure tests: a real playthrough's rumor
    // cards have already fired by the time heat hits 100, so pre-set them
    // here or the first one occupies the pendingCards slot the kazilik-quest
    // push defers to and this test never sees it fire.
    state.flags['rumor-low-done'] = true
    state.flags['rumor-mid-done'] = true
    state.flags['rumor-high-done'] = true
    stepWarDay(state, createRng(seed + 100))
    return state
  }

  it('pushes the kazilik-quest card once the finale starts', () => {
    const state = financeAtFinaleStart(20)
    expect(state.finaleStarted).toBe(true)
    expect(state.pendingCards.some((c) => c.templateId === 'kazilik-quest')).toBe(true)
  })

  it('"Fund the expedition" deducts coin and creates The Istanbul Run with the kazilik-run flag', () => {
    const state = financeAtFinaleStart(21)
    state.coin = 500
    const card = state.pendingCards.find((c) => c.templateId === 'kazilik-quest')!
    const coinBefore = state.coin

    chooseCardOption(state, card.id, 0)

    expect(state.coin).toBe(coinBefore - KAZILIK_COST)
    const mission = state.missions.find((m) => m.name === 'The Istanbul Run')
    expect(mission).toBeDefined()
    expect(mission!.kind).toBe('war')
    expect(mission!.severityTier).toBe(3)
    expect(state.flags[`kazilik-run:${mission!.id}`]).toBe(true)
  })

  it('is disabled when coin is short of KAZILIK_COST', () => {
    const state = financeAtFinaleStart(22)
    state.coin = KAZILIK_COST - 1
    const card = state.pendingCards.find((c) => c.templateId === 'kazilik-quest')!
    const options = CARDS['kazilik-quest'].options(state, card.params)
    expect(options[0].enabled).toBe(false)
    expect(options[1].enabled).toBe(true) // decline always available
  })

  it('"Decline" logs only — no mission, no coin change, no flag', () => {
    const state = financeAtFinaleStart(23)
    state.coin = 500
    const card = state.pendingCards.find((c) => c.templateId === 'kazilik-quest')!
    const coinBefore = state.coin
    const missionsBefore = state.missions.length

    chooseCardOption(state, card.id, 1)

    expect(state.coin).toBe(coinBefore)
    expect(state.missions.length).toBe(missionsBefore)
    expect(Object.keys(state.flags).some((k) => k.startsWith('kazilik-run:'))).toBe(false)
  })

  it('on scripted success, pushes a hatching card with breed kazilik for the best eligible candidate', () => {
    const state = financeAtFinaleStart(24)
    state.coin = 500
    const card = state.pendingCards.find((c) => c.templateId === 'kazilik-quest')!
    chooseCardOption(state, card.id, 0)
    const mission = state.missions.find((m) => m.name === 'The Istanbul Run')!

    // Make officers[1] the clear best free candidate (highest rank).
    state.officers[1].rank = 'lieutenant'
    state.officers[1].dragonId = null
    state.officers[1].alive = true

    const dragon = makeDragon(state, { captainId: state.officers[0].id })
    state.officers[0].dragonId = dragon.id // the flying captain is not itself eligible
    mission.assignedDragonId = dragon.id
    mission.status = 'active'
    mission.returnTick = state.tickCount + 1

    // success, light-wound roll (sev3 success draws crewLost too)
    resolveMission(state, mission, scriptedRng([0.0, 0.5, 0.5, 0.99]))

    expect(mission.outcome?.success).toBe(true)
    const hatchCard = state.pendingCards.find((c) => c.templateId === 'hatching')
    expect(hatchCard).toBeDefined()
    expect(hatchCard!.params.breed).toBe('kazilik')
    expect(hatchCard!.params.officerId).toBe(state.officers[1].id)
    expect(state.flags[`kazilik-run:${mission.id}`]).toBeUndefined()
  })

  it('on scripted success with no eligible candidate, grants consolation treasure instead', () => {
    const state = financeAtFinaleStart(25)
    state.coin = 500
    const card = state.pendingCards.find((c) => c.templateId === 'kazilik-quest')!
    chooseCardOption(state, card.id, 0)
    const mission = state.missions.find((m) => m.name === 'The Istanbul Run')!

    // No officer is free to bond: every non-captain officer is either dead
    // or already flagged as a captain's counterpart via dragonId.
    for (const o of state.officers) {
      o.alive = false
    }

    const dragon = makeDragon(state, { captainId: state.officers[0].id })
    state.officers[0].alive = true // the captain flying the mission
    state.officers[0].dragonId = dragon.id // and thus not eligible itself
    mission.assignedDragonId = dragon.id
    mission.status = 'active'
    mission.returnTick = state.tickCount + 1
    const treasureBefore = state.treasure

    const rewardTreasure = mission.rewardTreasure
    resolveMission(state, mission, scriptedRng([0.0, 0.5, 0.5, 0.99]))

    expect(mission.outcome?.success).toBe(true)
    expect(state.pendingCards.some((c) => c.templateId === 'hatching')).toBe(false)
    // Mission success pays its own rewardTreasure on top of the Kazilik
    // consolation grant — both land in the same resolveMission call.
    expect(state.treasure).toBe(treasureBefore + rewardTreasure + TREASURE_EGG_CONSOLATION)
  })

  it('on scripted failure, clears the flag and mourns without pushing a hatching card', () => {
    const state = financeAtFinaleStart(26)
    state.coin = 500
    const card = state.pendingCards.find((c) => c.templateId === 'kazilik-quest')!
    chooseCardOption(state, card.id, 0)
    const mission = state.missions.find((m) => m.name === 'The Istanbul Run')!

    const dragon = makeDragon(state, { captainId: state.officers[0].id, training: 0, contentment: 0 })
    mission.assignedDragonId = dragon.id
    mission.status = 'active'
    mission.returnTick = state.tickCount + 1

    resolveMission(state, mission, scriptedRng([0.99])) // guaranteed failure

    expect(mission.outcome?.success).toBe(false)
    expect(state.pendingCards.some((c) => c.templateId === 'hatching')).toBe(false)
    expect(state.flags[`kazilik-run:${mission.id}`]).toBeUndefined()
  })

  it('cleans up the kazilik-run flag (and closes the questline with a log) if the funded offer expires unaccepted', () => {
    const state = financeAtFinaleStart(28)
    state.coin = 500
    const card = state.pendingCards.find((c) => c.templateId === 'kazilik-quest')!
    chooseCardOption(state, card.id, 0)
    const mission = state.missions.find((m) => m.name === 'The Istanbul Run')!
    expect(state.flags[`kazilik-run:${mission.id}`]).toBe(true)

    // Never depart a dragon; jump to the tick just before the day boundary
    // after the offer window lapses, then tick once so tickMissions runs
    // its day-boundary expiry pass.
    state.tickCount = (mission.offerExpiresDay + 1) * TICKS_PER_DAY - 1
    state.day = Math.floor(state.tickCount / TICKS_PER_DAY)
    tick(state)

    expect(state.missions.find((m) => m.id === mission.id)).toBeUndefined()
    expect(state.flags[`kazilik-run:${mission.id}`]).toBeUndefined()
    expect(state.log.some((l) => l.text.includes('Istanbul expedition closes unanswered'))).toBe(true)
  })

  it('resolveKazilikRun is a no-op for a mission with no kazilik-run flag', () => {
    const state = newRun(27)
    const before = JSON.parse(JSON.stringify(state))
    resolveKazilikRun(state, 'm-does-not-exist', true)
    expect(state).toEqual(before)
  })
})

describe('war-rumor and kazilik-quest cards remain single-option/two-option and registered', () => {
  it('kazilik-quest exposes exactly a fund and a decline option', () => {
    const state = newRun(1)
    const template = CARDS['kazilik-quest']
    expect(template).toBeDefined()
    const options = template.options(state, {})
    expect(options).toHaveLength(2)
  })
})

describe('determinism', () => {
  it('produces deep-equal state across two identical seeds after 1200 ticks', () => {
    function build(seed: number): GameState {
      const state = newRun(seed)
      state.pendingCards = []
      state.rung = 2
      return state
    }

    const a = build(42)
    const b = build(42)
    for (let i = 0; i < 1200; i++) tick(a)
    for (let i = 0; i < 1200; i++) tick(b)
    expect(a).toEqual(b)
  })
})
