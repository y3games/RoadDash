import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalScoreService } from '../src/services/LocalScoreService';
import type { Player } from '../src/services/player';
import type { ScoreService } from '../src/services/ScoreService';

const PLAYER: Player = { id: '11111111-2222-3333-4444-555555555555', name: '동혁' };

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

afterEach(() => vi.unstubAllGlobals());

describe('storage key', () => {
  it('derives `<gameId>.best` from the injected id', async () => {
    await new LocalScoreService('my-game').submit(42, PLAYER);
    expect(storage.store.get('my-game.best')).toBe('42');
  });

  it('keeps two games on the same origin apart', async () => {
    await new LocalScoreService('alpha').submit(10, PLAYER);
    await new LocalScoreService('beta').submit(20, PLAYER);

    expect(await new LocalScoreService('alpha').getBest()).toBe(10);
    expect(await new LocalScoreService('beta').getBest()).toBe(20);
  });

  it('rejects an id that is not a slug', () => {
    for (const bad of ['', 'My Game', 'game.best', 'Game']) {
      expect(() => new LocalScoreService(bad)).toThrow(/Invalid game id/);
    }
  });
});

describe('player attribution', () => {
  it('keeps the best score numeric and the name in a sibling key', async () => {
    // The portal parses `<id>.best` with Number(), so the name must not share
    // that value.
    await new LocalScoreService('my-game').submit(42, PLAYER);

    expect(storage.store.get('my-game.best')).toBe('42');
    expect(JSON.parse(storage.store.get('my-game.best.owner') ?? 'null')).toEqual({
      id: PLAYER.id,
      name: PLAYER.name,
    });
  });

  it('follows a rename: the record still belongs to the same player', async () => {
    const service: ScoreService = new LocalScoreService('my-game');
    await service.submit(42, PLAYER);

    await service.renameOwner({ ...PLAYER, name: '캡틴' });

    expect(await service.getLeaderboard(10)).toEqual([{ name: '캡틴', score: 42 }]);
    expect(storage.store.get('my-game.best')).toBe('42');
  });

  it('leaves a record set by somebody else on the device alone', async () => {
    const service: ScoreService = new LocalScoreService('my-game');
    await service.submit(42, PLAYER);

    await service.renameOwner({ id: 'a-different-uuid', name: '침입자' });

    expect(await service.getLeaderboard(10)).toEqual([{ name: '동혁', score: 42 }]);
  });

  it('reports the local best as a one-entry leaderboard', async () => {
    // Through the interface: `limit` is part of the contract even though the
    // local implementation has nothing to trim.
    const service: ScoreService = new LocalScoreService('my-game');
    expect(await service.getLeaderboard(10)).toEqual([]);

    await service.submit(42, PLAYER);
    expect(await service.getLeaderboard(10)).toEqual([{ name: '동혁', score: 42 }]);
  });
});

describe('submit', () => {
  it('only stores a score that beats the best', async () => {
    const service = new LocalScoreService('my-game');

    expect(await service.submit(10, PLAYER)).toBe(true);
    expect(await service.submit(5, PLAYER)).toBe(false);
    expect(await service.getBest()).toBe(10);
  });
});

describe('unavailable storage', () => {
  it('falls back to 0 instead of throwing', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('site data disabled');
      },
      setItem: () => {
        throw new Error('site data disabled');
      },
    });
    const service = new LocalScoreService('my-game');

    expect(await service.getBest()).toBe(0);
    expect(await service.submit(10, PLAYER)).toBe(true);
  });
});
