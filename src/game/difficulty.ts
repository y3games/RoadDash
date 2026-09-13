/**
 * The difficulty ramp as pure functions.
 *
 * This module must never import Phaser. Every number it works with comes from
 * `config.ts`; what lives here is only the rule that turns a distance into a
 * level and a level into track parameters.
 *
 * The model: one level-up moves exactly **one** axis, and the axes are taken in
 * rotation (speed, density, road width, curve, speed, ...). That is what makes
 * a rising difficulty legible — the player can be told which screw just turned,
 * and `tests/difficulty.test.ts` can assert that no level-up moves two axes.
 *
 * Once all four are capped the rotation continues on two **tail** axes, which
 * keep shrinking the room for error. A flat endgame would turn a high-score
 * game into an endurance test.
 */

import type {
  DifficultyAxis,
  DifficultyParamKey,
  DifficultyParams,
  RotationAxis,
  RotationParamKey,
  TailAxis,
} from './config';
import {
  AXIS_PARAMS,
  DIFFICULTY,
  DIFFICULTY_AXES,
  EARLY,
  SAFE_GAP,
  SCORE,
  TAIL_AXES,
  TAIL_AXIS_PARAMS,
} from './config';

/** Every param the rotation moves, derived from the axis table so the two
 * cannot drift. Tail params are deliberately not here. */
export const PARAM_KEYS: readonly RotationParamKey[] = DIFFICULTY_AXES.flatMap(
  (axis) => AXIS_PARAMS[axis] as readonly RotationParamKey[],
);

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
function raise(current: number, key: RotationParamKey): number {
  return Math.min(exact(current + DIFFICULTY.step[key]), DIFFICULTY.cap[key]);
}

/** Lower a param one step toward its cap. */
function lower(current: number, key: RotationParamKey): number {
  return Math.max(exact(current - DIFFICULTY.step[key]), DIFFICULTY.cap[key]);
}

/**
 * How each rotation axis moves. Speed and curve rise; a denser track and a
 * tighter road are *smaller* numbers, so those two fall toward their caps.
 */
const BUMP: Readonly<Record<RotationAxis, (p: RampParams) => RampParams>> = {
  speed: (p) => ({ ...p, scrollSpeed: raise(p.scrollSpeed, 'scrollSpeed') }),
  density: (p) => ({ ...p, spawnIntervalPx: lower(p.spawnIntervalPx, 'spawnIntervalPx') }),
  roadWidth: (p) => ({ ...p, roadHalfWidth: lower(p.roadHalfWidth, 'roadHalfWidth') }),
  curve: (p) => ({
    ...p,
    curveAmplitude: raise(p.curveAmplitude, 'curveAmplitude'),
    curveFrequency: raise(p.curveFrequency, 'curveFrequency'),
  }),
};

/** How each tail axis moves. Both shrink what the player has to work with. */
const TAIL_BUMP: Readonly<Record<TailAxis, (p: RampParams) => RampParams>> = {
  gapWidth: (p) => ({
    ...p,
    gapSlackRatio: Math.max(
      exact(p.gapSlackRatio - DIFFICULTY.tailStep.gapSlackRatio),
      DIFFICULTY.tailCap.gapSlackRatio,
    ),
  }),
  spacing: (p) => ({
    ...p,
    spawnIntervalPx: Math.max(
      exact(p.spawnIntervalPx - DIFFICULTY.tailStep.spawnIntervalPx),
      DIFFICULTY.tailCap.spawnIntervalPx,
    ),
  }),
};

/** Everything the level model moves by stepping, i.e. all of it but the
 * beginner's gap floor, which is a function of the level rather than a step. */
type RampParams = Omit<DifficultyParams, 'minGapWidth'>;

/** Replay the rotation up to a level, without the level-driven extras. */
function rotate(level: number, until: number): RampParams {
  let params: RampParams = DIFFICULTY.base;
  for (let next = 2; next <= level; next += 1) {
    params =
      next >= until
        ? TAIL_BUMP[TAIL_AXES[(next - until) % TAIL_AXES.length]](params)
        : BUMP[DIFFICULTY_AXES[(next - 2) % DIFFICULTY_AXES.length]](params);
  }
  return params;
}

/** The first level at which every rotation axis sits at its cap. */
function firstMaxedLevel(): number {
  for (let level = 2; level < 500; level += 1) {
    const params = rotate(level, Number.POSITIVE_INFINITY);
    if (PARAM_KEYS.every((key) => params[key] === DIFFICULTY.cap[key])) return level;
  }
  throw new Error('the rotation never reaches its caps: check DIFFICULTY');
}

