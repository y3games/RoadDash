/**
 * Single source of truth for every tunable number.
 *
 * Nothing here imports Phaser. Balance and layout changes happen in this file
 * and nowhere else — a magic number in a scene is a bug.
 */

export interface BallKind {
  readonly name: string;
  readonly radius: number;
  readonly color: number;
  readonly score: number;
}

export const BALL_KINDS: readonly BallKind[] = [
  { name: 'small', radius: 16, color: 0x4fc3f7, score: 1 },
  { name: 'medium', radius: 24, color: 0x81c784, score: 3 },
  { name: 'large', radius: 34, color: 0xffb74d, score: 6 },
] as const;

/** Relative spawn weights, one per entry in BALL_KINDS. */
export const SPAWN_WEIGHTS: readonly number[] = [55, 30, 15];

/** Logical canvas size. All game coordinates live in this space. */
export const LAYOUT = {
  width: 480,
  height: 800,
  wallLeft: 40,
  wallRight: 440,
  floorY: 760,
  wallThickness: 40,
  dropY: 90,
} as const;

export const PHYSICS = {
  gravityY: 1.1,
  restitution: 0.25,
  friction: 0.3,
  frictionStatic: 0.5,
  density: 0.001,
  dropCooldownMs: 250,
  /** Matter body speed below which a ball counts as settled rather than falling. */
  settleSpeed: 0.7,
} as const;
