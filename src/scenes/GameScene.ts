import Phaser from 'phaser';

import type { CarColorId } from '../game/config';
import { CAR, COLORS, DEFAULT_CAR_COLOR, LAYOUT, MOTION, TRACK } from '../game/config';
import { steerInput } from '../game/input';
import type { ObstacleKind } from '../game/obstacles';
import type { CrashReason, WorldState } from '../game/world';
import { createWorld, currentScore, drivableBounds, stepWorld } from '../game/world';
import type { CarStore } from '../services/CarStore';
import type { Player } from '../services/player';
import type { ScoreService } from '../services/ScoreService';
import { carTextureKey, obstacleTextureKey } from './BootScene';

/** Events this scene emits for UIScene to render. */
export const GameEvents = {
  score: 'score',
  levelUp: 'level-up',
  started: 'started',
  gameOver: 'game-over',
} as const;

/** Events UIScene emits back at this scene. */
export const UiEvents = {
  /** `true` while an overlay owns the pointer: the car must not drive itself. */
  inputLock: 'ui:input-lock',
  /** The player picked a different car. */
  carColor: 'ui:car-color',
} as const;

export interface GameOverPayload {
  readonly score: number;
  readonly best: number;
  readonly isNewBest: boolean;
  readonly reason: CrashReason;
}

/** Px of track per dash on the centre line, drawn every other period. */
const DASH_PERIOD = 48;

/**
 * Input, drawing and nothing else.
 *
 * Every decision — where the road goes, what is passable, whether the run is
 * over — comes from `game/world`. This scene reports the player's steering to it
 * and draws what comes back, which is why none of the game's rules need a
 * browser to be tested.
 */
export class GameScene extends Phaser.Scene {
  private world!: WorldState;
  private road!: Phaser.GameObjects.Graphics;
  private car!: Phaser.GameObjects.Image;
  private pool = new Map<ObstacleKind, Phaser.GameObjects.Image[]>();
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private keyA?: Phaser.Input.Keyboard.Key;
  private keyD?: Phaser.Input.Keyboard.Key;
  /** The one pointer that steers. A second finger must not teleport the car. */
  private pointerId: number | null = null;
  private pointerX = LAYOUT.width / 2;
  /** Set while an overlay owns the screen, so the world holds still. */
  private frozen = false;
  private over = false;

  constructor() {
    super('GameScene');
  }

