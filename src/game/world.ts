/**
 * The simulation: the whole game, minus pixels.
 *
 * This module must never import Phaser. It is the only stateful module under
 * `game/`, and it exists so that `GameScene` can be reduced to "collect input,
 * call step, draw the result" — every decision about what happens lives here,
 * where a test can run a full two-minute run in milliseconds with no browser.
 */

import type { DifficultyAxis } from './config';
import { CAR, LAYOUT, MOTION, OBSTACLES, TRACK } from './config';
import { carRect, hitObstacle, isOffRoad } from './collision';
import type { SteerBounds } from './input';
import { DIFFICULTY } from './config';
import { axisForLevel, levelFor, paramsForLevel, pointsFor } from './difficulty';
import type { Obstacle, ObstacleRow } from './obstacles';
import { CROSSING_HALF_LENGTH, placeRow } from './obstacles';
import type { Random } from './random';
import { mulberry32 } from './random';
import type { TrackState } from './track';
import { createTrack, extendTrack, pruneTrack, roadEdgesAt, roadSpanAcross } from './track';

export type CrashReason = 'obstacle' | 'offroad';

export interface LevelUp {
  readonly level: number;
  /**
   * The axis this level-up actually raised, or null when it raised nothing.
   * The HUD updates the level badge either way and only announces an axis when
   * there is one — see `axisRaisedAt()`.
   */
  readonly axis: DifficultyAxis | null;
}

export interface WorldState {
  readonly track: TrackState;
  /** Rows currently in play, ordered by `s`. Pruned once well behind the car. */
  rows: ObstacleRow[];
  carX: number;
  /** Distance travelled. The run's whole progress is this number. */
  carS: number;
  /**
   * Points earned so far, unrounded. Accumulated rather than derived from the
   * distance, because a px is worth more at a higher level.
   */
  score: number;
  level: number;
  /** The world holds still until the player first steers. */
  started: boolean;
  crash: CrashReason | null;
  /** Where the next row goes. Advances by the spawn interval at that distance. */
  nextRowS: number;
  prevGapCenter: number | null;
  /** Distance of the last row the car has fully cleared; -1 before the first. */
  lastPassedS: number;
  readonly random: Random;
}

export interface StepResult {
  /** Set on the step that crossed into a new level, so the HUD can announce it. */
  readonly levelUp: LevelUp | null;
  /** Set on the step the car cleared a row, with the room it had to spare. */
  readonly passed: Passed | null;
  readonly crash: CrashReason | null;
  readonly score: number;
}

