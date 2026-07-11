import type { GameState } from './types'
import type { Rng } from './rng'

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

/** Empty for now — Task 7 (decision cards + scripted content) registers templates here. */
export const CARDS: Record<string, CardTemplate> = {}
