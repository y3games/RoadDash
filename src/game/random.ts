/**
 * Seeded pseudo-random numbers.
 *
 * The track is generated from random draws, so a run is only reproducible if
 * the source is seeded: tests replay an exact track, and `?seed=` in dev
 * replays a bug. `Math.random()` cannot do either.
 *
 * mulberry32 — 32-bit state, uniform in [0, 1), fast, and short enough to read.
 * It is not cryptographic and must never be used as if it were.
 */
export type Random = () => number;

export function mulberry32(seed: number): Random {
  if (!Number.isFinite(seed)) {
    throw new RangeError(`seed must be finite: ${seed}`);
  }
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
