/**
 * The difficulty ramp as pure functions.
 *
 * This module must never import Phaser. Every number it works with comes from
 * `config.ts`; what lives here is only the rule that turns a distance into a
 * level and a level into track parameters.
 *
 * The model: one level-up moves exactly **one** axis, taken in rotation (speed,
 * density, road width, curve). An axis already at its cap is skipped rather
 * than announced, so the rotation narrows itself as the track fills up — and
 * because the three geometric axes have fairness floors and speed does not,
 * what is left at the end is speed alone, rising to `SPEED_CEILING`.
 */

import type { DifficultyAxis, DifficultyParams, RotationAxis, RotationParamKey } from './config';
import {
  AXIS_PARAMS,
  DIFFICULTY,
  DIFFICULTY_AXES,
  EARLY,
  SAFE_GAP,
  SCORE,
  SPEED_CEILING,
} from './config';

/** Every param the rotation moves, derived from the axis table so the two
 * cannot drift. */
export const PARAM_KEYS: readonly RotationParamKey[] = DIFFICULTY_AXES.flatMap(
  (axis) => AXIS_PARAMS[axis] as readonly RotationParamKey[],
);

/**
 * The ramp is a running sum of decimal steps, so binary floating point drifts:
 * adding 0.0008 four times lands just short of the cap, and a capped axis would
 * then never compare equal to the cap written in the table. Rounding to 1e-6 —
 * orders of magnitude finer than the smallest step — keeps every value exactly
 * the decimal the table says it is.
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
 * How each axis moves. Speed and curve rise; a denser track and a tighter road
 * are *smaller* numbers, so those two fall toward their caps.
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

/** Everything the level model steps — all of it but the beginner's gap floor,
 * which is a function of the level rather than a step. */
type RampParams = Omit<DifficultyParams, 'minGapWidth'>;

/**
 * Whether a param has room left, in the direction its own axis moves.
 *
 * Not `!== cap`: speed carries on past its rotation cap once nothing else can
 * rise, and an equality test would call that "room" and hand it back to the
 * rotation — whose `raise()` clamps to the cap and would drag the speed back
 * *down*, one level up and one level down, for ever.
 */
function atCap(params: RampParams, key: RotationParamKey): boolean {
  const rises = DIFFICULTY.cap[key] > DIFFICULTY.base[key];
  return rises ? params[key] >= DIFFICULTY.cap[key] : params[key] <= DIFFICULTY.cap[key];
}

function hasRoom(params: RampParams, axis: RotationAxis): boolean {
  return AXIS_PARAMS[axis].some((key) => !atCap(params, key));
}

/** Whether anything but speed can still be raised. */
function hasGeometryRoom(params: RampParams): boolean {
  return DIFFICULTY_AXES.some((axis) => axis !== 'speed' && hasRoom(params, axis));
}

interface Ramp {
  readonly params: RampParams;
  /** The axis this level-up moved, or null when nothing could move. */
  readonly axis: DifficultyAxis | null;
}

/**
 * Replay the ramp from the base table up to a level.
 *
 * At each level-up the rotation is scanned from where it left off for the first
 * axis with headroom, so a capped axis costs nothing — no silent level-up, and
 * the rotation collapses onto whatever is still moving. When the geometry is
 * finished that is speed, which continues past its rotation cap to
 * `SPEED_CEILING`; when even that is spent the level-up moves nothing and says
 * so by returning a null axis.
 */
function replay(level: number): Ramp {
  let params: RampParams = DIFFICULTY.base;
  let cursor = 0;
  let axis: DifficultyAxis | null = null;

  for (let next = 2; next <= level; next += 1) {
    axis = null;

    for (let i = 0; i < DIFFICULTY_AXES.length; i += 1) {
      const candidate = DIFFICULTY_AXES[(cursor + i) % DIFFICULTY_AXES.length];
      if (!hasRoom(params, candidate)) continue;
      params = BUMP[candidate](params);
      cursor = (cursor + i + 1) % DIFFICULTY_AXES.length;
      axis = candidate;
      break;
    }
    if (axis !== null) continue;

    // Nothing geometric is left. Every one of those axes has a floor that
    // fairness sets — a gap the car fits through, reachable by steering, on the
    // road for the whole crossing — so speed is the only screw still turnable.
    const faster = Math.min(
      exact(params.scrollSpeed + DIFFICULTY.tailStep.scrollSpeed),
      SPEED_CEILING,
    );
    if (faster !== params.scrollSpeed) {
      params = { ...params, scrollSpeed: faster };
      axis = 'speed';
    }
  }

  return { params, axis };
}

/**
 * The first level reached by a speed-only level-up — from here on, the shape of
 * the track is settled and speed is the only thing that ever rises again.
 *
 * One past the level whose params exhaust the geometry, because it is the
 * *next* level-up that has nothing but speed to choose from.
 */
export const SPEED_ONLY_LEVEL: number = findLevel(1, (ramp) => !hasGeometryRoom(ramp.params)) + 1;

/** The first level at which a level-up changes nothing at all. */
export const MAX_LEVEL: number = findLevel(2, (ramp) => ramp.axis === null);

function findLevel(from: number, done: (ramp: Ramp) => boolean): number {
  for (let level = from; level < 500; level += 1) {
    if (done(replay(level))) return level;
  }
  throw new Error('the ramp never finishes: check DIFFICULTY');
}

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
 * The axis a level-up **actually moved**, or null when it moved nothing —
 * level 1, or a game that has run out of ramp.
 *
 * The HUD announces exactly this. Naming an axis that did not move teaches the
 * player to stop reading the one thing the difficulty model exists to tell them.
 */
export function axisForLevel(level: number): DifficultyAxis | null {
  assertLevel(level);
  return replay(level).axis;
}

/**
 * Track parameters at a level.
 *
 * O(level) by replaying the ramp from the base table rather than storing a
 * per-level table, so the model has exactly one definition. It is called once
 * per level-up — a few dozen times in a long run — not per frame, so there is
 * nothing to memoise here. Do not add a cache.
 */
export function paramsForLevel(level: number): DifficultyParams {
  assertLevel(level);

  // Not an axis: a beginner is handed a wider floor on every gap, decaying to
  // the safe minimum. Gap width is uniform over its legal range, so without
  // this the very first row could be as tight as the very last one — and about
  // one row in ten was, before the player had learned how the car responds.
  const bonus = EARLY.gapBonusPx * Math.max(0, 1 - (level - 1) / EARLY.levels);
  return { ...replay(level).params, minGapWidth: SAFE_GAP + bonus };
}

/** True once the ramp has nothing left to raise, speed included. */
export function isMaxedOut(level: number): boolean {
  assertLevel(level);
  return level >= MAX_LEVEL;
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
