import type { Rank, BreedId } from './types'

export const SCHEMA_VERSION = 1
export const TICKS_PER_DAY = 3
export const LOG_CAP = 60
export const START_COIN = 60
export const RUNG_STANDING = { 2: 20, 3: 45, 4: 70 } as const  // auction triggers at 2/3; 4 = finale eligibility
export const RUNG_RANK_GATE: Record<2 | 3, Rank> = { 2: 'midwingman', 3: 'lieutenant' }
export const EXPECTATION_RISE_PER_STANDING = 0.55 // expectation trails standing growth
export const EXPECTATION_FLOOR_BY_RUNG = { 1: 0, 2: 12, 3: 30, 4: 50 } as const
export const FAIL_DAYS_TO_RELIEVED = 30           // sustained standing<expectation ends run
export const FEED_COST: Record<BreedId, number> = { winchester: 1, greyling: 1, 'grey-copper': 2, 'yellow-reaper': 3, longwing: 3, 'chequered-nettle': 6, kazilik: 6 }
export const WAR_HEAT_PER_DAY = 0.28              // ~360 days to finale
export const FINALE_HEAT = 100
// mission maths
export const BASE_SUCCESS = 0.95
export const ENEMY_WEIGHT = 0.06
export const READINESS_WEIGHT = 0.05
export const WEATHER_WEIGHT = 0.10
export const MIN_SUCCESS = 0.05
export const MAX_SUCCESS = 0.98
