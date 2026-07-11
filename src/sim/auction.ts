import type { Auction, AuctionBidder, BreedId, CardInstance, Dragon, GameState, Id, Officer } from './types'
import type { Rng } from './rng'
import { addLog } from './tick'
import { BREEDS, DRAGON_NAMES, OFFICER_NAMES, RANK_ORDER } from './content'
import {
  TICKS_PER_DAY,
  RUNG_STANDING,
  RUNG_RANK_GATE,
  AUCTION_RIVALS,
  STANDING_INFLUENCE_DIVISOR,
  RIVAL_INFLUENCE_SPREAD_MIN,
  RIVAL_INFLUENCE_SPREAD_MAX,
  AUCTION_TICKS_PER_CLAIM,
  AUCTION_GRACE_TICKS,
  FIRST_AUCTION_RIVAL_MARGIN,
  JITTER_CHANCE,
  JITTER_SIZE,
  GIFT_TIER_MIN,
  AUCTION_PATRON_HELP_CHANCE,
  AUCTION_PATRON_BUMP,
  AUCTION_RIVAL_HURT_CHANCE,
  EGG_HATCH_DAYS,
  FEMALE_CANDIDATE_SKILL_SLACK,
  AUCTION_RETRY_COOLDOWN_DAYS,
  TRAINING_START,
  CONTENTMENT_START,
  HATCH_MORALE_BONUS,
} from './balance'

/**
 * The hatching-auction state machine — the structural spine through which
 * every dragon arrives. An auction runs live for a while (rivals outbidding
 * your candidate, claiming eggs at fixed intervals and leaving), then, if you
 * win an egg, enters an incubation ("egg") phase that finally fires a
 * `hatching` decision card.
 *
 * FTUE guarantee (scripted first auction): rivals are pinned exactly
 * FIRST_AUCTION_RIVAL_MARGIN above your candidate — enough that you win
 * nothing on merit, but one AUCTION_BUMP goodwill spend flips you above them
 * for the final winchester. To keep that guarantee deterministic across all
 * seeds, scripted auctions skip the per-tick jitter and patron interventions
 * that a normal auction rolls (they exist only to add variance, which would
 * otherwise defeat a hard tutorial promise). This is a deliberate
 * dispatch-override decision.
 *
 * The FTUE also cannot be LOST (design ruling): in scripted mode the final
 * winchester is never claimed by a rival, and the auction never expires.
 * Once only the winchester remains, surplus rivals withdraw one per claim
 * boundary until a single holdout is left, still pinned one margin above
 * you. The auction then waits — forever, if need be — for the one goodwill
 * spend that flips you past the holdout, and the claim at the open boundary.
 * Because that holdout never leaves, auctionClaim's "no rivals left" clause
 * can never grant a free claim in scripted mode.
 */

/** The scripted first-auction clutch: one middle, one light, one courier last. */
const FIRST_AUCTION_EGGS: BreedId[] = ['yellow-reaper', 'grey-copper', 'winchester']

/** Deletes every auction-scoped flag. Called whenever an auction ends. */
function clearAuctionFlags(state: GameState): void {
  delete state.flags['auction-helped']
  delete state.flags['auction-hurt']
  delete state.flags['first-auction']
}

/** Your candidate's effective bidding influence. */
function yourInfluenceFor(state: GameState, candidate: Officer): number {
  return candidate.skill + state.standing / STANDING_INFLUENCE_DIVISOR
}

/**
 * Opens an auction. Throws if one is already live. Builds the rival field and
 * the 'you' bidder, orders the eggs best→worst as given, and logs the
 * allocation. `opts.scripted` produces the FTUE first auction.
 */
