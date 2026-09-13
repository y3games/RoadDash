import type { CarColorId } from '../game/config';
import { CAR_COLORS, DEFAULT_CAR_COLOR } from '../game/config';

/** A game id is a slug: lowercase letters, digits and hyphens. */
const GAME_ID_PATTERN = /^[a-z0-9-]+$/;

/**
 * What the player has chosen, remembered between runs.
 *
 * Preferences, not identity: they are stored per game under `<gameId>.*` rather
 * than in the origin-wide `player` cookie, because every game on this origin
 * shares that cookie and only this one has cars and engine noise in it.
 *
 * Every access is guarded — private browsing, disabled site data and embedded
 * contexts can all make localStorage throw rather than return null. A storage
 * failure must never break the game, so a read that fails falls back to the
 * default and a write that fails is simply forgotten.
 */
export class Prefs {
  private readonly carKey: string;
  private readonly mutedKey: string;

  constructor(gameId: string) {
    if (!GAME_ID_PATTERN.test(gameId)) {
      throw new Error(
        `Invalid game id ${JSON.stringify(gameId)}: expected a slug like "my-game" ` +
          '(lowercase letters, digits and hyphens).',
      );
    }
    this.carKey = `${gameId}.car`;
    this.mutedKey = `${gameId}.muted`;
  }

  carColor(): CarColorId {
    return toCarColor(this.read(this.carKey));
  }

  saveCarColor(color: CarColorId): void {
    this.write(this.carKey, color);
  }

  /** Sound is on until the player turns it off. */
  muted(): boolean {
    return this.read(this.mutedKey) === '1';
  }

  saveMuted(muted: boolean): void {
    this.write(this.mutedKey, muted ? '1' : '0');
  }

  private read(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage unavailable — the choice still applies to this session.
    }
  }
}

/**
 * Read a stored value as a colour, falling back to the default.
 *
 * Exported because it is the validation, not the storage, that is worth
 * testing: anything may be sitting under that key, including a colour that a
 * later version of the game removed.
 */
export function toCarColor(raw: string | null): CarColorId {
  return CAR_COLORS.some((color) => color.id === raw) ? (raw as CarColorId) : DEFAULT_CAR_COLOR;
}
