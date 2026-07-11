import { describe, it, expect } from 'vitest'
import { newRun } from '../src/sim/newRun'
import { tick } from '../src/sim/tick'
import { createRng } from '../src/sim/rng'
import { chooseCardOption, auctionSpendGoodwill, declineMission } from '../src/sim/actions'
import { CARDS, tickCards } from '../src/sim/cards'
import { hatchEgg, auctionClaim, startAuction } from '../src/sim/auction'
import {
  TICKS_PER_DAY,
  SPONSOR_KIN_GOODWILL,
  SPONSOR_KIN_GOODWILL_NEW,
  INSURANCE_MORALE_COST,
  INSURANCE_DECLINE_MORALE,
  BYPASS_CONSOLE_COST,
  BYPASS_CONSOLE_MORALE,
  BYPASS_MORALE_COST,
  TRIBUTE_COST,
  TRIBUTE_GOODWILL,
  TRIBUTE_DEMAND_INTERVAL_DAYS,
  GIFT_TIER_MIN,
} from '../src/sim/balance'
import type { CardInstance, GameState, Mission } from '../src/sim/types'

function findCandidates(state: GameState) {
  const gratitude = state.patrons.find((p) => p.kind === 'gratitude')!
  const transactional = state.patrons.find((p) => p.kind === 'transactional')!
  const best = state.officers.find((o) => o.rank === 'midwingman' && o.relatedPatronId === null)!
  const gratitudeRelative = state.officers.find((o) => o.relatedPatronId === gratitude.id)!
  const transactionalRelative = state.officers.find((o) => o.relatedPatronId === transactional.id)!
  return { gratitude, transactional, best, gratitudeRelative, transactionalRelative }
}

describe('sponsorship card', () => {
  it('option 0 (best candidate): transactional -1, gratitude untouched, correct flags and card removal', () => {
    const state = newRun(1)
    const { gratitude, transactional, best } = findCandidates(state)
    const card = state.pendingCards.find((c) => c.templateId === 'sponsorship')!

    chooseCardOption(state, card.id, 0)

    expect(transactional.tier).toBe(-1)
    expect(transactional.goodwill).toBe(0)
    expect(transactional.memory).toBe('Remembers: you passed over his nephew.')
    expect(gratitude.tier).toBe(1)
    expect(gratitude.goodwill).toBe(4)
    expect(state.flags['sponsorship-done']).toBe(true)
    expect(state.flags[`sponsored:${best.id}`]).toBe(true)
    expect(state.pendingCards).toHaveLength(0)
  })

  it('option 1 (gratitude patron\'s relative): gratitude +2 goodwill/memory, transactional -1', () => {
    const state = newRun(1)
    const { gratitude, transactional, gratitudeRelative } = findCandidates(state)
    const card = state.pendingCards.find((c) => c.templateId === 'sponsorship')!

    chooseCardOption(state, card.id, 1)

    expect(gratitude.tier).toBe(1)
    expect(gratitude.goodwill).toBe(4 + SPONSOR_KIN_GOODWILL)
    expect(gratitude.memory).toBe('Remembers: you stood by her family.')
    expect(transactional.tier).toBe(-1)
    expect(transactional.goodwill).toBe(0)
    expect(transactional.memory).toBe('Remembers: you passed over his nephew.')
    expect(state.flags['sponsorship-done']).toBe(true)
    expect(state.flags[`sponsored:${gratitudeRelative.id}`]).toBe(true)
  })

  it('option 2 (transactional patron\'s relative): transactional +1 tier, +4 goodwill, gratitude untouched', () => {
    const state = newRun(1)
    const { gratitude, transactional, transactionalRelative } = findCandidates(state)
    const card = state.pendingCards.find((c) => c.templateId === 'sponsorship')!

    chooseCardOption(state, card.id, 2)

    expect(transactional.tier).toBe(1)
    expect(transactional.goodwill).toBe(SPONSOR_KIN_GOODWILL_NEW)
    expect(transactional.memory).toBe('Remembers: you advanced his nephew.')
    expect(gratitude.tier).toBe(1)
    expect(gratitude.goodwill).toBe(4)
    expect(state.flags['sponsorship-done']).toBe(true)
    expect(state.flags[`sponsored:${transactionalRelative.id}`]).toBe(true)
  })
})

