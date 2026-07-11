import { describe, it, expect } from 'vitest'
import { newRun } from '../src/sim/newRun'
import { tick } from '../src/sim/tick'
import { adjustTier, earnGoodwill, spendGoodwill } from '../src/sim/patrons'
import { resolveMission } from '../src/sim/missions'
import type { Rng } from '../src/sim/rng'
import {
  TICKS_PER_DAY,
  TIER_MIN,
  TIER_MAX,
  GOODWILL_CAP,
  TRAP_ENEMY_MIN,
  TRAP_ENEMY_MAX,
  TRAP_REWARD_MULT,
  COIN_REWARD_BASE,
  COIN_REWARD_PER_ENEMY,
} from '../src/sim/balance'
import type { GameState, Mission } from '../src/sim/types'

function tickN(state: GameState, n: number): void {
  for (let i = 0; i < n; i++) tick(state)
}

/** Same scripted-Rng double as missions.test.ts: next() returns queued values, then 0. */
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

describe('adjustTier', () => {
  it('clamps at TIER_MAX', () => {
    const state = newRun(1)
    const patron = state.patrons[0]
    patron.tier = TIER_MAX
    adjustTier(state, patron.id, 5)
    expect(patron.tier).toBe(TIER_MAX)
  })

  it('clamps at TIER_MIN', () => {
    const state = newRun(2)
    const patron = state.patrons[0]
    patron.tier = TIER_MIN
    adjustTier(state, patron.id, -5)
    expect(patron.tier).toBe(TIER_MIN)
  })

  it('sets memory only when given', () => {
    const state = newRun(3)
    const patron = state.patrons[0]
    const memoryBefore = patron.memory
    adjustTier(state, patron.id, 1)
    expect(patron.memory).toBe(memoryBefore)
    adjustTier(state, patron.id, 1, 'a new grievance')
    expect(patron.memory).toBe('a new grievance')
  })

  it('throws for an unknown patron', () => {
    const state = newRun(4)
    expect(() => adjustTier(state, 'nope', 1)).toThrow()
  })
})

describe('earnGoodwill', () => {
  it('clamps at 0 and GOODWILL_CAP', () => {
    const state = newRun(5)
    const patron = state.patrons[0]
    patron.goodwill = GOODWILL_CAP
    earnGoodwill(state, patron.id, 5)
    expect(patron.goodwill).toBe(GOODWILL_CAP)

    patron.goodwill = 0
    earnGoodwill(state, patron.id, -5)
    expect(patron.goodwill).toBe(0)
  })

  it('throws for an unknown patron', () => {
    const state = newRun(6)
    expect(() => earnGoodwill(state, 'nope', 1)).toThrow()
  })
})

describe('spendGoodwill', () => {
  it('throws when the patron has insufficient goodwill', () => {
    const state = newRun(7)
    const patron = state.patrons[0]
    patron.goodwill = 1
    expect(() => spendGoodwill(state, patron.id, 2, 'own-interest')).toThrow()
  })

  it('throws for an unknown patron', () => {
    const state = newRun(8)
    expect(() => spendGoodwill(state, 'nope', 1, 'own-interest')).toThrow()
  })

  it('deducts goodwill and cools tier by 1 for a stranger spend when tier > 0', () => {
    const state = newRun(9)
    const patron = state.patrons[0]
    patron.tier = 2
    patron.goodwill = 5
    spendGoodwill(state, patron.id, 2, 'stranger')
    expect(patron.goodwill).toBe(3)
    expect(patron.tier).toBe(1)
  })

  it('does not cool tier for an own-interest spend', () => {
    const state = newRun(10)
    const patron = state.patrons[0]
    patron.tier = 2
    patron.goodwill = 5
    spendGoodwill(state, patron.id, 2, 'own-interest')
    expect(patron.tier).toBe(2)
  })

  it('never cools tier below 0 from a stranger spend', () => {
    const state = newRun(11)
    const patron = state.patrons[0]
    patron.tier = 0
    patron.goodwill = 5
    spendGoodwill(state, patron.id, 2, 'stranger')
    expect(patron.tier).toBe(0)
  })

  it('does not cool a tier already at or below 0 even at negative tiers', () => {
    const state = newRun(12)
    const patron = state.patrons[0]
    patron.tier = -2
    patron.goodwill = 5
    spendGoodwill(state, patron.id, 2, 'stranger')
    expect(patron.tier).toBe(-2)
  })
})

describe('tickPatrons — gratitude gifts', () => {
  it('fires a gift within 200 seeded days at tier >= GIFT_TIER_MIN', () => {
    const state = newRun(20)
    state.pendingCards = []
    const patron = state.patrons.find((p) => p.kind === 'gratitude')!
    patron.tier = 2
    const coinBefore = state.coin
    const goodwillBefore = patron.goodwill

    for (let day = 0; day < 200; day++) tickN(state, TICKS_PER_DAY)

    const gifted = state.coin !== coinBefore || patron.goodwill !== goodwillBefore
    expect(gifted).toBe(true)
    const line = state.log.find((l) => l.text.includes(patron.name))
    expect(line).toBeDefined()
  })

  it('never gifts a gratitude patron below GIFT_TIER_MIN', () => {
    const state = newRun(21)
    state.pendingCards = []
    const patron = state.patrons.find((p) => p.kind === 'gratitude')!
    patron.tier = 1
    const coinBefore = state.coin
    const goodwillBefore = patron.goodwill

    for (let day = 0; day < 200; day++) tickN(state, TICKS_PER_DAY)

    expect(state.coin).toBe(coinBefore)
    expect(patron.goodwill).toBe(goodwillBefore)
  })
})