export function startAuction(
  state: GameState,
  rng: Rng,
  eggs: BreedId[],
  candidateOfficerId: Id,
  opts?: { scripted?: boolean }
): void {
  if (state.auction) throw new Error('startAuction: an auction is already live')
  const candidate = state.officers.find((o) => o.id === candidateOfficerId)
  if (!candidate) throw new Error(`startAuction: no officer with id ${candidateOfficerId}`)

  const scripted = opts?.scripted === true
  const yourInfluence = yourInfluenceFor(state, candidate)

  // Rival names are flavour only — distinct generated names not already worn
  // by a real officer, falling back to synthetic names if the pool runs dry.
  const namePool = OFFICER_NAMES.map((n) => n.name).filter((n) => !state.officers.some((o) => o.name === n))
  const bidders: AuctionBidder[] = []
  for (let i = 0; i < AUCTION_RIVALS; i++) {
    let name: string
    if (namePool.length > 0) {
      name = namePool.splice(rng.int(0, namePool.length - 1), 1)[0]
    } else {
      name = `Captain ${i + 1}`
    }
    const influence = scripted
      ? yourInfluence + FIRST_AUCTION_RIVAL_MARGIN
      : yourInfluence + rng.int(RIVAL_INFLUENCE_SPREAD_MIN, RIVAL_INFLUENCE_SPREAD_MAX)
    bidders.push({ name, influence, you: false })
  }
  bidders.push({ name: candidate.name, influence: yourInfluence, you: true })

  const ticksPerClaim = AUCTION_TICKS_PER_CLAIM
  const auction: Auction = {
    eggs: eggs.map((breed) => ({ breed, claimedBy: null })),
    bidders,
    ticksRemaining: (eggs.length + 1) * ticksPerClaim + AUCTION_GRACE_TICKS,
    ticksPerClaim,
    nextClaimIn: ticksPerClaim,
    concluded: false,
    wonBreed: null,
    candidateOfficerId,
  }
  state.auction = auction
  if (scripted) state.flags['first-auction'] = true

  addLog(
    state,
    `A clutch of ${eggs.length} eggs is put up for allocation; ${candidate.name} stands as your candidate against a field of rivals.`
  )
}

/** Sorts bidders by influence descending. 'you' loses ties — the underdog. */
function sortBidders(auction: Auction): void {
  auction.bidders.sort((a, b) => {
    if (b.influence !== a.influence) return b.influence - a.influence
    if (a.you === b.you) return 0
    return a.you ? 1 : -1
  })
}

/** One-shot patron help / rival sabotage during a live (non-scripted) auction. */
function applyPatronInterventions(state: GameState, rng: Rng, auction: Auction): void {
  const you = auction.bidders.find((b) => b.you)
  if (!you) return

  if (!state.flags['auction-helped']) {
    const helper = state.patrons.find(
      (p) => (p.kind === 'gratitude' || p.kind === 'transactional') && p.tier >= GIFT_TIER_MIN
    )
    if (helper && rng.next() < AUCTION_PATRON_HELP_CHANCE) {
      you.influence += AUCTION_PATRON_BUMP
      state.flags['auction-helped'] = true
      addLog(state, `${helper.name} speaks quietly to the Admiral — your candidate rises in the reckoning.`)
    }
  }

  if (!state.flags['auction-hurt']) {
    const rival = state.patrons.find((p) => p.kind === 'rival' && p.tier <= -1)
    if (rival && rng.next() < AUCTION_RIVAL_HURT_CHANCE) {
      you.influence = Math.max(0, you.influence - AUCTION_PATRON_BUMP)
      state.flags['auction-hurt'] = true
      addLog(state, `${rival.name} murmurs against your candidate — your standing in the bidding slips.`)
    }
  }
}

/**
 * Concludes an auction you lost outright: every egg gone, no egg phase.
 * A lost rung-2/3 auction is not lost forever: its `auction-N-held` flag is
 * lifted and a `auction-N-retry-day-<D>` cooldown marker is set, letting the
 * scheduler re-offer the clutch after AUCTION_RETRY_COOLDOWN_DAYS. Which N
 * this auction was is inferred from the rung, which only advances on a hatch:
 * a rung-2 auction only ever runs at rung 1, a rung-3 auction at rung 2.
 * (The scripted first auction can never reach here — see maybeConclude.)
 */
function concludeEmpty(state: GameState, auction: Auction): void {
  auction.concluded = true
  auction.wonBreed = null
  addLog(state, 'The clutch is gone — every egg claimed by another covert. Your candidate returns empty-handed.')

  const n = state.rung === 1 ? 2 : state.rung === 2 ? 3 : null
  if (n !== null && state.flags[`auction-${n}-held`]) {
    delete state.flags[`auction-${n}-held`]
    state.flags[`auction-${n}-retry-day-${state.day + AUCTION_RETRY_COOLDOWN_DAYS}`] = true
  }

  clearAuctionFlags(state)
  state.auction = null
}

/**
 * After a live tick, decide whether the auction ends. It ends only when the
 * player can no longer claim: either every egg is gone (rivals took them all),
 * or the grace clock expired while you were being outbid. While unclaimed
 * eggs remain and you are top (at a boundary or otherwise) or the sole
 * bidder, we wait — ticksRemaining stops mattering once you lead the field.
 * Scripted auctions never conclude empty at all: the FTUE cannot be lost.
 */
