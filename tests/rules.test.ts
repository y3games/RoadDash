import { describe, expect, it } from 'vitest';

import { BALL_KINDS, SPAWN_WEIGHTS } from '../src/game/config';
import { ballRadius, isValidKind, pickKind, scoreForKind } from '../src/game/rules';

describe('isValidKind', () => {
  it('accepts every configured kind', () => {
    BALL_KINDS.forEach((_, i) => expect(isValidKind(i)).toBe(true));
  });

  it('rejects out-of-range and non-integer values', () => {
    for (const bad of [-1, BALL_KINDS.length, 1.5, NaN]) {
      expect(isValidKind(bad)).toBe(false);
    }
  });
});

describe('ballRadius / scoreForKind', () => {
  it('matches the config table', () => {
    BALL_KINDS.forEach((ball, i) => {
      expect(ballRadius(i)).toBe(ball.radius);
      expect(scoreForKind(i)).toBe(ball.score);
    });
  });

  it('throws rather than returning undefined for a bad kind', () => {
    expect(() => ballRadius(-1)).toThrow(RangeError);
    expect(() => scoreForKind(BALL_KINDS.length)).toThrow(RangeError);
  });
});

describe('pickKind', () => {
  it('only ever returns a configured kind', () => {
    for (let i = 0; i < 500; i += 1) {
      expect(isValidKind(pickKind(i / 500))).toBe(true);
    }
  });

  it('honours the configured weights', () => {
    const total = SPAWN_WEIGHTS.reduce((a, b) => a + b, 0);
    const counts = new Array<number>(SPAWN_WEIGHTS.length).fill(0);
    const samples = 10_000;
    for (let i = 0; i < samples; i += 1) counts[pickKind(i / samples)] += 1;
    SPAWN_WEIGHTS.forEach((weight, kind) => {
      expect(counts[kind] / samples).toBeCloseTo(weight / total, 2);
    });
  });

  it('rejects values outside [0, 1)', () => {
    expect(() => pickKind(1)).toThrow(RangeError);
    expect(() => pickKind(-0.1)).toThrow(RangeError);
  });
});

describe('config table', () => {
  it('has one spawn weight per kind, all positive', () => {
    expect(SPAWN_WEIGHTS.length).toBe(BALL_KINDS.length);
    SPAWN_WEIGHTS.forEach((w) => expect(w).toBeGreaterThan(0));
  });
});
