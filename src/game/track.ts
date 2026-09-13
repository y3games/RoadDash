/**
 * The endless road, as geometry.
 *
 * This module must never import Phaser. The road is a list of nodes along the
 * track, each holding where the centreline is and how wide the road is there;
 * screen coordinates do not appear anywhere in this file — they are derived at
 * draw time from the car's own distance.
 *
 * Nodes are generated ahead of the car and pruned behind it, so the list stays
 * a fixed size however long a run lasts.
 */

import type { DifficultyParams } from './config';
import { LAYOUT, maxSlopeAt, TRACK } from './config';
import { levelFor, paramsForLevel } from './difficulty';

export interface TrackNode {
  /** Distance along the track from the start of the run. Monotonic. */
  readonly s: number;
  /** Road centre in logical x. */
  readonly centerX: number;
  /** Road half width here. */
  readonly halfWidth: number;
  /**
   * Integrated curve phase, radians.
   *
   * This field is the whole reason the road does not jump at a level boundary:
   * the centreline is `sin(phase)`, and phase is *accumulated* rather than
   * computed as `frequency * s`. A frequency change therefore alters the
   * derivative of the argument and never the argument itself. Computing
   * `sin(frequency * s)` with s in the tens of thousands would move the
   * argument by radians the instant frequency changed, and the road would
   * teleport sideways mid-run.
   */
  readonly phase: number;
}

export interface TrackState {
  /** Ordered by `s`, spaced exactly `TRACK.nodeStepPx` apart. */
  readonly nodes: TrackNode[];
}

/** Move `from` toward `to` by at most `maxDelta`. */
export function approach(from: number, to: number, maxDelta: number): number {
  const delta = to - from;
  if (Math.abs(delta) <= maxDelta) return to;
  return from + Math.sign(delta) * maxDelta;
}

