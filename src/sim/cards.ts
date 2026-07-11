import type { BreedId, CardInstance, Dragon, GameState, Officer } from './types'
import type { Rng } from './rng'
import { addLog } from './tick'
import { adjustTier, earnGoodwill } from './patrons'
import { hatchEgg } from './auction'
import { BREEDS } from './content'
import {
  TICKS_PER_DAY,
  FEED_COST,
  SPONSOR_KIN_GOODWILL,
  SPONSOR_KIN_GOODWILL_NEW,
  INSURANCE_MIN_DRAGONS,
  INSURANCE_MORALE_COST,
  INSURANCE_DECLINE_MORALE,
  BYPASS_CONSOLE_COST,
  BYPASS_CONSOLE_MORALE,
  BYPASS_MORALE_COST,
  TRIBUTE_COST,
  TRIBUTE_GOODWILL,
  TRIBUTE_DEMAND_INTERVAL_DAYS,
  GIFT_TIER_MIN,
  TRAP_WARNING_CHANCE,
} from './balance'

/**
 * A decision-card template: pure functions of (state, params) that render
 * the card's text and its option list. Not part of GameState — templates
 * are looked up by CardInstance.templateId at render/choose time, never
 * stored on state directly.
 */
export interface CardTemplate {
  title(state: GameState, params: Record<string, string | number>): string
  body(state: GameState, params: Record<string, string | number>): string
  options(
    state: GameState,
    params: Record<string, string | number>
  ): { label: string; detail: string; enabled: boolean; apply(state: GameState, rng: Rng): void }[]
}

/** The covert's two named, story-fixed patrons — always present (see content.ts PATRON_DEFS). */
function gratitudePatron(state: GameState) {
  return state.patrons.find((p) => p.kind === 'gratitude')!
}
function transactionalPatron(state: GameState) {
  return state.patrons.find((p) => p.kind === 'transactional')!
}
function rivalPatron(state: GameState) {
  return state.patrons.find((p) => p.kind === 'rival')
}

/** The three sponsorship candidates seeded by newRun, recovered live from state. */
function sponsorshipCandidates(state: GameState) {
  const gratitude = gratitudePatron(state)
  const transactional = transactionalPatron(state)
  const best = state.officers.find((o) => o.rank === 'midwingman' && o.relatedPatronId === null)!
  const gratitudeRelative = state.officers.find((o) => o.relatedPatronId === gratitude.id)!
  const transactionalRelative = state.officers.find((o) => o.relatedPatronId === transactional.id)!
  return { gratitude, transactional, best, gratitudeRelative, transactionalRelative }
}

/** Sets both sponsorship flags the auction scheduler watches for. */
function markSponsored(state: GameState, officerId: string): void {
  state.flags[`sponsored:${officerId}`] = true
  state.flags['sponsorship-done'] = true
}

const sponsorship: CardTemplate = {
  title: () => 'A Captaincy to Sponsor',
  body: () =>
    'The Admiralty means to allocate a clutch of eggs, and wants one name put forward to stand for your covert. Whose career do you sponsor?',
  options(state) {
    const { gratitude, transactional, best, gratitudeRelative, transactionalRelative } = sponsorshipCandidates(state)
    const rival = rivalPatron(state)
    const rivalName = rival ? rival.name : 'your rival'

    return [
      {
        label: `${best.name} — plainly the ablest of the three`,
        detail: `${transactional.name}'s nephew passed over; ${rivalName}'s protégé slighted.`,
        enabled: true,
        apply(state) {
          adjustTier(state, transactional.id, -1, 'Remembers: you passed over his nephew.')
          markSponsored(state, best.id)
        },
      },
      {
        label: `${gratitudeRelative.name} — kin to ${gratitude.name}`,
        detail: `${gratitude.name} will remember it — but ${transactional.name}'s nephew is passed over.`,
        enabled: true,
        apply(state) {
          earnGoodwill(state, gratitude.id, SPONSOR_KIN_GOODWILL)
          adjustTier(state, gratitude.id, 0, 'Remembers: you stood by her family.')
          adjustTier(state, transactional.id, -1, 'Remembers: you passed over his nephew.')
          markSponsored(state, gratitudeRelative.id)
        },
      },
      {
        label: `${transactionalRelative.name} — kin to ${transactional.name}`,
        detail: `${transactional.name} opens his purse — ${gratitude.name}'s interest may wander.`,
        enabled: true,
        apply(state) {
          adjustTier(state, transactional.id, 1, 'Remembers: you advanced his nephew.')
          earnGoodwill(state, transactional.id, SPONSOR_KIN_GOODWILL_NEW)
          markSponsored(state, transactionalRelative.id)
        },
      },
    ]
  },
}