function maybeConclude(state: GameState, auction: Auction): void {
  const unclaimed = auction.eggs.filter((e) => e.claimedBy === null)
  const rivalsLeft = auction.bidders.some((b) => !b.you)
  const youTop = auction.bidders.length > 0 && auction.bidders[0].you
  const playerCanClaim = unclaimed.length > 0 && ((youTop && auction.nextClaimIn <= 0) || !rivalsLeft)
  if (playerCanClaim) return
  if (state.flags['first-auction'] === true) return
  if (unclaimed.length === 0 || (auction.ticksRemaining <= 0 && !youTop)) {
    concludeEmpty(state, auction)
  }
}

/** One tick of a live auction. */
function tickLive(state: GameState, rng: Rng, auction: Auction): void {
  const scripted = state.flags['first-auction'] === true

  if (!scripted) {
    for (const b of auction.bidders) {
      if (b.you) continue
      if (rng.next() < JITTER_CHANCE) {
        b.influence = Math.max(0, b.influence + rng.pick([-1, 1]) * JITTER_SIZE)
      }
    }
    applyPatronInterventions(state, rng, auction)
  }

  sortBidders(auction)

  auction.nextClaimIn -= 1
  if (auction.nextClaimIn <= 0) {
    const unclaimed = auction.eggs.filter((e) => e.claimedBy === null)
    // Scripted FTUE, more than the last egg still up: rivals settle their own
    // pecking order regardless of where your candidate currently ranks. This
    // guarantees "the last pick, always a tiny messenger dragon" even if
    // goodwill is spent early — without it, an early spend would make you
    // the overall top bidder immediately, freezing the claim boundary before
    // any rival has taken a turn and letting you claim a BETTER egg than the
    // FTUE promises.
    const top = scripted && unclaimed.length > 1 ? (auction.bidders.find((b) => !b.you) ?? null) : auction.bidders[0]
    if (top && !top.you) {
      if (scripted && unclaimed.length <= 1) {
        // FTUE: the final egg is never taken by a rival. Surplus rivals drift
        // away one per boundary; the LAST rival stays as a permanent holdout
        // (pinned one margin above you), so the auction can neither be lost
        // nor won via the "no rivals left" free-claim clause — only a
        // goodwill spend gets past him.
        const rivalCount = auction.bidders.filter((b) => !b.you).length
        if (rivalCount > 1) {
          auction.bidders = auction.bidders.filter((b) => b !== top)
          addLog(state, `${top.name} loses interest in the runt of the clutch and withdraws.`)
          auction.nextClaimIn = auction.ticksPerClaim
        } else {
          // The holdout waits; the boundary stays open for your claim.
          auction.nextClaimIn = 0
        }
      } else {
        const egg = unclaimed[0]
        if (egg) {
          egg.claimedBy = top.name
          addLog(state, `${top.name} secures the ${BREEDS[egg.breed].name} egg; your candidate is passed over.`)
        }
        auction.bidders = auction.bidders.filter((b) => b !== top)
        auction.nextClaimIn = auction.ticksPerClaim
      }
    } else {
      // Top bidder is you: hold at the boundary and wait for auctionClaim.
      auction.nextClaimIn = 0
    }
  }

  auction.ticksRemaining -= 1
  maybeConclude(state, auction)
}

/** One tick of the incubation phase after you win an egg. */
function tickEggPhase(state: GameState, auction: Auction): void {
  auction.ticksRemaining -= 1
  if (auction.ticksRemaining <= 0) {
    const card: CardInstance = {
      id: `c${state.nextId}`,
      templateId: 'hatching',
      params: { breed: auction.wonBreed as string, officerId: auction.candidateOfficerId },
    }
    state.nextId += 1
    state.pendingCards.push(card)
    state.auction = null
  }
}

/** Officers eligible to stand as an auction candidate at/above `minRank`. */
function eligibleCandidates(state: GameState, minRank: 'midwingman' | 'lieutenant'): Officer[] {
  return state.officers.filter(
    (o) => o.alive && o.dragonId === null && o.rank !== 'captain' && RANK_ORDER[o.rank] >= RANK_ORDER[minRank]
  )
}

/** Highest rank, then highest skill. */
function bestCandidate(candidates: Officer[]): Officer | null {
  if (candidates.length === 0) return null
  return [...candidates].sort((a, b) => RANK_ORDER[b.rank] - RANK_ORDER[a.rank] || b.skill - a.skill)[0]
}

