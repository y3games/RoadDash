import { describe, expect, it } from 'vitest';

import { CAR, LAYOUT, OBSTACLES } from '../src/game/config';
import { paramsForLevel } from '../src/game/difficulty';
import type { ObstacleRow } from '../src/game/obstacles';
import {
  CROSSING_HALF_LENGTH,
  freeIntervals,
  maxGapShift,
  placeRow,
  SAFE_GAP,
} from '../src/game/obstacles';
import { mulberry32 } from '../src/game/random';
import type { RoadSpan } from '../src/game/track';
import { createTrack, extendTrack, roadEdgesAt, roadSpanAcross } from '../src/game/track';

/**
 * A synthetic span. Placement reads nothing but the two edges, so driving those
 * directly covers far more of the road's state space than waiting for a
 * generated track to produce each case.
 */
function span(s: number, centerX: number, halfWidth: number): RoadSpan {
  return { s, left: centerX - halfWidth, right: centerX + halfWidth };
}

interface PlacedRow {
  readonly span: RoadSpan;
  readonly row: ObstacleRow;
}

/** Chain rows the way the world does: each gap constrained by the last. */
function chainRows(level: number, count: number, seed: number): readonly PlacedRow[] {
  const params = paramsForLevel(level);
  const random = mulberry32(seed);
  const rows: PlacedRow[] = [];
  let previous: number | null = null;
  let s = 0;

  for (let i = 0; i < count; i += 1) {
    // Sweep the centre across the legal range so rows are tested against a road
    // that moves, not a straight one.
    const swing = LAYOUT.width / 2 - LAYOUT.edgeMargin - params.roadHalfWidth;
    const current = span(s, LAYOUT.width / 2 + swing * Math.sin(i * 0.37), params.roadHalfWidth);
    const row = placeRow(current, params, previous, random);
    rows.push({ span: current, row });
    previous = row.gapCenter;
    s += params.spawnIntervalPx;
  }

  return rows;
}

describe('a row of obstacles', () => {
  /**
   * I1, checked against the emitted rectangles rather than the row's own
   * bookkeeping — a placement bug that records a correct gapWidth while emitting
   * an overlapping blocker has to fail here.
   */
  it('always leaves a gap at least a car plus clearance wide', () => {
    for (let level = 1; level <= 40; level += 1) {
      const params = paramsForLevel(level);
      const random = mulberry32(level * 7919);
      let previous: number | null = null;

      for (let i = 0; i < 150; i += 1) {
        const swing = LAYOUT.width / 2 - LAYOUT.edgeMargin - params.roadHalfWidth;
        const current = span(
          i * params.spawnIntervalPx,
          LAYOUT.width / 2 + swing * Math.sin(i),
          params.roadHalfWidth,
        );
        const row = placeRow(current, params, previous, random);
        previous = row.gapCenter;

        const widest = freeIntervals(row, current).reduce(
          (best, [from, to]) => Math.max(best, to - from),
          0,
        );
        expect(widest, `level ${level} row ${i}`).toBeGreaterThanOrEqual(SAFE_GAP - 1e-9);
      }
    }
  });

  it('keeps the widest free stretch inside the road', () => {
    for (const level of [1, 10, 20, 29, 40]) {
      const params = paramsForLevel(level);
      const current = span(0, 240, params.roadHalfWidth);
      const random = mulberry32(level);

      for (let i = 0; i < 100; i += 1) {
        const row = placeRow(current, params, null, random);
        const [from, to] = freeIntervals(row, current).reduce((best, interval) =>
          interval[1] - interval[0] > best[1] - best[0] ? interval : best,
        );
        expect(from).toBeGreaterThanOrEqual(current.left - 1e-9);
        expect(to).toBeLessThanOrEqual(current.right + 1e-9);
      }
    }
  });

  it('never puts an obstacle in its own gap', () => {
    for (const { row } of chainRows(20, 400, 4242)) {
      const gapLeft = row.gapCenter - row.gapWidth / 2;
      const gapRight = row.gapCenter + row.gapWidth / 2;
      for (const obstacle of row.obstacles) {
        const left = obstacle.x - obstacle.width / 2;
        const right = obstacle.x + obstacle.width / 2;
        const clear = right <= gapLeft + 1e-9 || left >= gapRight - 1e-9;
        expect(clear, `obstacle ${left}..${right} vs gap ${gapLeft}..${gapRight}`).toBe(true);
      }
    }
  });

  it('never puts an obstacle past the road edge', () => {
    const params = paramsForLevel(25);
    const random = mulberry32(31337);
    for (let i = 0; i < 300; i += 1) {
      const current = span(i * 200, 180 + (i % 120), params.roadHalfWidth);
      const row = placeRow(current, params, null, random);
      for (const obstacle of row.obstacles) {
        expect(obstacle.x - obstacle.width / 2).toBeGreaterThanOrEqual(current.left - 1e-9);
        expect(obstacle.x + obstacle.width / 2).toBeLessThanOrEqual(current.right + 1e-9);
      }
    }
  });

  it('leaves every unblocked sliver too narrow for the car', () => {
    // Tiling stops when no blocker fits, so free space other than the gap
    // exists — it must never be wide enough to drive through.
    for (const { span: current, row } of chainRows(29, 400, 99)) {
      const slivers = freeIntervals(row, current).filter(
        ([from, to]) => row.gapCenter < from || row.gapCenter > to,
      );
      for (const [from, to] of slivers) {
        expect(to - from).toBeLessThan(CAR.width);
      }
    }
  });

  it('places obstacles only where the row is', () => {
    for (const { row } of chainRows(12, 50, 7)) {
      for (const obstacle of row.obstacles) {
        expect(obstacle.s).toBe(row.s);
        expect(obstacle.length).toBe(OBSTACLES.rowLength);
      }
    }
  });

  it('is reproducible from a seed', () => {
    expect(chainRows(15, 60, 2024)).toEqual(chainRows(15, 60, 2024));
    expect(chainRows(15, 60, 2024)).not.toEqual(chainRows(15, 60, 2025));
  });
});