const hatching: CardTemplate = {
  title: () => 'An Egg Hatches',
  body(state, params) {
    const breed = params.breed as BreedId
    const officer = state.officers.find((o) => o.id === params.officerId)
    const breedName = BREEDS[breed].name
    const officerName = officer ? officer.name : 'your candidate'
    return `A young ${breedName} breaks its shell in the incubation shed, and will suffer no hand near it but ${officerName}'s.`
  },
  options(_state, params) {
    return [
      {
        label: 'Welcome them to the covert',
        detail: 'Formalize the bond — your candidate takes the harness and becomes captain.',
        enabled: true,
        apply(state, rng) {
          hatchEgg(state, rng, params.breed as BreedId, String(params.officerId))
        },
      },
    ]
  },
}

/** Highest-skill living lieutenant not already a captain. */
function bestNonCaptainLieutenant(state: GameState): Officer | null {
  const candidates = state.officers.filter((o) => o.alive && o.rank === 'lieutenant')
  if (candidates.length === 0) return null
  return [...candidates].sort((a, b) => b.skill - a.skill)[0]
}

/** Simplifying binding (Task 7): "most powerful" = highest feed cost, ties broken by array order. */
function mostPowerfulDragon(state: GameState): Dragon | null {
  if (state.dragons.length === 0) return null
  return [...state.dragons].sort((a, b) => FEED_COST[b.breed] - FEED_COST[a.breed])[0]
}

const insuranceOfficer: CardTemplate = {
  title: () => 'A Captaincy to Spare',
  body(state, params) {
    const officer = state.officers.find((o) => o.id === params.officerId)
    const dragon = state.dragons.find((d) => d.id === params.dragonId)
    const officerName = officer ? officer.name : 'a lieutenant'
    const dragonName = dragon ? dragon.name : 'a dragon'
    return `${officerName} could be held back in reserve against the day ${dragonName}'s captain falls in the field. It is a grim sort of foresight, but foresight nonetheless.`
  },
  options(_state, params) {
    const officerId = String(params.officerId)
    const dragonId = String(params.dragonId)
    return [
      {
        label: 'Bench them as living insurance',
        detail: "If that dragon's captain falls, the bond survives it — but a career stalls in the waiting.",
        enabled: true,
        apply(state) {
          state.flags[`insurance:${dragonId}`] = true
          const o = state.officers.find((x) => x.id === officerId)!
          o.morale = Math.max(0, o.morale - INSURANCE_MORALE_COST)
          addLog(state, `${o.name} is quietly held in reserve — insurance against a captain's fall.`)
        },
      },
      {
        label: 'Let them fly their own path',
        detail: 'No dragon is the safer for it, but their own ambitions stay their own.',
        enabled: true,
        apply(state) {
          const o = state.officers.find((x) => x.id === officerId)!
          o.morale = Math.min(100, o.morale + INSURANCE_DECLINE_MORALE)
          addLog(state, `${o.name} is left to make their own way in the covert.`)
        },
      },
    ]
  },
}