describe('tickPatrons — rival traps', () => {
  it('injects a flagged trap mission with a true enemyStrength in [TRAP_ENEMY_MIN, TRAP_ENEMY_MAX] and 1.5x rewards', () => {
    const state = newRun(22)
    state.pendingCards = []
    const rival = state.patrons.find((p) => p.kind === 'rival')!
    rival.tier = -2

    let trapMission: Mission | undefined
    for (let day = 0; day < 400 && !trapMission; day++) {
      tickN(state, TICKS_PER_DAY)
      trapMission = state.missions.find((m) => state.flags[`trap:${m.id}`])
    }

    expect(trapMission).toBeDefined()
    const m = trapMission!
    expect(m.patronId).toBe(rival.id)
    expect(m.enemyStrength).toBeGreaterThanOrEqual(TRAP_ENEMY_MIN)
    expect(m.enemyStrength).toBeLessThanOrEqual(TRAP_ENEMY_MAX)

    const expectedCoin = Math.round((COIN_REWARD_BASE * m.severityTier + COIN_REWARD_PER_ENEMY * m.enemyStrength) * TRAP_REWARD_MULT)
    expect(m.rewardCoin).toBe(expectedCoin)
  })
})

describe('trap flag cleanup on offer expiry', () => {
  it('an expired trap offer leaves no trap: flag behind', () => {
    const state = newRun(23)
    state.pendingCards = []
    const rival = state.patrons.find((p) => p.kind === 'rival')!
    const id = `m${state.nextId}`
    state.nextId += 1
    state.missions.push({
      id,
      name: 'Trap Offer',
      kind: 'dispatch',
      severityTier: 1,
      rewardCoin: 30,
      rewardTreasure: 0,
      rewardStanding: 8,
      patronId: rival.id,
      offerExpiresDay: 1,
      deadlineDay: 10,
      durationTicks: 6,
      enemyStrength: 7,
      weather: 0.2,
      status: 'offered',
      assignedDragonId: null,
      returnTick: null,
      outcome: null,
    })
    state.flags[`trap:${id}`] = true

    tickN(state, TICKS_PER_DAY * 3) // well past offerExpiresDay

    expect(state.missions.find((m) => m.id === id)).toBeUndefined()
    expect(state.flags[`trap:${id}`]).toBeUndefined()
  })
})

describe('missions.ts refactor — failure-path patron effects', () => {
  it('a failed patron mission drops tier by exactly 1 and updates memory', () => {
    const state = newRun(24)
    const patron = state.patrons.find((p) => p.kind === 'transactional')!
    patron.tier = 1
    const dragonId = `d${state.nextId}`
    state.nextId += 1
    state.dragons.push({
      id: dragonId,
      name: 'Test Dragon',
      breed: 'winchester',
      training: 0,
      woundsTemp: 0,
      woundsLasting: 0,
      contentment: 0,
      captainId: state.officers[0].id,
      status: 'mission',
      missionId: null,
    })
    const mission: Mission = {
      id: `m${state.nextId}`,
      name: 'Patron Failure',
      kind: 'dispatch',
      severityTier: 1,
      rewardCoin: 10,
      rewardTreasure: 0,
      rewardStanding: 3,
      patronId: patron.id,
      offerExpiresDay: state.day + 4,
      deadlineDay: state.day + 10,
      durationTicks: 6,
      enemyStrength: 9,
      weather: 1,
      status: 'active',
      assignedDragonId: dragonId,
      returnTick: state.tickCount + 1,
      outcome: null,
    }
    state.nextId += 1
    state.missions.push(mission)

    // Draws on a sev1 failure: 1. success roll (0.99 beats any clamped
    // chance → fail) 2. woundsTemp 3. woundsLasting 4. crewLost
    // 5. skill-growth (captain alive).
    resolveMission(state, mission, scriptedRng([0.99, 0.5, 0.5, 0.5, 0.99]))

    expect(mission.outcome?.success).toBe(false)
    expect(patron.tier).toBe(0) // exactly -1 from its prior value of 1
    expect(patron.memory).toContain(mission.name)
    expect(patron.memory.toLowerCase()).toContain('failure')
  })
})

describe('missions.ts refactor sanity', () => {
  it('newRun + a single tick still produces a valid, deep-equal-across-seeds state', () => {
    const a = newRun(31)
    const b = newRun(31)
    tickN(a, TICKS_PER_DAY)
    tickN(b, TICKS_PER_DAY)
    expect(a).toEqual(b)
  })
})
