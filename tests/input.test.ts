import { describe, expect, it } from 'vitest';

import { CAR } from '../src/game/config';
import { steerInput } from '../src/game/input';

const NO_KEYS = { left: false, right: false };

describe('steerInput', () => {
  it('is neutral with no key and no pointer', () => {
    expect(steerInput(NO_KEYS, null, 240)).toBe(0);
    expect(steerInput(NO_KEYS, { down: false, x: 0 }, 240)).toBe(0);
  });

  it('reads a held key as full deflection', () => {
    expect(steerInput({ left: true, right: false }, null, 240)).toBe(-1);
    expect(steerInput({ left: false, right: true }, null, 240)).toBe(1);
    expect(steerInput({ left: true, right: true }, null, 240)).toBe(0);
  });

  it('lets a held key win over the pointer', () => {
    const pointer = { down: true, x: 0 };
    expect(steerInput({ left: false, right: true }, pointer, 240)).toBe(1);
  });

  it('steers toward the pointer in proportion to the distance', () => {
    expect(steerInput(NO_KEYS, { down: true, x: 240 }, 240)).toBe(0);
    expect(steerInput(NO_KEYS, { down: true, x: 240 + CAR.pointerRangePx / 2 }, 240)).toBeCloseTo(
      0.5,
      9,
    );
    expect(steerInput(NO_KEYS, { down: true, x: 240 - CAR.pointerRangePx / 2 }, 240)).toBeCloseTo(
      -0.5,
      9,
    );
  });

  it('saturates at the pointer range', () => {
    expect(steerInput(NO_KEYS, { down: true, x: 480 }, 240)).toBe(1);
    expect(steerInput(NO_KEYS, { down: true, x: 0 }, 240)).toBe(-1);
  });
});
