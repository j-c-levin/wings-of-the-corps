import { describe, it, expect, afterEach } from 'vitest'
import { newRun } from '../src/sim/newRun'
import { tick } from '../src/sim/tick'
import {
  acceptMission,
  declineMission,
  giveTreasure,
  payTribute,
  buyFeed,
  auctionSpendGoodwill,
  chooseCardOption,
} from '../src/sim/actions'
import { CARDS } from '../src/sim/cards'
import type { CardTemplate } from '../src/sim/cards'
import type { Rng } from '../src/sim/rng'
import {
  REFUSAL_WAR_HEAT_GATE,
  REFUSAL_STANDING_COST,
  TRIBUTE_COST,
  TRIBUTE_GOODWILL,
  FEED_PRICE,
  AUCTION_GOODWILL_COST,
  AUCTION_BUMP,
} from '../src/sim/balance'
import type { Auction, Dragon, GameState, Mission } from '../src/sim/types'

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

function makeAuction(state: GameState, overrides: Partial<Auction> = {}): Auction {
  const auction: Auction = {
    eggs: [],
    bidders: [{ name: 'You', influence: 5, you: true }],
    ticksRemaining: 10,
    ticksPerClaim: 5,
    nextClaimIn: 5,
    concluded: false,
    wonBreed: null,
    candidateOfficerId: state.officers[0].id,
    ...overrides,
  }
  state.auction = auction
  return auction
}

describe('acceptMission', () => {
  it('throws for an unknown mission', () => {
    const state = newRun(1)
    const dragon = makeDragon(state)
    expect(() => acceptMission(state, 'nope', dragon.id)).toThrow()
  })

  it('throws when the mission is not offered', () => {
    const state = newRun(2)
    const dragon = makeDragon(state)
    const mission = makeMission(state, { status: 'active' })
    expect(() => acceptMission(state, mission.id, dragon.id)).toThrow()
  })

  it('throws when past the offer expiry day', () => {
    const state = newRun(3)
    const dragon = makeDragon(state)
    const mission = makeMission(state, { offerExpiresDay: 0 })
    state.day = 1
    expect(() => acceptMission(state, mission.id, dragon.id)).toThrow()
  })

  it('throws for an unknown dragon', () => {
    const state = newRun(4)
    const mission = makeMission(state)
    expect(() => acceptMission(state, mission.id, 'nope')).toThrow()
  })

  it('throws when the dragon is not home', () => {
    const state = newRun(5)
    const dragon = makeDragon(state, { status: 'healing' })
    const mission = makeMission(state)
    expect(() => acceptMission(state, mission.id, dragon.id)).toThrow()
  })

  it('departs the mission on the happy path', () => {
    const state = newRun(6)
    const dragon = makeDragon(state)
    const mission = makeMission(state, { durationTicks: 5 })
    const tickCountBefore = state.tickCount

    acceptMission(state, mission.id, dragon.id)

    expect(mission.status).toBe('active')
    expect(mission.assignedDragonId).toBe(dragon.id)
    expect(mission.returnTick).toBe(tickCountBefore + 5)
    expect(dragon.status).toBe('mission')
    expect(dragon.missionId).toBe(mission.id)
  })
})

describe('declineMission', () => {
  it('throws for an unknown mission', () => {
    const state = newRun(10)
    expect(() => declineMission(state, 'nope')).toThrow()
  })

  it('throws when the mission is not offered', () => {
    const state = newRun(11)
    const mission = makeMission(state, { status: 'active' })
    expect(() => declineMission(state, mission.id)).toThrow()
  })

  it('removes the offer', () => {
    const state = newRun(12)
    const mission = makeMission(state)
    declineMission(state, mission.id)
    expect(state.missions.find((m) => m.id === mission.id)).toBeUndefined()
  })

  it('costs standing when warHeat exceeds the refusal gate', () => {
    const state = newRun(13)
    state.warHeat = REFUSAL_WAR_HEAT_GATE + 1
    const mission = makeMission(state)
    const standingBefore = state.standing
    declineMission(state, mission.id)
    expect(state.standing).toBe(Math.max(0, standingBefore - REFUSAL_STANDING_COST))
  })

  it('does not cost standing when warHeat is at or below the gate', () => {
    const state = newRun(14)
    state.warHeat = REFUSAL_WAR_HEAT_GATE
    const mission = makeMission(state)
    const standingBefore = state.standing
    declineMission(state, mission.id)
    expect(state.standing).toBe(standingBefore)
  })

  it('cools a non-trap patron mission by one tier with a memory line', () => {
    const state = newRun(15)
    const patron = state.patrons.find((p) => p.kind === 'gratitude')!
    const tierBefore = patron.tier
    const mission = makeMission(state, { patronId: patron.id })

    declineMission(state, mission.id)

    expect(patron.tier).toBe(tierBefore - 1)
    expect(patron.memory.toLowerCase()).toContain('declined')
  })

  it('declines a trap mission freely, skipping both penalties and clearing the flag', () => {
    const state = newRun(16)
    const rival = state.patrons.find((p) => p.kind === 'rival')!
    const mission = makeMission(state, { patronId: rival.id })
    state.flags[`trap:${mission.id}`] = true
    state.warHeat = REFUSAL_WAR_HEAT_GATE + 1
    const tierBefore = rival.tier
    const standingBefore = state.standing

    declineMission(state, mission.id)

    expect(rival.tier).toBe(tierBefore)
    expect(state.standing).toBe(standingBefore)
    expect(state.flags[`trap:${mission.id}`]).toBeUndefined()
  })
})

