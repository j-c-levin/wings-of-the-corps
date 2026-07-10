import { createRng } from './rng'
import { SCHEMA_VERSION, START_COIN } from './balance'
import { OFFICER_NAMES, PATRON_DEFS } from './content'
import type { OfficerNameEntry } from './content'
import type { GameState, Officer, Patron, Rank, Id } from './types'

const OFFICER_START_MORALE = 70

/** Allocates ids from a single shared monotonic counter, e.g. "o1", "p2", "c3". */
function makeIdCounter() {
  let counter = 1
  return {
    next(prefix: string): Id {
      const id = `${prefix}${counter}`
      counter += 1
      return id
    },
    get value() {
      return counter
    },
  }
}

function takeName(
  rng: ReturnType<typeof createRng>,
  gender: 'm' | 'f',
  used: Set<string>
): string {
  const candidates = OFFICER_NAMES.filter((n: OfficerNameEntry) => n.gender === gender && !used.has(n.name))
  const pool = candidates.length > 0 ? candidates : OFFICER_NAMES.filter((n: OfficerNameEntry) => n.gender === gender)
  const chosen = rng.pick(pool)
  used.add(chosen.name)
  return chosen.name
}

export function newRun(seed: number): GameState {
  const rng = createRng(seed)
  const ids = makeIdCounter()
  const usedNames = new Set<string>()

  // Patrons first — the two connected candidates need their patron ids.
  const patrons: Patron[] = PATRON_DEFS.map((def) => ({
    id: ids.next('p'),
    name: def.name,
    kind: def.kind,
    tier: def.tier,
    goodwill: def.goodwill,
    memory: def.memory,
  }))
  const allendale = patrons.find((p) => p.kind === 'gratitude')!
  const barham = patrons.find((p) => p.kind === 'transactional')!

  // Guarantee mixed genders and at least one strong (skill>=4) female
  // candidate exists among the three candidates in every run, so a later
  // task's Longwing gate always has a possible path.
  const candidateGenders: ('m' | 'f')[] = [rng.pick(['m', 'f']), rng.pick(['m', 'f']), rng.pick(['m', 'f'])]
  if (!candidateGenders.includes('f')) {
    candidateGenders[0] = 'f'
  }

  const bestCandidate: Officer = {
    id: ids.next('o'),
    name: takeName(rng, candidateGenders[0], usedNames),
    gender: candidateGenders[0],
    rank: 'midwingman',
    xp: 0,
    skill: 7,
    nerve: 7,
    morale: OFFICER_START_MORALE,
    dragonId: null,
    relatedPatronId: null,
    alive: true,
  }

  const allendaleRelative: Officer = {
    id: ids.next('o'),
    name: takeName(rng, candidateGenders[1], usedNames),
    gender: candidateGenders[1],
    rank: 'midwingman',
    xp: 0,
    skill: 4,
    nerve: rng.int(4, 6),
    morale: OFFICER_START_MORALE,
    dragonId: null,
    relatedPatronId: allendale.id,
    alive: true,
  }

  const barhamRelative: Officer = {
    id: ids.next('o'),
    name: takeName(rng, candidateGenders[2], usedNames),
    gender: candidateGenders[2],
    rank: 'midwingman',
    xp: 0,
    skill: 4,
    nerve: rng.int(4, 6),
    morale: OFFICER_START_MORALE,
    dragonId: null,
    relatedPatronId: barham.id,
    alive: true,
  }

  const juniorRanks: Rank[] = ['runner', 'ensign', 'runner']
  const juniors: Officer[] = juniorRanks.map((rank) => {
    const gender: 'm' | 'f' = rng.pick(['m', 'f'])
    return {
      id: ids.next('o'),
      name: takeName(rng, gender, usedNames),
      gender,
      rank,
      xp: 0,
      skill: rng.int(1, 3),
      nerve: rng.int(2, 5),
      morale: OFFICER_START_MORALE,
      dragonId: null,
      relatedPatronId: null,
      alive: true,
    }
  })

  const officers: Officer[] = [bestCandidate, allendaleRelative, barhamRelative, ...juniors]

  const sponsorshipCard = {
    id: ids.next('c'),
    templateId: 'sponsorship',
    params: {},
  }

  const state: GameState = {
    schemaVersion: SCHEMA_VERSION,
    seed,
    rngState: rng.getState(),
    status: 'running',
    ending: null,
    score: 0,
    tickCount: 0,
    day: 0,
    rung: 1,
    coin: START_COIN,
    feed: 0,
    treasure: 0,
    standing: 5,
    expectation: 0,
    failStreakDays: 0,
    officers,
    dragons: [],
    patrons,
    missions: [],
    auction: null,
    pendingCards: [sponsorshipCard],
    log: [{ day: 0, text: 'You take command of a threadbare covert and six hopeful officers.' }],
    warHeat: 0,
    finaleStarted: false,
    flags: {},
    nextId: ids.value,
  }

  return state
}