describe('FTUE spine end-to-end', () => {
  it('sponsor best candidate -> auction fires -> goodwill spend cools gratitude -> claim -> hatch -> welcome', () => {
    const state = newRun(1)
    const { gratitude } = findCandidates(state)
    const sponsorCard = state.pendingCards.find((c) => c.templateId === 'sponsorship')!
    chooseCardOption(state, sponsorCard.id, 0) // best candidate — a stranger to every patron

    // Tick until the scripted first auction fires.
    let guard = 0
    while (!state.auction && guard < 20) {
      tick(state)
      guard += 1
    }
    expect(state.auction).not.toBeNull()
    expect(gratitude.tier).toBe(1)

    // Tick until only the winchester remains (the scripted FTUE guarantee:
    // you are never top before this — see auction.test.ts), then spend the
    // gratitude patron's goodwill on this stranger; that flips you above the
    // last holdout and cools her by one tier.
    guard = 0
    let spent = false
    let claimed = false
    while (guard < 300) {
      if (!state.auction || state.auction.concluded) break
      tick(state)
      guard += 1
      const a = state.auction
      if (!a || a.concluded) break

      if (!spent) {
        const unclaimed = a.eggs.filter((e) => e.claimedBy === null)
        if (unclaimed.length === 1 && unclaimed[0].breed === 'winchester' && a.bidders.some((b) => !b.you)) {
          auctionSpendGoodwill(state, gratitude.id)
          spent = true
        }
      } else if (a.bidders[0]?.you && a.nextClaimIn <= 0) {
        auctionClaim(state, 'winchester')
        claimed = true
        break
      }
    }
    expect(spent).toBe(true)
    expect(claimed).toBe(true)
    expect(gratitude.tier).toBe(0)
    expect(state.auction?.wonBreed).toBe('winchester')

    // Tick through the incubation phase to the hatching card.
    guard = 0
    while (state.auction && guard < 50) {
      tick(state)
      guard += 1
    }
    const hatchCard = state.pendingCards.find((c) => c.templateId === 'hatching')!
    expect(hatchCard).toBeDefined()
    expect(hatchCard.params.breed).toBe('winchester')

    chooseCardOption(state, hatchCard.id, 0) // welcome them to the covert

    expect(state.dragons).toHaveLength(1)
    const dragon = state.dragons[0]
    const captain = state.officers.find((o) => o.id === dragon.captainId)!
    expect(captain.rank).toBe('captain')
    expect(captain.dragonId).toBe(dragon.id)
  })
})

