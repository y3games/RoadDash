/**
 * Score persistence boundary.
 *
 * The game never touches localStorage, fetch, or any backend directly — it only
 * knows this interface. Adding a global leaderboard later means writing one new
 * implementation (Supabase, Cloudflare Workers, AWS API Gateway, NCP — the game
 * does not care) and changing the single injection site in `main.ts`.
 */

import type { Player } from './player';

export interface LeaderboardEntry {
  readonly name: string;
  readonly score: number;
}

export interface ScoreService {
  /** Personal best. Returns 0 when there is no record yet. */
  getBest(): Promise<number>;

  /**
   * Record a finished run by the player who scored it. Returns true when it
   * beat the previous best, so the UI can celebrate without recomputing.
   *
   * The player is passed in rather than read from storage inside the service:
   * a server-backed implementation needs the id and name in the request body,
   * and taking them as an argument keeps that swap free of new plumbing.
   */
  submit(score: number, player: Player): Promise<boolean>;

  /**
   * Update the attribution of stored records after the player renames
   * themselves — the record is still theirs, so it must not keep the old name.
   * A server-backed implementation that keys records by player id can make this
   * a no-op.
   */
  renameOwner(player: Player): Promise<void>;

  /**
   * Global ranking, best first. Local-only implementations return an empty
   * array — callers must handle that rather than assuming a populated board.
   */
  getLeaderboard(limit: number): Promise<readonly LeaderboardEntry[]>;
}
