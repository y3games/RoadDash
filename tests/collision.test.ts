import { describe, expect, it } from 'vitest';

import { CAR, OBSTACLES } from '../src/game/config';
import { carRect, hitObstacle, isOffRoad, rectsOverlap } from '../src/game/collision';
import type { Obstacle } from '../src/game/obstacles';
import { createTrack, extendTrack, sampleTrack } from '../src/game/track';

function cone(x: number, s: number): Obstacle {
  return { x, s, width: OBSTACLES.coneWidth, length: OBSTACLES.rowLength, kind: 'cone' };
}

describe('rectsOverlap', () => {
  /**
   * Where this boundary sits is the difference between "I grazed it and lived"
   * and "I grazed it and died", so it is pinned rather than left to whoever
   * refactors next.
   */
  it('does not collide with a rect it exactly touches', () => {
    const a = { x: 0, s: 0, w: 10, l: 10 };
    expect(rectsOverlap(a, { x: 10, s: 0, w: 10, l: 10 })).toBe(false);
    expect(rectsOverlap(a, { x: 9.99, s: 0, w: 10, l: 10 })).toBe(true);
    expect(rectsOverlap(a, { x: 0, s: 10, w: 10, l: 10 })).toBe(false);
    expect(rectsOverlap(a, { x: 0, s: 9.99, w: 10, l: 10 })).toBe(true);
  });

  it('needs an overlap in both axes', () => {
    const a = { x: 0, s: 0, w: 10, l: 10 };
    expect(rectsOverlap(a, { x: 4, s: 40, w: 10, l: 10 })).toBe(false);
    expect(rectsOverlap(a, { x: 40, s: 4, w: 10, l: 10 })).toBe(false);
    expect(rectsOverlap(a, { x: 4, s: 4, w: 10, l: 10 })).toBe(true);
  });
});

describe('hitObstacle', () => {
  it('returns the obstacle that was hit, not just a flag', () => {
    const car = carRect(240, 1000);
    const target = cone(240, 1000);
    expect(hitObstacle(car, [cone(100, 1000), target, cone(400, 1000)])).toBe(target);
  });

  it('returns null when the car is between two rows', () => {
    const car = carRect(240, 1000);
    const clear = 1000 + (CAR.length + OBSTACLES.rowLength) / 2 + 1;
    expect(hitObstacle(car, [cone(240, clear), cone(240, 1000 - clear + 1000 - 1000)])).toBeNull();
  });
});

describe('isOffRoad', () => {
  const track = createTrack();
  extendTrack(track, 3_000);

  it('is false in the middle of the road', () => {
    const node = sampleTrack(track, 1_000);
    expect(isOffRoad(carRect(node.centerX, 1_000), track)).toBe(false);
  });

  it('is true once the car hangs past the edge by more than the tolerance', () => {
    // The road curves, so the binding edge is the tighter of the car's two
    // ends — the same rule isOffRoad applies.
    const front = sampleTrack(track, 1_000 + CAR.length / 2);
    const rear = sampleTrack(track, 1_000 - CAR.length / 2);
    const edge = Math.min(front.centerX + front.halfWidth, rear.centerX + rear.halfWidth);

    // Fully inside: the car's right side exactly on the edge.
    expect(isOffRoad(carRect(edge - CAR.width / 2, 1_000), track)).toBe(false);
    // Hanging over by less than the tolerance: forgiven.
    expect(isOffRoad(carRect(edge - CAR.width / 2 + CAR.offRoadTolerance - 1, 1_000), track)).toBe(
      false,
    );
    // Hanging over by more: a crash.
    expect(isOffRoad(carRect(edge - CAR.width / 2 + CAR.offRoadTolerance + 1, 1_000), track)).toBe(
      true,
    );
  });

  it('uses the tighter of the car’s front and rear', () => {
    // On a curve the two ends of the car see different edges; the narrower one
    // has to win, or a car can corner with its nose off the road.
    const front = sampleTrack(track, 2_000 + CAR.length / 2);
    const rear = sampleTrack(track, 2_000 - CAR.length / 2);
    const tightestRight = Math.min(front.centerX + front.halfWidth, rear.centerX + rear.halfWidth);
    const x = tightestRight - CAR.width / 2 + CAR.offRoadTolerance + 1;
    expect(isOffRoad(carRect(x, 2_000), track)).toBe(true);
  });
});
