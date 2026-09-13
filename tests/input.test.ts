import { describe, expect, it } from 'vitest';

import { CAR, LAYOUT } from '../src/game/config';
import { steerInput } from '../src/game/input';

const NO_KEYS = { left: false, right: false };

/** The whole canvas: bounds wide enough not to interfere. */
const OPEN = { min: CAR.width / 2, max: LAYOUT.width - CAR.width / 2 };

describe('steerInput', () => {
  it('is neutral with no key and no pointer', () => {
    expect(steerInput(NO_KEYS, null, 240, OPEN)).toBe(0);
    expect(steerInput(NO_KEYS, { down: false, x: 0 }, 240, OPEN)).toBe(0);
  });

  it('reads a held key as full deflection', () => {
    expect(steerInput({ left: true, right: false }, null, 240, OPEN)).toBe(-1);
    expect(steerInput({ left: false, right: true }, null, 240, OPEN)).toBe(1);
    expect(steerInput({ left: true, right: true }, null, 240, OPEN)).toBe(0);
  });

  it('lets a held key win over the pointer', () => {
    const pointer = { down: true, x: 0 };
    expect(steerInput({ left: false, right: true }, pointer, 240, OPEN)).toBe(1);
  });

  it('steers toward the pointer in proportion to the distance', () => {
    expect(steerInput(NO_KEYS, { down: true, x: 240 }, 240, OPEN)).toBe(0);
    expect(
      steerInput(NO_KEYS, { down: true, x: 240 + CAR.pointerRangePx / 2 }, 240, OPEN),
    ).toBeCloseTo(0.5, 9);
    expect(
      steerInput(NO_KEYS, { down: true, x: 240 - CAR.pointerRangePx / 2 }, 240, OPEN),
    ).toBeCloseTo(-0.5, 9);
  });

  /**
   * Tapping the side of the screen is the first thing anyone does on a phone.
   * Taken literally it is an instruction to leave the road, which in a one-hit
   * game ends the run in a quarter of a second. Clamped, it reads as "hug that
   * edge" — which is what the player meant.
   */
  it('never steers the car off the road to chase a pointer', () => {
    const road = { min: 150, max: 330 };
    // Finger far off the left of the road: the car goes to the edge, not past.
    expect(steerInput(NO_KEYS, { down: true, x: 0 }, 150, road)).toBe(0);
    expect(steerInput(NO_KEYS, { down: true, x: 0 }, 200, road)).toBeCloseTo(-50 / 60, 9);
    // And on the other side.
    expect(steerInput(NO_KEYS, { down: true, x: 480 }, 330, road)).toBe(0);
  });

  it('survives bounds that have collapsed or crossed over', () => {
    const crossed = { min: 300, max: 200 };
    const steer = steerInput(NO_KEYS, { down: true, x: 0 }, 250, crossed);
    expect(Number.isFinite(steer)).toBe(true);
    expect(Math.abs(steer)).toBeLessThanOrEqual(1);
  });

  it('saturates at the pointer range', () => {
    expect(steerInput(NO_KEYS, { down: true, x: 480 }, 240, OPEN)).toBe(1);
    expect(steerInput(NO_KEYS, { down: true, x: 0 }, 240, OPEN)).toBe(-1);
  });
});