describe('giveTreasure', () => {
  it('throws for an unknown dragon', () => {
    const state = newRun(20)
    state.treasure = 5
    expect(() => giveTreasure(state, 'nope')).toThrow()
  })

  it('throws when there is no treasure', () => {
    const state = newRun(21)
    const dragon = makeDragon(state)
    state.treasure = 0
    expect(() => giveTreasure(state, dragon.id)).toThrow()
  })

  it('spends one treasure and raises contentment, clamped at 100', () => {
    const state = newRun(22)
    const dragon = makeDragon(state, { contentment: 95 })
    state.treasure = 2
    giveTreasure(state, dragon.id)
    expect(state.treasure).toBe(1)
    expect(dragon.contentment).toBe(100)
  })
})

describe('payTribute', () => {
  it('throws for an unknown patron', () => {
    const state = newRun(30)
    state.coin = 100
    expect(() => payTribute(state, 'nope')).toThrow()
  })

  it('throws for a non-transactional patron', () => {
    const state = newRun(31)
    const patron = state.patrons.find((p) => p.kind === 'gratitude')!
    state.coin = 100
    expect(() => payTribute(state, patron.id)).toThrow()
  })

  it('throws when coin is insufficient', () => {
    const state = newRun(32)
    const patron = state.patrons.find((p) => p.kind === 'transactional')!
    state.coin = TRIBUTE_COST - 1
    expect(() => payTribute(state, patron.id)).toThrow()
  })

  it('spends coin, grants goodwill, and warms a cold patron to tier 1', () => {
    const state = newRun(33)
    const patron = state.patrons.find((p) => p.kind === 'transactional')!
    patron.tier = 0
    state.coin = 100
    const goodwillBefore = patron.goodwill

    payTribute(state, patron.id)

    expect(state.coin).toBe(100 - TRIBUTE_COST)
    expect(patron.goodwill).toBe(goodwillBefore + TRIBUTE_GOODWILL)
    expect(patron.tier).toBe(1)
    expect(patron.memory.toLowerCase()).toContain('tribute')
  })

  it('does not raise tier further once already at 1 or above', () => {
    const state = newRun(34)
    const patron = state.patrons.find((p) => p.kind === 'transactional')!
    patron.tier = 2
    state.coin = 100

    payTribute(state, patron.id)

    expect(patron.tier).toBe(2)
    expect(patron.memory.toLowerCase()).toContain('tribute')
  })
})

describe('buyFeed', () => {
  it('throws for a non-integer amount', () => {
    const state = newRun(40)
    state.coin = 100
    expect(() => buyFeed(state, 1.5)).toThrow()
  })

  it('throws for a non-positive amount', () => {
    const state = newRun(41)
    state.coin = 100
    expect(() => buyFeed(state, 0)).toThrow()
  })

  it('throws when coin is insufficient', () => {
    const state = newRun(42)
    state.coin = FEED_PRICE - 1
    expect(() => buyFeed(state, 1)).toThrow()
  })

  it('spends coin and adds feed', () => {
    const state = newRun(43)
    state.coin = 100
    state.feed = 5
    buyFeed(state, 3)
    expect(state.coin).toBe(100 - 3 * FEED_PRICE)
    expect(state.feed).toBe(8)
  })
})

