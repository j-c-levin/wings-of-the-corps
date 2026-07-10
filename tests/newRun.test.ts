import { describe, it, expect } from 'vitest'
import { newRun } from '../src/sim/newRun'

describe('newRun', () => {
  it('same seed produces deep-equal state on repeated calls', () => {
    const a = newRun(1234)
    const b = newRun(1234)
    expect(a).toEqual(b)
  })

  it('survives a JSON.stringify/parse roundtrip deep-equal', () => {
    const state = newRun(42)
    const roundtripped = JSON.parse(JSON.stringify(state))
    expect(roundtripped).toEqual(state)
  })

  it('has three patrons with the spec starting tiers/goodwill', () => {
    const state = newRun(7)
    expect(state.patrons).toHaveLength(3)

    const allendale = state.patrons.find((p) => p.name === 'Lady Allendale')
    expect(allendale).toBeDefined()
    expect(allendale?.kind).toBe('gratitude')
    expect(allendale?.tier).toBe(1)
    expect(allendale?.goodwill).toBe(4)

    const barham = state.patrons.find((p) => p.name === 'Lord Barham')
    expect(barham).toBeDefined()
    expect(barham?.kind).toBe('transactional')
    expect(barham?.tier).toBe(0)
    expect(barham?.goodwill).toBe(0)

    const rankin = state.patrons.find((p) => p.name === 'Captain Rankin')
    expect(rankin).toBeDefined()
    expect(rankin?.kind).toBe('rival')
    expect(rankin?.tier).toBe(-1)
    expect(rankin?.goodwill).toBe(0)
  })

  it('starts with zero dragons', () => {
    const state = newRun(99)
    expect(state.dragons).toHaveLength(0)
  })

  it('first pending card is a sponsorship card', () => {
    const state = newRun(5)
    expect(state.pendingCards[0].templateId).toBe('sponsorship')
  })

  it('has six officers, three of them midwingmen, with mixed genders', () => {
    for (const seed of [1, 2, 3, 4, 5, 11, 22, 33, 100, 555]) {
      const state = newRun(seed)
      expect(state.officers).toHaveLength(6)

      const midwingmen = state.officers.filter((o) => o.rank === 'midwingman')
      expect(midwingmen).toHaveLength(3)

      const genders = new Set(state.officers.map((o) => o.gender))
      expect(genders.has('m')).toBe(true)
      expect(genders.has('f')).toBe(true)

      // The Longwing gate (later task) needs at least one strong female
      // candidate to be possible in every run.
      const strongFemaleCandidate = state.officers.some((o) => o.gender === 'f' && o.skill >= 4)
      expect(strongFemaleCandidate).toBe(true)
    }
  })

  it('creates the three candidates with the binding skill/nerve/patron links', () => {
    const state = newRun(314)
    const midwingmen = state.officers.filter((o) => o.rank === 'midwingman')

    const best = midwingmen.find((o) => o.relatedPatronId === null)
    expect(best).toBeDefined()
    expect(best?.skill).toBe(7)
    expect(best?.nerve).toBe(7)
    expect(best?.relatedPatronId).toBeNull()

    const gratitudePatron = state.patrons.find((p) => p.kind === 'gratitude')!
    const transactionalPatron = state.patrons.find((p) => p.kind === 'transactional')!

    const gratitudeRelative = midwingmen.find((o) => o.relatedPatronId === gratitudePatron.id)
    expect(gratitudeRelative).toBeDefined()
    expect(gratitudeRelative?.skill).toBe(4)

    const transactionalRelative = midwingmen.find((o) => o.relatedPatronId === transactionalPatron.id)
    expect(transactionalRelative).toBeDefined()
    expect(transactionalRelative?.skill).toBe(4)
  })

  it('gives every entity a unique id and leaves nextId past the entity count', () => {
    const state = newRun(2718)
    const ids = [
      ...state.officers.map((o) => o.id),
      ...state.patrons.map((p) => p.id),
      ...state.pendingCards.map((c) => c.id),
    ]
    expect(new Set(ids).size).toBe(ids.length)
    expect(state.nextId).toBeGreaterThan(ids.length)
  })

  it('sets the expected starting resource/state values', () => {
    const state = newRun(2026)
    expect(state.coin).toBe(60)
    expect(state.feed).toBe(0)
    expect(state.treasure).toBe(0)
    expect(state.standing).toBe(5)
    expect(state.expectation).toBe(0)
    expect(state.rung).toBe(1)
    expect(state.warHeat).toBe(0)
    expect(state.tickCount).toBe(0)
    expect(state.day).toBe(0)
    expect(state.status).toBe('running')
    expect(state.ending).toBeNull()
    expect(state.score).toBe(0)
    expect(state.failStreakDays).toBe(0)
    expect(state.finaleStarted).toBe(false)
    expect(state.flags).toEqual({})
    expect(state.log).toHaveLength(1)
    expect(state.missions).toHaveLength(0)
    expect(state.auction).toBeNull()
  })
})