/**
 * Retry-cooldown gate for the rung-N auction. A lost auction leaves an
 * `auction-N-retry-day-<D>` marker (flags are boolean-only, so the day lives
 * in the key). Before day D the auction is blocked; from day D onward the
 * marker is consumed and the auction may fire again, all other eligibility
 * rules still applying.
 */
function retryBlocked(state: GameState, n: 2 | 3): boolean {
  const prefix = `auction-${n}-retry-day-`
  const key = Object.keys(state.flags).find((k) => k.startsWith(prefix))
  if (!key) return false
  const retryDay = Number(key.slice(prefix.length))
  if (state.day < retryDay) return true
  delete state.flags[key]
  return false
}

/**
 * Day-boundary auction scheduler. Runs only when nothing else is pending: no
 * live auction, no decision cards, the run still going. Fires at most one
 * auction per call, first-auction first, then rung-2, then rung-3.
 */
function maybeScheduleAuction(state: GameState, rng: Rng): void {
  if (state.pendingCards.length > 0) return
  if (state.status !== 'running') return
  if (state.tickCount % TICKS_PER_DAY !== 0) return

  // First auction (scripted FTUE). The sponsorship card records the sponsored
  // officer with a `sponsored:<id>` flag (flags are boolean-only, so the id
  // lives in the key) — we recover it by prefix scan.
  if (state.flags['sponsorship-done'] && !state.flags['first-auction-held']) {
    const sponsoredKey = Object.keys(state.flags).find((k) => k.startsWith('sponsored:'))
    const officerId = sponsoredKey ? sponsoredKey.slice('sponsored:'.length) : null
    const officer = officerId ? state.officers.find((o) => o.id === officerId && o.alive) : null
    if (officer) {
      startAuction(state, rng, FIRST_AUCTION_EGGS, officer.id, { scripted: true })
      state.flags['first-auction-held'] = true
      return
    }
  }

  // Rung-2 auction: earned once you have a dragon and enough standing, with a
  // midwingman-or-better candidate free to bond.
  if (
    state.rung === 1 &&
    state.dragons.length >= 1 &&
    state.standing >= RUNG_STANDING[2] &&
    !state.flags['auction-2-held'] &&
    !retryBlocked(state, 2)
  ) {
    const candidate = bestCandidate(eligibleCandidates(state, RUNG_RANK_GATE[2] as 'midwingman'))
    if (candidate) {
      const eggs: BreedId[] = rng.next() < 0.5 ? ['yellow-reaper', 'grey-copper'] : ['grey-copper', 'yellow-reaper']
      startAuction(state, rng, eggs, candidate.id)
      state.flags['auction-2-held'] = true
      return
    }
  }

  // Rung-3 auction: a chequered-nettle always, plus a longwing IF a senior
  // female candidate can stand for it.
  //
  // The auction runs for exactly ONE candidate, so a longwing (which lore
  // demands a female captain) can only be offered if that candidate is female.
  // Simplification (binding): if the top eligible candidate is female, she
  // stands and the longwing appears. If the top candidate is male, the longwing
  // appears only when the best eligible female is within
  // FEMALE_CANDIDATE_SKILL_SLACK skill of him — and then SHE becomes the
  // candidate; otherwise the longwing is omitted and the man stands with just
  // the nettle.
  if (state.rung === 2 && state.standing >= RUNG_STANDING[3] && !state.flags['auction-3-held'] && !retryBlocked(state, 3)) {
    const eligible = eligibleCandidates(state, RUNG_RANK_GATE[3] as 'lieutenant')
    const top = bestCandidate(eligible)
    if (top) {
      const eggs: BreedId[] = ['chequered-nettle']
      let candidate = top
      if (top.gender === 'f') {
        eggs.push('longwing')
      } else {
        const bestFemale = bestCandidate(eligible.filter((o) => o.gender === 'f'))
        if (bestFemale && top.skill - bestFemale.skill <= FEMALE_CANDIDATE_SKILL_SLACK) {
          eggs.push('longwing')
          candidate = bestFemale
        }
      }
      startAuction(state, rng, eggs, candidate.id)
      state.flags['auction-3-held'] = true
      return
    }
  }
}

/** Called every tick by the engine. Drives live bidding, incubation, or scheduling. */
export function tickAuction(state: GameState, rng: Rng): void {
  const auction = state.auction
  if (auction) {
    if (auction.concluded) {
      tickEggPhase(state, auction)
    } else {
      tickLive(state, rng, auction)
    }
    return
  }
  maybeScheduleAuction(state, rng)
}

