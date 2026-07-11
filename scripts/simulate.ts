import { pathToFileURL } from 'node:url'
import type { CardInstance, GameState, Id } from '../src/sim/types'
import { newRun } from '../src/sim/newRun'
import { tick } from '../src/sim/tick'
import {
  acceptMission,
  buyFeed,
  giveTreasure,
  auctionSpendGoodwill,
  chooseCardOption,
} from '../src/sim/actions'
import { auctionClaim } from '../src/sim/auction'
import { successChance } from '../src/sim/projection'
import { CARDS } from '../src/sim/cards'
import { FEED_COST, TICKS_PER_DAY, AUCTION_GOODWILL_COST, KAZILIK_COST } from '../src/sim/balance'

/**
 * Headless balance bot. Plays the game ENTIRELY through the public sim surface
 * (newRun / tick / actions), never mutating state directly, with a simple
 * competent policy. It is a measuring instrument: the deliverable is a tuned
 * balance.ts, and this bot is how we read the tuning. Style follows
 * merc-company/scripts/simulate.ts (botAct + runOne + a stats main()).
 */

// --- Policy tunables (bot-side, NOT game balance) --------------------------
const MISSION_ACCEPT_CHANCE = 0.6      // accept a mission on the best free dragon at/above this
const MISSION_ACCEPT_CHANCE_FINALE = 0.5 // war demands more risk once the finale is live
const FEED_DAYS_BUFFER = 3             // keep at least this many days of upkeep in stock
const TREASURE_CONTENTMENT_FLOOR = 40  // pamper any dragon below this while treasure remains
const KAZILIK_COIN_BUFFER = 60         // only fund the Istanbul run with this much slack over its cost

/** The mission success-chance the bot demands, given whether the finale is live. */
export function missionAcceptThreshold(state: GameState): number {
  return state.finaleStarted ? MISSION_ACCEPT_CHANCE_FINALE : MISSION_ACCEPT_CHANCE
}

/**
 * Chooses which card option the bot takes. Mirrors the policy in the dispatch:
 * sponsorship rotates by seed%3, tribute pays when affordable, insurance benches,
 * kazilik funds only with a comfortable buffer, everything else takes option 0
 * (falling back to the first enabled option when 0 is disabled).
 */
export function chooseCardOptionIndex(state: GameState, card: CardInstance): number {
  const template = CARDS[card.templateId]
  const options = template.options(state, card.params)
  const firstEnabled = () => {
    const i = options.findIndex((o) => o.enabled)
    return i >= 0 ? i : 0
  }

  switch (card.templateId) {
    case 'sponsorship':
      // Rotate all three openings across seeds so every path gets exercised.
      return state.seed % 3
    case 'tribute-demand':
      // Pay the cut if we can afford it (option 0 enabled), else refuse.
      return options[0].enabled ? 0 : 1
    case 'insurance-officer':
      // Bench the spare captain as insurance.
      return 0
    case 'kazilik-quest':
      // Fund the gamble only with real slack over its cost.
      return state.coin >= KAZILIK_COST + KAZILIK_COIN_BUFFER ? 0 : 1
    default:
      return options[0]?.enabled ? 0 : firstEnabled()
  }
}

/** The best free (home) dragon for a mission, by real successChance, or null. */
export function bestDragonForMission(
  state: GameState,
  missionId: Id
): { dragonId: Id; chance: number } | null {
  const mission = state.missions.find((m) => m.id === missionId)
  if (!mission) return null
  let best: { dragonId: Id; chance: number } | null = null
  for (const d of state.dragons) {
    if (d.status !== 'home') continue
    const chance = successChance(state, mission, d)
    if (best === null || chance > best.chance) best = { dragonId: d.id, chance }
  }
  return best
}

/**
 * Picks the patron to spend goodwill through in a live auction: prefer the
 * standing candidate's own related patron (spending on their own interest never
 * cools them), else the richest-goodwill patron with enough to spend.
 */
function pickAuctionPatron(state: GameState): Id | null {
  const auction = state.auction
  if (!auction) return null
  const candidate = state.officers.find((o) => o.id === auction.candidateOfficerId)
  const relatedId = candidate?.relatedPatronId ?? null
  const related = relatedId ? state.patrons.find((p) => p.id === relatedId) : undefined
  if (related && related.goodwill >= AUCTION_GOODWILL_COST) return related.id
  const eligible = state.patrons
    .filter((p) => p.goodwill >= AUCTION_GOODWILL_COST)
    .sort((a, b) => b.goodwill - a.goodwill)
  return eligible.length > 0 ? eligible[0].id : null
}

