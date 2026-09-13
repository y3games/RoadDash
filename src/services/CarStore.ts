import type { CarColorId } from '../game/config';
import { CAR_COLORS, DEFAULT_CAR_COLOR } from '../game/config';

/** A game id is a slug: lowercase letters, digits and hyphens. */
const GAME_ID_PATTERN = /^[a-z0-9-]+$/;

/**
 * Which car the player drives, remembered between runs.
 *
 * A preference, not identity: it is stored per game under `<gameId>.car` rather
 * than in the origin-wide `player` cookie, because every game on this origin
 * shares that cookie and only this one has cars in it.
 *
 * Every access is guarded — private browsing, disabled site data and embedded
 * contexts can all make localStorage throw rather than return null. A storage
 * failure must never break the game, so a read that fails falls back to the
 * default colour and a write that fails is simply forgotten.
 */
export class CarStore {
  private readonly key: string;

  constructor(gameId: string) {
    if (!GAME_ID_PATTERN.test(gameId)) {
      throw new Error(
        `Invalid game id ${JSON.stringify(gameId)}: expected a slug like "my-game" ` +
          '(lowercase letters, digits and hyphens).',
      );
    }
    this.key = `${gameId}.car`;
  }

  read(): CarColorId {
    try {
      return toCarColor(localStorage.getItem(this.key));
    } catch {
      return DEFAULT_CAR_COLOR;
    }
  }

  save(color: CarColorId): void {
    try {
      localStorage.setItem(this.key, color);
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
