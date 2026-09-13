import { describe, expect, it } from 'vitest';

import {
  AXIS_PARAMS,
  CAR,
  DIFFICULTY,
  DIFFICULTY_AXES,
  EARLY,
  LAYOUT,
  MOTION,
  OBSTACLES,
  SAFE_GAP,
  TRACK,
} from '../src/game/config';
import { maxGapShift } from '../src/game/obstacles';

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
    // The tail floor, not the rotation cap: the tail is what actually decides
    // how close two rows ever get.
    expect(DIFFICULTY.tailCap.spawnIntervalPx - OBSTACLES.rowLength).toBeGreaterThan(CAR.length);
  });

  it('asks for no more curve than the road is allowed to draw', () => {
    // A slew-limited follower of a sine can only reach an amplitude of
    // maxSlope * π / (2 * frequency). A larger cap would be a decoration: the
    // ramp would keep raising a number the road cannot express.
    const reachable = (TRACK.maxSlope * Math.PI) / (2 * DIFFICULTY.cap.curveFrequency);
    expect(DIFFICULTY.cap.curveAmplitude).toBeLessThanOrEqual(reachable);
  });

  it('keeps the widest swing on the narrowest road inside the canvas', () => {
    const reach = LAYOUT.width / 2 + DIFFICULTY.cap.curveAmplitude + DIFFICULTY.cap.roadHalfWidth;
    expect(reach).toBeLessThanOrEqual(LAYOUT.width - LAYOUT.edgeMargin);
  });

  it('leaves a full second of lookahead at top speed', () => {
    expect(LAYOUT.lookaheadPx / DIFFICULTY.cap.scrollSpeed).toBeGreaterThanOrEqual(1);
  });
});

describe('the endgame tail', () => {
  it('tightens both of its axes past where the rotation left them', () => {
    expect(DIFFICULTY.tailCap.spawnIntervalPx).toBeLessThan(DIFFICULTY.cap.spawnIntervalPx);
    expect(DIFFICULTY.tailCap.gapSlackRatio).toBeLessThan(DIFFICULTY.base.gapSlackRatio);
    expect(DIFFICULTY.tailStep.spawnIntervalPx).toBeGreaterThan(0);
    expect(DIFFICULTY.tailStep.gapSlackRatio).toBeGreaterThan(0);
  });

  it('still leaves the car somewhere to go at its tightest', () => {
    const tightest = {
      ...DIFFICULTY.cap,
      spawnIntervalPx: DIFFICULTY.tailCap.spawnIntervalPx,
      gapSlackRatio: DIFFICULTY.tailCap.gapSlackRatio,
      minGapWidth: SAFE_GAP,
    };
    // A budget of zero would mean every gap sits exactly where the last one
    // did — the track would stop asking anything of the player.
    expect(maxGapShift(tightest)).toBeGreaterThan(CAR.width / 2);
  });
});

describe('the beginner’s gap', () => {
  it('starts wider than the safe minimum and decays onto it', () => {
    expect(EARLY.gapBonusPx).toBeGreaterThan(0);
    expect(EARLY.levels).toBeGreaterThan(1);
    // It must fit inside the road it is given, or level 1 would have no room
    // for obstacles at all.
    expect(SAFE_GAP + EARLY.gapBonusPx).toBeLessThan(2 * DIFFICULTY.base.roadHalfWidth);
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