function centerBounds(halfWidth: number): { readonly min: number; readonly max: number } {
  return {
    min: LAYOUT.edgeMargin + halfWidth,
    max: LAYOUT.width - LAYOUT.edgeMargin - halfWidth,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The next node after `prev`, `stepPx` further along the track.
 *
 * Both the centreline and the half width only ever *approach* what the
 * difficulty asks for, rate-limited. That is what turns a level-up from a step
 * into a glide — and the same limit on the centreline doubles as the road's
 * maximum steepness, which is what keeps it followable at all.
 */
export function stepNode(prev: TrackNode, params: DifficultyParams, stepPx: number): TrackNode {
  const phase = prev.phase + params.curveFrequency * stepPx;

  // Width first: the centre clamp below needs *this* node's width. Using the
  // previous width would let a narrowing road lag its own bounds and admit a
  // centre that puts the edge off canvas for a few nodes.
  const halfWidth = approach(prev.halfWidth, params.roadHalfWidth, TRACK.widthRatePerPx * stepPx);
  const bounds = centerBounds(halfWidth);

  const target = clamp(
    LAYOUT.width / 2 + params.curveAmplitude * Math.sin(phase),
    bounds.min,
    bounds.max,
  );
  // The slope limit is a function of the speed this stretch will be driven at:
  // the road may lean 0.55 while the game is slow, but it straightens as the
  // game speeds up so that following it never costs more than
  // TRACK.maxLateralPxPerSec of the car's steering.
  //
  // The clamp after the approach only bites when the bounds themselves moved
  // (a widening road). Bounds move at most widthRatePerPx per px, far less than
  // the slope limit, so this cannot break the continuity the approach gives.
  const centerX = clamp(
    approach(prev.centerX, target, maxSlopeAt(params.scrollSpeed) * stepPx),
    bounds.min,
    bounds.max,
  );

  return { s: prev.s + stepPx, centerX, halfWidth, phase };
}

/**
 * A fresh track: one node, straight ahead, at the starting width.
 *
 * It starts **behind** the start line by the length of road kept behind the car,
 * so the road is drawn under and past the car from the very first frame rather
 * than fading in over the first second of the run.
 */
export function createTrack(): TrackState {
  const base = paramsForLevel(1);
  const behind =
    Math.ceil((LAYOUT.behindPx + TRACK.nodeStepPx) / TRACK.nodeStepPx) * TRACK.nodeStepPx;
  return {
    nodes: [{ s: -behind, centerX: LAYOUT.width / 2, halfWidth: base.roadHalfWidth, phase: 0 }],
  };
}

/**
 * Generate nodes until the track reaches `untilS`. Returns **only the new
 * nodes**, so the caller can place obstacles on them without rescanning.
 *
 * Each node is built from the params at **its own distance**, not at the car's.
 * Generation runs a full screen ahead, so using the car's level would make every
 * difficulty change visibly lag by half a screen. (`scrollSpeed` is the one
 * param that is a property of *now* rather than of a place, and `world.ts` reads
 * that one from the car's level instead — see the note there.)
 */
export function extendTrack(state: TrackState, untilS: number): readonly TrackNode[] {
  const created: TrackNode[] = [];
  let last = state.nodes[state.nodes.length - 1];

  while (last.s < untilS) {
    const nextS = last.s + TRACK.nodeStepPx;
    // The stretch before the start line is approach road: it belongs to level 1,
    // and levelFor() rightly refuses to answer for a negative distance.
    const node = stepNode(last, paramsForLevel(levelFor(Math.max(nextS, 0))), TRACK.nodeStepPx);
    state.nodes.push(node);
    created.push(node);
    last = node;
  }

  return created;
}

/**
 * Drop nodes behind `behindS`, keeping one at or before it so a position at
 * `behindS` is still between two nodes and therefore still samplable.
 */
export function pruneTrack(state: TrackState, behindS: number): void {
  let keepFrom = 0;
  while (keepFrom + 1 < state.nodes.length && state.nodes[keepFrom + 1].s <= behindS) {
    keepFrom += 1;
  }
  if (keepFrom > 0) state.nodes.splice(0, keepFrom);
}

/**
 * The road at an arbitrary distance, interpolated between two nodes.
 *
 * Spacing is uniform, so the bracketing node is an index rather than a search.
 * Outside the generated range the nearest end node is returned — the caller
 * should not be asking, but a clamped answer is better than a crash in a loop
 * that runs every frame.
 */
export function sampleTrack(state: TrackState, s: number): TrackNode {
  const { nodes } = state;
  const raw = (s - nodes[0].s) / TRACK.nodeStepPx;
  if (raw <= 0) return nodes[0];
  if (raw >= nodes.length - 1) return nodes[nodes.length - 1];

  const index = Math.floor(raw);
  const t = raw - index;
  const a = nodes[index];
  const b = nodes[index + 1];
  return {
    s,
    centerX: a.centerX + (b.centerX - a.centerX) * t,
    halfWidth: a.halfWidth + (b.halfWidth - a.halfWidth) * t,
    phase: a.phase + (b.phase - a.phase) * t,
  };
}

/** Left and right road edge at a distance. */
export function roadEdgesAt(
  state: TrackState,
  s: number,
): { readonly left: number; readonly right: number } {
  const node = sampleTrack(state, s);
  return { left: node.centerX - node.halfWidth, right: node.centerX + node.halfWidth };
}

/** A stretch of road reduced to what is passable across it. */
export interface RoadSpan {
  readonly s: number;
  readonly left: number;
  readonly right: number;
}

/**
 * The road that is passable for a body of `2 * halfLength` centred at `s`: the
 * **intersection** of the spans at its two ends, not the span at its middle.
 *
 * Anything that takes time to cross a point on the track — the car crossing a
 * row of obstacles — spends that time on a road that is still moving sideways.
 * Taking the nominal span at `s` would hand out room that has slid away by the
 * time the far end of the body gets there, which is how a gap ends up half off
 * the road and the car ends up squeezed between a blocker and the verge.
 */
export function roadSpanAcross(state: TrackState, s: number, halfLength: number): RoadSpan {
  const near = roadEdgesAt(state, s - halfLength);
  const middle = roadEdgesAt(state, s);
  const far = roadEdgesAt(state, s + halfLength);
  return {
    s,
    left: Math.max(near.left, middle.left, far.left),
    right: Math.min(near.right, middle.right, far.right),
  };
}
