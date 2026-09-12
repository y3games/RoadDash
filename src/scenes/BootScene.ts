import Phaser from 'phaser';

import { BALL_KINDS } from '../game/config';

/** Texture key for a ball kind. Generated at runtime — no image files ship. */
export function ballTextureKey(kind: number): string {
  return `ball-${kind}`;
}

/**
 * Draws each ball as a texture with Graphics, then hands off to the game.
 *
 * Generating textures keeps the repo free of binary assets. To use real art,
 * load files here instead — nothing else references anything but the keys.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    BALL_KINDS.forEach((ball, index) => {
      const r = ball.radius;
      const g = this.make.graphics({ x: 0, y: 0 }, false);

      g.fillStyle(ball.color, 1);
      g.fillCircle(r, r, r);
      g.lineStyle(Math.max(2, r * 0.07), 0x000000, 0.15);
      g.strokeCircle(r, r, r * 0.96);
      g.fillStyle(0xffffff, 0.3);
      g.fillEllipse(r * 0.68, r * 0.6, r * 0.5, r * 0.34);

      g.generateTexture(ballTextureKey(index), r * 2, r * 2);
      g.destroy();
    });

    this.scene.start('GameScene');
  }
}