describe('insurance-officer card', () => {
  /** Hatches officers[0] then officers[2] as captains (both start midwingman,
   * so neither hatch can trigger a bypassed-officer card), leaving officers[1]
   * free to be promoted to lieutenant afterward as the insurance candidate. */
  function twoDragonState(seed: number): GameState {
    const state = newRun(seed)
    state.pendingCards = []
    hatchEgg(state, createRng(1), 'winchester', state.officers[0].id)
    hatchEgg(state, createRng(2), 'greyling', state.officers[2].id)
    state.pendingCards = [] // guard against any incidental card from the hatches above
    return state
  }

  it('does not fire with only one dragon, even with a lieutenant available', () => {
    const state = newRun(5)
    state.pendingCards = []
    hatchEgg(state, createRng(1), 'winchester', state.officers[0].id)
    state.pendingCards = []
    state.officers[1].rank = 'lieutenant'
    state.tickCount = TICKS_PER_DAY
    state.day = 1

    tickCards(state, createRng(1))
    expect(state.pendingCards.some((c) => c.templateId === 'insurance-officer')).toBe(false)
  })

  it('fires once with 2+ dragons and a non-captain lieutenant, naming the right officer/dragon', () => {
    const state = twoDragonState(6)
    state.officers[1].rank = 'lieutenant'
    state.tickCount = TICKS_PER_DAY
    state.day = 1

    tickCards(state, createRng(1))
    const card = state.pendingCards.find((c) => c.templateId === 'insurance-officer')
    expect(card).toBeDefined()
    expect(card!.params.officerId).toBe(state.officers[1].id)
    expect(state.flags['insurance-offered']).toBe(true)

    // A second call must not push a duplicate.
    state.pendingCards = state.pendingCards.filter((c) => c !== card)
    state.tickCount = TICKS_PER_DAY * 2
    state.day = 2
    tickCards(state, createRng(1))
    expect(state.pendingCards.some((c) => c.templateId === 'insurance-officer')).toBe(false)
  })

  it('"bench" sets the insurance flag and costs morale', () => {
    const state = twoDragonState(7)
    state.officers[1].rank = 'lieutenant'
    state.tickCount = TICKS_PER_DAY
    state.day = 1
    tickCards(state, createRng(1))
    const card = state.pendingCards.find((c) => c.templateId === 'insurance-officer')!
    const officer = state.officers.find((o) => o.id === card.params.officerId)!
    const dragonId = String(card.params.dragonId)
    const moraleBefore = officer.morale

    chooseCardOption(state, card.id, 0)

    expect(state.flags[`insurance:${dragonId}`]).toBe(true)
    expect(officer.morale).toBe(moraleBefore - INSURANCE_MORALE_COST)
  })

  it('does not fire while an auction is live; fires once the auction resolves', () => {
    const state = twoDragonState(30)
    state.officers[1].rank = 'lieutenant' // insurance-eligible from here on
    state.tickCount = TICKS_PER_DAY
    state.day = 1

    // A live auction suppresses the trigger entirely.
    startAuction(state, createRng(1), ['grey-copper'], state.officers[4].id)
    tickCards(state, createRng(1))
    expect(state.pendingCards).toHaveLength(0)
    expect(state.flags['insurance-offered']).toBeUndefined()

    // Once the auction resolves, the same trigger fires on the next day boundary.
    state.auction = null
    state.tickCount = TICKS_PER_DAY * 2
    state.day = 2
    tickCards(state, createRng(1))
    expect(state.pendingCards.some((c) => c.templateId === 'insurance-officer')).toBe(true)
  })

  it('"let them fly" gives a morale bonus and sets no flag', () => {
    const state = twoDragonState(8)
    state.officers[1].rank = 'lieutenant'
    state.tickCount = TICKS_PER_DAY
    state.day = 1
    tickCards(state, createRng(1))
    const card = state.pendingCards.find((c) => c.templateId === 'insurance-officer')!
    const officer = state.officers.find((o) => o.id === card.params.officerId)!
    const dragonId = String(card.params.dragonId)
    const moraleBefore = officer.morale

    chooseCardOption(state, card.id, 1)

    expect(officer.morale).toBe(Math.min(100, moraleBefore + INSURANCE_DECLINE_MORALE))
    expect(state.flags[`insurance:${dragonId}`]).toBeUndefined()
  })
})

describe('bypassed-officer card', () => {
  it('fires when a second captaincy leapfrogs a higher-ranked living officer', () => {
    const state = newRun(9)
    state.pendingCards = []
    hatchEgg(state, createRng(1), 'winchester', state.officers[0].id)
    state.pendingCards = []
    state.officers[4].rank = 'lieutenant' // outranks the runner about to be promoted

    hatchEgg(state, createRng(2), 'greyling', state.officers[3].id) // a runner leapfrogs the lieutenant

    const card = state.pendingCards.find((c) => c.templateId === 'bypassed-officer')
    expect(card).toBeDefined()
    expect(card!.params.bypassedId).toBe(state.officers[4].id)
    expect(card!.params.newCaptainId).toBe(state.officers[3].id)
  })

  it('does not fire on the very first captaincy of the covert', () => {
    const state = newRun(10)
    state.pendingCards = []
    state.officers[4].rank = 'lieutenant'

    hatchEgg(state, createRng(1), 'winchester', state.officers[3].id) // first-ever dragon

    expect(state.pendingCards.some((c) => c.templateId === 'bypassed-officer')).toBe(false)
  })

  function bypassedState(seed: number): GameState {
    const state = newRun(seed)
    state.pendingCards = []
    hatchEgg(state, createRng(1), 'winchester', state.officers[0].id)
    state.pendingCards = []
    state.officers[4].rank = 'lieutenant'
    hatchEgg(state, createRng(2), 'greyling', state.officers[3].id)
    return state
  }

  it('"console with a purse" costs coin, gives morale, disabled when coin is short', () => {
    const state = bypassedState(11)
    const card = state.pendingCards.find((c) => c.templateId === 'bypassed-officer')!
    const bypassed = state.officers.find((o) => o.id === card.params.bypassedId)!

    const disabledOptions = CARDS['bypassed-officer'].options({ ...state, coin: BYPASS_CONSOLE_COST - 1 }, card.params)
    expect(disabledOptions[0].enabled).toBe(false)

    const coinBefore = state.coin
    const moraleBefore = bypassed.morale
    chooseCardOption(state, card.id, 0)
    expect(state.coin).toBe(coinBefore - BYPASS_CONSOLE_COST)
    expect(bypassed.morale).toBe(Math.min(100, moraleBefore + BYPASS_CONSOLE_MORALE))
  })

  it('"let it stand" costs morale', () => {
    const state = bypassedState(12)
    const card = state.pendingCards.find((c) => c.templateId === 'bypassed-officer')!
    const bypassed = state.officers.find((o) => o.id === card.params.bypassedId)!
    const moraleBefore = bypassed.morale

    chooseCardOption(state, card.id, 1)

    expect(bypassed.morale).toBe(Math.max(0, moraleBefore - BYPASS_MORALE_COST))
  })
})

