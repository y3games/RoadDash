/**
 * The difficulty ramp as pure functions.
 *
 * This module must never import Phaser. Every number it works with comes from
 * `config.ts`; what lives here is only the rule that turns a distance into a
 * level and a level into track parameters.
 *
 * The model: one level-up bumps exactly **one** axis, and the axes are taken in
 * rotation (speed, density, road width, curve, speed, ...). That is what makes
 * a rising difficulty legible — the player can be told which screw just turned,
 * and `tests/difficulty.test.ts` can assert that no level-up moves two axes.
 */

import type { DifficultyAxis, DifficultyParamKey, DifficultyParams } from './config';
import { AXIS_PARAMS, DIFFICULTY, DIFFICULTY_AXES, SCORE } from './config';

/** Level for a distance travelled, 1-based. */
export function levelFor(distance: number): number {
  if (!(distance >= 0) || !Number.isFinite(distance)) {
    throw new RangeError(`distance must be a finite number >= 0: ${distance}`);
  }
  return 1 + Math.floor(distance / DIFFICULTY.levelDistancePx);
}

/** Distance at which a level begins. */
export function distanceForLevel(level: number): number {
  assertLevel(level);
  return (level - 1) * DIFFICULTY.levelDistancePx;
}

/**
 * The axis the jump **into** `level` bumped, or null for level 1 (nothing was
 * bumped to arrive there). Level-up number `k` takes axis `k - 1` mod 4.
 */
export function axisForLevel(level: number): DifficultyAxis | null {
  assertLevel(level);
  if (level === 1) return null;
  return DIFFICULTY_AXES[(level - 2) % DIFFICULTY_AXES.length];
}

/**
 * The ramp is a running sum of decimal steps, so binary floating point drifts:
 * adding 0.0006 six times lands on 0.007799999999999999, and a capped axis
 * would then never compare equal to the cap written in the table. Rounding to
 * 1e-6 — three orders of magnitude finer than the smallest step — keeps every
 * value exactly the decimal the table says it is.
 */
function exact(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Raise a param one step toward its cap. */
function raise(current: number, key: DifficultyParamKey): number {
  return Math.min(exact(current + DIFFICULTY.step[key]), DIFFICULTY.cap[key]);
}

/** Lower a param one step toward its cap. */
function lower(current: number, key: DifficultyParamKey): number {
  return Math.max(exact(current - DIFFICULTY.step[key]), DIFFICULTY.cap[key]);
}

/**
 * How each axis moves. Speed and curve rise; a denser track and a tighter road
 * are *smaller* numbers, so those two fall toward their caps.
 */
const BUMP: Readonly<Record<DifficultyAxis, (p: DifficultyParams) => DifficultyParams>> = {
  speed: (p) => ({ ...p, scrollSpeed: raise(p.scrollSpeed, 'scrollSpeed') }),
  density: (p) => ({ ...p, spawnIntervalPx: lower(p.spawnIntervalPx, 'spawnIntervalPx') }),
  roadWidth: (p) => ({ ...p, roadHalfWidth: lower(p.roadHalfWidth, 'roadHalfWidth') }),
  curve: (p) => ({
    ...p,
    curveAmplitude: raise(p.curveAmplitude, 'curveAmplitude'),
    curveFrequency: raise(p.curveFrequency, 'curveFrequency'),
  }),
};

/**
 * Track parameters at a level.
 *
 * O(level) by replaying the rotation from the base table rather than storing a
 * per-level table, so the ramp has exactly one definition. It is called once
 * per level-up — about thirty times in a long run — not per frame, so there is
 * nothing to memoise here. Do not add a cache.
 */
export function paramsForLevel(level: number): DifficultyParams {
  assertLevel(level);
  let params: DifficultyParams = DIFFICULTY.base;
  for (let levelUp = 1; levelUp < level; levelUp += 1) {
    // Level-up `k` produces level `k + 1`, whose axis is axisForLevel(k + 1).
    const axis = DIFFICULTY_AXES[(levelUp - 1) % DIFFICULTY_AXES.length];
    params = BUMP[axis](params);
  }
  return params;
}

/** True once every axis sits at its cap and a level-up changes nothing. */
export function isMaxedOut(level: number): boolean {
  const params = paramsForLevel(level);
  return PARAM_KEYS.every((key) => params[key] === DIFFICULTY.cap[key]);
}

/** Score for a distance travelled. Integral and monotone by construction. */
export function scoreForDistance(distance: number): number {
  if (!(distance >= 0) || !Number.isFinite(distance)) {
    throw new RangeError(`distance must be a finite number >= 0: ${distance}`);
  }
  return Math.floor(distance / SCORE.pxPerPoint);
}

/** Every param key, derived from the axis table so the two cannot drift. */
export const PARAM_KEYS: readonly DifficultyParamKey[] = DIFFICULTY_AXES.flatMap(
  (axis) => AXIS_PARAMS[axis],
);

function assertLevel(level: number): void {
  if (!Number.isInteger(level) || level < 1) {
    throw new RangeError(`level must be an integer >= 1: ${level}`);
  }
}
