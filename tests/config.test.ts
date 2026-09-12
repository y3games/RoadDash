import { describe, expect, it } from 'vitest';

import {
  AXIS_PARAMS,
  CAR,
  DIFFICULTY,
  DIFFICULTY_AXES,
  LAYOUT,
  MOTION,
  OBSTACLES,
  TRACK,
} from '../src/game/config';
import { SAFE_GAP } from '../src/game/obstacles';

/**
 * The balance table is only sound if a handful of relationships between its
 * numbers hold. Each of these is a way the game breaks — an impassable row, a
 * road the car cannot follow, an obstacle it can tunnel through — so they are
 * asserted rather than left as comments next to the values.
 */
describe('the difficulty table', () => {
  it('gives every axis a base, a step and a cap', () => {
    for (const axis of DIFFICULTY_AXES) {
      for (const key of AXIS_PARAMS[axis]) {
        expect(Number.isFinite(DIFFICULTY.base[key]), `${axis}.${key} base`).toBe(true);
        expect(DIFFICULTY.step[key], `${axis}.${key} step`).toBeGreaterThan(0);
        expect(Number.isFinite(DIFFICULTY.cap[key]), `${axis}.${key} cap`).toBe(true);
      }
    }
  });

  it('puts each cap on the far side of its base in the direction the axis moves', () => {
    // Speed and curve rise; a denser track and a tighter road are smaller
    // numbers, so those fall.
    expect(DIFFICULTY.cap.scrollSpeed).toBeGreaterThan(DIFFICULTY.base.scrollSpeed);
    expect(DIFFICULTY.cap.curveAmplitude).toBeGreaterThan(DIFFICULTY.base.curveAmplitude);
    expect(DIFFICULTY.cap.curveFrequency).toBeGreaterThan(DIFFICULTY.base.curveFrequency);
    expect(DIFFICULTY.cap.spawnIntervalPx).toBeLessThan(DIFFICULTY.base.spawnIntervalPx);
    expect(DIFFICULTY.cap.roadHalfWidth).toBeLessThan(DIFFICULTY.base.roadHalfWidth);
  });
});

describe('the hardest the game ever gets', () => {
  it('still fits a safe gap plus a blocker on each side of it', () => {
    const narrowest = 2 * DIFFICULTY.cap.roadHalfWidth;
    expect(narrowest).toBeGreaterThanOrEqual(SAFE_GAP + 2 * OBSTACLES.coneWidth);
  });

  it('leaves the car able to out-steer the steepest road', () => {
    // Lateral px available per px of forward travel, derated by the same safety
    // factor obstacle reachability uses. Below TRACK.maxSlope, following the
    // road at top speed becomes impossible regardless of obstacles.
    const authority = (CAR.steerSpeed / DIFFICULTY.cap.scrollSpeed) * OBSTACLES.reachSafety;
    expect(authority).toBeGreaterThanOrEqual(TRACK.maxSlope);
  });

  it('leaves a car length of clear track between the tightest rows', () => {
    expect(DIFFICULTY.cap.spawnIntervalPx - OBSTACLES.rowLength).toBeGreaterThan(CAR.length);
  });

  it('keeps the widest swing on the narrowest road inside the canvas', () => {
    const reach = LAYOUT.width / 2 + DIFFICULTY.cap.curveAmplitude + DIFFICULTY.cap.roadHalfWidth;
    expect(reach).toBeLessThanOrEqual(LAYOUT.width - LAYOUT.edgeMargin);
  });

  it('leaves a full second of lookahead at top speed', () => {
    expect(LAYOUT.lookaheadPx / DIFFICULTY.cap.scrollSpeed).toBeGreaterThanOrEqual(1);
  });
});

describe('the geometry the renderer and the collider share', () => {
  it('generates track for the whole strip above the car', () => {
    expect(LAYOUT.lookaheadPx).toBeGreaterThanOrEqual(LAYOUT.carScreenY);
  });

  it('keeps track for the whole strip below the car', () => {
    expect(LAYOUT.behindPx).toBeGreaterThanOrEqual(LAYOUT.height - LAYOUT.carScreenY);
  });

  it('checks collisions more often than an obstacle is thin', () => {
    // A substep longer than the smallest obstacle in either axis would let a
    // fast car step straight over it between two checks.
    expect(MOTION.maxSubStepPx).toBeLessThan(OBSTACLES.rowLength);
    expect(MOTION.maxSubStepPx).toBeLessThan(OBSTACLES.coneWidth);
  });

  it('never leaves a leftover stretch the car could fit through', () => {
    // Tiling leaves less than one cone of road unblocked. A cone no wider than
    // the car is what makes that leftover unusable instead of a second gap.
    expect(OBSTACLES.coneWidth).toBeLessThanOrEqual(CAR.width);
  });

  it('samples the road at least once per node step of car length', () => {
    // isOffRoad() samples the car's front and rear only; a car much longer than
    // the node spacing could bow across a curve between those samples.
    expect(CAR.length).toBeLessThan(4 * TRACK.nodeStepPx);
  });
});
