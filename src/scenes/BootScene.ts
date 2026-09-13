import Phaser from 'phaser';

import type { CarColorId } from '../game/config';
import { CAR, CAR_COLORS, COLORS, OBSTACLES } from '../game/config';
import type { ObstacleKind } from '../game/obstacles';

/** Texture key for a car colour. One texture per colour, all drawn at boot. */
export function carTextureKey(color: CarColorId): string {
  return `car-${color}`;
}

/** Texture key for an obstacle kind. Generated at runtime — no files ship. */
export function obstacleTextureKey(kind: ObstacleKind): string {
  return `obstacle-${kind}`;
}

/**
 * Draws the car and the obstacles as textures, then hands off to the game.
 *
 * The road is **not** a texture: its shape changes every frame, so GameScene
 * fills it as a polygon instead. To use real art, load files here — nothing else
 * references anything but these keys.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    for (const color of CAR_COLORS) this.drawCar(color);
    this.drawCone();
    this.drawBarrier();
    this.scene.start('GameScene');
  }

  private drawCar(color: (typeof CAR_COLORS)[number]): void {
    const { width, length } = CAR;
    const g = this.make.graphics({ x: 0, y: 0 }, false);

    g.fillStyle(color.body, 1);
    g.fillRoundedRect(0, 0, width, length, 7);
    // The outline is what keeps a dark car readable against dark asphalt, so it
    // is drawn for every colour rather than only the ones that need it.
    g.lineStyle(2, color.trim, 1);
    g.strokeRoundedRect(1, 1, width - 2, length - 2, 6);
    // Windscreen toward the top: the car drives up the screen, and without a
    // front the sprite reads as a brick.
    g.fillStyle(COLORS.carWindow, 1);
    g.fillRoundedRect(width * 0.16, length * 0.12, width * 0.68, length * 0.26, 4);
    g.fillRoundedRect(width * 0.16, length * 0.56, width * 0.68, length * 0.2, 4);
    g.fillStyle(0x000000, 0.25);
    g.fillRect(0, length * 0.42, width, length * 0.06);

    g.generateTexture(carTextureKey(color.id), width, length);
    g.destroy();
  }

  private drawCone(): void {
    const w = OBSTACLES.coneWidth;
    const h = OBSTACLES.rowLength;
    const g = this.make.graphics({ x: 0, y: 0 }, false);

    g.fillStyle(COLORS.cone, 1);
    g.fillTriangle(w / 2, 2, w - 3, h - 2, 3, h - 2);
    g.fillStyle(0xffffff, 0.85);
    g.fillRect(w * 0.24, h * 0.52, w * 0.52, h * 0.16);

    g.generateTexture(obstacleTextureKey('cone'), w, h);
    g.destroy();
  }

  private drawBarrier(): void {
    const w = OBSTACLES.barrierWidth;
    const h = OBSTACLES.rowLength;
    const g = this.make.graphics({ x: 0, y: 0 }, false);

    g.fillStyle(COLORS.barrier, 1);
    g.fillRoundedRect(0, 0, w, h, 4);
    // Diagonal hazard stripes, clipped by drawing them as quads inside the bar.
    g.fillStyle(COLORS.barrierStripe, 1);
    const stripe = 14;
    for (let x = -h; x < w; x += stripe * 2) {
      g.fillPoints(
        [
          new Phaser.Math.Vector2(Math.max(x, 0), Math.min(Math.max(-x, 0), h)),
          new Phaser.Math.Vector2(Math.min(x + stripe, w), Math.min(Math.max(-x, 0), h)),
          new Phaser.Math.Vector2(Math.min(x + stripe + h, w), h),
          new Phaser.Math.Vector2(Math.min(Math.max(x + h, 0), w), h),
        ],
        true,
      );
    }

    g.generateTexture(obstacleTextureKey('barrier'), w, h);
    g.destroy();
  }
}
