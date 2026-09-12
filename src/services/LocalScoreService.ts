import type { Player } from './player';
import type { LeaderboardEntry, ScoreService } from './ScoreService';

/** Who set the stored best. The id is what makes a rename resolvable. */
interface OwnerRecord {
  readonly id: string;
  readonly name: string;
}

/** A game id is a slug: lowercase letters, digits and hyphens. */
const GAME_ID_PATTERN = /^[a-z0-9-]+$/;

/**
 * Browser-local implementation: personal best only, no global ranking.
 *
 * The storage key is derived from the game id rather than hardcoded. Every game
 * deployed to the same GitHub Pages origin shares one localStorage, so a key
 * baked into the template would make two template-derived games silently
 * overwrite each other's best score. `<gameId>.best` is also the convention the
 * games portal reads, so that key holds a bare number and nothing else — who
 * scored it lives in a sibling `<gameId>.best.owner` key.
 *
 * Every storage access is guarded — private browsing, disabled site data, and
 * embedded contexts can all make localStorage throw rather than return null.
 * A storage failure must never break the game, so reads fall back to 0.
 */
export class LocalScoreService implements ScoreService {
  private readonly bestKey: string;
  private readonly ownerKey: string;

  /**
   * @param gameId Stable slug for this game, matching the repository name and
   * the portal's entry id (e.g. `mergedrop`). It must be unique across every
   * game served from the same origin.
   */
  constructor(gameId: string) {
    if (!GAME_ID_PATTERN.test(gameId)) {
      throw new Error(
        `Invalid game id ${JSON.stringify(gameId)}: expected a slug like "my-game" ` +
          '(lowercase letters, digits and hyphens).',
      );
    }
    this.bestKey = `${gameId}.best`;
    this.ownerKey = `${gameId}.best.owner`;
  }

  async getBest(): Promise<number> {
    try {
      const raw = localStorage.getItem(this.bestKey);
      const value = Number(raw);
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch {
      return 0;
    }
  }

  async submit(score: number, player: Player): Promise<boolean> {
    const best = await this.getBest();
    if (score <= best) return false;
    try {
      localStorage.setItem(this.bestKey, String(score));
      this.writeOwner(player);
    } catch {
      // Storage unavailable — the run still counted for this session.
    }
    return true;
  }

  async renameOwner(player: Player): Promise<void> {
    // Only the record this player set. A best score left by someone else on a
    // shared browser keeps the name it was earned under.
    if (this.readOwner()?.id !== player.id) return;
    this.writeOwner(player);
  }

  /**
   * One entry at most: this browser's own best, under the name that set it.
   * There is no server, so there is nobody else to rank against — but the shape
   * matches what a real leaderboard returns, so the UI needs no special case.
   */
  async getLeaderboard(): Promise<readonly LeaderboardEntry[]> {
    const score = await this.getBest();
    if (score === 0) return [];
    return [{ name: this.readOwner()?.name ?? '이 기기', score }];
  }

  private readOwner(): OwnerRecord | null {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(this.ownerKey) ?? 'null');
      if (typeof parsed !== 'object' || parsed === null) return null;
      const { id, name } = parsed as Record<string, unknown>;
      return typeof id === 'string' && typeof name === 'string' ? { id, name } : null;
    } catch {
      return null;
    }
  }

  private writeOwner(player: Player): void {
    try {
      localStorage.setItem(this.ownerKey, JSON.stringify({ id: player.id, name: player.name }));
    } catch {
      // Storage unavailable — the score itself did not persist either.
    }
  }
}
