/**
 * Game rules as pure functions.
 *
 * This module must never import Phaser. Keeping decisions here rather than in a
 * scene is what makes the rule set testable without booting a game — see
 * `tests/rules.test.ts`. Scenes translate engine events into calls on these
 * functions and apply the result.
 */

import { BALL_KINDS, SPAWN_WEIGHTS } from './config';

export function isValidKind(kind: number): boolean {
  return Number.isInteger(kind) && kind >= 0 && kind < BALL_KINDS.length;
}

export function ballRadius(kind: number): number {
  if (!isValidKind(kind)) {
    throw new RangeError(`kind out of range: ${kind}`);
  }
  return BALL_KINDS[kind].radius;
}

export function scoreForKind(kind: number): number {
  if (!isValidKind(kind)) {
    throw new RangeError(`kind out of range: ${kind}`);
  }
  return BALL_KINDS[kind].score;
}

/**
 * Pick a ball kind from a uniform random value in [0, 1).
 *
 * Taking the random value as an argument instead of calling Math.random() keeps
 * this deterministic, which is the whole reason it can be tested.
 */
export function pickKind(random: number): number {
  if (!(random >= 0 && random < 1)) {
    throw new RangeError(`random must be in [0, 1): ${random}`);
  }
  const total = SPAWN_WEIGHTS.reduce((sum, w) => sum + w, 0);
  let threshold = random * total;
  for (let kind = 0; kind < SPAWN_WEIGHTS.length; kind += 1) {
    threshold -= SPAWN_WEIGHTS[kind];
    if (threshold < 0) return kind;
  }
  // Unreachable for valid input; guards against float drift at the top.
  return SPAWN_WEIGHTS.length - 1;
}
