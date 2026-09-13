/**
 * Single source of truth for every tunable number.
 *
 * Nothing here imports Phaser. Balance and layout changes happen in this file
 * and nowhere else — a magic number in a scene is a bug.
 */

/**
 * The difficulty axes, in the order a level-up rotates through them.
 *
 * One level-up turns exactly one screw, which is what keeps a rising
 * difficulty legible: the player is told which axis moved, and a tuning change
 * to one axis cannot quietly alter the pace of the others.
 */
export const DIFFICULTY_AXES = ['speed', 'density', 'roadWidth', 'curve'] as const;

export type RotationAxis = (typeof DIFFICULTY_AXES)[number];

/**
 * The axes a level-up can move. There is no separate tail axis: once the
 * geometry has given everything it can, **speed is the only thing left**.
 *
 * That is not a stylistic choice. Every geometric screw has a floor set by
 * fairness — a gap must stay wide enough to drive through, reachable by
 * steering, and on the road for the whole crossing. Speed has no such floor
 * until the road itself outruns the car, so it is the one axis that can keep
 * going after the others have stopped.
 */
export type DifficultyAxis = RotationAxis;

/**
 * Everything about the track that difficulty moves.
 *
 * The first five are moved by a level-up, one axis at a time. `minGapWidth` is
 * the exception: it is not an axis but an onboarding concession that decays
 * with level regardless of whose turn it is.
 */
export interface DifficultyParams {
  /** Px per second the world scrolls down — the car's forward speed. */
  readonly scrollSpeed: number;
  /** Px of track between obstacle rows. Smaller is denser. */
  readonly spawnIntervalPx: number;
  /** Px from the road centreline to either edge. Smaller is tighter. */
  readonly roadHalfWidth: number;
  /** Px of lateral swing the centreline aims for. */
  readonly curveAmplitude: number;
  /** Radians of curve phase added per px of track. Higher is twistier. */
  readonly curveFrequency: number;
  /** Px: no gap may be narrower than this. Decays to SAFE_GAP over the ramp. */
  readonly minGapWidth: number;
}

export type DifficultyParamKey = keyof DifficultyParams;

/**
 * Which params each axis moves. `curve` is the one axis that moves two numbers
 * — amplitude and frequency together are what reads as "a sharper curve".
 *
 * Exported because it is the contract `difficulty.ts` applies and the one
 * `tests/difficulty.test.ts` checks a level-up against.
 */
export const AXIS_PARAMS = {
  speed: ['scrollSpeed'],
  density: ['spawnIntervalPx'],
  roadWidth: ['roadHalfWidth'],
  curve: ['curveAmplitude', 'curveFrequency'],
} as const satisfies Record<RotationAxis, readonly DifficultyParamKey[]>;

/**
 * The params the rotation moves — derived from the axis table, so `step` and
 * `cap` cannot fall out of step with the axes that read them.
 */
export type RotationParamKey = (typeof AXIS_PARAMS)[RotationAxis][number];

/** The starting value of every param the level model moves. */
type RampStart = Omit<DifficultyParams, 'minGapWidth'>;

/** A step or a cap for the rotation: one number per rotation param. */
type RampBounds = Record<RotationParamKey, number>;

/**
 * The difficulty ramp: where every axis starts, how much one level-up moves it,
 * and where it stops.
 *
 * `step` is a magnitude; `cap` is the end of the ramp in that axis's own
 * direction (speed and curve rise, interval and width fall). Four axes with
 * seven steps each means every axis is capped by level 29, which the speed
 * schedule puts at roughly 78 seconds — difficulty stops inventing itself and
 * becomes a pure reflex grind from there.
 */
