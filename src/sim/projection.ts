import type { Dragon, GameState, Id, Mission, MissionKind } from './types'
import { BREEDS } from './content'
import {
  BASE_SUCCESS,
  ENEMY_WEIGHT,
  READINESS_WEIGHT,
  WEATHER_WEIGHT,
  MIN_SUCCESS,
  MAX_SUCCESS,
  CONTENTMENT_FACTOR_BASE,
  CONTENTMENT_FACTOR_SCALE,
  CAPTAIN_FACTOR_BASE,
  CAPTAIN_SKILL_WEIGHT,
  CAPTAIN_NERVE_WEIGHT,
  DRAGON_POWER_MIN,
  RISK_SAFE,
  RISK_RISKY,
  RISK_DANGEROUS,
  AVG_WOUND_ESTIMATE,
  WOUND_HEAL_PER_DAY,
  HEALING_THRESHOLD,
  TICKS_PER_DAY,
} from './balance'

/**
 * THE shared honesty layer. Both the UI's risk read and the mission
 * resolver call these exact functions — the forecast can never lie,
 * because it is not a separate estimate, it is the real calculation.
 */

/** Training/wounds/contentment/captain multipliers shared by both power reads. */
function scaledPower(state: GameState, d: Dragon, basePower: number): number {
  const trainingFactor = 0.5 + d.training / 200
  const woundFactor = 1 - d.woundsTemp / 150 - d.woundsLasting / 100
  const contentmentFactor = CONTENTMENT_FACTOR_BASE + CONTENTMENT_FACTOR_SCALE * (d.contentment / 100)
  const captain = state.officers.find((o) => o.id === d.captainId)
  const captainFactor = captain
    ? CAPTAIN_FACTOR_BASE + CAPTAIN_SKILL_WEIGHT * captain.skill + CAPTAIN_NERVE_WEIGHT * captain.nerve
    : CAPTAIN_FACTOR_BASE

  const power = basePower * trainingFactor * woundFactor * contentmentFactor * captainFactor
  return Math.max(DRAGON_POWER_MIN, power)
}

/**
 * Kind-aware power — what successChance actually uses. Couriers excel at
 * dispatch (BREEDS dispatchPower), combat breeds at fighting (combatPower,
 * used for 'combat'/'formation'/'war'), so a Winchester on a combat mission
 * is genuinely bad, per the breed table's intent.
 */
export function dragonPowerForKind(state: GameState, d: Dragon, kind: MissionKind): number {
  const breed = BREEDS[d.breed]
  const basePower = kind === 'dispatch' ? breed.dispatchPower : breed.combatPower
  return scaledPower(state, d, basePower)
}

/**
 * Kind-agnostic general-readiness figure (average of a breed's dispatch and
 * combat power) — for roster/condition display, not for mission odds.
 */
export function dragonPower(state: GameState, d: Dragon): number {
  const breed = BREEDS[d.breed]
  return scaledPower(state, d, (breed.dispatchPower + breed.combatPower) / 2)
}

export function successChance(state: GameState, m: Mission, d: Dragon): number {
  const raw =
    BASE_SUCCESS -
    ENEMY_WEIGHT * m.enemyStrength +
    READINESS_WEIGHT * dragonPowerForKind(state, d, m.kind) -
    WEATHER_WEIGHT * m.weather
  return Math.min(MAX_SUCCESS, Math.max(MIN_SUCCESS, raw))
}

export function riskLabel(p: number): 'safe' | 'risky' | 'dangerous' | 'desperate' {
  if (p >= RISK_SAFE) return 'safe'
  if (p >= RISK_RISKY) return 'risky'
  if (p >= RISK_DANGEROUS) return 'dangerous'
  return 'desperate'
}

export function availabilityForecast(state: GameState): { dragonId: Id; freeOnDay: number; note: string }[] {
  return state.dragons.map((d) => {
    if (d.status === 'home') {
      return { dragonId: d.id, freeOnDay: state.day, note: 'ready' }
    }

    if (d.status === 'mission') {
      const mission = state.missions.find((m) => m.id === d.missionId)
      const returnTick = mission?.returnTick ?? state.tickCount
      let freeOnDay = Math.ceil(returnTick / TICKS_PER_DAY)
      if (mission && mission.severityTier >= 2) {
        freeOnDay += Math.ceil(AVG_WOUND_ESTIMATE / WOUND_HEAL_PER_DAY)
      }
      return { dragonId: d.id, freeOnDay, note: 'on mission' }
    }

    // healing
    const freeOnDay = state.day + Math.ceil((d.woundsTemp - HEALING_THRESHOLD + 1) / WOUND_HEAL_PER_DAY)
    return { dragonId: d.id, freeOnDay, note: 'healing' }
  })
}
