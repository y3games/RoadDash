import { describe, expect, it } from 'vitest';

import { CAR, DIFFICULTY, LAYOUT, TRACK } from '../src/game/config';
import { levelFor, paramsForLevel } from '../src/game/difficulty';
import {
  approach,
  createTrack,
  extendTrack,
  pruneTrack,
  roadEdgesAt,
  sampleTrack,
} from '../src/game/track';

/** Float slack for a comparison against a rate limit. */
const EPSILON = 1e-9;

function trackTo(untilS: number) {
  const track = createTrack();
  extendTrack(track, untilS);
  return track;
}

describe('approach', () => {
  it('moves toward the target and stops on it', () => {
    expect(approach(0, 10, 4)).toBe(4);
    expect(approach(0, 10, 40)).toBe(10);
    expect(approach(10, 0, 4)).toBe(6);
    expect(approach(5, 5, 0)).toBe(5);
  });
});

describe('the generated road', () => {
  it('starts straight ahead at the base width', () => {
    const [first] = createTrack().nodes;
    expect(first).toMatchObject({
      centerX: LAYOUT.width / 2,
      halfWidth: DIFFICULTY.base.roadHalfWidth,
      phase: 0,
    });
  });

  it('exists behind the start line, so the car is on road from frame one', () => {
    const track = createTrack();
    expect(track.nodes[0].s).toBeLessThanOrEqual(-LAYOUT.behindPx);

    // Approach road included, the car's starting position is comfortably on it.
    extendTrack(track, 200);
    for (const node of track.nodes.filter((n) => n.s <= 0)) {
      const offset = Math.abs(node.centerX - LAYOUT.width / 2);
      expect(offset).toBeLessThan(node.halfWidth - CAR.width);
    }
  });

  /**
   * The reason TrackNode carries an integrated phase. Computing the centreline
   * as sin(frequency * s) would teleport the road sideways the moment a level
   * changed the frequency, with s in the tens of thousands.
   */
  it('never jumps, not even across a level boundary', () => {
    const track = trackTo(60_000);
    const limit = TRACK.maxSlope * TRACK.nodeStepPx + EPSILON;
    for (let i = 1; i < track.nodes.length; i += 1) {
      const delta = Math.abs(track.nodes[i].centerX - track.nodes[i - 1].centerX);
      expect(delta, `node ${i} at s=${track.nodes[i].s}`).toBeLessThanOrEqual(limit);
    }
  });

  it('changes width no faster than its rate limit', () => {
    const track = trackTo(60_000);
    const limit = TRACK.widthRatePerPx * TRACK.nodeStepPx + EPSILON;
    for (let i = 1; i < track.nodes.length; i += 1) {
      const delta = Math.abs(track.nodes[i].halfWidth - track.nodes[i - 1].halfWidth);
      expect(delta).toBeLessThanOrEqual(limit);
    }
  });

  it('stays inside the canvas for a very long run', () => {
    for (const node of trackTo(120_000).nodes) {
      expect(node.centerX - node.halfWidth).toBeGreaterThanOrEqual(LAYOUT.edgeMargin - EPSILON);
      expect(node.centerX + node.halfWidth).toBeLessThanOrEqual(
        LAYOUT.width - LAYOUT.edgeMargin + EPSILON,
      );
    }
  });

  it('narrows and twists as the levels demand', () => {
    const track = trackTo(60_000);
    const late = track.nodes[track.nodes.length - 1];
    expect(late.halfWidth).toBeCloseTo(DIFFICULTY.cap.roadHalfWidth, 5);
  });

  /** A road that generated perfectly straight would pass every test above. */
  it('actually curves', () => {
    const track = trackTo(30_000);
    const lateNodes = track.nodes.filter((n) => n.s > 24_000);
    const centres = lateNodes.map((n) => n.centerX);
    expect(Math.max(...centres) - Math.min(...centres)).toBeGreaterThan(100);
  });

  it('keeps node spacing uniform', () => {
    const track = trackTo(10_000);
    for (let i = 1; i < track.nodes.length; i += 1) {
      expect(track.nodes[i].s - track.nodes[i - 1].s).toBeCloseTo(TRACK.nodeStepPx, 9);
    }
  });

  it('generates each node from the params at that node, not at the car', () => {
    // Take a node deep into the run and re-derive it from its own predecessor
    // with the params for its own distance.
    const track = trackTo(20_000);
    const index = track.nodes.findIndex((n) => n.s >= 18_000);
    const previous = track.nodes[index - 1];
    const node = track.nodes[index];
    const params = paramsForLevel(levelFor(node.s));
    const phase = previous.phase + params.curveFrequency * TRACK.nodeStepPx;
    expect(node.phase).toBeCloseTo(phase, 9);
  });
});

describe('extendTrack', () => {
  it('returns only the nodes it created', () => {
    const track = createTrack();
    const first = extendTrack(track, 1_000);
    expect(first.length).toBeGreaterThan(0);
    expect(first[first.length - 1]).toBe(track.nodes[track.nodes.length - 1]);

    const again = extendTrack(track, 1_000);
    expect(again).toEqual([]);
  });

  it('only ever generates forward', () => {
    const track = trackTo(5_000);
    const head = track.nodes[track.nodes.length - 1];
    extendTrack(track, 100);
    expect(track.nodes[track.nodes.length - 1]).toBe(head);
  });
});

describe('pruneTrack', () => {
  it('keeps one node behind the cut so that position is still samplable', () => {
    const track = trackTo(5_000);
    pruneTrack(track, 2_000);
    expect(track.nodes[0].s).toBeLessThanOrEqual(2_000);
    expect(track.nodes[1].s).toBeGreaterThan(2_000);
    expect(sampleTrack(track, 2_000).s).toBe(2_000);
  });

  it('bounds the node count over a long run', () => {
    const track = createTrack();
    let counted = 0;
    for (let carS = 0; carS < 100_000; carS += 137) {
      extendTrack(track, carS + LAYOUT.lookaheadPx);
      pruneTrack(track, carS - LAYOUT.behindPx);
      counted = Math.max(counted, track.nodes.length);
    }
    const window = (LAYOUT.lookaheadPx + LAYOUT.behindPx) / TRACK.nodeStepPx;
    expect(counted).toBeLessThan(window + 10);
  });
});

describe('sampleTrack', () => {
  it('matches exactly at a node and interpolates between two', () => {
    const track = trackTo(2_000);
    const node = track.nodes[20];
    expect(sampleTrack(track, node.s).centerX).toBeCloseTo(node.centerX, 9);

    const next = track.nodes[21];
    const middle = sampleTrack(track, (node.s + next.s) / 2);
    expect(middle.centerX).toBeCloseTo((node.centerX + next.centerX) / 2, 9);
    expect(middle.halfWidth).toBeCloseTo((node.halfWidth + next.halfWidth) / 2, 9);
  });

  it('clamps to the ends rather than throwing', () => {
    const track = trackTo(1_000);
    expect(sampleTrack(track, -500)).toBe(track.nodes[0]);
    expect(sampleTrack(track, 99_999)).toBe(track.nodes[track.nodes.length - 1]);
  });

  it('reports edges a half width either side of the centre', () => {
    const track = trackTo(1_000);
    const node = sampleTrack(track, 512);
    const edges = roadEdgesAt(track, 512);
    expect(edges.left).toBeCloseTo(node.centerX - node.halfWidth, 9);
    expect(edges.right).toBeCloseTo(node.centerX + node.halfWidth, 9);
  });
});