export const DIFFICULTY = {
  /**
   * Px of track per level.
   *
   * 1000 rather than a screen and a half: at 1200 the first five levels ate 20
   * seconds — a quarter of the whole ramp — before the game posed a threat.
   */
  levelDistancePx: 1000,
  /**
   * Where the ramp starts.
   *
   * Not as gentle as it looks: the opening used to give 2.4 s of lookahead on a
   * 336 px road with 1.6 s between rows, and a quarter of the whole ramp went by
   * before the game asked anything. These numbers put the first row inside two
   * seconds of reaction time and keep the ramp's shape — each axis still takes
   * seven steps to reach its cap, which is what the step sizes below are
   * derived from.
   */
  base: {
    scrollSpeed: 320,
    spawnIntervalPx: 360,
    roadHalfWidth: 155,
    curveAmplitude: 60,
    curveFrequency: 0.0048,
  },
  /**
   * How far one level-up moves an axis.
   *
   * The three geometric axes take **four** steps to reach their caps and are
   * then finished — the shape of the track is settled inside the first forty
   * seconds. Speed takes seven, and then keeps going alone (see SPEED_CEILING).
   */
  step: {
    scrollSpeed: 43,
    spawnIntervalPx: 38,
    roadHalfWidth: 14,
    curveAmplitude: 13,
    curveFrequency: 0.0008,
  },
  cap: {
    // 620 px/s against a 620 px lookahead is exactly one second of reaction
    // time — the tightest the game can be while still being a reflex test
    // rather than a memorisation test.
    scrollSpeed: 620,
    // At 620 px/s this is 0.34 s between rows, and three rows visible at once.
    spawnIntervalPx: 210,
    // 204 px of road: six car widths. Enough for a wall plus a gap, not enough
    // to be casual about it.
    roadHalfWidth: 102,
    // The most swing the road can actually deliver. Above the frequency cap the
    // centreline is slew-limited to TRACK.maxSlope, so the sine's peak is
    // reached only if it fits in `maxSlope * π / (2 * frequency)` ≈ 110 px. A
    // larger number here would be a decoration: the ramp would keep "raising"
    // an amplitude the road can never draw.
    curveAmplitude: 110,
    curveFrequency: 0.0078,
  },
  /**
   * How much a level-up adds to the speed once nothing else can rise. Smaller
   * than the rotation's step: past the rotation cap every px/s costs reaction
   * time that cannot be won back.
   */
  tailStep: { scrollSpeed: 12 },
} as const satisfies {
  levelDistancePx: number;
  base: RampStart;
  step: RampBounds;
  cap: RampBounds;
  tailStep: { scrollSpeed: number };
};

/**
 * The gap a beginner is given on top of the safe minimum, and how many levels
 * it takes to decay away.
 *
 * Without it the very first row can be as tight as the very last one: the gap
 * width is uniform over its whole legal range, so a level-1 player met the
 * game's narrowest possible gap about once every ten rows, before they had
 * learned how the car responds.
 */
export const EARLY = {
  gapBonusPx: 70,
  levels: 12,
} as const;

/** Logical canvas size. Every game coordinate lives in this space. */
export const LAYOUT = {
  width: 480,
  height: 800,
  /** Where the car sits. The track above it is the player's reaction window. */
  carScreenY: 620,
  /** Px of track generated ahead of the car — equals the visible window. */
  lookaheadPx: 620,
  /** Px of track kept behind the car, so the road is drawn under and past it. */
  behindPx: 200,
  /** Px the road may never come closer than to the canvas edge. */
  edgeMargin: 8,
} as const;

export const CAR = {
  width: 34,
  length: 54,
  /** Px per second of lateral movement at full steering input. */
  steerSpeed: 560,
  /** Px of slack on each side of the car a gap must add to be passable. */
  clearance: 11,
  /** Px of overhang forgiven before a run counts as off-road. */
  offRoadTolerance: 4,
  /** Px between the pointer and the car at which steering saturates. */
  pointerRangePx: 60,
  /** Radians the sprite leans into a turn. Cosmetic only. */
  leanRad: 0.18,
  /** Px of room to spare below which passing a row counts as a near miss. */
  squeezePx: 26,
} as const;

export const TRACK = {
  /** Px between generated track nodes. ~51 nodes cover the visible window. */
  nodeStepPx: 16,
  /**
   * Maximum |dx/ds| of the centreline: the road's steepest lean, ~29°. Steeper
   * reads as a zigzag.
   */
  maxSlope: 0.55,
  /**
   * Maximum px per **second** the centreline may travel sideways.
   *
   * The real constraint on a curve is not its shape but what following it costs
   * the driver: a road leaning 0.55 at 712 px/s slides sideways at 391 px/s and
   * eats 70% of the car's steering just to stay on it, leaving almost nothing
   * to reach the next gap with. Capping the lateral *speed* instead means the
   * road straightens as the game gets faster, which is both what a fast road
   * looks like and what keeps late levels passable.
   */
  maxLateralPxPerSec: 250,
  /** Maximum px the half width may change per px of track. */
  widthRatePerPx: 0.06,
} as const;

export const OBSTACLES = {
  /** Fraction of the spare road width a gap may be widened by, at random. */
  gapSlackRatio: 0.55,
  /** How much of the car's theoretical steering reach a gap shift may use. */
  reachSafety: 0.7,
  /**
   * The narrowest blocker. It is no wider than the car on purpose: a stretch of
   * road too small for a cone is then also too small for the car to fit
   * through, so leftover slivers can be left unblocked without ever becoming a
   * second, unintended gap. `tests/config.test.ts` pins the relationship.
   */
  coneWidth: 34,
  barrierWidth: 96,
  /** Extent of an obstacle along the track. */
  rowLength: 30,
} as const;

