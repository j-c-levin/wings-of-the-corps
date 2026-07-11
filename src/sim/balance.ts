import type { Rank, BreedId } from './types'

export const SCHEMA_VERSION = 1
export const TICKS_PER_DAY = 3
export const LOG_CAP = 60
export const START_COIN = 60
export const RUNG_STANDING = { 2: 20, 3: 45, 4: 70 } as const  // auction triggers at 2/3; 4 = finale eligibility
export const RUNG_RANK_GATE: Record<2 | 3, Rank> = { 2: 'midwingman', 3: 'lieutenant' }
export const EXPECTATION_RISE_PER_STANDING = 0.55 // expectation trails standing growth
export const EXPECTATION_FLOOR_BY_RUNG = { 1: 0, 2: 15, 3: 40, 4: 55 } as const // a bigger covert is expected to hold real standing — the late red line has teeth
export const FAIL_DAYS_TO_RELIEVED = 30           // sustained standing<expectation ends run
export const FEED_COST: Record<BreedId, number> = { winchester: 1, greyling: 1, 'grey-copper': 2, 'yellow-reaper': 3, longwing: 3, 'chequered-nettle': 6, kazilik: 6 }
export const FEED_SHORTFALL_CONTENTMENT = 4       // per-dragon contentment hit on a feed shortfall day
export const WOUND_HEAL_PER_DAY = 2
export const HEALING_THRESHOLD = 60               // woundsTemp at/above this benches a dragon as 'healing'
export const TRAINING_PER_DAY = 0.8               // passive training gain for dragons at home
export const CONTENTMENT_BASELINE = 50            // daily drift target
export const WOUNDED_LOG_CHANCE = 0.5             // daily flavor-log odds of 'wounded' context when any dragon is hurt
export const WAR_HEAT_PER_DAY = 0.25              // + WAR_HEAT_NOISE mean 0.05 = ~0.30/day → finale centred ~day 333 (mid of the 300-380 window)
export const FINALE_HEAT = 100
// mission maths
export const BASE_SUCCESS = 0.95
export const ENEMY_WEIGHT = 0.06
export const READINESS_WEIGHT = 0.05
export const WEATHER_WEIGHT = 0.10
export const MIN_SUCCESS = 0.05
export const MAX_SUCCESS = 0.98
// starting roster tuning (consumed by newRun)
export const START_STANDING = 5
export const OFFICER_START_MORALE = 70
export const CANDIDATE_SKILL_BEST = 7
export const CANDIDATE_NERVE_BEST = 7
export const CANDIDATE_SKILL_RELATIVE = 4
export const RELATIVE_NERVE_RANGE: readonly [number, number] = [4, 6]
export const JUNIOR_SKILL_RANGE: readonly [number, number] = [1, 3]
export const JUNIOR_NERVE_RANGE: readonly [number, number] = [2, 5]

// projection.ts — dragonPower / successChance / riskLabel / availabilityForecast
export const CONTENTMENT_FACTOR_BASE = 0.7
export const CONTENTMENT_FACTOR_SCALE = 0.6
export const CAPTAIN_FACTOR_BASE = 0.75
export const CAPTAIN_SKILL_WEIGHT = 0.04
export const CAPTAIN_NERVE_WEIGHT = 0.01
export const DRAGON_POWER_MIN = 0.1
export const RISK_SAFE = 0.85
export const RISK_RISKY = 0.65
export const RISK_DANGEROUS = 0.4
export const AVG_WOUND_ESTIMATE = 20

// missions.ts — offer generation
export const REFUSAL_WAR_HEAT_GATE = 80
export const REFUSAL_STANDING_COST = 2
export const OFFER_INTERVAL_DAYS = 3
export const MAX_OPEN_OFFERS = 3
export const OFFER_WINDOW_DAYS = 4
export const DEADLINE_SLACK_DAYS = 3
export const DISPATCH_DURATION_MIN_DAYS = 2
export const DISPATCH_DURATION_MAX_DAYS = 4
export const COMBAT_DURATION_MIN_DAYS = 3
export const COMBAT_DURATION_MAX_DAYS = 5
export const FORMATION_DURATION_MIN_DAYS = 4
export const FORMATION_DURATION_MAX_DAYS = 7
export const ENEMY_STRENGTH_SEV1_MIN = 0
export const ENEMY_STRENGTH_SEV1_MAX = 3
export const ENEMY_STRENGTH_SEV2_MIN = 3
export const ENEMY_STRENGTH_SEV2_MAX = 6
export const ENEMY_STRENGTH_SEV3_MIN = 5
export const ENEMY_STRENGTH_SEV3_MAX = 9
export const COIN_REWARD_BASE = 10
export const COIN_REWARD_PER_ENEMY = 2
export const TREASURE_REWARD = 5
export const STANDING_REWARD_BASE = 3
export const PATRON_MISSION_STANDING_BONUS = 2
export const PATRON_MISSION_CHANCE = 0.3

// missions.ts — resolution
export const LIGHT_WOUND_MAX = 10
export const CREW_LOST_SUCCESS_MAX = 2
export const FAIL_WOUND_MIN = 15
export const FAIL_WOUND_MAX = 45
export const FAIL_LASTING_MAX = 5
export const FAIL_STANDING_COST = 2
export const CREW_LOST_FAIL_SEV1_MIN = 0
export const CREW_LOST_FAIL_SEV1_MAX = 2
export const CREW_LOST_FAIL_SEV2_MIN = 1
export const CREW_LOST_FAIL_SEV2_MAX = 4
export const CREW_LOST_FAIL_SEV3_MIN = 2
export const CREW_LOST_FAIL_SEV3_MAX = 6
export const OFFICER_DEATH_CHANCE = 0.15   // sev-2 failure captain-death cascade; at 0.25 it bled ~1.6 dragons/run pre-finale and pinned the wing at 1 dragon
export const DRAGON_LOSS_CHANCE = 0.45     // sev-3 failure outright dragon loss — the finale's teeth; pre-finale sev-3 exposure is small
export const CAPTAIN_MORALE_LOSS_ON_DRAGON_DEATH = 30
export const LATE_STANDING_COST = 3
export const PATRON_SUCCESS_GOODWILL = 1
export const XP_PER_MISSION = 10
export const SKILL_GROWTH_CHANCE = 0.3
export const SKILL_MAX = 10
export const DONE_MISSION_CAP = 8