/** One decision pass over the current state, through the public action surface. */
export function botAct(state: GameState): void {
  // 1. Answer every pending decision card, first-first, until the queue clears.
  //    Answering can enqueue a follow-up (e.g. bypassed-officer after a hatch),
  //    so loop with a guard rather than assuming a single card.
  let cardGuard = 0
  while (state.pendingCards.length > 0 && cardGuard < 50) {
    const card = state.pendingCards[0]
    chooseCardOption(state, card.id, chooseCardOptionIndex(state, card))
    cardGuard += 1
  }
  if (state.pendingCards.length > 0) return

  // 2. Live auction: claim when we can, otherwise buy our way to the top.
  const auction = state.auction
  if (auction && !auction.concluded) {
    const youTop = auction.bidders.length > 0 && auction.bidders[0].you
    const rivalsLeft = auction.bidders.some((b) => !b.you)
    const unclaimed = auction.eggs.filter((e) => e.claimedBy === null)
    const canClaim = unclaimed.length > 0 && ((youTop && auction.nextClaimIn <= 0) || !rivalsLeft)
    if (canClaim) {
      auctionClaim(state, unclaimed[0].breed) // eggs are ordered best→worst
      return
    }
    if (!youTop) {
      const patronId = pickAuctionPatron(state)
      if (patronId) auctionSpendGoodwill(state, patronId)
    }
    return
  }

  // 3. Missions: send the best free dragon on any offer it clears the bar on.
  const threshold = missionAcceptThreshold(state)
  for (const m of state.missions) {
    if (m.status !== 'offered') continue
    if (state.day > m.offerExpiresDay) continue
    const pick = bestDragonForMission(state, m.id)
    if (pick && pick.chance >= threshold) {
      acceptMission(state, m.id, pick.dragonId)
    }
  }

  // 4. Economy, daily-ish (buyFeed guards on its own threshold, so cheap to
  //    re-run; gate the sweep on the day boundary to keep it once-per-day).
  if (state.tickCount % TICKS_PER_DAY === 0) {
    const dailyUpkeep = state.dragons.reduce((sum, d) => sum + FEED_COST[d.breed], 0)
    const target = dailyUpkeep * FEED_DAYS_BUFFER
    if (state.feed < target) {
      const short = target - state.feed
      // buyFeed costs FEED_PRICE per unit; buy what we can afford, up to the gap.
      const affordable = Math.floor(state.coin / 2)
      const amount = Math.min(short, affordable)
      if (amount >= 1) buyFeed(state, amount)
    }
    for (const d of state.dragons) {
      if (state.treasure < 1) break
      if (d.contentment < TREASURE_CONTENTMENT_FLOOR) giveTreasure(state, d.id)
    }
  }
}

export interface RunResult {
  seed: number
  opening: number
  ending: 'survived' | 'relieved' | 'wing-destroyed' | 'timeout'
  runLengthDays: number
  score: number
  dragonsAtEnd: number
  finaleStartDay: number | null
  standingAtDay100: number
  standingAtDay150: number
  // rung diagnostics
  auction2Fired: boolean
  auction2Won: boolean
  auction3Fired: boolean
  auction3Won: boolean
  dragonsAtFinaleStart: number | null
  rungAtFinaleStart: number | null
}

const DAY_CAP = 500

/** Plays one seeded run to completion (or the safety cap) and reports it. */
export function runOne(seed: number): RunResult {
  const state = newRun(seed)
  let finaleStartDay: number | null = null
  let standingAtDay100: number | null = null
  let standingAtDay150: number | null = null
  let dragonsAtFinaleStart: number | null = null
  let rungAtFinaleStart: number | null = null

  // Auction diagnostics, observed from OUTSIDE the sim (read-only): rung only
  // advances on a hatch, so a non-FTUE auction opening at rung 1 is the rung-2
  // auction and one opening at rung 2 is the rung-3 auction. A win is visible
  // as that same auction's concluded-with-wonBreed incubation phase.
  let currentAuction: 'ftue' | 'a2' | 'a3' | null = null
  let auction2Fired = false
  let auction2Won = false
  let auction3Fired = false
  let auction3Won = false

  while (state.status === 'running' && state.day <= DAY_CAP) {
    botAct(state)
    tick(state)

    const a = state.auction
    if (a && currentAuction === null) {
      currentAuction = state.flags['first-auction'] ? 'ftue' : state.rung === 1 ? 'a2' : 'a3'
      if (currentAuction === 'a2') auction2Fired = true
      if (currentAuction === 'a3') auction3Fired = true
    }
    if (a && a.concluded && a.wonBreed !== null) {
      if (currentAuction === 'a2') auction2Won = true
      if (currentAuction === 'a3') auction3Won = true
    }
    if (!a) currentAuction = null

    if (finaleStartDay === null && state.finaleStarted) {
      finaleStartDay = state.day
      dragonsAtFinaleStart = state.dragons.length
      rungAtFinaleStart = state.rung
    }
    if (standingAtDay100 === null && state.day >= 100) standingAtDay100 = state.standing
    if (standingAtDay150 === null && state.day >= 150) standingAtDay150 = state.standing
  }

  const timedOut = state.status === 'running'
  const ending: RunResult['ending'] = timedOut ? 'timeout' : (state.ending ?? 'timeout')
  return {
    seed,
    opening: seed % 3,
    ending,
    runLengthDays: state.day,
    score: state.score,
    dragonsAtEnd: state.dragons.length,
    finaleStartDay,
    standingAtDay100: standingAtDay100 ?? state.standing,
    standingAtDay150: standingAtDay150 ?? state.standing,
    auction2Fired,
    auction2Won,
    auction3Fired,
    auction3Won,
    dragonsAtFinaleStart,
    rungAtFinaleStart,
  }
}

