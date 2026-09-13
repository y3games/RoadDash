import { describe, expect, it } from 'vitest';

import type { RotationAxis } from '../src/game/config';
import {
  AXIS_PARAMS,
  DIFFICULTY,
  DIFFICULTY_AXES,
  EARLY,
  SAFE_GAP,
  SCORE,
  SPEED_CEILING,
} from '../src/game/config';
import {
  axisForLevel,
  distanceForLevel,
  isMaxedOut,
  levelFor,
  MAX_LEVEL,
  PARAM_KEYS,
  paramsForLevel,
  pointsFor,
  scoreMultiplier,
  SPEED_ONLY_LEVEL,
} from '../src/game/difficulty';

/** The last level that still raises something. */
const MAXED_LEVEL = MAX_LEVEL - 1;

/** The axes whose floors fairness sets, so they stop early by design. */
const GEOMETRY: readonly RotationAxis[] = DIFFICULTY_AXES.filter((axis) => axis !== 'speed');

describe('levelFor', () => {
  it('starts at level 1 and treats a boundary as the new level', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(DIFFICULTY.levelDistancePx - 1)).toBe(1);
    expect(levelFor(DIFFICULTY.levelDistancePx)).toBe(2);
    expect(levelFor(DIFFICULTY.levelDistancePx * 9.5)).toBe(10);
  });

  it('rejects a distance that is negative or not a number', () => {
    expect(() => levelFor(-1)).toThrow(RangeError);
    expect(() => levelFor(Number.NaN)).toThrow(RangeError);
    expect(() => levelFor(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('is the inverse of distanceForLevel', () => {
    for (let level = 1; level <= 40; level += 1) {
      expect(levelFor(distanceForLevel(level))).toBe(level);
    }
  });
});

describe('the rotating ramp', () => {
  it('starts at the base table', () => {
    // minGapWidth is not part of the ramp table — it is the beginner's bonus,
    // checked on its own below.
    expect(paramsForLevel(1)).toMatchObject(DIFFICULTY.base);
  });

  it('bumps nothing to reach level 1', () => {
    expect(axisForLevel(1)).toBeNull();
  });

  it('takes the axes in the documented rotation', () => {
    expect([2, 3, 4, 5, 6, 7, 8, 9].map(axisForLevel)).toEqual([
      'speed',
      'density',
      'roadWidth',
      'curve',
      'speed',
      'density',
      'roadWidth',
      'curve',
    ]);
  });

  /**
   * The central property of the whole design: a level-up turns exactly one
   * screw. Without this, "the player is told which axis rose" is a lie, and
   * difficulty becomes a soup nobody can tune.
   */
  it('changes only the params of one axis per level-up', () => {
    for (let level = 1; level < MAXED_LEVEL; level += 1) {
      const before = paramsForLevel(level);
      const after = paramsForLevel(level + 1);
      const changed = PARAM_KEYS.filter((key) => before[key] !== after[key]);
      const axis = axisForLevel(level + 1) as RotationAxis;
      for (const key of changed) {
        expect(AXIS_PARAMS[axis], `level ${level + 1} changed ${key}`).toContain(key);
      }
    }
  });

  /**
   * The toast is the only thing that tells the player what changed. Announcing
   * an axis that did not move teaches them to stop reading it, so a level-up
   * either moved the axis it names or names nothing at all.
   */
  it('never names an axis that did not actually move', () => {
    for (let level = 2; level <= 200; level += 1) {
      const axis = axisForLevel(level);
      if (axis === null) continue;
      const before = paramsForLevel(level - 1);
      const after = paramsForLevel(level);
      expect(
        AXIS_PARAMS[axis].some((key) => before[key] !== after[key]),
        `level ${level} named ${axis}`,
      ).toBe(true);
    }
  });

  it('goes quiet once the ramp is finished', () => {
    expect(axisForLevel(MAXED_LEVEL)).not.toBeNull();
    expect(axisForLevel(MAX_LEVEL)).toBeNull();
    expect(axisForLevel(150)).toBeNull();
  });

  it('never hands a capped axis back to the rotation', () => {
    // Speed carries on past its rotation cap, and a rotation bump would clamp
    // it back down — one level up, one level down, for ever.
    for (let level = SPEED_ONLY_LEVEL; level < 120; level += 1) {
      expect(paramsForLevel(level + 1).scrollSpeed).toBeGreaterThanOrEqual(
        paramsForLevel(level).scrollSpeed,
      );
    }
  });

  it('is monotone in every axis', () => {
    for (let level = 1; level < 200; level += 1) {
      const before = paramsForLevel(level);
      const after = paramsForLevel(level + 1);
      expect(after.scrollSpeed).toBeGreaterThanOrEqual(before.scrollSpeed);
      expect(after.curveAmplitude).toBeGreaterThanOrEqual(before.curveAmplitude);
      expect(after.curveFrequency).toBeGreaterThanOrEqual(before.curveFrequency);
      expect(after.spawnIntervalPx).toBeLessThanOrEqual(before.spawnIntervalPx);
      expect(after.roadHalfWidth).toBeLessThanOrEqual(before.roadHalfWidth);
    }
  });

  it('reaches every cap exactly and never passes one', () => {
    for (let level = 1; level <= 200; level += 1) {
      const params = paramsForLevel(level);
      expect(params.curveAmplitude).toBeLessThanOrEqual(DIFFICULTY.cap.curveAmplitude);
      expect(params.curveFrequency).toBeLessThanOrEqual(DIFFICULTY.cap.curveFrequency);
      expect(params.roadHalfWidth).toBeGreaterThanOrEqual(DIFFICULTY.cap.roadHalfWidth);
      expect(params.spawnIntervalPx).toBeGreaterThanOrEqual(DIFFICULTY.cap.spawnIntervalPx);
      // Speed is the exception: it keeps rising past its rotation cap, and
      // stops only where the road stops being followable.
      expect(params.scrollSpeed).toBeLessThanOrEqual(SPEED_CEILING);
    }
    expect(paramsForLevel(MAXED_LEVEL).scrollSpeed).toBe(SPEED_CEILING);
  });

  it('rejects a level that is not a positive integer', () => {
    expect(() => paramsForLevel(0)).toThrow(RangeError);
    expect(() => paramsForLevel(1.5)).toThrow(RangeError);
    expect(() => axisForLevel(-2)).toThrow(RangeError);
  });

  /**
   * The balance intent, as an executable claim. Retuning a step has to confront
   * these two numbers.
   */
  it('settles the shape of the track inside the first minute', () => {
    expect(secondsTo(SPEED_ONLY_LEVEL)).toBeGreaterThan(25);
    expect(secondsTo(SPEED_ONLY_LEVEL)).toBeLessThan(60);
  });

  it('reaches its top speed between 45 and 90 seconds', () => {
    expect(secondsTo(MAX_LEVEL)).toBeGreaterThan(45);
    expect(secondsTo(MAX_LEVEL)).toBeLessThan(90);
  });

  it('derives its param keys from the axis table', () => {
    expect([...PARAM_KEYS].sort()).toEqual(
      [...DIFFICULTY_AXES.flatMap((axis) => AXIS_PARAMS[axis])].sort(),
    );
  });
});

describe('once the geometry is full', () => {
  /**
   * The shape of the track has a floor that fairness sets — a gap the car fits
   * through, reachable by steering, on the road for the whole crossing — so it
   * fills up early and stays. Speed is the only screw with anywhere left to go.
   */
  it('freezes every geometric axis', () => {
    const settled = paramsForLevel(SPEED_ONLY_LEVEL);
    for (const level of [SPEED_ONLY_LEVEL, MAX_LEVEL, MAX_LEVEL + 50]) {
      const params = paramsForLevel(level);
      expect(params.spawnIntervalPx, `level ${level}`).toBe(settled.spawnIntervalPx);
      expect(params.roadHalfWidth, `level ${level}`).toBe(settled.roadHalfWidth);
      expect(params.curveAmplitude, `level ${level}`).toBe(settled.curveAmplitude);
      expect(params.curveFrequency, `level ${level}`).toBe(settled.curveFrequency);
    }
  });

  it('raises speed, and only speed, from there on', () => {
    for (let level = SPEED_ONLY_LEVEL; level < MAX_LEVEL; level += 1) {
      expect(axisForLevel(level), `level ${level}`).toBe('speed');
    }
    for (const axis of GEOMETRY) {
      expect(AXIS_PARAMS[axis].length).toBeGreaterThan(0);
    }
  });

  it('keeps accelerating past the rotation cap, up to the ceiling', () => {
    expect(paramsForLevel(SPEED_ONLY_LEVEL).scrollSpeed).toBeLessThan(SPEED_CEILING);
    expect(paramsForLevel(MAX_LEVEL - 1).scrollSpeed).toBe(SPEED_CEILING);
    expect(paramsForLevel(MAX_LEVEL + 40).scrollSpeed).toBe(SPEED_CEILING);
  });

  it('stops there, because past it no line through the track exists', () => {
    // The road drifts sideways at maxSlope * speed; above the ceiling that
    // outruns the car and the run would end on geometry, not on a mistake.
    expect(isMaxedOut(MAX_LEVEL - 1)).toBe(false);
    expect(isMaxedOut(MAX_LEVEL)).toBe(true);
  });
});

function secondsTo(level: number): number {
  let seconds = 0;
  for (let l = 1; l < level; l += 1) {
    seconds += DIFFICULTY.levelDistancePx / paramsForLevel(l).scrollSpeed;
  }
  return seconds;
}

describe('the beginner’s gap floor', () => {
  it('starts a full bonus above the safe minimum', () => {
    expect(paramsForLevel(1).minGapWidth).toBeCloseTo(SAFE_GAP + EARLY.gapBonusPx, 9);
  });

  it('decays onto the safe minimum and stays there', () => {
    expect(paramsForLevel(EARLY.levels + 1).minGapWidth).toBeCloseTo(SAFE_GAP, 9);
    expect(paramsForLevel(60).minGapWidth).toBeCloseTo(SAFE_GAP, 9);
  });

  it('never widens', () => {
    for (let level = 1; level < 40; level += 1) {
      expect(paramsForLevel(level + 1).minGapWidth).toBeLessThanOrEqual(
        paramsForLevel(level).minGapWidth,
      );
    }
  });
});

describe('scoring', () => {
  it('pays the base rate at level 1', () => {
    expect(scoreMultiplier(1)).toBe(1);
    expect(pointsFor(SCORE.pxPerPoint, 1)).toBe(1);
    expect(pointsFor(0, 1)).toBe(0);
  });

  /**
   * The point of the multiplier: rows arrive twice as fast at the cap, so
   * distance alone paid *less* for the hardest row in the game than the
   * easiest. Passing a row must be worth more later, not less.
   */
  it('pays more for a row at the cap than for one at the start', () => {
    const easy = pointsFor(DIFFICULTY.base.spawnIntervalPx, 1);
    const hard = pointsFor(DIFFICULTY.cap.spawnIntervalPx, MAXED_LEVEL);
    expect(hard).toBeGreaterThan(easy);
  });

  it('keeps rewarding the levels past the ramp', () => {
    // Nothing rises after MAX_LEVEL, but the run is still getting longer and
    // the multiplier is the only thing that says so.
    expect(scoreMultiplier(MAX_LEVEL + 20)).toBeGreaterThan(scoreMultiplier(MAX_LEVEL));
  });

  it('rises with the level and never falls', () => {
    for (let level = 1; level < 100; level += 1) {
      expect(scoreMultiplier(level + 1)).toBeGreaterThan(scoreMultiplier(level));
    }
  });

  it('rejects a distance that is negative or not a number', () => {
    expect(() => pointsFor(-1, 1)).toThrow(RangeError);
    expect(() => pointsFor(Number.NaN, 1)).toThrow(RangeError);
    expect(() => scoreMultiplier(0)).toThrow(RangeError);
  });
});
