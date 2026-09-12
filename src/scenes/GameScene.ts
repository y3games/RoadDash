import Phaser from 'phaser';

import { LAYOUT, PHYSICS } from '../game/config';
import { ballRadius, pickKind, scoreForKind } from '../game/rules';
import { ballTextureKey } from './BootScene';

/** Events this scene emits for UIScene to render. */
export const GameEvents = {
  score: 'score',
  next: 'next',
} as const;

/** Events UIScene emits back at this scene. */
export const UiEvents = {
  /** `true` while a DOM overlay is open, so a tap on it is not also a drop. */
  inputLock: 'ui:input-lock',
} as const;

/**
 * Physics, input and rendering. Every rule decision comes from `game/rules`;
 * this scene only reports facts to it and applies the result.
 *
 * Replace the demo loop below with your own game — the structure around it
 * (pure rules, config table, scene split, ScoreService) is the part to keep.
 */
export class GameScene extends Phaser.Scene {
  private balls: Phaser.Physics.Matter.Image[] = [];
  private heldKind = 0;
  private nextKind = 0;
  private held?: Phaser.GameObjects.Image;
  private score = 0;
  private canDrop = false;
  /** Set while an overlay owns the pointer; independent of the drop cooldown. */
  private inputLocked = false;
  private aimX = LAYOUT.width / 2;

  constructor() {
    super('GameScene');
  }

  create(): void {
    this.balls = [];
    this.score = 0;
    this.canDrop = true;
    this.inputLocked = false;

    this.events.on(UiEvents.inputLock, (locked: boolean) => (this.inputLocked = locked));

    this.buildPlayfield();

    this.heldKind = pickKind(Math.random());
    this.nextKind = pickKind(Math.random());
    this.held = this.add.image(this.aimX, LAYOUT.dropY, ballTextureKey(this.heldKind));

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.aim(p.x));
    // Firing on pointerup, not pointerdown, keeps a mobile scroll gesture from
    // dropping a ball the player never meant to release.
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      this.aim(p.x);
      this.drop();
    });

    this.scene.launch('UIScene');
    this.time.delayedCall(0, () => {
      this.events.emit(GameEvents.score, this.score);
      this.events.emit(GameEvents.next, this.nextKind);
    });
  }

  private buildPlayfield(): void {
    const { wallLeft, wallRight, floorY, wallThickness, width, height } = LAYOUT;
    const opts = { isStatic: true, restitution: 0, friction: PHYSICS.friction };

    this.matter.add.rectangle(
      wallLeft - wallThickness / 2,
      height / 2,
      wallThickness,
      height,
      opts,
    );
    this.matter.add.rectangle(
      wallRight + wallThickness / 2,
      height / 2,
      wallThickness,
      height,
      opts,
    );
    this.matter.add.rectangle(width / 2, floorY + wallThickness / 2, width, wallThickness, opts);

    this.add
      .rectangle(
        width / 2,
        (LAYOUT.dropY + floorY) / 2,
        wallRight - wallLeft,
        floorY - LAYOUT.dropY,
      )
      .setStrokeStyle(1, 0xffffff, 0.08)
      .setDepth(-1);
  }

  private aim(x: number): void {
    const r = ballRadius(this.heldKind);
    this.aimX = Phaser.Math.Clamp(x, LAYOUT.wallLeft + r, LAYOUT.wallRight - r);
    this.held?.setX(this.aimX);
  }

  private drop(): void {
    if (!this.canDrop || this.inputLocked) return;
    this.canDrop = false;

    this.spawnBall(this.aimX, LAYOUT.dropY, this.heldKind);
    this.heldKind = this.nextKind;
    this.nextKind = pickKind(Math.random());
    this.events.emit(GameEvents.next, this.nextKind);

    this.held?.setVisible(false);
    this.time.delayedCall(PHYSICS.dropCooldownMs, () => {
      this.canDrop = true;
      this.held?.setTexture(ballTextureKey(this.heldKind)).setVisible(true);
      this.aim(this.aimX);
    });
  }

  private spawnBall(x: number, y: number, kind: number): void {
    const radius = ballRadius(kind);
    const image = this.matter.add.image(x, y, ballTextureKey(kind), undefined, {
      shape: { type: 'circle', radius },
      restitution: PHYSICS.restitution,
      friction: PHYSICS.friction,
      frictionStatic: PHYSICS.frictionStatic,
      density: PHYSICS.density,
      label: 'ball',
    });
    image.setData('kind', kind);
    image.setData('scored', false);
    // A ball spawns at rest, so "settled" is true on its very first frame. It
    // only counts as landed after it has actually been in motion.
    image.setData('moved', false);
    this.balls.push(image);
  }

  override update(): void {
    this.balls = this.balls.filter((b) => b.active);

    for (const ball of this.balls) {
      if (ball.getData('scored')) continue;

      const body = ball.body as MatterJS.BodyType | null;
      if (body === null) continue;

      const moving = body.speed >= PHYSICS.settleSpeed;
      if (!ball.getData('moved')) {
        // Unlike a position-based gate, this always becomes true: a dropped
        // ball accelerates past the threshold long before it lands.
        if (moving) ball.setData('moved', true);
        continue;
      }
      if (moving) continue;

      ball.setData('scored', true);
      this.score += scoreForKind(ball.getData('kind') as number);
      this.events.emit(GameEvents.score, this.score);
    }
  }
}