// --- stats helpers ---------------------------------------------------------

function median(xs: number[]): number {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const idx = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))
  return s[idx]
}

function pct(n: number, total: number): string {
  return total === 0 ? 'n/a' : `${((n / total) * 100).toFixed(1)}%`
}

function main(): void {
  const n = Number(process.argv[2] ?? 200)
  const offset = Number(process.argv[3] ?? 0)

  const results: RunResult[] = []
  for (let i = 0; i < n; i++) results.push(runOne(offset + i))

  const wins = results.filter((r) => r.ending === 'survived')
  const relieved = results.filter((r) => r.ending === 'relieved')
  const wingDestroyed = results.filter((r) => r.ending === 'wing-destroyed')
  const timeouts = results.filter((r) => r.ending === 'timeout')
  const reachedFinale = results.filter((r) => r.finaleStartDay !== null)
  const relievedBeforeFinale = relieved.filter((r) => r.finaleStartDay === null)

  const openingWin: string[] = []
  for (let o = 0; o < 3; o++) {
    const bucket = results.filter((r) => r.opening === o)
    const w = bucket.filter((r) => r.ending === 'survived').length
    openingWin.push(`opening ${o}: ${pct(w, bucket.length)} (${w}/${bucket.length})`)
  }

  const standings100 = results.map((r) => r.standingAtDay100)
  const a2Fired = results.filter((r) => r.auction2Fired)
  const a2Won = results.filter((r) => r.auction2Won)
  const a3Fired = results.filter((r) => r.auction3Fired)
  const a3Won = results.filter((r) => r.auction3Won)
  const finaleDragons = reachedFinale.map((r) => r.dragonsAtFinaleStart!)
  const finaleRungs = reachedFinale.map((r) => r.rungAtFinaleStart!)

  const rows: [string, string][] = [
    ['runs (N)', String(n)],
    ['seed range', `${offset}..${offset + n - 1}`],
    ['WIN rate (survived)', pct(wins.length, n)],
    ['loss: relieved', pct(relieved.length, n)],
    ['loss: wing-destroyed', pct(wingDestroyed.length, n)],
    ['loss: timeout', pct(timeouts.length, n)],
    ['reached finale', pct(reachedFinale.length, n)],
    ['relieved before finale', pct(relievedBeforeFinale.length, n)],
    ['median finale-start day', reachedFinale.length ? median(reachedFinale.map((r) => r.finaleStartDay!)).toFixed(0) : 'n/a'],
    ['median dragons at end', median(results.map((r) => r.dragonsAtEnd)).toFixed(1)],
    ['median score', median(results.map((r) => r.score)).toFixed(0)],
    ['median run length (days)', median(results.map((r) => r.runLengthDays)).toFixed(0)],
    ['standing @day100 p10/p90', `${percentile(standings100, 10).toFixed(0)} / ${percentile(standings100, 90).toFixed(0)}`],
    ['median standing @day150', median(results.map((r) => r.standingAtDay150)).toFixed(0)],
    ['auction-2 fired / won', `${pct(a2Fired.length, n)} / ${pct(a2Won.length, n)}`],
    ['auction-3 fired / won', `${pct(a3Fired.length, n)} / ${pct(a3Won.length, n)}`],
    ['median dragons @finale start', finaleDragons.length ? median(finaleDragons).toFixed(1) : 'n/a'],
    ['median rung @finale start', finaleRungs.length ? median(finaleRungs).toFixed(1) : 'n/a'],
  ]

  const labelW = Math.max(...rows.map((r) => r[0].length))
  console.log('')
  console.log('  Wings of the Corps — balance bot report')
  console.log('  ' + '-'.repeat(labelW + 20))
  for (const [label, value] of rows) {
    console.log(`  ${label.padEnd(labelW)}  ${value}`)
  }
  console.log('  ' + '-'.repeat(labelW + 20))
  for (const line of openingWin) console.log(`  ${line}`)
  console.log('')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