  create(): void {
    // scene.restart() reuses this instance, so every field is re-initialised
    // here rather than at the declaration.
    this.world = createWorld(this.pickSeed());
    this.pool = new Map();
    this.pointerId = null;
    this.pointerX = LAYOUT.width / 2;
    this.frozen = false;
    this.over = false;

    this.cameras.main.setBackgroundColor(COLORS.background);
    this.road = this.add.graphics().setDepth(-10);

    const carStore = this.registry.get('carStore') as CarStore | undefined;
    const color: CarColorId = carStore?.read() ?? DEFAULT_CAR_COLOR;
    this.car = this.add
      .image(this.world.carX, LAYOUT.carScreenY, carTextureKey(color))
      .setDepth(10);

    this.cursors = this.input.keyboard?.createCursorKeys();
    this.keyA = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyD = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    // Without this the arrow keys scroll the page instead of steering, and
    // SPACE scrolls instead of restarting (UIScene listens for it).
    this.input.keyboard?.addCapture('LEFT,RIGHT,A,D,SPACE,ENTER');

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.pointerId !== null) return;
      this.pointerId = p.id;
      this.pointerX = p.x;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.id === this.pointerId) this.pointerX = p.x;
    });
    const release = (p: Phaser.Input.Pointer) => {
      if (p.id === this.pointerId) this.pointerId = null;
    };
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);

    this.events.on(UiEvents.carColor, (picked: CarColorId) => {
      this.car.setTexture(carTextureKey(picked));
    });

    this.events.on(UiEvents.inputLock, (locked: boolean) => {
      this.frozen = locked;
      // Drop the held pointer: the tap that opened the dialog would otherwise
      // still be steering when it closes.
      if (locked) this.pointerId = null;
    });

    this.drawRoad();
    this.syncObstacles();

    this.scene.launch('UIScene');
    this.time.delayedCall(0, () => {
      this.events.emit(GameEvents.score, 0);
      this.events.emit(GameEvents.levelUp, { level: 1, axis: null });
    });
  }

  /**
   * A fresh seed per run, except in dev where `?seed=` replays an exact track —
   * the only practical way to look at a crash twice.
   */
  private pickSeed(): number {
    if (import.meta.env.DEV) {
      const requested = Number(new URLSearchParams(location.search).get('seed'));
      if (Number.isFinite(requested) && requested !== 0) return requested;
    }
    return Date.now() & 0x7fffffff;
  }

  private steer(): number {
    const keys = {
      left: (this.cursors?.left.isDown ?? false) || (this.keyA?.isDown ?? false),
      right: (this.cursors?.right.isDown ?? false) || (this.keyD?.isDown ?? false),
    };
    const pointer = this.pointerId === null ? null : { down: true, x: this.pointerX };
    return steerInput(keys, pointer, this.world.carX, drivableBounds(this.world));
  }

  override update(_time: number, delta: number): void {
    if (this.over) return;

    const steer = this.frozen ? 0 : this.steer();
    if (!this.frozen) {
      // Clamped: a tab switch or a breakpoint produces deltas in the hundreds of
      // ms, and believing one teleports the car into an obstacle nobody saw.
      const dt = Math.min(delta, MOTION.maxFrameMs) / 1000;
      const result = stepWorld(this.world, dt, steer);

      this.events.emit(GameEvents.score, result.score);
      if (result.levelUp !== null) this.events.emit(GameEvents.levelUp, result.levelUp);
      if (this.world.started) this.events.emit(GameEvents.started);
    }

    this.drawRoad();
    this.syncObstacles();
    this.car.setX(this.world.carX);
    this.car.setRotation(steer * CAR.leanRad);

    if (this.world.crash !== null) this.endRun(this.world.crash);
  }

  /** Track distance to screen y. The car never moves up or down the screen. */
  private screenY(s: number): number {
    return LAYOUT.carScreenY - (s - this.world.carS);
  }

  /**
   * The road as **one filled polygon** per frame: left edge forward, right edge
   * back. Stitching it from per-segment quads instead leaves an antialiased
   * hairline at every joint, and there are forty of them.
   */
  private drawRoad(): void {
    const { nodes } = this.world.track;
    const g = this.road;
    // Forgetting this leaves last frame's road smeared under this one, which
    // reads as a rendering bug rather than as a missing call.
    g.clear();

    const surface: Phaser.Math.Vector2[] = [];
    const leftEdge: Phaser.Math.Vector2[] = [];
    const rightEdge: Phaser.Math.Vector2[] = [];

    for (const node of nodes) {
      const y = this.screenY(node.s);
      leftEdge.push(new Phaser.Math.Vector2(node.centerX - node.halfWidth, y));
      rightEdge.push(new Phaser.Math.Vector2(node.centerX + node.halfWidth, y));
    }
    surface.push(...leftEdge, ...[...rightEdge].reverse());

    g.fillStyle(COLORS.road, 1);
    g.fillPoints(surface, true);

    g.lineStyle(3, COLORS.roadEdge, 0.85);
    g.strokePoints(leftEdge, false);
    g.strokePoints(rightEdge, false);

    g.lineStyle(4, COLORS.centerLine, 0.22);
    for (let i = 1; i < nodes.length; i += 1) {
      const a = nodes[i - 1];
      if (Math.floor(a.s / DASH_PERIOD) % 2 !== 0) continue;
      const b = nodes[i];
      g.lineBetween(a.centerX, this.screenY(a.s), b.centerX, this.screenY(b.s));
    }
  }

  /**
   * Position the obstacle sprites from the world's rows, reusing images from a
   * pool. Creating and destroying them per row instead produces GC pauses that,
   * at 620 px/s, read as the car stuttering into a wall.
   */
  private syncObstacles(): void {
    const used = new Map<ObstacleKind, number>();

    for (const row of this.world.rows) {
      const y = this.screenY(row.s);
      if (y < -TRACK.nodeStepPx || y > LAYOUT.height + TRACK.nodeStepPx) continue;

      for (const obstacle of row.obstacles) {
        const index = used.get(obstacle.kind) ?? 0;
        used.set(obstacle.kind, index + 1);
        this.sprite(obstacle.kind, index).setPosition(obstacle.x, y).setVisible(true);
      }
    }

    for (const [kind, sprites] of this.pool) {
      for (let i = used.get(kind) ?? 0; i < sprites.length; i += 1) sprites[i].setVisible(false);
    }
  }

  private sprite(kind: ObstacleKind, index: number): Phaser.GameObjects.Image {
    let sprites = this.pool.get(kind);
    if (sprites === undefined) {
      sprites = [];
      this.pool.set(kind, sprites);
    }
    if (sprites[index] === undefined) {
      sprites[index] = this.add.image(0, 0, obstacleTextureKey(kind)).setDepth(5);
    }
    return sprites[index];
  }

  /**
   * Report the finished run once, then stop simulating.
   *
   * The best score is read before submitting so the panel can say what the
   * record was, and `submit()` answers whether this run beat it — no second
   * comparison to get wrong.
   */
  private endRun(reason: CrashReason): void {
    this.over = true;
    this.cameras.main.shake(220, 0.012);
    this.car.setTintFill(0xff5252);

    const score = currentScore(this.world);
    const service = this.registry.get('scoreService') as ScoreService | undefined;
    const player = this.registry.get('player') as Player | undefined;

    void (async () => {
      const previous = (await service?.getBest()) ?? 0;
      const isNewBest =
        service !== undefined && player !== undefined ? await service.submit(score, player) : false;
      const payload: GameOverPayload = {
        score,
        best: Math.max(previous, score),
        isNewBest,
        reason,
      };
      this.events.emit(GameEvents.gameOver, payload);
    })();
  }
}