describe('gap reachability (I2)', () => {
  /**
   * The invariant that separates hard from unfair: a gap that exists but cannot
   * be steered to is an unavoidable wall. `maxGapShift` is the budget, derated
   * by a safety factor; the assertion here is against the car's *physical*
   * reach, because when the road itself drifts further than the budget the
   * placement spends part of that safety margin rather than breaking the rule.
   */
  it('never moves a gap further than the car can steer in the time available', () => {
    for (const level of [1, 5, 15, 25, 29, 45]) {
      const params = paramsForLevel(level);
      const rows = chainRows(level, 400, level * 17);
      const seconds = params.spawnIntervalPx / params.scrollSpeed;
      const physical = CAR.steerSpeed * seconds;

      for (let i = 1; i < rows.length; i += 1) {
        const shift = Math.abs(rows[i].row.gapCenter - rows[i - 1].row.gapCenter);
        expect(shift, `level ${level} row ${i}`).toBeLessThanOrEqual(physical);
      }
    }
  });

  it('stays inside its own budget while the road holds still', () => {
    const params = paramsForLevel(29);
    const random = mulberry32(5);
    const current = span(0, 240, params.roadHalfWidth);
    let previous = 240;

    for (let i = 0; i < 500; i += 1) {
      const row = placeRow(current, params, previous, random);
      expect(Math.abs(row.gapCenter - previous)).toBeLessThanOrEqual(maxGapShift(params) + 1e-9);
      previous = row.gapCenter;
    }
  });

  it('shrinks the budget as the game speeds up', () => {
    expect(maxGapShift(paramsForLevel(29))).toBeLessThan(maxGapShift(paramsForLevel(1)));
  });
});

describe('the gap stays on the road while the car crosses it (I3)', () => {
  /**
   * The invariant that I1 and I2 both miss. A row is crossed over a stretch of
   * track as long as the car plus the row, and the road keeps sliding sideways
   * for all of it. A gap placed against the road at the row's own distance can
   * therefore be half off the road by the time the car's tail is through, which
   * squeezes it between a blocker and the verge with nowhere legal to go.
   */
  it('holds the whole gap inside the road from bumper to tail', () => {
    const track = createTrack();
    extendTrack(track, 70_000);
    const random = mulberry32(8080);
    let previous: number | null = null;

    for (let s = 600; s < 60_000; s += 300) {
      const crossing = roadSpanAcross(track, s, CROSSING_HALF_LENGTH);
      const row = placeRow(crossing, paramsForLevel(40), previous, random);
      previous = row.gapCenter;

      const gapLeft = row.gapCenter - row.gapWidth / 2;
      const gapRight = row.gapCenter + row.gapWidth / 2;
      for (const offset of [-CROSSING_HALF_LENGTH, 0, CROSSING_HALF_LENGTH]) {
        const edges = roadEdgesAt(track, s + offset);
        expect(gapLeft, `s=${s} offset=${offset}`).toBeGreaterThanOrEqual(edges.left - 1e-9);
        expect(gapRight, `s=${s} offset=${offset}`).toBeLessThanOrEqual(edges.right + 1e-9);
      }
    }
  });

  it('still leaves a safe gap after narrowing the span to what is passable', () => {
    const track = createTrack();
    extendTrack(track, 70_000);
    for (let s = 600; s < 60_000; s += 137) {
      const crossing = roadSpanAcross(track, s, CROSSING_HALF_LENGTH);
      expect(crossing.right - crossing.left, `s=${s}`).toBeGreaterThanOrEqual(SAFE_GAP);
    }
  });
});