describe('tribute-demand card', () => {
  it('fires only at transactional tier >= 1, on the interval cadence', () => {
    const state = newRun(13)
    state.pendingCards = []
    const transactional = state.patrons.find((p) => p.kind === 'transactional')!
    transactional.tier = 0
    state.day = TRIBUTE_DEMAND_INTERVAL_DAYS
    state.tickCount = TRIBUTE_DEMAND_INTERVAL_DAYS * TICKS_PER_DAY

    tickCards(state, createRng(1))
    expect(state.pendingCards.some((c) => c.templateId === 'tribute-demand')).toBe(false)

    transactional.tier = 1
    tickCards(state, createRng(1))
    const card = state.pendingCards.find((c) => c.templateId === 'tribute-demand')
    expect(card).toBeDefined()
    expect(card!.params.patronId).toBe(transactional.id)
  })

  it('does not fire off the 60-day cadence', () => {
    const state = newRun(14)
    state.pendingCards = []
    const transactional = state.patrons.find((p) => p.kind === 'transactional')!
    transactional.tier = 1
    state.day = TRIBUTE_DEMAND_INTERVAL_DAYS - 1
    state.tickCount = (TRIBUTE_DEMAND_INTERVAL_DAYS - 1) * TICKS_PER_DAY

    tickCards(state, createRng(1))
    expect(state.pendingCards.some((c) => c.templateId === 'tribute-demand')).toBe(false)
  })

  it('pay path: deducts coin, earns goodwill; disabled when coin is short', () => {
    const state = newRun(15)
    state.pendingCards = []
    const transactional = state.patrons.find((p) => p.kind === 'transactional')!
    transactional.tier = 1
    state.day = TRIBUTE_DEMAND_INTERVAL_DAYS
    state.tickCount = TRIBUTE_DEMAND_INTERVAL_DAYS * TICKS_PER_DAY
    tickCards(state, createRng(1))
    const card = state.pendingCards.find((c) => c.templateId === 'tribute-demand')!

    const shortOptions = CARDS['tribute-demand'].options({ ...state, coin: TRIBUTE_COST - 1 }, card.params)
    expect(shortOptions[0].enabled).toBe(false)

    const coinBefore = state.coin
    const goodwillBefore = transactional.goodwill
    expect(state.coin).toBeGreaterThanOrEqual(TRIBUTE_COST)
    chooseCardOption(state, card.id, 0)
    expect(state.coin).toBe(coinBefore - TRIBUTE_COST)
    expect(transactional.goodwill).toBe(Math.min(10, goodwillBefore + TRIBUTE_GOODWILL))
  })

  it('refuse path: drops tier by 1', () => {
    const state = newRun(16)
    state.pendingCards = []
    const transactional = state.patrons.find((p) => p.kind === 'transactional')!
    transactional.tier = 1
    state.day = TRIBUTE_DEMAND_INTERVAL_DAYS
    state.tickCount = TRIBUTE_DEMAND_INTERVAL_DAYS * TICKS_PER_DAY
    tickCards(state, createRng(1))
    const card = state.pendingCards.find((c) => c.templateId === 'tribute-demand')!

    chooseCardOption(state, card.id, 1)
    expect(transactional.tier).toBe(0)
  })

  it('drops the stale tribute-done marker when the next demand fires', () => {
    const state = newRun(22)
    state.pendingCards = []
    const transactional = state.patrons.find((p) => p.kind === 'transactional')!
    transactional.tier = 1

    state.day = TRIBUTE_DEMAND_INTERVAL_DAYS
    state.tickCount = TRIBUTE_DEMAND_INTERVAL_DAYS * TICKS_PER_DAY
    tickCards(state, createRng(1))
    expect(state.flags[`tribute-done-${TRIBUTE_DEMAND_INTERVAL_DAYS}`]).toBe(true)
    chooseCardOption(state, state.pendingCards[0].id, 1)

    state.day = TRIBUTE_DEMAND_INTERVAL_DAYS * 2
    state.tickCount = TRIBUTE_DEMAND_INTERVAL_DAYS * 2 * TICKS_PER_DAY
    transactional.tier = 1 // refuse dropped it; re-warm to re-arm the cadence
    tickCards(state, createRng(1))
    expect(state.flags[`tribute-done-${TRIBUTE_DEMAND_INTERVAL_DAYS * 2}`]).toBe(true)
    expect(state.flags[`tribute-done-${TRIBUTE_DEMAND_INTERVAL_DAYS}`]).toBeUndefined()
  })
})

