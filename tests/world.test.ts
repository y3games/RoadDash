import { describe, expect, it } from 'vitest';

import { CAR, LAYOUT, OBSTACLES, TRACK } from '../src/game/config';
import { MAX_LEVEL, scoreMultiplier, SPEED_ONLY_LEVEL } from '../src/game/difficulty';
import { paramsForLevel } from '../src/game/difficulty';
import type { WorldState } from '../src/game/world';
import { createWorld, drivableBounds, nextRowAhead, stepWorld } from '../src/game/world';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * A competent player, as a function: aim at the next gap, but never leave the
 * road you are on to line up early.
 *
 * It is deliberately simple — no prediction, no braking, no knowledge the player
 * lacks. If this can survive, a human can.
 */
function autopilot(world: WorldState, dtSeconds: number): number {
  // Where the car may legally be *now*: the road it is standing on, measured
  // the way isOffRoad measures it, minus the tolerance the collider forgives.
  const bounds = drivableBounds(world);
  let low = bounds.min + CAR.offRoadTolerance;
  let high = bounds.max - CAR.offRoadTolerance;

  // Narrow that to the part of the road that also gets through the next row.
  const row = nextRowAhead(world);
  if (row !== null) {
    const gapLow = row.gapCenter - row.gapWidth / 2 + CAR.width / 2;
    const gapHigh = row.gapCenter + row.gapWidth / 2 - CAR.width / 2;
    const both = [Math.max(low, gapLow), Math.min(high, gapHigh)] as const;
    if (both[0] <= both[1]) {
      [low, high] = both;
    } else {
      // The road has not brought the gap within reach yet; sit as close to it
      // as the road allows and wait for it to come.
      const nearest = clamp((gapLow + gapHigh) / 2, low, high);
      low = nearest;
      high = nearest;
    }
  }

  // Aim at the **middle** of what is legal, never at its edge. Aiming at an
  // edge leaves no room for a frame of lag, and half a pixel of it is a crash.
  const target = (low + high) / 2;

  // Steer no harder than it takes to land on the target this frame. A fixed
  // gain overshoots by a frame of travel, which on the edge of the road is a
  // crash the player would never have made.
  return clamp((target - world.carX) / (CAR.steerSpeed * dtSeconds), -1, 1);
}

function drive(
  world: WorldState,
  seconds: number,
  frameMs: number,
  steer: (world: WorldState, dtSeconds: number) => number = autopilot,
): void {
  const dt = frameMs / 1000;
  for (let elapsed = 0; elapsed < seconds; elapsed += dt) {
    if (world.crash !== null) return;
    stepWorld(world, dt, steer(world, dt));
  }
}

describe('a run', () => {
  it('holds still until the player first steers', () => {
    const world = createWorld(1);
    const result = stepWorld(world, 1 / 60, 0);
    expect(world.carS).toBe(0);
    expect(world.started).toBe(false);
    expect(result.score).toBe(0);

    stepWorld(world, 1 / 60, 1);
    expect(world.started).toBe(true);
    expect(world.carS).toBeGreaterThan(0);
  });

  it('has a road and a first row ready before the first step', () => {
    const world = createWorld(7);
    expect(world.rows.length).toBeGreaterThan(0);
    expect(world.track.nodes[world.track.nodes.length - 1].s).toBeGreaterThanOrEqual(
      LAYOUT.lookaheadPx,
    );
  });

  /**
   * The most valuable test in the repository: the proof that the generator
   * produces a track a player can actually get through. Every invariant in
   * `obstacles.ts` exists to make this pass.
   *
   * The claim is bounded at the **designed ramp** — through the rotation and
   * into the tail. Past that the tail deliberately keeps shrinking the margin,
   * and this driver does eventually die on some seeds; that is the tail working,
   * not the track cheating.
   */
  it('is survivable through the whole ramp by a player who just aims at the gap', () => {
    for (const seed of [1, 2, 3, 17, 99, 12345]) {
      const world = createWorld(seed);
      drive(world, 70, 1000 / 60);
      expect(world.crash, `seed ${seed} crashed at ${Math.round(world.carS)}px`).toBeNull();
      expect(world.level).toBeGreaterThanOrEqual(MAX_LEVEL);
    }
  });

  it('is survivable at 30 Hz and at 120 Hz too', () => {
    for (const frameMs of [1000 / 30, 1000 / 120]) {
      const world = createWorld(4242);
      drive(world, 70, frameMs);
      expect(world.crash, `${Math.round(1000 / frameMs)} Hz`).toBeNull();
    }
  });

  /**
   * Not bit-identical, and it cannot be: a level boundary falls inside a
   * different frame at each rate, so the speed schedule quantises slightly
   * differently. What matters is that frame rate is not an advantage — a few px
   * in six thousand is noise, a systematic difference would be a cheat.
   */
  it('travels the same distance whatever the frame rate', () => {
    const distances = [1000 / 120, 1000 / 60, 1000 / 30, 1000 / 45].map((frameMs) => {
      const world = createWorld(8);
      drive(world, 20, frameMs);
      return world.carS;
    });
    for (const distance of distances) {
      expect(Math.abs(distance - distances[0]) / distances[0]).toBeLessThan(0.001);
    }
  });

  it('replays exactly from the same seed and the same input', () => {
    const runs = [0, 1].map(() => {
      const world = createWorld(555);
      drive(world, 30, 1000 / 60);
      return { carS: world.carS, carX: world.carX, crash: world.crash, level: world.level };
    });
    expect(runs[0]).toEqual(runs[1]);
  });
});

