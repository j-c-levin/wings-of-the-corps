import { describe, it, expect } from 'vitest'
import { newRun } from '../src/sim/newRun'
import { tick } from '../src/sim/tick'
import { createRng } from '../src/sim/rng'
import { startAuction, tickAuction, auctionClaim, hatchEgg } from '../src/sim/auction'
import { auctionSpendGoodwill } from '../src/sim/actions'
import { RANK_ORDER } from '../src/sim/content'
import {
  AUCTION_GOODWILL_COST,
  AUCTION_RIVALS,
  AUCTION_RETRY_COOLDOWN_DAYS,
  EGG_HATCH_DAYS,
  TICKS_PER_DAY,
  TRAINING_START,
  CONTENTMENT_START,
  RUNG_STANDING,
} from '../src/sim/balance'
import type { BreedId, GameState, Id } from '../src/sim/types'

const FIRST_EGGS: BreedId[] = ['yellow-reaper', 'grey-copper', 'winchester']

/** Opens the scripted FTUE first auction with proper rng round-trip. */
function startScriptedFirst(state: GameState, candidateId: Id): void {
  const rng = createRng(state.rngState)
  startAuction(state, rng, FIRST_EGGS, candidateId, { scripted: true })
  state.rngState = rng.getState()
}

describe('first-auction FTUE guarantee', () => {
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

  it('without a goodwill spend you never win, never lose: the winchester waits behind one holdout (10 seeds)', () => {
    for (const seed of SEEDS) {
      const state = newRun(seed)
      state.pendingCards = []
      startScriptedFirst(state, state.officers[0].id)

      for (let i = 0; i < 200; i++) {
        tick(state)
        // The whole point: without a goodwill spend you are never the top bidder.
        expect(state.auction).not.toBeNull()
        expect(state.auction!.concluded).toBe(false)
        expect(state.auction!.bidders[0]?.you).not.toBe(true)
      }

      // The auction is still live: the winchester unclaimed, exactly one
      // rival holding out above you, no egg won and none lost for good.
      const a = state.auction!
      const unclaimed = a.eggs.filter((e) => e.claimedBy === null)
      expect(unclaimed).toHaveLength(1)
      expect(unclaimed[0].breed).toBe('winchester')
      expect(a.bidders.filter((b) => !b.you)).toHaveLength(1)
      expect(state.dragons).toHaveLength(0)
      expect(state.pendingCards.some((c) => c.templateId === 'hatching')).toBe(false)
      // ... and even now, the holdout blocks a free claim.
      expect(() => auctionClaim(state, 'winchester')).toThrow()
    }
  })

  it('ONE goodwill spend flips you above the field to claim the last winchester (10 seeds)', () => {
    for (const seed of SEEDS) {
      const state = newRun(seed)
      state.pendingCards = []
      startScriptedFirst(state, state.officers[0].id)
      const patron = state.patrons.find((p) => p.goodwill >= AUCTION_GOODWILL_COST)!

      let spent = false
      let claimed = false
      let guard = 0
      while (guard < 300) {
        if (!state.auction || state.auction.concluded) break
        tick(state)
        guard += 1
        const a = state.auction
        if (!a || a.concluded) break

        if (!spent) {
          // Pre-spend invariant: you are never the top bidder.
          expect(a.bidders[0]?.you).not.toBe(true)
          const unclaimed = a.eggs.filter((e) => e.claimedBy === null)
          if (unclaimed.length === 1 && unclaimed[0].breed === 'winchester' && a.bidders.some((b) => !b.you)) {
            auctionSpendGoodwill(state, patron.id)
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
      expect(state.auction?.concluded).toBe(true)
      expect(state.auction?.wonBreed).toBe('winchester')
    }
  })

  it('an EARLY goodwill spend (before any rival has claimed) still only ever secures the winchester (10 seeds)', () => {
    // Regression: spending goodwill immediately makes you the top bidder
    // right away. Rivals must still settle yellow-reaper and grey-copper
    // between themselves before your candidate can claim anything — the
    // "last pick, always a tiny messenger dragon" promise must hold
    // regardless of when the spend happens, not just when it happens late.
    for (const seed of SEEDS) {
      const state = newRun(seed)
      state.pendingCards = []
      startScriptedFirst(state, state.officers[0].id)
      const patron = state.patrons.find((p) => p.goodwill >= AUCTION_GOODWILL_COST)!

      // Spend before a single tick has run.
      auctionSpendGoodwill(state, patron.id)

      let claimed = false
      let guard = 0
      while (guard < 300) {
        if (!state.auction || state.auction.concluded) break
        tick(state)
        guard += 1
        const a = state.auction
        if (!a || a.concluded) break

        // Never allowed to claim while a better egg is still unclaimed.
        const unclaimed = a.eggs.filter((e) => e.claimedBy === null)
        if (unclaimed.length > 1) {
          expect(() => auctionClaim(state, unclaimed[0].breed)).toThrow()
        }

        if (a.bidders[0]?.you && a.nextClaimIn <= 0) {
          expect(unclaimed).toHaveLength(1)
          expect(unclaimed[0].breed).toBe('winchester')
          auctionClaim(state, 'winchester')
          claimed = true
          break
        }
      }

      expect(claimed).toBe(true)
      expect(state.auction?.concluded).toBe(true)
      expect(state.auction?.wonBreed).toBe('winchester')
    }
  })
})

describe('rival claims', () => {
  it('the top rival takes the best unclaimed egg and leaves the field, best-first', () => {
    const state = newRun(42)
    state.pendingCards = []
    startScriptedFirst(state, state.officers[0].id)

    let guard = 0
    while (
      state.auction &&
      !state.auction.concluded &&
      state.auction.eggs.filter((e) => e.claimedBy !== null).length < 2 &&
      guard < 100
    ) {
      tick(state)
      guard += 1
    }

    const a = state.auction!
    // Eggs claimed strictly best-first: the first two go, the winchester stays.
    expect(a.eggs[0].claimedBy).not.toBeNull()
    expect(a.eggs[1].claimedBy).not.toBeNull()
    expect(a.eggs[2].claimedBy).toBeNull()
    // Two rivals have left the field.
    expect(a.bidders.length).toBe(AUCTION_RIVALS + 1 - 2)
    // The claimers are rivals, not your candidate.
    const youName = a.bidders.find((b) => b.you)!.name
    expect(a.eggs[0].claimedBy).not.toBe(youName)
    expect(a.eggs[1].claimedBy).not.toBe(youName)
  })
})

describe('auctionClaim validation', () => {
  it('throws when there is no live auction', () => {
    const state = newRun(1)
    expect(() => auctionClaim(state, 'winchester')).toThrow()
  })

  it('throws for a breed that is not an unclaimed egg', () => {
    const state = newRun(1)
    state.pendingCards = []
    startScriptedFirst(state, state.officers[0].id)
    expect(() => auctionClaim(state, 'kazilik')).toThrow()
  })

  it('throws when the chosen egg is already claimed by a rival', () => {
    const state = newRun(2)
    state.pendingCards = []
    startScriptedFirst(state, state.officers[0].id)
    let guard = 0
    while (state.auction && state.auction.eggs[0].claimedBy === null && guard < 50) {
      tick(state)
      guard += 1
    }
    expect(state.auction!.eggs[0].claimedBy).not.toBeNull()
    expect(() => auctionClaim(state, state.auction!.eggs[0].breed)).toThrow()
  })

  it('throws when you are not the top bidder (rivals still ahead)', () => {
    const state = newRun(3)
    state.pendingCards = []
    startScriptedFirst(state, state.officers[0].id)
    tick(state) // one tick: rivals sit above your candidate
    expect(state.auction!.bidders[0].you).toBe(false)
    expect(() => auctionClaim(state, 'winchester')).toThrow()
  })

  it('throws when you are top but not at a claim boundary and rivals remain', () => {
    const state = newRun(4)
    state.pendingCards = []
    startScriptedFirst(state, state.officers[0].id)
    const patron = state.patrons.find((p) => p.goodwill >= AUCTION_GOODWILL_COST)!

    // Advance to only the winchester remaining, then spend to jump the field.
    let guard = 0
    let spent = false
    while (guard < 200) {
      if (!state.auction || state.auction.concluded) break
      tick(state)
      guard += 1
      const a = state.auction
      if (!a || a.concluded) break
      const unclaimed = a.eggs.filter((e) => e.claimedBy === null)
      if (unclaimed.length === 1 && a.bidders.some((b) => !b.you)) {
        auctionSpendGoodwill(state, patron.id)
        spent = true
        break
      }
    }
    expect(spent).toBe(true)
    // One more tick puts you on top, but mid-interval (nextClaimIn > 0).
    tick(state)
    expect(state.auction!.bidders[0].you).toBe(true)
    expect(state.auction!.nextClaimIn).toBeGreaterThan(0)
    expect(() => auctionClaim(state, 'winchester')).toThrow()
  })
})

describe('egg phase', () => {
  function winWinchester(seed: number): GameState {
    const state = newRun(seed)
    state.pendingCards = []
    startScriptedFirst(state, state.officers[0].id)
    const patron = state.patrons.find((p) => p.goodwill >= AUCTION_GOODWILL_COST)!
    let spent = false
    let guard = 0
    while (guard < 300) {
      if (!state.auction || state.auction.concluded) break
      tick(state)
      guard += 1
      const a = state.auction
      if (!a || a.concluded) break
      if (!spent) {
        const unclaimed = a.eggs.filter((e) => e.claimedBy === null)
        if (unclaimed.length === 1 && unclaimed[0].breed === 'winchester' && a.bidders.some((b) => !b.you)) {
          auctionSpendGoodwill(state, patron.id)
          spent = true
        }
      } else if (a.bidders[0]?.you && a.nextClaimIn <= 0) {
        auctionClaim(state, 'winchester')
        break
      }
    }
    return state
  }

  it('claiming concludes the auction into an incubation countdown, then fires a hatching card', () => {
    const state = winWinchester(5)
    expect(state.auction?.concluded).toBe(true)
    expect(state.auction?.wonBreed).toBe('winchester')
    expect(state.auction?.ticksRemaining).toBe(EGG_HATCH_DAYS * TICKS_PER_DAY)

    for (let i = 0; i < EGG_HATCH_DAYS * TICKS_PER_DAY; i++) tick(state)

    expect(state.auction).toBeNull()
    const card = state.pendingCards.find((c) => c.templateId === 'hatching')
    expect(card).toBeDefined()
    expect(card!.params.breed).toBe('winchester')
    expect(card!.params.officerId).toBe(state.officers[0].id)
  })
})

describe('scheduling', () => {
  it('fires the scripted first auction, recovering the candidate from the sponsored flag', () => {
    const state = newRun(1)
    state.pendingCards = []
    state.tickCount = TICKS_PER_DAY // a day boundary
    state.flags['sponsorship-done'] = true
    state.flags[`sponsored:${state.officers[0].id}`] = true

    tickAuction(state, createRng(1))

    expect(state.auction).not.toBeNull()
    expect(state.flags['first-auction']).toBe(true)
    expect(state.flags['first-auction-held']).toBe(true)
    expect(state.auction!.candidateOfficerId).toBe(state.officers[0].id)
    expect(state.auction!.eggs.map((e) => e.breed)).toEqual(['yellow-reaper', 'grey-copper', 'winchester'])
  })

  it('does not fire a rung-2 auction below the standing gate, and does once it is met', () => {
    const state = newRun(1)
    state.pendingCards = []
    state.tickCount = TICKS_PER_DAY // a day boundary
    // A junior becomes the first captain so the midwingman candidates stay free.
    hatchEgg(state, createRng(5), 'winchester', state.officers[3].id)
    state.rung = 1
    state.standing = RUNG_STANDING[2] - 5

    tickAuction(state, createRng(1))
    expect(state.auction).toBeNull()

    state.standing = RUNG_STANDING[2] + 5
    tickAuction(state, createRng(1))
    expect(state.auction).not.toBeNull()
    expect(state.flags['auction-2-held']).toBe(true)

    const cand = state.officers.find((o) => o.id === state.auction!.candidateOfficerId)!
    expect(RANK_ORDER[cand.rank]).toBeGreaterThanOrEqual(RANK_ORDER['midwingman'])
  })

  function rung3State(): GameState {
    const state = newRun(1)
    state.pendingCards = []
    state.tickCount = TICKS_PER_DAY
    state.rung = 2
    state.standing = RUNG_STANDING[3] + 5
    // Only officers 0 and 1 will be lieutenant-eligible; keep the rest below.
    return state
  }

  it('offers a longwing when the top eligible candidate is female', () => {
    const state = rung3State()
    Object.assign(state.officers[0], { rank: 'lieutenant', gender: 'f', skill: 7, dragonId: null })
    tickAuction(state, createRng(1))
    const a = state.auction!
    expect(a.eggs.map((e) => e.breed)).toContain('longwing')
    expect(state.officers.find((o) => o.id === a.candidateOfficerId)!.gender).toBe('f')
  })

  it('offers a longwing to a within-slack female even when the top candidate is male', () => {
    const state = rung3State()
    Object.assign(state.officers[0], { rank: 'lieutenant', gender: 'm', skill: 7, dragonId: null })
    Object.assign(state.officers[1], { rank: 'lieutenant', gender: 'f', skill: 6, dragonId: null })
    tickAuction(state, createRng(1))
    const a = state.auction!
    expect(a.eggs.map((e) => e.breed)).toContain('longwing')
    // The female within slack becomes the auction candidate.
    expect(a.candidateOfficerId).toBe(state.officers[1].id)
  })

  it('re-fires a lost rung-2 auction only after the retry cooldown', () => {
    const state = newRun(11)
    state.pendingCards = []
    state.tickCount = TICKS_PER_DAY // a day boundary
    state.day = 1
    hatchEgg(state, createRng(5), 'winchester', state.officers[3].id)
    state.rung = 1
    state.standing = RUNG_STANDING[2] + 5

    tickAuction(state, createRng(1))
    expect(state.auction).not.toBeNull()

    // Sink your candidate so every egg goes to a rival and the auction is lost.
    state.auction!.bidders.find((b) => b.you)!.influence = 0
    let guard = 0
    while (state.auction && guard < 100) {
      tick(state)
      guard += 1
    }
    expect(state.auction).toBeNull()
    expect(state.dragons).toHaveLength(1) // no new egg won

    // The held flag is lifted and replaced by a retry-day marker.
    expect(state.flags['auction-2-held']).toBeUndefined()
    const retryKey = Object.keys(state.flags).find((k) => k.startsWith('auction-2-retry-day-'))!
    expect(retryKey).toBeDefined()
    const retryDay = Number(retryKey.slice('auction-2-retry-day-'.length))
    expect(retryDay).toBe(state.day + AUCTION_RETRY_COOLDOWN_DAYS)

    // The day before the cooldown ends: still blocked.
    state.tickCount = (retryDay - 1) * TICKS_PER_DAY
    state.day = retryDay - 1
    tickAuction(state, createRng(2))
    expect(state.auction).toBeNull()
    expect(state.flags[retryKey]).toBe(true)

    // On the cooldown day: the auction fires again and consumes the marker.
    state.tickCount = retryDay * TICKS_PER_DAY
    state.day = retryDay
    tickAuction(state, createRng(2))
    expect(state.auction).not.toBeNull()
    expect(state.flags[retryKey]).toBeUndefined()
    expect(state.flags['auction-2-held']).toBe(true)
  })

  it('a rung-2 auction is winnable on merit — top at a boundary with no goodwill spend (seeded)', () => {
    // Seed 85 verified by sweep: with top standing and a skill-10 candidate,
    // rival jitter lets you lead at a claim boundary without spending goodwill.
    // (Reswept for Task 8's tickWar, which now draws from the shared rng
    // stream on every day boundary and so shifts downstream auction jitter.)
    const state = newRun(85)
    state.pendingCards = []
    state.tickCount = TICKS_PER_DAY
    state.day = 1
    hatchEgg(state, createRng(5), 'winchester', state.officers[3].id)
    state.rung = 1
    state.standing = 100
    state.officers[0].skill = 10
    const r = createRng(state.rngState)
    tickAuction(state, r)
    state.rngState = r.getState()
    expect(state.auction).not.toBeNull()
    const goodwillBefore = state.patrons.map((p) => p.goodwill)

    let won = false
    let guard = 0
    while (state.auction && !state.auction.concluded && guard < 60) {
      tick(state)
      guard += 1
      const a = state.auction
      if (a && !a.concluded && a.bidders[0]?.you && a.nextClaimIn <= 0) {
        const egg = a.eggs.find((e) => e.claimedBy === null)!
        auctionClaim(state, egg.breed)
        won = true
        break
      }
    }

    expect(won).toBe(true)
    expect(state.auction?.concluded).toBe(true)
    expect(state.auction?.wonBreed).not.toBeNull()
    // No goodwill was spent anywhere along the way.
    expect(state.patrons.map((p) => p.goodwill)).toEqual(goodwillBefore)
  })

  it('omits the longwing when the top candidate is male and no female is within slack', () => {
    const state = rung3State()
    Object.assign(state.officers[0], { rank: 'lieutenant', gender: 'm', skill: 9, dragonId: null })
    Object.assign(state.officers[1], { rank: 'lieutenant', gender: 'f', skill: 5, dragonId: null })
    tickAuction(state, createRng(1))
    const a = state.auction!
    expect(a.eggs.map((e) => e.breed)).not.toContain('longwing')
    expect(a.eggs.map((e) => e.breed)).toEqual(['chequered-nettle'])
    expect(a.candidateOfficerId).toBe(state.officers[0].id)
  })
})

describe('hatchEgg', () => {
  it('creates a dragon bonded to its officer, who becomes captain', () => {
    const state = newRun(1)
    const officer = state.officers[0]
    hatchEgg(state, createRng(123), 'winchester', officer.id)

    expect(state.dragons).toHaveLength(1)
    const d = state.dragons[0]
    expect(d.captainId).toBe(officer.id)
    expect(d.training).toBe(TRAINING_START)
    expect(d.contentment).toBe(CONTENTMENT_START)
    expect(d.status).toBe('home')
    expect(officer.rank).toBe('captain')
    expect(officer.dragonId).toBe(d.id)
    // First dragon: still rung 1.
    expect(state.rung).toBe(1)
  })

  it('promotes the covert to rung 2 on the second dragon', () => {
    const state = newRun(1)
    const rng = createRng(9)
    hatchEgg(state, rng, 'winchester', state.officers[0].id)
    hatchEgg(state, rng, 'grey-copper', state.officers[1].id)
    expect(state.dragons).toHaveLength(2)
    expect(state.rung).toBe(2)
  })

  it('throws for a dead officer or one who is already a captain', () => {
    const state = newRun(1)
    const rng = createRng(9)
    hatchEgg(state, rng, 'winchester', state.officers[0].id)
    expect(() => hatchEgg(state, rng, 'grey-copper', state.officers[0].id)).toThrow()

    state.officers[2].alive = false
    expect(() => hatchEgg(state, rng, 'grey-copper', state.officers[2].id)).toThrow()
  })
})

describe('determinism', () => {
  it('same seed + same action script yields deep-equal state after the auction and hatch', () => {
    function play(seed: number): GameState {
      const state = newRun(seed)
      state.pendingCards = []
      startScriptedFirst(state, state.officers[0].id)
      const patron = state.patrons.find((p) => p.goodwill >= AUCTION_GOODWILL_COST)!

      let spent = false
      let guard = 0
      while (guard < 300) {
        if (!state.auction || state.auction.concluded) break
        tick(state)
        guard += 1
        const a = state.auction
        if (!a || a.concluded) break
        if (!spent) {
          const unclaimed = a.eggs.filter((e) => e.claimedBy === null)
          if (unclaimed.length === 1 && unclaimed[0].breed === 'winchester' && a.bidders.some((b) => !b.you)) {
            auctionSpendGoodwill(state, patron.id)
            spent = true
          }
        } else if (a.bidders[0]?.you && a.nextClaimIn <= 0) {
          auctionClaim(state, 'winchester')
          break
        }
      }

      // Incubate to the hatching card, then hatch it directly.
      guard = 0
      while (state.auction && guard < 50) {
        tick(state)
        guard += 1
      }
      const card = state.pendingCards.find((c) => c.templateId === 'hatching')!
      const r = createRng(state.rngState)
      hatchEgg(state, r, card.params.breed as BreedId, card.params.officerId as Id)
      state.rngState = r.getState()
      state.pendingCards = state.pendingCards.filter((c) => c !== card)
      return state
    }

    expect(play(777)).toEqual(play(777))
  })
})
