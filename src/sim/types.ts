export type Id = string
export type BreedId = 'winchester' | 'greyling' | 'grey-copper' | 'yellow-reaper' | 'longwing' | 'chequered-nettle' | 'kazilik'
export type Rank = 'runner' | 'ensign' | 'midwingman' | 'lieutenant' | 'captain'

export interface Officer {
  id: Id; name: string; gender: 'm' | 'f'
  rank: Rank; xp: number
  skill: number        // 1..10, derived-but-stored, grows with xp
  nerve: number         // 1..10, fixed at creation
  morale: number        // 0..100
  dragonId: Id | null   // set when captain
  relatedPatronId: Id | null
  alive: boolean
}

export interface Dragon {
  id: Id; name: string; breed: BreedId
  training: number       // 0..100
  woundsTemp: number     // 0..100, heals over time; 100 = out of action
  woundsLasting: number  // 0..30, permanent penalty
  contentment: number    // 0..100
  captainId: Id
  status: 'home' | 'mission' | 'healing'
  missionId: Id | null
}

export type PatronKind = 'gratitude' | 'transactional' | 'rival'
export interface Patron {
  id: Id; name: string; kind: PatronKind
  tier: number      // -3..3
  goodwill: number  // 0..10 spendable
  memory: string    // one-line last grievance/favour, shown on People tab
}

export type MissionKind = 'dispatch' | 'combat' | 'formation' | 'war'
export interface MissionOutcome {
  success: boolean
  woundsTemp: number; woundsLasting: number
  crewLost: number             // unnamed ground-crew count
  officerLostId: Id | null     // severity 2+
  dragonLost: boolean          // severity 3 only
  narrative: string
}
export interface Mission {
  id: Id; name: string; kind: MissionKind
  severityTier: 1 | 2 | 3
  rewardCoin: number; rewardTreasure: number; rewardStanding: number
  patronId: Id | null
  offerExpiresDay: number      // accept by this day or it vanishes (late: refusal cost)
  deadlineDay: number          // must RESOLVE by this day or promise broken
  durationTicks: number
  enemyStrength: number        // 0..10 visible
  weather: number               // 0..1 visible, higher = worse
  status: 'offered' | 'active' | 'done'
  assignedDragonId: Id | null
  returnTick: number | null
  outcome: MissionOutcome | null
}

export interface AuctionEgg { breed: BreedId; claimedBy: string | null }
export interface AuctionBidder { name: string; influence: number; you: boolean }
export interface Auction {
  eggs: AuctionEgg[]              // ordered best→worst
  bidders: AuctionBidder[]        // sorted desc by influence each tick
  ticksRemaining: number
  ticksPerClaim: number
  nextClaimIn: number
  concluded: boolean
  wonBreed: BreedId | null
  candidateOfficerId: Id
}

export interface CardInstance { id: Id; templateId: string; params: Record<string, string | number> }
export interface LogLine { day: number; text: string }

export interface GameState {
  schemaVersion: number
  seed: number; rngState: number
  status: 'running' | 'ended'
  ending: 'relieved' | 'wing-destroyed' | 'survived' | null
  score: number
  tickCount: number; day: number
  rung: 1 | 2 | 3 | 4
  coin: number; feed: number; treasure: number
  standing: number       // 0..100
  expectation: number    // 0..100 rising red line
  failStreakDays: number // days spent with standing < expectation
  officers: Officer[]; dragons: Dragon[]; patrons: Patron[]
  missions: Mission[]; auction: Auction | null
  pendingCards: CardInstance[]
  log: LogLine[]         // capped ring, newest last
  warHeat: number        // 0..100 hidden
  finaleStarted: boolean
  flags: Record<string, boolean>
  nextId: number         // monotonic id counter ("o1","d2","m3"…)
}