describe('auctionSpendGoodwill', () => {
  it('throws when there is no auction', () => {
    const state = newRun(50)
    expect(() => auctionSpendGoodwill(state, state.patrons[0].id)).toThrow()
  })

  it('throws when the auction has concluded', () => {
    const state = newRun(51)
    makeAuction(state, { concluded: true })
    expect(() => auctionSpendGoodwill(state, state.patrons[0].id)).toThrow()
  })

  it('throws for an unknown patron', () => {
    const state = newRun(52)
    makeAuction(state)
    expect(() => auctionSpendGoodwill(state, 'nope')).toThrow()
  })

  it('throws when goodwill is insufficient', () => {
    const state = newRun(53)
    makeAuction(state)
    const patron = state.patrons[0]
    patron.goodwill = AUCTION_GOODWILL_COST - 1
    expect(() => auctionSpendGoodwill(state, patron.id)).toThrow()
  })

  it('spends goodwill for own-interest without cooling tier, and bumps "you" influence', () => {
    const state = newRun(54)
    const patron = state.patrons.find((p) => p.kind === 'gratitude')!
    const candidate = state.officers.find((o) => o.relatedPatronId === patron.id)!
    makeAuction(state, { candidateOfficerId: candidate.id })
    patron.goodwill = 5
    patron.tier = 2
    const you = state.auction!.bidders.find((b) => b.you)!
    const influenceBefore = you.influence

    auctionSpendGoodwill(state, patron.id)

    expect(patron.goodwill).toBe(5 - AUCTION_GOODWILL_COST)
    expect(patron.tier).toBe(2)
    expect(you.influence).toBe(influenceBefore + AUCTION_BUMP)
  })

  it('spends goodwill for a stranger candidate and cools tier by 1', () => {
    const state = newRun(55)
    const patron = state.patrons.find((p) => p.kind === 'gratitude')!
    const stranger = state.officers.find((o) => o.relatedPatronId !== patron.id)!
    makeAuction(state, { candidateOfficerId: stranger.id })
    patron.goodwill = 5
    patron.tier = 2

    auctionSpendGoodwill(state, patron.id)

    expect(patron.tier).toBe(1)
  })
})

describe('chooseCardOption', () => {
  const TEST_KEY = '__test_card__'

  afterEach(() => {
    delete CARDS[TEST_KEY]
  })

  function registerTestCard(apply: (state: GameState, rng: Rng) => void, enabled = true) {
    const template: CardTemplate = {
      title: () => 'Test',
      body: () => 'Test body',
      options: () => [{ label: 'Do it', detail: 'detail', enabled, apply }],
    }
    CARDS[TEST_KEY] = template
  }

  it('throws for an unknown card', () => {
    const state = newRun(60)
    expect(() => chooseCardOption(state, 'nope', 0)).toThrow()
  })

  it('throws when the template is missing from the registry', () => {
    const state = newRun(61)
    state.pendingCards.push({ id: 'c99', templateId: 'does-not-exist', params: {} })
    expect(() => chooseCardOption(state, 'c99', 0)).toThrow()
  })

  it('throws for an invalid option index', () => {
    const state = newRun(62)
    registerTestCard(() => {})
    state.pendingCards.push({ id: 'c100', templateId: TEST_KEY, params: {} })
    expect(() => chooseCardOption(state, 'c100', 5)).toThrow()
  })

  it('throws for a disabled option', () => {
    const state = newRun(63)
    registerTestCard(() => {}, false)
    state.pendingCards.push({ id: 'c101', templateId: TEST_KEY, params: {} })
    expect(() => chooseCardOption(state, 'c101', 0)).toThrow()
  })

  it('applies the option, reconstructs rng, writes back rngState, and removes the card', () => {
    const state = newRun(64)
    let sawRngValue: number | null = null
    registerTestCard((s, rng) => {
      s.coin += 5
      sawRngValue = rng.next()
    })
    state.pendingCards.push({ id: 'c102', templateId: TEST_KEY, params: {} })
    const rngStateBefore = state.rngState
    const coinBefore = state.coin

    chooseCardOption(state, 'c102', 0)

    expect(state.coin).toBe(coinBefore + 5)
    expect(sawRngValue).not.toBeNull()
    expect(state.rngState).not.toBe(rngStateBefore)
    expect(state.pendingCards.find((c) => c.id === 'c102')).toBeUndefined()
  })
})

describe('determinism', () => {
  it('same seed + same action sequence at fixed ticks produces deep-equal state after 200 ticks', () => {
    function build(seed: number): GameState {
      const state = newRun(seed)
      state.pendingCards = []
      const dragon = makeDragon(state)
      const mission = makeMission(state, { durationTicks: 6 })
      acceptMission(state, mission.id, dragon.id)
      return state
    }

    const a = build(777)
    const b = build(777)
    for (let i = 0; i < 200; i++) tick(a)
    for (let i = 0; i < 200; i++) tick(b)
    expect(a).toEqual(b)
  })
})