describe('trap-warning card', () => {
  function missionWithTrap(state: GameState): Mission {
    const id = `m${state.nextId}`
    state.nextId += 1
    const mission: Mission = {
      id,
      name: 'Trap Offer',
      kind: 'dispatch',
      severityTier: 1,
      rewardCoin: 30,
      rewardTreasure: 0,
      rewardStanding: 8,
      patronId: null,
      offerExpiresDay: 9999,
      deadlineDay: 9999,
      durationTicks: 6,
      enemyStrength: 7,
      weather: 0.2,
      status: 'offered',
      assignedDragonId: null,
      returnTick: null,
      outcome: null,
    }
    state.missions.push(mission)
    state.flags[`trap:${id}`] = true
    return mission
  }

  it('fires within a seeded window at gratitude tier >= GIFT_TIER_MIN with an offered trap mission', () => {
    const state = newRun(17)
    state.pendingCards = []
    const gratitude = state.patrons.find((p) => p.kind === 'gratitude')!
    gratitude.tier = GIFT_TIER_MIN
    const mission = missionWithTrap(state)

    const rng = createRng(3)
    let card: CardInstance | undefined
    for (let day = 1; day <= 200 && !card; day++) {
      state.day = day
      state.tickCount = day * TICKS_PER_DAY
      tickCards(state, rng)
      card = state.pendingCards.find((c) => c.templateId === 'trap-warning')
    }

    expect(card).toBeDefined()
    expect(card!.params.missionId).toBe(mission.id)
    expect(state.flags[`warned:${mission.id}`]).toBe(true)
  })

  it('never fires below GIFT_TIER_MIN', () => {
    const state = newRun(18)
    state.pendingCards = []
    const gratitude = state.patrons.find((p) => p.kind === 'gratitude')!
    gratitude.tier = GIFT_TIER_MIN - 1
    missionWithTrap(state)

    const rng = createRng(3)
    for (let day = 1; day <= 200; day++) {
      state.day = day
      state.tickCount = day * TICKS_PER_DAY
      tickCards(state, rng)
    }
    expect(state.pendingCards.some((c) => c.templateId === 'trap-warning')).toBe(false)
  })

  it('heeding the warning removes the mission and its trap flag', () => {
    const state = newRun(19)
    state.pendingCards = []
    const gratitude = state.patrons.find((p) => p.kind === 'gratitude')!
    gratitude.tier = GIFT_TIER_MIN
    const mission = missionWithTrap(state)

    const rng = createRng(3)
    let card: CardInstance | undefined
    for (let day = 1; day <= 200 && !card; day++) {
      state.day = day
      state.tickCount = day * TICKS_PER_DAY
      tickCards(state, rng)
      card = state.pendingCards.find((c) => c.templateId === 'trap-warning')
    }
    expect(card).toBeDefined()

    chooseCardOption(state, card!.id, 0)

    expect(state.missions.find((m) => m.id === mission.id)).toBeUndefined()
    expect(state.flags[`trap:${mission.id}`]).toBeUndefined()
    expect(state.flags[`warned:${mission.id}`]).toBeUndefined()
    // The log names the actual rival patron, not a hardcoded string.
    const rival = state.patrons.find((p) => p.kind === 'rival')!
    const line = state.log[state.log.length - 1]
    expect(line.text).toContain(rival.name)
  })

  it('declining a warned trap mission directly also cleans up the warned flag', () => {
    const state = newRun(24)
    state.pendingCards = []
    const mission = missionWithTrap(state)
    state.flags[`warned:${mission.id}`] = true // as if the warning card had fired

    declineMission(state, mission.id)

    expect(state.missions.find((m) => m.id === mission.id)).toBeUndefined()
    expect(state.flags[`trap:${mission.id}`]).toBeUndefined()
    expect(state.flags[`warned:${mission.id}`]).toBeUndefined()
  })
})