/**
 * Player claims an unclaimed egg from the live auction. Valid only when you are
 * the top bidder at a claim boundary, or no rivals remain. Concludes the
 * auction into its incubation phase.
 */
export function auctionClaim(state: GameState, breed: BreedId): void {
  const auction = state.auction
  if (!auction || auction.concluded) throw new Error('auctionClaim: no live auction')
  const egg = auction.eggs.find((e) => e.breed === breed && e.claimedBy === null)
  if (!egg) throw new Error(`auctionClaim: ${breed} is not an unclaimed egg in the auction`)

  const you = auction.bidders.find((b) => b.you)
  const rivalsLeft = auction.bidders.some((b) => !b.you)
  const youTop = auction.bidders.length > 0 && auction.bidders[0].you
  const canClaim = (youTop && auction.nextClaimIn <= 0) || !rivalsLeft
  if (!canClaim) throw new Error('auctionClaim: your candidate is not in a position to claim')

  egg.claimedBy = you ? you.name : 'you'
  auction.concluded = true
  auction.wonBreed = breed
  auction.ticksRemaining = EGG_HATCH_DAYS * TICKS_PER_DAY
  clearAuctionFlags(state)
  addLog(state, `Your candidate claims the ${BREEDS[breed].name} egg. It is carried to the incubation shed to harden.`)
}

/**
 * Hatches a won egg into a dragon bonded to `officerId`, who becomes its
 * captain. Promotes the covert to rung 2 on the second dragon, rung 3 on the
 * third. Throws if the officer is missing, dead, or already a captain.
 */
export function hatchEgg(state: GameState, rng: Rng, breed: BreedId, officerId: Id): void {
  const officer = state.officers.find((o) => o.id === officerId)
  if (!officer) throw new Error(`hatchEgg: no officer with id ${officerId}`)
  if (!officer.alive) throw new Error(`hatchEgg: officer ${officerId} is dead`)
  if (officer.rank === 'captain' || officer.dragonId !== null) {
    throw new Error(`hatchEgg: officer ${officerId} is already a captain`)
  }

  // Captured before promotion for the bypassed-officer check below, and
  // before pushing the new dragon so it reflects prior state.
  const preHatchRank = officer.rank
  const hadPriorDragon = state.dragons.length > 0

  const dragonId = `d${state.nextId}`
  state.nextId += 1
  const dragon: Dragon = {
    id: dragonId,
    name: rng.pick(DRAGON_NAMES[breed]),
    breed,
    training: TRAINING_START,
    woundsTemp: 0,
    woundsLasting: 0,
    contentment: CONTENTMENT_START,
    captainId: officerId,
    status: 'home',
    missionId: null,
  }
  state.dragons.push(dragon)

  officer.rank = 'captain'
  officer.dragonId = dragonId
  officer.morale = Math.min(100, officer.morale + HATCH_MORALE_BONUS)

  addLog(state, `The ${BREEDS[breed].name} egg hatches: a dragon named ${dragon.name} chooses ${officer.name} on sight.`)
  addLog(state, `${officer.name} takes the captain's harness; ${dragon.name} will suffer no other hand near it.`)

  if (state.dragons.length === 2) {
    state.rung = 2
    addLog(state, 'Dispatch from the Admiralty: with a second dragon in the covert, you are raised to the second rung.')
  } else if (state.dragons.length === 3) {
    state.rung = 3
    addLog(state, 'Dispatch from the Admiralty: a third dragon earns your covert the third rung.')
  }

  // The bypassed-officer card (Task 7): a life-sim beat that only makes
  // sense once the covert already has a captain — its FIRST captaincy can
  // never "bypass" anyone, there being no prior captains to compare rank
  // against. From the second captaincy on, if the officer just promoted
  // was junior to some other living, still-uncaptained officer, that
  // senior officer has been passed over.
  if (hadPriorDragon) {
    const bypassCandidates = state.officers.filter(
      (o) => o.alive && o.id !== officerId && o.rank !== 'captain' && RANK_ORDER[o.rank] > RANK_ORDER[preHatchRank]
    )
    if (bypassCandidates.length > 0) {
      const bypassed = [...bypassCandidates].sort(
        (a, b) => RANK_ORDER[b.rank] - RANK_ORDER[a.rank] || b.skill - a.skill
      )[0]
      const card: CardInstance = {
        id: `c${state.nextId}`,
        templateId: 'bypassed-officer',
        params: { bypassedId: bypassed.id, newCaptainId: officerId },
      }
      state.nextId += 1
      state.pendingCards.push(card)
    }
  }
}
