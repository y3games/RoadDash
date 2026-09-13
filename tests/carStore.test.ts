import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CAR_COLORS, DEFAULT_CAR_COLOR } from '../src/game/config';
import { CarStore, toCarColor } from '../src/services/CarStore';

/** Minimal localStorage stand-in; vitest runs in node, which has no DOM. */
function fakeStorage() {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
}

let storage: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  storage = fakeStorage();
  vi.stubGlobal('localStorage', storage);
});

describe('toCarColor', () => {
  it('accepts every colour the game offers', () => {
    for (const color of CAR_COLORS) {
      expect(toCarColor(color.id)).toBe(color.id);
    }
  });

  it('falls back to the default for anything else', () => {
    // Anything at all can be sitting under that key, including a colour a later
    // version of the game removed.
    expect(toCarColor(null)).toBe(DEFAULT_CAR_COLOR);
    expect(toCarColor('')).toBe(DEFAULT_CAR_COLOR);
    expect(toCarColor('chartreuse')).toBe(DEFAULT_CAR_COLOR);
    expect(toCarColor('{"id":"red"}')).toBe(DEFAULT_CAR_COLOR);
  });
});

describe('CarStore', () => {
  it('keeps the choice under a key of its own game', () => {
    new CarStore('roaddash').save('red');
    expect(storage.store.get('roaddash.car')).toBe('red');
  });

  it('reads back what it saved', () => {
    const store = new CarStore('roaddash');
    expect(store.read()).toBe(DEFAULT_CAR_COLOR);
    store.save('black');
    expect(store.read()).toBe('black');
  });

  it('rejects a game id that is not a slug', () => {
    expect(() => new CarStore('RoadDash')).toThrow();
    expect(() => new CarStore('')).toThrow();
  });

  it('survives storage that throws', () => {
    // Private browsing, disabled site data and embedded contexts can all make
    // localStorage throw rather than return null.
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    const store = new CarStore('roaddash');
    expect(() => store.save('blue')).not.toThrow();
    expect(store.read()).toBe(DEFAULT_CAR_COLOR);
  });
});