// patrons.ts
export const TIER_MIN = -3
export const TIER_MAX = 3
export const GOODWILL_CAP = 10
export const GIFT_TIER_MIN = 2
export const GIFT_CHANCE = 0.04
export const GIFT_COIN = 25
export const GIFT_GOODWILL = 2
export const RIVAL_SABOTAGE_TIER = -1
export const TRAP_CHANCE = 0.03
export const TRAP_ENEMY_MIN = 6
export const TRAP_ENEMY_MAX = 9
export const TRAP_REWARD_MULT = 1.5

// actions.ts
export const TREASURE_CONTENTMENT = 15
export const TRIBUTE_COST = 30
export const TRIBUTE_GOODWILL = 2
export const FEED_PRICE = 2
export const AUCTION_GOODWILL_COST = 2
export const AUCTION_BUMP = 3

// auction.ts — bidding state machine
export const AUCTION_RIVALS = 5
export const STANDING_INFLUENCE_DIVISOR = 10
export const RIVAL_INFLUENCE_SPREAD_MIN = -2
export const RIVAL_INFLUENCE_SPREAD_MAX = 4
export const AUCTION_TICKS_PER_CLAIM = 5
export const AUCTION_GRACE_TICKS = 10
export const FIRST_AUCTION_RIVAL_MARGIN = 2
export const JITTER_CHANCE = 0.5
export const JITTER_SIZE = 1
export const AUCTION_PATRON_HELP_CHANCE = 0.06
export const AUCTION_PATRON_BUMP = 2
export const AUCTION_RIVAL_HURT_CHANCE = 0.06
export const EGG_HATCH_DAYS = 2
export const FEMALE_CANDIDATE_SKILL_SLACK = 2
export const AUCTION_RETRY_COOLDOWN_DAYS = 20  // days before a lost rung-2/3 auction is re-offered
// hatchEgg — new dragon / captain starting stats
export const TRAINING_START = 20
export const CONTENTMENT_START = 60
export const HATCH_MORALE_BONUS = 10

// missions.ts — crew equity conversion (non-captain xp + promotion thresholds)
export const CREW_XP_PER_MISSION = 2
export const RANK_XP: Record<'ensign' | 'midwingman' | 'lieutenant', number> = { ensign: 15, midwingman: 40, lieutenant: 90 }

// cards.ts — decision card registry
export const SPONSOR_KIN_GOODWILL = 2       // sponsorship: gratitude patron's relative chosen
export const SPONSOR_KIN_GOODWILL_NEW = 4   // sponsorship: transactional patron's relative chosen
export const INSURANCE_MIN_DRAGONS = 2
export const INSURANCE_MORALE_COST = 20
export const INSURANCE_DECLINE_MORALE = 5
export const BYPASS_CONSOLE_COST = 10
export const BYPASS_CONSOLE_MORALE = 5
export const BYPASS_MORALE_COST = 15
export const TRIBUTE_DEMAND_INTERVAL_DAYS = 60
export const TRAP_WARNING_CHANCE = 0.15

// war.ts — heat clock, authored finale, kazilik quest, scoring
export const WAR_HEAT_NOISE = 0.1            // extra daily heat draw, rng.next() * this
export const WAR_RUMOR_LOW_HEAT = 30
export const WAR_RUMOR_MID_HEAT = 55
export const WAR_RUMOR_HIGH_HEAT = 80
export const WAR_LOG_CHANCE = 0.15           // daily odds of an extra war-flavor log line once heat >= 30
export const FINALE_LENGTH_DAYS = 30
export const FINALE_MISSION_INTERVAL_DAYS = 2
export const FINALE_MISSION_COUNT = 12       // authored war-mission sequence across the finale window
export const FINALE_SEVERITY_PATTERN: ReadonlyArray<2 | 3> = [2, 2, 3, 3, 3, 3] // per-mission severity, indexed by (i-1); last value is the fallback
export const WAR_ENEMY_MIN = 4              // low enough that some war offers are flyable (not all desperate) — an engaged finale kills dragons; a turtled one was free
export const WAR_ENEMY_MAX = 10
export const WAR_MISSION_DURATION_MIN_DAYS = 3
export const WAR_MISSION_DURATION_MAX_DAYS = 5
export const WAR_OFFER_WINDOW_DAYS = 7      // at 3, ~90% of war offers expired before any dragon came home — a wide window lets a deep bench actually fly (and risk) the war
export const WAR_DEADLINE_SLACK_DAYS = 2
export const WAR_REWARD_MULT = 1.5
export const SCORE_PER_DRAGON_WEIGHT: Record<'courier' | 'light' | 'middle' | 'heavy', number> = {
  courier: 10,
  light: 15,
  middle: 25,
  heavy: 40,
}
export const SCORE_PER_OFFICER = 3
export const SCORE_PER_PATRON_TIER = 5
export const KAZILIK_COST = 120
export const TREASURE_KAZILIK_CONSOLATION = 5
