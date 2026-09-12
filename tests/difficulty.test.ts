import { describe, expect, it } from 'vitest';

import type { DifficultyParamKey } from '../src/game/config';
import { AXIS_PARAMS, DIFFICULTY, DIFFICULTY_AXES, SCORE } from '../src/game/config';
import {
  axisForLevel,
  distanceForLevel,
  isMaxedOut,
  levelFor,
  PARAM_KEYS,
  paramsForLevel,
  scoreForDistance,
} from '../src/game/difficulty';

/** The level at which every axis sits at its cap. Derived, not assumed. */
const MAXED_LEVEL = 29;

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
    expect(paramsForLevel(1)).toEqual(DIFFICULTY.base);
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
    for (let level = 1; level < 80; level += 1) {
      const before = paramsForLevel(level);
      const after = paramsForLevel(level + 1);
      const changed = PARAM_KEYS.filter((key) => before[key] !== after[key]);
      const axis = axisForLevel(level + 1);
      expect(axis).not.toBeNull();
      const allowed: readonly DifficultyParamKey[] = AXIS_PARAMS[axis!];
      for (const key of changed) {
        expect(allowed, `level ${level + 1} changed ${key}`).toContain(key);
      }
    }
  });

  it('moves the axis it names until that axis is capped', () => {
    for (let level = 1; level < MAXED_LEVEL; level += 1) {
      const before = paramsForLevel(level);
      const after = paramsForLevel(level + 1);
      const axis = axisForLevel(level + 1)!;
      const atCap = AXIS_PARAMS[axis].every((key) => before[key] === DIFFICULTY.cap[key]);
      if (atCap) continue;
      expect(
        AXIS_PARAMS[axis].some((key) => before[key] !== after[key]),
        `level ${level + 1} should have moved ${axis}`,
      ).toBe(true);
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
      expect(params.scrollSpeed).toBeLessThanOrEqual(DIFFICULTY.cap.scrollSpeed);
      expect(params.curveAmplitude).toBeLessThanOrEqual(DIFFICULTY.cap.curveAmplitude);
      expect(params.curveFrequency).toBeLessThanOrEqual(DIFFICULTY.cap.curveFrequency);
      expect(params.spawnIntervalPx).toBeGreaterThanOrEqual(DIFFICULTY.cap.spawnIntervalPx);
      expect(params.roadHalfWidth).toBeGreaterThanOrEqual(DIFFICULTY.cap.roadHalfWidth);
    }
    expect(paramsForLevel(200)).toEqual(DIFFICULTY.cap);
  });

  it('tops out at level 29 and stays there', () => {
    expect(isMaxedOut(MAXED_LEVEL - 1)).toBe(false);
    expect(isMaxedOut(MAXED_LEVEL)).toBe(true);
    expect(isMaxedOut(MAXED_LEVEL + 50)).toBe(true);
  });

  it('rejects a level that is not a positive integer', () => {
    expect(() => paramsForLevel(0)).toThrow(RangeError);
    expect(() => paramsForLevel(1.5)).toThrow(RangeError);
    expect(() => axisForLevel(-2)).toThrow(RangeError);
  });

  /**
   * The balance intent, as an executable claim: difficulty stops rising at
   * about 78 seconds, which is what makes a good run land in the 60–120 s band
   * the game was asked for. Retuning a step has to confront this number.
   */
  it('reaches maximum difficulty between 60 and 110 seconds', () => {
    let seconds = 0;
    for (let level = 1; level < MAXED_LEVEL; level += 1) {
      seconds += DIFFICULTY.levelDistancePx / paramsForLevel(level).scrollSpeed;
    }
    expect(seconds).toBeGreaterThan(60);
    expect(seconds).toBeLessThan(110);
  });

  it('derives its param keys from the axis table', () => {
    expect([...PARAM_KEYS].sort()).toEqual(
      [...DIFFICULTY_AXES.flatMap((axis) => AXIS_PARAMS[axis])].sort(),
    );
  });
});

describe('scoreForDistance', () => {
  it('is an integral, monotone function of distance', () => {
    expect(scoreForDistance(0)).toBe(0);
    expect(scoreForDistance(SCORE.pxPerPoint - 1)).toBe(0);
    expect(scoreForDistance(SCORE.pxPerPoint)).toBe(1);
    expect(scoreForDistance(SCORE.pxPerPoint * 1234.9)).toBe(1234);
  });

  it('rejects a distance that is negative or not a number', () => {
    expect(() => scoreForDistance(-1)).toThrow(RangeError);
    expect(() => scoreForDistance(Number.NaN)).toThrow(RangeError);
  });
});
