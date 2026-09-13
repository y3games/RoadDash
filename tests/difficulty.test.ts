import { describe, expect, it } from 'vitest';

import type { DifficultyParamKey, RotationAxis, TailAxis } from '../src/game/config';
import {
  AXIS_PARAMS,
  DIFFICULTY,
  DIFFICULTY_AXES,
  EARLY,
  SAFE_GAP,
  SCORE,
  TAIL_AXES,
  TAIL_AXIS_PARAMS,
} from '../src/game/config';
import {
  axisForLevel,
  axisRaisedAt,
  distanceForLevel,
  isMaxedOut,
  levelFor,
  PARAM_KEYS,
  paramsForLevel,
  pointsFor,
  scoreMultiplier,
  TAIL_START_LEVEL,
} from '../src/game/difficulty';

/** The last level of the rotation — the one that caps its final axis. */
const MAXED_LEVEL = TAIL_START_LEVEL - 1;

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

  it('finishes the rotation before the tail begins', () => {
    // The tail replaces a level's bump rather than following it, so starting it
    // one level early silently costs the rotation its last step.
    expect(paramsForLevel(MAXED_LEVEL)).toMatchObject(
      Object.fromEntries(PARAM_KEYS.map((key) => [key, DIFFICULTY.cap[key]])),
    );
    expect(isMaxedOut(MAXED_LEVEL - 1)).toBe(false);
    expect(isMaxedOut(MAXED_LEVEL)).toBe(true);
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
      const allowed: readonly DifficultyParamKey[] = AXIS_PARAMS[axis];
      for (const key of changed) {
        expect(allowed, `level ${level + 1} changed ${key}`).toContain(key);
      }
    }
  });

  it('moves the axis it names until that axis is capped', () => {
    for (let level = 1; level < MAXED_LEVEL; level += 1) {
      const before = paramsForLevel(level);
      const after = paramsForLevel(level + 1);
      const axis = axisForLevel(level + 1) as RotationAxis;
      const atCap = AXIS_PARAMS[axis].every((key) => before[key] === DIFFICULTY.cap[key]);
      if (atCap) continue;
      expect(
        AXIS_PARAMS[axis].some((key) => before[key] !== after[key]),
        `level ${level + 1} should have moved ${axis}`,
      ).toBe(true);
    }
  });

  /**
   * The toast is the only thing that tells the player what changed. Announcing
   * an axis that did not move teaches them to stop reading it, so the HUD asks
   * `axisRaisedAt()` and it must go quiet exactly when the ramp does.
   */
  it('never names an axis that did not actually move', () => {
    for (let level = 1; level <= 200; level += 1) {
      const axis = axisRaisedAt(level);
      if (axis === null) continue;
      const before = paramsForLevel(level - 1 || 1);
      const after = paramsForLevel(level);
      const keys: readonly DifficultyParamKey[] =
        axis in AXIS_PARAMS
          ? AXIS_PARAMS[axis as RotationAxis]
          : TAIL_AXIS_PARAMS[axis as TailAxis];
      expect(
        keys.some((key) => before[key] !== after[key]),
        `level ${level}`,
      ).toBe(true);
    }
  });

  it('goes quiet once even the tail is finished', () => {
    expect(axisRaisedAt(TAIL_START_LEVEL)).not.toBeNull();
    // Far past both tail caps, a level-up changes nothing and says nothing.
    expect(axisRaisedAt(150)).toBeNull();
    expect(axisForLevel(150)).not.toBeNull();
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
      expect(params.scrollSpeed).toBeLessThanOrEqual(DIFFICULTY.cap.scrollSpeed);
      expect(params.curveAmplitude).toBeLessThanOrEqual(DIFFICULTY.cap.curveAmplitude);
      expect(params.curveFrequency).toBeLessThanOrEqual(DIFFICULTY.cap.curveFrequency);
      expect(params.roadHalfWidth).toBeGreaterThanOrEqual(DIFFICULTY.cap.roadHalfWidth);
      // Rows keep closing up in the tail, so this floor is the tail's, not the
      // rotation's.
      expect(params.spawnIntervalPx).toBeGreaterThanOrEqual(DIFFICULTY.tailCap.spawnIntervalPx);
      expect(params.gapSlackRatio).toBeGreaterThanOrEqual(DIFFICULTY.tailCap.gapSlackRatio);
    }
  });

  it('rejects a level that is not a positive integer', () => {
    expect(() => paramsForLevel(0)).toThrow(RangeError);
    expect(() => paramsForLevel(1.5)).toThrow(RangeError);
    expect(() => axisForLevel(-2)).toThrow(RangeError);
  });

  /**
   * The balance intent, as an executable claim: the rotation finishes around
   * 65 seconds, which is what makes a good run land in the 60–120 s band the
   * game was asked for. Retuning a step has to confront this number.
   */
  it('finishes the rotation between 55 and 90 seconds', () => {
    let seconds = 0;
    for (let level = 1; level <= MAXED_LEVEL; level += 1) {
      seconds += DIFFICULTY.levelDistancePx / paramsForLevel(level).scrollSpeed;
    }
    expect(seconds).toBeGreaterThan(55);
    expect(seconds).toBeLessThan(90);
  });

  it('derives its param keys from the axis table', () => {
    expect([...PARAM_KEYS].sort()).toEqual(
      [...DIFFICULTY_AXES.flatMap((axis) => AXIS_PARAMS[axis])].sort(),
    );
  });
});

describe('the tail', () => {
  it('keeps tightening after the rotation is done', () => {
    const capped = paramsForLevel(MAXED_LEVEL);
    const late = paramsForLevel(MAXED_LEVEL + 30);
    expect(late.gapSlackRatio).toBeLessThan(capped.gapSlackRatio);
    expect(late.spawnIntervalPx).toBeLessThan(capped.spawnIntervalPx);
  });

  it('takes its two axes in rotation as well', () => {
    expect(axisForLevel(TAIL_START_LEVEL)).toBe(TAIL_AXES[0]);
    expect(axisForLevel(TAIL_START_LEVEL + 1)).toBe(TAIL_AXES[1]);
    expect(axisForLevel(TAIL_START_LEVEL + 2)).toBe(TAIL_AXES[0]);
  });

  it('leaves the rotation axes exactly where it found them', () => {
    const capped = paramsForLevel(MAXED_LEVEL);
    const late = paramsForLevel(MAXED_LEVEL + 60);
    expect(late.scrollSpeed).toBe(capped.scrollSpeed);
    expect(late.roadHalfWidth).toBe(capped.roadHalfWidth);
    expect(late.curveAmplitude).toBe(capped.curveAmplitude);
  });

  it('stops at its own caps', () => {
    const end = paramsForLevel(300);
    expect(end.gapSlackRatio).toBe(DIFFICULTY.tailCap.gapSlackRatio);
    expect(end.spawnIntervalPx).toBe(DIFFICULTY.tailCap.spawnIntervalPx);
  });
});

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