/**
 * The first level of the tail — where the rotation axes have nothing left to
 * give and the tail axes take over. Derived rather than written down, so
 * retuning the ramp cannot leave the tail starting in the middle of it.
 *
 * One **past** the level that caps the last axis, not on it: the tail replaces
 * that level's bump rather than following it, so starting a level early would
 * quietly cost the rotation its final step — the road would stop narrowing six
 * px short of its cap, for good.
 */
export const TAIL_START_LEVEL: number = firstMaxedLevel() + 1;

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
 * The axis the jump **into** `level` is assigned by the rotation, or null for
 * level 1 (nothing was bumped to arrive there).
 *
 * This is the schedule, not the outcome: an axis already at its cap is still
 * this level's axis. Ask `axisRaisedAt()` whether anything actually moved.
 */
export function axisForLevel(level: number): DifficultyAxis | null {
  assertLevel(level);
  if (level === 1) return null;
  if (level >= TAIL_START_LEVEL) {
    return TAIL_AXES[(level - TAIL_START_LEVEL) % TAIL_AXES.length];
  }
  return DIFFICULTY_AXES[(level - 2) % DIFFICULTY_AXES.length];
}

/** The params an axis owns, whether it is a rotation axis or a tail axis. */
function paramsOf(axis: DifficultyAxis): readonly DifficultyParamKey[] {
  return axis in AXIS_PARAMS
    ? AXIS_PARAMS[axis as RotationAxis]
    : TAIL_AXIS_PARAMS[axis as TailAxis];
}

/**
 * The axis a level-up **actually moved**, or null when it changed nothing.
 *
 * The HUD announces this rather than `axisForLevel()`. Both tail axes cap
 * eventually, and a toast saying "속도 상승" while nothing rises teaches the
 * player to stop reading the one thing the difficulty model exists to tell them.
 */
export function axisRaisedAt(level: number): DifficultyAxis | null {
  assertLevel(level);
  const axis = axisForLevel(level);
  if (axis === null) return null;

  const before = paramsForLevel(level - 1);
  const after = paramsForLevel(level);
  return paramsOf(axis).some((key) => before[key] !== after[key]) ? axis : null;
}

/**
 * Track parameters at a level.
 *
 * O(level) by replaying the rotation from the base table rather than storing a
 * per-level table, so the ramp has exactly one definition. It is called once
 * per level-up — a few dozen times in a long run — not per frame, so there is
 * nothing to memoise here. Do not add a cache.
 */
export function paramsForLevel(level: number): DifficultyParams {
  assertLevel(level);
  const params = rotate(level, TAIL_START_LEVEL);

  // Not an axis: a beginner is handed a wider floor on every gap, decaying to
  // the safe minimum. Gap width is uniform over its legal range, so without
  // this the very first row could be as tight as the very last one — and about
  // one row in ten was, before the player had learned how the car responds.
  const bonus = EARLY.gapBonusPx * Math.max(0, 1 - (level - 1) / EARLY.levels);
  return { ...params, minGapWidth: SAFE_GAP + bonus };
}

/**
 * True once every **rotation** axis sits at its cap.
 *
 * It stays true through the tail, which lowers `spawnIntervalPx` past its
 * rotation cap — "the rotation is finished" is the question this answers, not
 * "difficulty has stopped rising".
 */
export function isMaxedOut(level: number): boolean {
  assertLevel(level);
  return level >= TAIL_START_LEVEL - 1;
}

/**
 * What a px of track is worth at this level, as a multiple of the base rate.
 *
 * Rows arrive twice as fast at the cap as at the start, so paying by distance
 * alone paid *less* for the hardest row in the game than for the easiest. This
 * puts the rate back on the same side as the risk.
 */
export function scoreMultiplier(level: number): number {
  assertLevel(level);
  return 1 + SCORE.levelBonus * (level - 1);
}

/** Points earned by travelling `distance` px at `level`. */
export function pointsFor(distance: number, level: number): number {
  if (!(distance >= 0) || !Number.isFinite(distance)) {
    throw new RangeError(`distance must be a finite number >= 0: ${distance}`);
  }
  return (distance / SCORE.pxPerPoint) * scoreMultiplier(level);
}

function assertLevel(level: number): void {
  if (!Number.isInteger(level) || level < 1) {
    throw new RangeError(`level must be an integer >= 1: ${level}`);
  }
}
