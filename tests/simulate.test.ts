import { describe, it, expect } from 'vitest'
import { newRun } from '../src/sim/newRun'
import { tick } from '../src/sim/tick'
import { createRng } from '../src/sim/rng'
import { hatchEgg } from '../src/sim/auction'
import type { GameState, Mission, Id } from '../src/sim/types'
import {
  botAct,
  missionAcceptThreshold,
  bestDragonForMission,
} from '../scripts/simulate'

/**
 * The balance bot's policy pieces, unit-tested. The full N-run sim lives in
 * `npm run sim` (scripts/simulate.ts's main(), guarded off under vitest) — this
 * file only proves the per-tick decision surface behaves.
 */

function addDragon(state: GameState, breed: Parameters<typeof hatchEgg>[2], captainId: Id): Id {
  hatchEgg(state, createRng(1), breed, captainId)
  return state.dragons[state.dragons.length - 1].id
}

function pushMission(state: GameState, overrides: Partial<Mission>): Mission {
  const m: Mission = {
    id: `mtest${state.nextId}`,
    name: 'Test Offer',
    kind: 'dispatch',
    severityTier: 1,
    rewardCoin: 10,
    rewardTreasure: 0,
    rewardStanding: 3,
    patronId: null,
    offerExpiresDay: state.day + 4,
    deadlineDay: state.day + 7,
    durationTicks: 6,
    enemyStrength: 0,
    weather: 0,
    status: 'offered',
    assignedDragonId: null,
    returnTick: null,
    outcome: null,
    ...overrides,
  }
  state.nextId += 1
  state.missions.push(m)
  return m
}

describe('bot smoke test', () => {
  it('plays seed 1 to a valid ending (or the in-test cap) without throwing', () => {
    const state = newRun(1)
    expect(() => {
      // Cap at 200 days in-test (the real sim caps at 500); enough to exercise
      // the FTUE, missions, and at least an auction without a slow full run.
      while (state.status === 'running' && state.day <= 200) {
        botAct(state)
        tick(state)
      }
    }).not.toThrow()

    if (state.status === 'ended') {
      expect(['survived', 'relieved', 'wing-destroyed']).toContain(state.ending)
      expect(typeof state.score).toBe('number')
    } else {
      // Still running at the cap — the sim would classify this as a timeout.
      expect(state.status).toBe('running')
    }
  })
})

describe('mission acceptance policy', () => {
  it('demands 0.6 success pre-finale and relaxes to 0.5 during the finale', () => {
    const state = newRun(2)
    expect(missionAcceptThreshold(state)).toBe(0.6)
    state.finaleStarted = true
    expect(missionAcceptThreshold(state)).toBe(0.5)
  })

  it('accepts an easy mission (chance >= 0.6) and refuses a brutal one pre-finale', () => {
    const state = newRun(3)
    state.pendingCards = [] // skip the FTUE sponsorship card for this unit test
    const dragonId = addDragon(state, 'yellow-reaper', state.officers[3].id)

    const easy = pushMission(state, { enemyStrength: 0, weather: 0 })
    const easyPick = bestDragonForMission(state, easy.id)!
    expect(easyPick.chance).toBeGreaterThanOrEqual(0.6)

    botAct(state)
    const dragon = state.dragons.find((d) => d.id === dragonId)!
    expect(dragon.status).toBe('mission') // dispatched onto the easy offer
    expect(easy.status).toBe('active')
  })

  it('leaves a dragon home when no offer clears the 0.6 bar pre-finale', () => {
    const state = newRun(4)
    state.pendingCards = []
    const dragonId = addDragon(state, 'winchester', state.officers[3].id)

    // A winchester (combat 0.6) against a heavy enemy in foul weather sits well
    // under 0.6 — the bot should refuse it (let it expire), never dispatch.
    const brutal = pushMission(state, { kind: 'combat', severityTier: 2, enemyStrength: 10, weather: 1 })
    const pick = bestDragonForMission(state, brutal.id)!
    expect(pick.chance).toBeLessThan(0.6)

    botAct(state)
    const dragon = state.dragons.find((d) => d.id === dragonId)!
    expect(dragon.status).toBe('home')
    expect(brutal.status).toBe('offered')
  })

  it('takes the same brutal offer once the finale relaxes the bar (chance in [0.5,0.6))', () => {
    const state = newRun(5)
    state.pendingCards = []
    state.finaleStarted = true
    const dragonId = addDragon(state, 'yellow-reaper', state.officers[3].id)

    // Tune enemy strength so this yellow-reaper lands between 0.5 and 0.6:
    // refused pre-finale, accepted in-finale.
    let mission = pushMission(state, { kind: 'combat', severityTier: 2, enemyStrength: 7, weather: 0 })
    let chance = bestDragonForMission(state, mission.id)!.chance
    // Nudge until it sits in the finale-only band, keeping the test robust to
    // small breed/stat changes.
    let guard = 0
    while ((chance < 0.5 || chance >= 0.6) && guard < 12) {
      state.missions = state.missions.filter((m) => m.id !== mission.id)
      const enemy = chance >= 0.6 ? mission.enemyStrength + 1 : mission.enemyStrength - 1
      mission = pushMission(state, { kind: 'combat', severityTier: 2, enemyStrength: enemy, weather: 0 })
      chance = bestDragonForMission(state, mission.id)!.chance
      guard += 1
    }
    expect(chance).toBeGreaterThanOrEqual(0.5)
    expect(chance).toBeLessThan(0.6)

    botAct(state)
    const dragon = state.dragons.find((d) => d.id === dragonId)!
    expect(dragon.status).toBe('mission')
  })
})