export const MOTION = {
  /**
   * Longest frame the simulation will believe. A tab switch or a breakpoint
   * produces deltas in the hundreds of ms, and without this the car teleports
   * into an obstacle the player never saw.
   */
  maxFrameMs: 32,
  /**
   * Longest distance a single collision check may cover. Shorter than the
   * thinnest obstacle in both axes, which is what makes tunnelling impossible
   * rather than merely unlikely.
   */
  maxSubStepPx: 12,
} as const;

export const SCORE = {
  /**
   * Px of track per point. Load-bearing forever: changing it makes bests
   * already stored under `roaddash.best` incomparable with new ones.
   */
  pxPerPoint: 10,
  /**
   * Extra points per level, as a fraction: level L pays `1 + levelBonus * (L-1)`
   * times the base rate.
   *
   * Distance alone pays *less* for the hard part than the easy part — rows are
   * 420 px apart at level 1 and 210 at the cap, so passing the hardest row in
   * the game was worth exactly half of passing the easiest. At 0.06 the level-29
   * row pays 56 points against level 1's 42, so the rate rises with the risk.
   * Like `pxPerPoint`, this can only be changed while no records exist.
   */
  levelBonus: 0.06,
} as const;

/**
 * The narrowest gap the game may ever produce: the car plus clearance on both
 * sides. Derived, so it cannot drift from the car's own size.
 */
export const SAFE_GAP = CAR.width + 2 * CAR.clearance;

/**
 * The least warning a player may be given about a row, in seconds.
 *
 * With the road's sideways speed capped, following it costs the same at any
 * scroll speed, so what actually limits speed is how long the player gets to
 * read what is coming. This is that floor.
 */
export const MIN_REACTION_SECONDS = 0.85;

/**
 * The fastest the game may ever scroll, in px/s — a **fairness** limit, not a
 * taste one: the visible track ahead divided by the least warning a player may
 * be given. Derived, so moving the car down the screen moves the ceiling too.
 */
export const SPEED_CEILING = Math.floor(LAYOUT.lookaheadPx / MIN_REACTION_SECONDS);

/** How fast the road slides sideways at a given scroll speed, px/s. */
export function roadLateralSpeed(scrollSpeed: number): number {
  return Math.min(TRACK.maxSlope * scrollSpeed, TRACK.maxLateralPxPerSec);
}

/** The steepest the centreline may lean at a given scroll speed. */
export function maxSlopeAt(scrollSpeed: number): number {
  return roadLateralSpeed(scrollSpeed) / scrollSpeed;
}

/**
 * The cars a player may pick from, in the order the picker shows them.
 *
 * `trim` is the outline, and it is not decoration: the road is dark, so a dark
 * car needs a light edge to stay readable at speed. That is why black's trim is
 * the lightest of the five.
 */
export const CAR_COLORS = [
  { id: 'white', label: '흰색', body: 0xf2f5fa, trim: 0x98a1b0 },
  { id: 'yellow', label: '노란색', body: 0xffc400, trim: 0xb08600 },
  { id: 'red', label: '빨간색', body: 0xe53935, trim: 0x8d1f1c },
  { id: 'blue', label: '파란색', body: 0x2f7de1, trim: 0x1a4d8f },
  { id: 'black', label: '검정색', body: 0x1c1f26, trim: 0xe6e9f0 },
] as const;

export type CarColorId = (typeof CAR_COLORS)[number]['id'];

/** What a player who has never chosen drives. */
export const DEFAULT_CAR_COLOR: CarColorId = 'yellow';

/** Palette. Textures are generated from these, so no image assets ship. */
export const COLORS = {
  background: 0x141a24,
  road: 0x2c313d,
  roadEdge: 0xf4f6fb,
  centerLine: 0xffffff,
  carWindow: 0x22262f,
  cone: 0xff6d3b,
  barrier: 0xe8ecf4,
  barrierStripe: 0xd83a2c,
  /** The touch strip drawn under the car on a touch device. Barely there on
   * purpose: it marks where the thumb goes without competing with the road. */
  touchZone: 0xffffff,
} as const;

/**
 * The strip at the bottom of a touch screen that says "steer here".
 *
 * It sits **below** the car, so the thumb resting on it never covers the car or
 * the road ahead. Steering still works from anywhere on the screen — this is an
 * affordance, not a restriction.
 */
export const TOUCH_ZONE = {
  /** Px below the car where the strip begins. */
  topOffset: 44,
  fillAlpha: 0.06,
  borderAlpha: 0.16,
} as const;