const bypassedOfficer: CardTemplate = {
  title: () => 'Passed Over',
  body(state, params) {
    const bypassed = state.officers.find((o) => o.id === params.bypassedId)
    const captain = state.officers.find((o) => o.id === params.newCaptainId)
    const bypassedName = bypassed ? bypassed.name : 'a senior officer'
    const captainName = captain ? captain.name : 'the new captain'
    return `${bypassedName} watches ${captainName} take a dragon's harness — a captaincy that, by seniority, should by rights have been theirs.`
  },
  options(state, params) {
    const bypassedId = String(params.bypassedId)
    return [
      {
        label: 'Console them with a purse',
        detail: `${BYPASS_CONSOLE_COST} coin softens the blow, if not the insult.`,
        enabled: state.coin >= BYPASS_CONSOLE_COST,
        apply(state) {
          state.coin -= BYPASS_CONSOLE_COST
          const o = state.officers.find((x) => x.id === bypassedId)!
          o.morale = Math.min(100, o.morale + BYPASS_CONSOLE_MORALE)
          addLog(state, `${o.name} is consoled with a purse of coin.`)
        },
      },
      {
        label: 'Let it stand',
        detail: 'No purse, no apology — the decision stands as made.',
        enabled: true,
        apply(state) {
          const o = state.officers.find((x) => x.id === bypassedId)!
          o.morale = Math.max(0, o.morale - BYPASS_MORALE_COST)
          addLog(state, `${o.name} says nothing, and the covert notices the silence.`)
        },
      },
    ]
  },
}

const tributeDemand: CardTemplate = {
  title: () => 'A Cut, Demanded',
  body(state, params) {
    const patron = state.patrons.find((p) => p.id === params.patronId)
    const name = patron ? patron.name : 'your patron'
    return `${name} sends word that his patience runs on a schedule, and the schedule says now: he expects his cut.`
  },
  options(state, params) {
    const patron = state.patrons.find((p) => p.id === params.patronId)!
    return [
      {
        label: `Pay his cut (${TRIBUTE_COST} coin)`,
        detail: `${patron.name} is satisfied, and remembers it kindly.`,
        enabled: state.coin >= TRIBUTE_COST,
        apply(state) {
          state.coin -= TRIBUTE_COST
          earnGoodwill(state, patron.id, TRIBUTE_GOODWILL)
          const p = state.patrons.find((x) => x.id === patron.id)!
          p.memory = 'Remembers: tribute paid, and finds it satisfactory.'
          addLog(state, `You pay ${patron.name} his cut.`)
        },
      },
      {
        label: 'Refuse',
        detail: `${patron.name} does not forget a debt unpaid.`,
        enabled: true,
        apply(state) {
          adjustTier(state, patron.id, -1, 'Remembers: you kept his cut.')
          addLog(state, `You refuse ${patron.name} his cut.`)
        },
      },
    ]
  },
}

const trapWarning: CardTemplate = {
  title: () => 'A Quiet Word',
  body(state, params) {
    const mission = state.missions.find((m) => m.id === params.missionId)
    const gratitude = gratitudePatron(state)
    const rival = rivalPatron(state)
    const missionName = mission ? mission.name : 'the offer'
    const rivalName = rival ? rival.name : 'your rival'
    return `${gratitude.name} sends a quiet word of her own: the ${missionName} is not the prize it appears — decline ${rivalName}'s generosity.`
  },
  options(_state, params) {
    const missionId = String(params.missionId)
    return [
      {
        label: 'Heed her warning',
        detail: 'Decline the offer before it can close its jaws.',
        enabled: true,
        apply(state) {
          const mission = state.missions.find((m) => m.id === missionId)
          const rival = rivalPatron(state)
          state.missions = state.missions.filter((m) => m.id !== missionId)
          delete state.flags[`trap:${missionId}`]
          delete state.flags[`warned:${missionId}`]
          addLog(
            state,
            `A quiet word, and you decline ${mission ? mission.name : 'the offer'} — ${rival ? rival.name : 'your rival'}'s generosity along with it.`
          )
        },
      },
    ]
  },
}

/** Escalating war-heat flavor cards. Task 8 pushes these at warHeat 30/55/80; registered now. */
function noteWellOption(logLine: string) {
  return [
    {
      label: 'Note it well',
      detail: 'File the report and carry on.',
      enabled: true,
      apply(state: GameState) {
        addLog(state, logLine)
      },
    },
  ]
}

const warRumorLow: CardTemplate = {
  title: () => 'Distant Cannon',
  body: () => 'Word from the coast: cannon-fire, faint and far off, drifting up the Channel on an easterly wind.',
  options: () => noteWellOption('The Admiralty notes distant cannon-fire in the Channel ports — nothing more, for now.'),
}

