import type { GameState, Id } from './types'
import { createRng } from './rng'
import { departMission } from './missions'
import { adjustTier, earnGoodwill, spendGoodwill } from './patrons'
import { CARDS } from './cards'
import { addLog } from './tick'
import {
  REFUSAL_WAR_HEAT_GATE,
  REFUSAL_STANDING_COST,
  TREASURE_CONTENTMENT,
  TRIBUTE_COST,
  TRIBUTE_GOODWILL,
  FEED_PRICE,
  AUCTION_GOODWILL_COST,
  AUCTION_BUMP,
} from './balance'

/**
 * Every player verb lives here. All of them are sim-pure (mutate `state`
 * in place, no I/O) and all of them throw on invalid input — callers (the
 * UI) are expected to only offer legal actions, but the sim never trusts
 * that and validates independently.
 */

export function acceptMission(state: GameState, missionId: Id, dragonId: Id): void {
  const mission = state.missions.find((m) => m.id === missionId)
  if (!mission) throw new Error(`acceptMission: no mission with id ${missionId}`)
  if (mission.status !== 'offered') throw new Error(`acceptMission: mission ${missionId} is not offered`)
  if (state.day > mission.offerExpiresDay) throw new Error(`acceptMission: mission ${missionId} offer has expired`)

  const dragon = state.dragons.find((d) => d.id === dragonId)
  if (!dragon) throw new Error(`acceptMission: no dragon with id ${dragonId}`)
  if (dragon.status !== 'home') throw new Error(`acceptMission: dragon ${dragonId} is not home`)

  departMission(state, mission, dragon)
}

export function declineMission(state: GameState, missionId: Id): void {
  const mission = state.missions.find((m) => m.id === missionId)
  if (!mission) throw new Error(`declineMission: no mission with id ${missionId}`)
  if (mission.status !== 'offered') throw new Error(`declineMission: mission ${missionId} is not offered`)

  const trapFlag = `trap:${missionId}`
  const isTrap = state.flags[trapFlag] === true

  state.missions = state.missions.filter((m) => m.id !== missionId)
  delete state.flags[`warned:${missionId}`] // trap-warning's one-shot marker leaves with the mission

  if (isTrap) {
    delete state.flags[trapFlag]
    return
  }

  if (state.warHeat > REFUSAL_WAR_HEAT_GATE) {
    state.standing = Math.max(0, state.standing - REFUSAL_STANDING_COST)
    addLog(state, `You decline the ${mission.name} — the Admiralty notices the refusal.`)
  }

  if (mission.patronId) {
    adjustTier(state, mission.patronId, -1, `Remembers: declined the ${mission.name}.`)
  }
}

export function giveTreasure(state: GameState, dragonId: Id): void {
  const dragon = state.dragons.find((d) => d.id === dragonId)
  if (!dragon) throw new Error(`giveTreasure: no dragon with id ${dragonId}`)
  if (state.treasure < 1) throw new Error('giveTreasure: no treasure to give')

  state.treasure -= 1
  dragon.contentment = Math.min(100, dragon.contentment + TREASURE_CONTENTMENT)
  addLog(state, `${dragon.name} is given treasure to guard, and preens with satisfaction.`)
}

export function payTribute(state: GameState, patronId: Id): void {
  const patron = state.patrons.find((p) => p.id === patronId)
  if (!patron) throw new Error(`payTribute: no patron with id ${patronId}`)
  if (patron.kind !== 'transactional') throw new Error(`payTribute: patron ${patronId} is not transactional`)
  if (state.coin < TRIBUTE_COST) throw new Error('payTribute: insufficient coin')

  state.coin -= TRIBUTE_COST
  earnGoodwill(state, patronId, TRIBUTE_GOODWILL)

  const memory = 'Remembers: tribute paid, and finds it satisfactory.'
  if (patron.tier < 1) {
    adjustTier(state, patronId, 1, memory)
  } else {
    patron.memory = memory
  }
  addLog(state, `You pay tribute to ${patron.name}.`)
}

export function buyFeed(state: GameState, amount: number): void {
  if (!Number.isInteger(amount) || amount < 1) throw new Error('buyFeed: amount must be a positive integer')
  const cost = amount * FEED_PRICE
  if (state.coin < cost) throw new Error('buyFeed: insufficient coin')

  state.coin -= cost
  state.feed += amount
}

export function auctionSpendGoodwill(state: GameState, patronId: Id): void {
  if (!state.auction || state.auction.concluded) throw new Error('auctionSpendGoodwill: no active auction')
  const patron = state.patrons.find((p) => p.id === patronId)
  if (!patron) throw new Error(`auctionSpendGoodwill: no patron with id ${patronId}`)
  if (patron.goodwill < AUCTION_GOODWILL_COST) throw new Error(`auctionSpendGoodwill: patron ${patronId} has insufficient goodwill`)

  const auction = state.auction
  const candidate = state.officers.find((o) => o.id === auction.candidateOfficerId)
  const forWhom: 'own-interest' | 'stranger' = candidate?.relatedPatronId === patronId ? 'own-interest' : 'stranger'
  spendGoodwill(state, patronId, AUCTION_GOODWILL_COST, forWhom)

  const you = auction.bidders.find((b) => b.you)
  if (you) you.influence += AUCTION_BUMP
}

export function chooseCardOption(state: GameState, cardId: Id, optionIndex: number): void {
  const card = state.pendingCards.find((c) => c.id === cardId)
  if (!card) throw new Error(`chooseCardOption: no pending card with id ${cardId}`)

  const template = CARDS[card.templateId]
  if (!template) throw new Error(`chooseCardOption: no card template registered for ${card.templateId}`)

  const options = template.options(state, card.params)
  const option = options[optionIndex]
  if (!option) throw new Error(`chooseCardOption: invalid option index ${optionIndex}`)
  if (!option.enabled) throw new Error(`chooseCardOption: option ${optionIndex} is disabled`)

  // Same reconstruct/writeback dance tick.ts does — chooseCardOption is the
  // one player action that needs the RNG.
  const rng = createRng(state.rngState)
  option.apply(state, rng)
  state.rngState = rng.getState()

  state.pendingCards = state.pendingCards.filter((c) => c.id !== cardId)
}
