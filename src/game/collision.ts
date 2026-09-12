/**
 * Collision, as pure geometry.
 *
 * This module must never import Phaser. Everything is in **(x, s) space** — x is
 * the logical lateral coordinate, s is the distance along the track — never in
 * screen space. Screen y is derived only at draw time, so these tests read as
 * geometry rather than as rendering, and a change to where the car sits on
 * screen cannot alter what counts as a crash.
 */

import { CAR } from './config';
import type { Obstacle } from './obstacles';
import type { TrackState } from './track';
import { roadEdgesAt } from './track';

/** A centre-based box: `w` across the road, `l` along it. */
export interface Rect {
  readonly x: number;
  readonly s: number;
  readonly w: number;
  readonly l: number;
}

/**
 * Overlap test, strict: boxes that exactly touch do **not** collide.
 *
 * Which side of that boundary we land on is the difference between "I grazed it
 * and lived" and "I grazed it and died", so it is pinned by a test rather than
 * left to whoever next refactors this.
 */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.s - b.s) < (a.l + b.l) / 2;
}

export function carRect(carX: number, carS: number): Rect {
  return { x: carX, s: carS, w: CAR.width, l: CAR.length };
}

/** The obstacle the car is touching, or null. Returns the obstacle so the
 * scene can flash the thing that killed the player. */
export function hitObstacle(car: Rect, obstacles: Iterable<Obstacle>): Obstacle | null {
  for (const obstacle of obstacles) {
    if (
      rectsOverlap(car, { x: obstacle.x, s: obstacle.s, w: obstacle.width, l: obstacle.length })
    ) {
      return obstacle;
    }
  }
  return null;
}

/**
 * Whether the car has left the road.
 *
 * The edges are sampled at the car's front and rear and the **tighter** of the
 * two is used. On the inside of a curve that is slightly conservative — the true
 * boundary between the samples bows outward — and conservative is the right
 * direction here: the player is only ever killed by road they can see, and
 * `CAR.offRoadTolerance` forgives the pixel of overhang that approximation can
 * cost them.
 */
export function isOffRoad(car: Rect, track: TrackState): boolean {
  const front = roadEdgesAt(track, car.s + car.l / 2);
  const rear = roadEdgesAt(track, car.s - car.l / 2);
  const left = Math.max(front.left, rear.left);
  const right = Math.min(front.right, rear.right);

  return (
    car.x - car.w / 2 < left - CAR.offRoadTolerance ||
    car.x + car.w / 2 > right + CAR.offRoadTolerance
  );
}
