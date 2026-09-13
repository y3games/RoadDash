/**
 * Obstacle placement.
 *
 * This module must never import Phaser. Every row is a **wall with exactly one
 * gap**: the gap is chosen first and blockers are fitted into what is left, so
 * no code path can encroach on it. The alternative — blocking part of the road
 * at random — makes the fairness property probabilistic, verifiable only by
 * sampling and hoping. Here it is true by construction.
 *
 * Variety comes from tiling the blocked stretches with two widths of obstacle,
 * not from varying how much of the road is blocked.
 */

import type { DifficultyParams } from './config';
import { CAR, OBSTACLES, roadLateralSpeed, SAFE_GAP } from './config';
import type { Random } from './random';
import type { RoadSpan } from './track';

export type ObstacleKind = 'cone' | 'barrier';

export interface Obstacle {
  /** Centre along the track. */
  readonly s: number;
  /** Centre in logical x. */
  readonly x: number;
  readonly width: number;
  /** Extent along the track. */
  readonly length: number;
  readonly kind: ObstacleKind;
}

export interface ObstacleRow {
  readonly s: number;
  /** Kept so the next row's gap can be checked for reachability. */
  readonly gapCenter: number;
  readonly gapWidth: number;
  readonly obstacles: readonly Obstacle[];
}

/**
 * Half the stretch of track the car occupies while crossing a row: its own
 * length plus the row's depth. Rows are placed against the road that is
 * passable over this whole window (see `roadSpanAcross`), because the road slides
 * sideways while the car is inside the row.
 */
export const CROSSING_HALF_LENGTH = (CAR.length + OBSTACLES.rowLength) / 2;

const WIDTHS: Readonly<Record<ObstacleKind, number>> = {
  barrier: OBSTACLES.barrierWidth,
  cone: OBSTACLES.coneWidth,
};

/**
 * How far the gap may move between two consecutive rows.
 *
 * This is the constraint that makes the game hard rather than unfair. A row that
 * leaves a legal gap 300 px away from the previous one, reachable only by
 * steering faster than the car can, is an unavoidable wall *that contains a
 * gap*.
 *
 * The budget is the car's steering speed **minus what following the road
 * already costs it**: a curving road moves sideways at up to
 * `TRACK.maxSlope * scrollSpeed`, and that much of the car's authority is spent
 * before it has changed lanes at all. Leaving the term out is what makes a late
 * level look fair row by row and be impossible in sequence — the car arrives at
 * the gap having drifted off the road to get there. A safety factor on top
 * leaves the player room to be imperfect.
 */
export function maxGapShift(params: DifficultyParams): number {
  const seconds = params.spawnIntervalPx / params.scrollSpeed;
  const spare = CAR.steerSpeed - roadLateralSpeed(params.scrollSpeed);
  return Math.max(spare, 0) * seconds * OBSTACLES.reachSafety;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Tile a blocked stretch, widest blocker first, working **from the gap toward
 * the road edge**.
 *
 * Whatever does not fit is left empty against the road edge rather than next to
 * the gap, which keeps the gap exactly the width it was designed to be. That
 * leftover is always narrower than a cone, and therefore narrower than the car,
 * so it can never be squeezed through.
 */
function tile(from: number, to: number, s: number): Obstacle[] {
  const direction = Math.sign(to - from);
  let remaining = Math.abs(to - from);
  let edge = from;
  const placed: Obstacle[] = [];

  for (const kind of ['barrier', 'cone'] as const) {
    const width = WIDTHS[kind];
    while (remaining >= width) {
      placed.push({
        s,
        x: edge + (direction * width) / 2,
        width,
        length: OBSTACLES.rowLength,
        kind,
      });
      edge += direction * width;
      remaining -= width;
    }
  }

  return placed;
}

/**
 * One row of obstacles across a stretch of road.
 *
 * The span is the **passable** road over the whole window the car spends
 * crossing the row, which is what keeps the gap on the road from the moment the
 * bumper enters it to the moment the tail leaves.
 *
 * `prevGapCenter` is null for the first row of a run, which is centred. The
 * random source is passed in rather than called globally, which is what makes a
 * generated track reproducible from a seed.
 */
export function placeRow(
  span: RoadSpan,
  params: DifficultyParams,
  prevGapCenter: number | null,
  random: Random,
): ObstacleRow {
  const { left, right } = span;
  const width = right - left;
  const center = (left + right) / 2;

  // A stretch narrower than a safe gap would be impassable; leave it wide open.
  // The config test makes sure the difficulty ramp never gets there.
  if (width <= SAFE_GAP) {
    return { s: span.s, gapCenter: center, gapWidth: width, obstacles: [] };
  }

  // The floor is the safe minimum plus whatever of the beginner's bonus is
  // left at this level; the slack ratio decides how much wider than that a
  // given row happens to be.
  const floor = Math.min(params.minGapWidth, width);
  const gapWidth = clamp(
    floor + (width - floor) * OBSTACLES.gapSlackRatio * random(),
    floor,
    width,
  );

  // Where the gap may legally sit, and where the car could actually get to.
  const legalMin = left + gapWidth / 2;
  const legalMax = right - gapWidth / 2;
  const previous = prevGapCenter ?? center;
  const reach = maxGapShift(params);
  const reachableMin = Math.max(legalMin, previous - reach);
  const reachableMax = Math.min(legalMax, previous + reach);

  const gapCenter =
    reachableMin <= reachableMax
      ? reachableMin + (reachableMax - reachableMin) * random()
      : // The windows do not overlap: the road itself moved further than the car
        // can follow within one row spacing. Give up the randomness, not the
        // reachability — take the legal position closest to the last gap.
        clamp(previous, legalMin, legalMax);

  const obstacles = [
    ...tile(gapCenter - gapWidth / 2, left, span.s),
    ...tile(gapCenter + gapWidth / 2, right, span.s),
  ];

  return { s: span.s, gapCenter, gapWidth, obstacles };
}

/**
 * The unobstructed stretches of road in a row, recomputed from the obstacle
 * rectangles themselves.
 *
 * Tests use this rather than the row's own `gapWidth`, so a placement bug that
 * records a correct gap while emitting an overlapping blocker still fails.
 */
export function freeIntervals(
  row: ObstacleRow,
  span: RoadSpan,
): readonly (readonly [number, number])[] {
  const { left, right } = span;

  const blocked = row.obstacles
    .map((o) => [o.x - o.width / 2, o.x + o.width / 2] as const)
    .sort((a, b) => a[0] - b[0]);

  const free: (readonly [number, number])[] = [];
  let cursor = left;
  for (const [from, to] of blocked) {
    if (from > cursor) free.push([cursor, Math.min(from, right)]);
    cursor = Math.max(cursor, to);
  }
  if (cursor < right) free.push([cursor, right]);

  return free.filter(([from, to]) => to > from);
}
