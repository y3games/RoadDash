import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CAR_COLORS, DEFAULT_CAR_COLOR } from '../src/game/config';
import { Prefs, toCarColor } from '../src/services/Prefs';

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

describe('Prefs', () => {
  it('keeps each choice under a key of its own game', () => {
    const prefs = new Prefs('roaddash');
    prefs.saveCarColor('red');
    prefs.saveMuted(true);
    expect(storage.store.get('roaddash.car')).toBe('red');
    expect(storage.store.get('roaddash.muted')).toBe('1');
  });

  it('reads back what it saved', () => {
    const prefs = new Prefs('roaddash');
    expect(prefs.carColor()).toBe(DEFAULT_CAR_COLOR);
    prefs.saveCarColor('black');
    expect(prefs.carColor()).toBe('black');
  });

  it('leaves sound on until it is turned off', () => {
    const prefs = new Prefs('roaddash');
    expect(prefs.muted()).toBe(false);
    prefs.saveMuted(true);
    expect(prefs.muted()).toBe(true);
    prefs.saveMuted(false);
    expect(prefs.muted()).toBe(false);
  });

  it('rejects a game id that is not a slug', () => {
    expect(() => new Prefs('RoadDash')).toThrow();
    expect(() => new Prefs('')).toThrow();
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
    const prefs = new Prefs('roaddash');
    expect(() => prefs.saveCarColor('blue')).not.toThrow();
    expect(() => prefs.saveMuted(true)).not.toThrow();
    expect(prefs.carColor()).toBe(DEFAULT_CAR_COLOR);
    expect(prefs.muted()).toBe(false);
  });
});