const warRumorMid: CardTemplate = {
  title: () => 'Refugee Boats',
  body: () => 'Small boats crowd into the Channel ports, laden with families fleeing a coastline that no longer feels safe.',
  options: () => noteWellOption("Refugee boats crowd the harbours; the war is no longer someone else's."),
}

const warRumorHigh: CardTemplate = {
  title: () => 'The Beacons Are Lit',
  body: () => 'Fire answers fire down the length of the coast: the invasion beacons are lit, and every covert stands to.',
  options: () => noteWellOption('The invasion beacons burn along the coast. There is no pretending otherwise now.'),
}

export const CARDS: Record<string, CardTemplate> = {
  sponsorship,
  hatching,
  'insurance-officer': insuranceOfficer,
  'bypassed-officer': bypassedOfficer,
  'tribute-demand': tributeDemand,
  'trap-warning': trapWarning,
  'war-rumor-low': warRumorLow,
  'war-rumor-mid': warRumorMid,
  'war-rumor-high': warRumorHigh,
}

function pushCard(state: GameState, templateId: string, params: Record<string, string | number>): void {
  const card: CardInstance = { id: `c${state.nextId}`, templateId, params }
  state.nextId += 1
  state.pendingCards.push(card)
}

/** Trigger 3: insurance-officer — a mid-run one-shot once the covert has depth. */
function tryInsurance(state: GameState): boolean {
  if (state.flags['insurance-offered']) return false
  if (state.dragons.length < INSURANCE_MIN_DRAGONS) return false
  const lieutenant = bestNonCaptainLieutenant(state)
  if (!lieutenant) return false
  const dragon = mostPowerfulDragon(state)
  if (!dragon) return false

  state.flags['insurance-offered'] = true
  pushCard(state, 'insurance-officer', { officerId: lieutenant.id, dragonId: dragon.id })
  return true
}

/** Trigger 5: tribute-demand — fires on a fixed cadence once the transactional patron is warm. */
function tryTribute(state: GameState): boolean {
  const transactional = transactionalPatron(state)
  if (transactional.tier < 1) return false
  if (state.day <= 0 || state.day % TRIBUTE_DEMAND_INTERVAL_DAYS !== 0) return false
  const doneFlag = `tribute-done-${state.day}`
  if (state.flags[doneFlag]) return false

  // Track only the latest cadence marker — drop stale ones so flags don't
  // grow (same idiom as the offers-day and auction retry markers).
  for (const key of Object.keys(state.flags)) {
    if (key.startsWith('tribute-done-')) delete state.flags[key]
  }
  state.flags[doneFlag] = true
  pushCard(state, 'tribute-demand', { patronId: transactional.id })
  return true
}

/** Trigger 6: trap-warning — the gratitude patron occasionally tips you off to a rival's trap. */
function tryTrapWarning(state: GameState, rng: Rng): boolean {
  const gratitude = gratitudePatron(state)
  if (gratitude.tier < GIFT_TIER_MIN) return false
  const trapMission = state.missions.find(
    (m) => m.status === 'offered' && state.flags[`trap:${m.id}`] === true && !state.flags[`warned:${m.id}`]
  )
  if (!trapMission) return false
  if (rng.next() >= TRAP_WARNING_CHANCE) return false

  state.flags[`warned:${trapMission.id}`] = true
  pushCard(state, 'trap-warning', { missionId: trapMission.id })
  return true
}

/**
 * Day-boundary scripted-content scheduler. Never stacks: if a card is
 * already pending — from this function or anywhere else (hatchEgg's
 * bypassed-officer, the auction's hatching card) — it does nothing, and it
 * stays silent while an auction is live (same precedent as patrons.ts's
 * canInjectTrap: no new demands mid-auction). Checks triggers in a fixed
 * priority order and pushes at most one card per day.
 */
export function tickCards(state: GameState, rng: Rng): void {
  if (state.tickCount % TICKS_PER_DAY !== 0) return
  if (state.pendingCards.length > 0) return
  if (state.auction !== null) return
  if (state.status !== 'running') return

  if (tryInsurance(state)) return
  if (tryTribute(state)) return
  if (tryTrapWarning(state, rng)) return
}