export interface Passed {
  /** Px between the car's side and the nearer edge of the gap it went through. */
  readonly clearance: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Extend the track and place rows up to the visible horizon.
 *
 * Both the road geometry and the row spacing use the params at **that
 * distance** (`paramsForLevel(levelFor(s))`), not at the car's — generation runs
 * a screen ahead, so reading the car's level here would make every difficulty
 * change arrive half a screen late. The exception is `scrollSpeed` in
 * `stepWorld`, which is a property of *now* rather than of a place.
 */
function generateAhead(world: WorldState): void {
  const horizon = world.carS + LAYOUT.lookaheadPx;
  // Past the horizon by one crossing window, because placing the last visible
  // row reads the road on the far side of it.
  extendTrack(world.track, horizon + CROSSING_HALF_LENGTH);

  while (world.nextRowS <= horizon) {
    const params = paramsForLevel(levelFor(world.nextRowS));
    const span = roadSpanAcross(world.track, world.nextRowS, CROSSING_HALF_LENGTH);
    const row = placeRow(span, params, world.prevGapCenter, world.random);
    world.rows.push(row);
    world.prevGapCenter = row.gapCenter;
    world.nextRowS += params.spawnIntervalPx;
  }
}

/** Drop what is far enough behind the car to be off screen. */
function prune(world: WorldState): void {
  const behind = world.carS - LAYOUT.behindPx;
  pruneTrack(world.track, behind - TRACK.nodeStepPx);
  world.rows = world.rows.filter((row) => row.s + OBSTACLES.rowLength / 2 >= behind);
}

export function createWorld(seed: number): WorldState {
  const world: WorldState = {
    track: createTrack(),
    rows: [],
    carX: LAYOUT.width / 2,
    carS: 0,
    score: 0,
    level: 1,
    started: false,
    crash: null,
    // The first row sits a full base interval ahead, so the opening screen is
    // readable instead of an immediate dodge.
    nextRowS: DIFFICULTY.base.spawnIntervalPx,
    prevGapCenter: null,
    lastPassedS: -1,
    random: mulberry32(seed),
  };
  generateAhead(world);
  return world;
}

function firstHit(world: WorldState, car: ReturnType<typeof carRect>): Obstacle | null {
  for (const row of world.rows) {
    const hit = hitObstacle(car, row.obstacles);
    if (hit !== null) return hit;
  }
  return null;
}

/**
 * Advance the world by `dtSeconds` with a steering input in [-1, 1].
 *
 * The step is subdivided by **distance, not by frame**: a frame buys
 * `scrollSpeed * dt` px of track, and that is walked in pieces no longer than
 * `MOTION.maxSubStepPx`. Two things fall out of that. The simulation behaves
 * identically at 30, 60 and 120 Hz, because frame rate only decides how many
 * pieces a step is cut into. And a fast car cannot tunnel through a thin
 * obstacle, because no single collision check ever covers more ground than the
 * thinnest obstacle is deep.
 */
export function stepWorld(world: WorldState, dtSeconds: number, steer: number): StepResult {
  const result = (levelUp: LevelUp | null, passed: Passed | null = null): StepResult => ({
    levelUp,
    passed,
    crash: world.crash,
    score: currentScore(world),
  });

  // A crash is terminal: the final state is what the game-over panel reports.
  if (world.crash !== null) return result(null);
  if (!(dtSeconds > 0)) return result(null);

  if (!world.started) {
    if (steer === 0) return result(null);
    world.started = true;
  }

  // scrollSpeed is the one param read from the car's *current* level: it is a
  // property of now, not of a place on the track. See generateAhead().
  const { scrollSpeed } = paramsForLevel(world.level);
  const distance = scrollSpeed * dtSeconds;
  const substeps = Math.max(1, Math.ceil(distance / MOTION.maxSubStepPx));
  const forwardPerSub = distance / substeps;
  const lateralPerSub = steer * CAR.steerSpeed * (dtSeconds / substeps);

  for (let i = 0; i < substeps; i += 1) {
    world.carS += forwardPerSub;
    world.score += pointsFor(forwardPerSub, world.level);
    world.carX = clamp(world.carX + lateralPerSub, CAR.width / 2, LAYOUT.width - CAR.width / 2);
    generateAhead(world);

    const car = carRect(world.carX, world.carS);
    if (firstHit(world, car) !== null) {
      world.crash = 'obstacle';
      break;
    }
    if (isOffRoad(car, world.track)) {
      world.crash = 'offroad';
      break;
    }
  }

  const passed = takePassed(world);
  prune(world);

  const level = levelFor(world.carS);
  if (level === world.level) return result(null, passed);

  world.level = level;
  return result({ level, axis: axisForLevel(level) }, passed);
}

/**
 * The row the car has just cleared, if any, and how much room it had.
 *
 * Reported rather than merely counted because "that was close" is the one thing
 * the game cannot show the player: the moment is behind them by the time they
 * could look. A sound can say it while it still means something.
 */
function takePassed(world: WorldState): Passed | null {
  const tail = world.carS - CAR.length / 2;
  let cleared: ObstacleRow | null = null;

  for (const row of world.rows) {
    if (row.s <= world.lastPassedS) continue;
    if (row.s + OBSTACLES.rowLength / 2 >= tail) break;
    cleared = row;
  }
  if (cleared === null) return null;

  world.lastPassedS = cleared.s;
  const half = CAR.width / 2;
  const clearance = Math.min(
    world.carX - (cleared.gapCenter - cleared.gapWidth / 2 + half),
    cleared.gapCenter + cleared.gapWidth / 2 - half - world.carX,
  );
  return { clearance: Math.max(clearance, 0) };
}

/** The score as the player sees it. */
export function currentScore(world: WorldState): number {
  return Math.floor(world.score);
}

/**
 * The x the car may legally occupy right now, measured the way `isOffRoad`
 * measures it: the tighter of what its nose and its tail can see.
 */
export function drivableBounds(world: WorldState): SteerBounds {
  const front = roadEdgesAt(world.track, world.carS + CAR.length / 2);
  const rear = roadEdgesAt(world.track, world.carS - CAR.length / 2);
  return {
    min: Math.max(front.left, rear.left) + CAR.width / 2,
    max: Math.min(front.right, rear.right) - CAR.width / 2,
  };
}

/**
 * The row the car still has to get through, or null.
 *
 * "Still has to" **includes the row it is currently crossing** — the gap has to
 * be held until the car is clear of it. Returning only rows strictly ahead of
 * the bumper looks equivalent and is not: it makes anything steering by this
 * function abandon the gap it is halfway into and line up for the row after,
 * which drives straight into the blocker beside it.
 */
export function nextRowAhead(world: WorldState): ObstacleRow | null {
  for (const row of world.rows) {
    if (row.s + OBSTACLES.rowLength / 2 > world.carS - CAR.length / 2) return row;
  }
  return null;
}