describe('tickCards one-per-day rule', () => {
  it('pushes at most one card even when multiple triggers are eligible simultaneously', () => {
    const state = newRun(20)
    state.pendingCards = []
    hatchEgg(state, createRng(1), 'winchester', state.officers[0].id)
    hatchEgg(state, createRng(2), 'greyling', state.officers[2].id)
    state.pendingCards = []
    state.officers[1].rank = 'lieutenant' // insurance-eligible

    const transactional = state.patrons.find((p) => p.kind === 'transactional')!
    transactional.tier = 1 // tribute-eligible on the same day
    state.day = TRIBUTE_DEMAND_INTERVAL_DAYS
    state.tickCount = TRIBUTE_DEMAND_INTERVAL_DAYS * TICKS_PER_DAY

    tickCards(state, createRng(1))

    expect(state.pendingCards).toHaveLength(1)
    // Priority order (3, 5, 6): insurance-officer beats tribute-demand.
    expect(state.pendingCards[0].templateId).toBe('insurance-officer')
  })
})

describe('war-rumor cards', () => {
  it('are registered with escalating flavor and a single note-well option', () => {
    for (const id of ['war-rumor-low', 'war-rumor-mid', 'war-rumor-high']) {
      const template = CARDS[id]
      expect(template).toBeDefined()
      const state = newRun(1)
      expect(template.title(state, {})).toBeTruthy()
      expect(template.body(state, {})).toBeTruthy()
      const options = template.options(state, {})
      expect(options).toHaveLength(1)
      expect(options[0].enabled).toBe(true)
      const before = state.log.length
      options[0].apply(state, createRng(1))
      expect(state.log.length).toBe(before + 1)
    }
  })
})

describe('determinism', () => {
  it('same seed and same scripted choices at the same ticks yield deep-equal state', () => {
    function play(seed: number): GameState {
      const state = newRun(seed)
      const card = state.pendingCards.find((c) => c.templateId === 'sponsorship')!
      chooseCardOption(state, card.id, 0)
      for (let i = 0; i < 30; i++) tick(state)
      return state
    }

    expect(play(555)).toEqual(play(555))
  })
})

describe('chooseCardOption validation (regression)', () => {
  it('throws on an invalid option index and on choosing a disabled option', () => {
    const state = newRun(21)
    const transactional = state.patrons.find((p) => p.kind === 'transactional')!
    transactional.tier = 1
    state.pendingCards = []
    state.day = TRIBUTE_DEMAND_INTERVAL_DAYS
    state.tickCount = TRIBUTE_DEMAND_INTERVAL_DAYS * TICKS_PER_DAY
    tickCards(state, createRng(1))
    const card = state.pendingCards.find((c) => c.templateId === 'tribute-demand')!

    expect(() => chooseCardOption(state, card.id, 99)).toThrow()

    state.coin = 0
    expect(() => chooseCardOption(state, card.id, 0)).toThrow() // pay option disabled: insufficient coin
  })
})
