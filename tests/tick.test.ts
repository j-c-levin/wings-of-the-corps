import { describe, it, expect } from 'vitest'
import { newRun } from '../src/sim/newRun'
import { tick, addLog } from '../src/sim/tick'
import { LOG_CAP, TICKS_PER_DAY, FAIL_DAYS_TO_RELIEVED, FEED_SHORTFALL_CONTENTMENT, EXPECTATION_FLOOR_BY_RUNG } from '../src/sim/balance'
import type { Dragon, GameState } from '../src/sim/types'

function makeDragon(state: GameState, overrides: Partial<Dragon> = {}): Dragon {
  const id = `d${state.nextId}`
  state.nextId += 1
  const dragon: Dragon = {
    id,
    name: 'Test Dragon',
    breed: 'winchester',
    training: 0,
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

function tickN(state: GameState, n: number): void {
  for (let i = 0; i < n; i++) tick(state)
}

describe('tick', () => {
  it('rolls the day over exactly at TICKS_PER_DAY ticks', () => {
    const state = newRun(1)
    expect(state.day).toBe(0)
    tickN(state, TICKS_PER_DAY - 1)
    expect(state.day).toBe(0)
    tick(state)
    expect(state.day).toBe(1)
  })

  it('deducts feed per breed on day rollover', () => {
    const state = newRun(2)
    state.feed = 100
    makeDragon(state, { breed: 'winchester' })
    makeDragon(state, { breed: 'chequered-nettle' })
    tickN(state, TICKS_PER_DAY)
    expect(state.feed).toBe(100 - 7)
  })

  it('clamps feed at 0 and drops contentment on a shortfall day', () => {
    const state = newRun(3)
    state.feed = 3
    const a = makeDragon(state, { breed: 'winchester', contentment: 50 })
    const b = makeDragon(state, { breed: 'chequered-nettle', contentment: 50 })
    tickN(state, TICKS_PER_DAY)
    expect(state.feed).toBe(0)
    // Contentment drift (step 4) runs after the shortfall penalty (step 1)
    // in the same day, nudging both back up by 1 toward the baseline.
    expect(a.contentment).toBe(50 - FEED_SHORTFALL_CONTENTMENT + 1)
    expect(b.contentment).toBe(50 - FEED_SHORTFALL_CONTENTMENT + 1)
    const shortfallLine = state.log.find((l) => l.text.toLowerCase().includes('short rations'))
    expect(shortfallLine).toBeDefined()
  })

  it('does not drop contentment below 0 on repeated shortfalls', () => {
    const state = newRun(4)
    state.feed = 0
    makeDragon(state, { breed: 'kazilik', contentment: 2 })
    tickN(state, TICKS_PER_DAY)
    const dragon = state.dragons[0]
    // Contentment is clamped to 0 by the shortfall, then drift (step 4)
    // nudges it 1 point back toward the baseline the same day.
    expect(dragon.contentment).toBe(1)
  })

  it('heals wounds by 2/day for dragons not on mission', () => {
    const state = newRun(5)
    const dragon = makeDragon(state, { woundsTemp: 10, status: 'home' })
    tickN(state, TICKS_PER_DAY)
    expect(dragon.woundsTemp).toBe(8)
  })

  it('never touches a dragon with status mission', () => {
    const state = newRun(6)
    const dragon = makeDragon(state, { woundsTemp: 10, status: 'mission', training: 20 })
    tickN(state, TICKS_PER_DAY)
    expect(dragon.woundsTemp).toBe(10)
    expect(dragon.training).toBe(20)
  })

  it('flips status to healing when post-heal woundsTemp is at/above the threshold', () => {
    const state = newRun(7)
    const dragon = makeDragon(state, { woundsTemp: 70, status: 'home' })
    tickN(state, TICKS_PER_DAY)
    expect(dragon.woundsTemp).toBe(68)
    expect(dragon.status).toBe('healing')
  })

  it('flips status back to home once healed below the threshold', () => {
    const state = newRun(8)
    const dragon = makeDragon(state, { woundsTemp: 61, status: 'healing' })
    tickN(state, TICKS_PER_DAY)
    expect(dragon.woundsTemp).toBe(59)
    expect(dragon.status).toBe('home')
  })

  it('grants passive training to home dragons, capped at 100', () => {
    const state = newRun(9)
    const dragon = makeDragon(state, { status: 'home', training: 99.5 })
    tickN(state, TICKS_PER_DAY)
    expect(dragon.training).toBeCloseTo(100)
  })

  it('drifts contentment toward the baseline by 1/day', () => {
    const state = newRun(10)
    state.feed = 1000 // avoid a shortfall penalty muddying the drift-only assertion
    const low = makeDragon(state, { contentment: 40 })
    const high = makeDragon(state, { contentment: 60 })
    tickN(state, TICKS_PER_DAY)
    expect(low.contentment).toBe(41)
    expect(high.contentment).toBe(59)
  })

  it('sets expectation to the rung floor when standing is low', () => {
    const state = newRun(11)
    state.rung = 3
    state.standing = 0
    tickN(state, TICKS_PER_DAY)
    expect(state.expectation).toBe(EXPECTATION_FLOOR_BY_RUNG[3])
  })

  it('raises expectation with standing per the exact formula', () => {
    const state = newRun(12)
    state.rung = 1
    state.standing = 100
    tickN(state, TICKS_PER_DAY)
    expect(state.expectation).toBeCloseTo(55)
  })

  it('ends the run as relieved after FAIL_DAYS_TO_RELIEVED consecutive shortfall days', () => {
    const state = newRun(13)
    state.rung = 2 // positive rung-2 floor, so standing 0 is always below expectation
    state.standing = 0
    tickN(state, TICKS_PER_DAY * FAIL_DAYS_TO_RELIEVED)
    expect(state.status).toBe('ended')
    expect(state.ending).toBe('relieved')
    expect(state.failStreakDays).toBeGreaterThanOrEqual(FAIL_DAYS_TO_RELIEVED)
  })

  it('does not end the run early if standing stays at/above expectation', () => {
    const state = newRun(14)
    state.rung = 1
    state.standing = 50 // expectation formula keeps this above floor 0, so red line never trips
    tickN(state, TICKS_PER_DAY * (FAIL_DAYS_TO_RELIEVED - 1))
    expect(state.status).toBe('running')
  })

  it('is a no-op once the run has ended', () => {
    const state = newRun(15)
    state.status = 'ended'
    state.ending = 'relieved'
    const before = JSON.parse(JSON.stringify(state))
    tick(state)
    tick(state)
    expect(state).toEqual(before)
  })

  it('produces deep-equal state across two identical seeds after 500 ticks', () => {
    const a = newRun(999)
    const b = newRun(999)
    tickN(a, 500)
    tickN(b, 500)
    expect(a).toEqual(b)
  })

  it('reconstructs rng from state and persists rngState across a day rollover', () => {
    const state = newRun(16)
    makeDragon(state, { woundsTemp: 5 }) // ensures the daily flavor-log roll consumes rng draws
    const before = state.rngState
    tickN(state, TICKS_PER_DAY)
    expect(state.rngState).not.toBe(before)
  })
})

describe('addLog', () => {
  it('appends a log line tagged with the current day', () => {
    const state = newRun(20)
    state.day = 5
    addLog(state, 'hello world')
    const last = state.log[state.log.length - 1]
    expect(last).toEqual({ day: 5, text: 'hello world' })
  })

  it('caps the log at LOG_CAP, trimming from the front and keeping the newest', () => {
    const state = newRun(21)
    state.log = []
    for (let i = 0; i < LOG_CAP + 10; i++) {
      addLog(state, `line ${i}`)
    }
    expect(state.log).toHaveLength(LOG_CAP)
    expect(state.log[state.log.length - 1].text).toBe(`line ${LOG_CAP + 9}`)
    expect(state.log[0].text).toBe(`line 10`)
  })
})