describe('a run ends', () => {
  it('on an obstacle when the car stops steering', () => {
    const world = createWorld(3);
    // One nudge to start the world, then hands off the wheel entirely.
    stepWorld(world, 1 / 60, 1);
    drive(world, 60, 1000 / 60, () => 0);
    expect(world.crash).not.toBeNull();
  });

  it('off the road when the car steers into the verge', () => {
    const world = createWorld(3);
    drive(world, 10, 1000 / 60, () => -1);
    expect(world.crash).toBe('offroad');
  });

  it('and then nothing further happens', () => {
    const world = createWorld(3);
    drive(world, 10, 1000 / 60, () => -1);
    const frozen = { carS: world.carS, carX: world.carX, crash: world.crash };

    const result = stepWorld(world, 1 / 60, 1);
    expect(result.crash).toBe(frozen.crash);
    expect(world.carS).toBe(frozen.carS);
    expect(world.carX).toBe(frozen.carX);
  });

  /**
   * A frame delta of seconds — a tab switch, a breakpoint — must not let the car
   * step over an obstacle between two collision checks.
   */
  it('rather than tunnelling through a row on a multi-second frame', () => {
    const world = createWorld(3);
    stepWorld(world, 1 / 60, 1);

    const firstRow = world.rows.find((row) => row.s > world.carS);
    expect(firstRow).toBeDefined();
    expect(firstRow!.obstacles.length).toBeGreaterThan(0);
    // Line the car up on a blocker rather than the gap, so passing the row
    // cleanly is not an option — only a skipped check could let it through.
    world.carX = firstRow!.obstacles[0].x;

    // One frame worth two seconds: 1200 px of track in a single step.
    stepWorld(world, 2, 0);
    expect(world.crash).toBe('obstacle');
    expect(world.carS).toBeLessThan(firstRow!.s + OBSTACLES.rowLength);
  });

  it('ignoring a frame with no time in it', () => {
    const world = createWorld(3);
    stepWorld(world, 1 / 60, 1);
    const { carS } = world;
    stepWorld(world, 0, 1);
    stepWorld(world, -1, 1);
    expect(world.carS).toBe(carS);
  });
});

describe('the endgame', () => {
  /**
   * A track that keeps its fairness invariants cannot kill a perfect player —
   * that is what fairness *means* — so the shape of the track stops getting
   * harder and speed carries the difficulty alone. This pins that a long run
   * really does end up faster on a track of unchanged shape.
   */
  it('keeps accelerating on a track whose shape has stopped changing', () => {
    const world = createWorld(1);
    drive(world, 70, 1000 / 60);
    expect(world.crash).toBeNull();
    expect(world.level).toBeGreaterThanOrEqual(MAX_LEVEL);

    const settled = paramsForLevel(SPEED_ONLY_LEVEL);
    const now = paramsForLevel(world.level);
    expect(now.scrollSpeed).toBeGreaterThan(settled.scrollSpeed);
    expect(now.spawnIntervalPx).toBe(settled.spawnIntervalPx);
    expect(now.roadHalfWidth).toBe(settled.roadHalfWidth);
  });
});

describe('the score', () => {
  it('counts up from zero and stays whole', () => {
    const world = createWorld(31);
    let previous = 0;
    for (let i = 0; i < 600 && world.crash === null; i += 1) {
      const { score } = stepWorld(world, 1 / 60, autopilot(world, 1 / 60));
      expect(Number.isInteger(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(previous);
      previous = score;
    }
    expect(previous).toBeGreaterThan(0);
  });

  /**
   * The multiplier's whole point: the same stretch of track must pay more when
   * it is harder, or the hardest rows in the game are the cheapest.
   */
  it('pays more for the same distance later in the run', () => {
    const world = createWorld(77);
    drive(world, 2, 1000 / 60);
    const earlyLevel = world.level;
    const earlyRate = world.score / world.carS;

    drive(world, 40, 1000 / 60);
    expect(world.crash).toBeNull();
    expect(world.level).toBeGreaterThan(earlyLevel);
    expect(world.score / world.carS).toBeGreaterThan(earlyRate);
    expect(scoreMultiplier(world.level)).toBeGreaterThan(scoreMultiplier(earlyLevel));
  });
});

describe('a long run', () => {
  it('reports a level-up exactly once, naming the axis that rose', () => {
    const world = createWorld(11);
    const seen: number[] = [];
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 60 && world.crash === null; i += 1) {
      const result = stepWorld(world, dt, autopilot(world, dt));
      if (result.levelUp !== null) {
        seen.push(result.levelUp.level);
        expect(result.levelUp.axis).toBeTruthy();
      }
    }
    expect(seen).toEqual([...new Set(seen)]);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen[0]).toBe(2);
  });

  it('keeps its memory bounded', () => {
    const world = createWorld(6);
    let nodes = 0;
    let rows = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 120 && world.crash === null; i += 1) {
      stepWorld(world, dt, autopilot(world, dt));
      nodes = Math.max(nodes, world.track.nodes.length);
      rows = Math.max(rows, world.rows.length);
    }
    expect(nodes).toBeLessThan((LAYOUT.lookaheadPx + LAYOUT.behindPx) / TRACK.nodeStepPx + 10);
    expect(rows).toBeLessThan(10);
  });
});
