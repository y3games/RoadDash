import Phaser from 'phaser';

import { BALL_KINDS, LAYOUT } from '../game/config';
import type { Player } from '../services/player';
import type { ScoreService } from '../services/ScoreService';
import { renamePlayer } from '../ui/nameGate';
import { ballTextureKey } from './BootScene';
import { GameEvents, UiEvents } from './GameScene';

/** Canvas text uses system fonts, so a CJK-capable stack needs no font file. */
const FONT = '"Apple SD Gothic Neo", "Noto Sans KR", -apple-system, BlinkMacSystemFont, sans-serif';

/**
 * HUD, run alongside GameScene via `scene.launch()` rather than inside it, so
 * overlays stay interactive while the physics scene is paused or frozen.
 */
export class UIScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private nextPreview!: Phaser.GameObjects.Image;
  /** Mirrors storage so a new record is recognised without awaiting a read. */
  private best = 0;

  constructor() {
    super('UIScene');
  }

  create(): void {
    const game = this.scene.get('GameScene');

    this.scoreText = this.add.text(24, 22, '0', {
      fontFamily: FONT,
      fontSize: '40px',
      color: '#ffffff',
      fontStyle: 'bold',
    });
    // One line rather than two: the drop zone starts at LAYOUT.dropY, so a
    // second row of HUD text would sit behind the falling balls.
    this.bestText = this.add.text(24, 68, '', {
      fontFamily: FONT,
      fontSize: '17px',
      color: '#ffffffaa',
    });
    this.drawBest();

    // Tap the name to rename. `pointerdown`, not `pointerup`: GameScene drops a
    // ball on pointerup, and the lock has to be in place before that fires.
    this.bestText.setInteractive({ useHandCursor: true });
    this.bestText.on('pointerdown', () => void this.rename());

    this.add
      .text(LAYOUT.width - 24, 22, 'NEXT', {
        fontFamily: FONT,
        fontSize: '14px',
        color: '#ffffff88',
      })
      .setOrigin(1, 0);
    this.nextPreview = this.add.image(LAYOUT.width - 46, 66, ballTextureKey(0));

    void this.loadBest();

    const onScore = (score: number) => {
      this.scoreText.setText(String(score));
      this.recordBest(score);
    };
    const onNext = (kind: number) => {
      this.nextPreview.setTexture(ballTextureKey(kind));
      this.nextPreview.setScale(Math.min(1, 22 / BALL_KINDS[kind].radius));
    };

    game.events.on(GameEvents.score, onScore);
    game.events.on(GameEvents.next, onNext);

    // Without this the listeners pile up on GameScene across restarts.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      game.events.off(GameEvents.score, onScore);
      game.events.off(GameEvents.next, onNext);
    });
  }

  private player(): Player | undefined {
    return this.registry.get('player') as Player | undefined;
  }

  /** `이름 · 최고 N` — who is playing and what they have to beat. */
  private drawBest(): void {
    const name = this.player()?.name;
    this.bestText.setText(name === undefined ? `최고 ${this.best}` : `${name} · 최고 ${this.best}`);
  }

  private async loadBest(): Promise<void> {
    const service = this.registry.get('scoreService') as ScoreService | undefined;
    // max(), not assignment: the read is async, so a run can already have
    // beaten the stored value by the time it lands.
    this.best = Math.max(this.best, (await service?.getBest()) ?? 0);
    this.drawBest();
  }

  /**
   * Rename the player without losing their record — `savePlayer()` keeps the id.
   *
   * GameScene keeps simulating behind the overlay, which is what we want: balls
   * already in the air still settle and score. Only new drops are blocked.
   */
  private async rename(): Promise<void> {
    const current = this.player();
    if (current === undefined) return;

    const game = this.scene.get('GameScene');
    game.events.emit(UiEvents.inputLock, true);
    try {
      const renamed = await renamePlayer(current);
      this.registry.set('player', renamed);
      this.drawBest();

      // The record is still theirs, so it must not keep the old name.
      const service = this.registry.get('scoreService') as ScoreService | undefined;
      await service?.renameOwner(renamed);
    } finally {
      game.events.emit(UiEvents.inputLock, false);
    }
  }

  /**
   * Persist a new personal best under the current player.
   *
   * The HUD updates from the local mirror rather than waiting on the service:
   * the demo scores several times a second, and awaiting each write would let a
   * slower (server-backed) implementation reorder the displayed number.
   */
  private recordBest(score: number): void {
    if (score <= this.best) return;
    this.best = score;
    this.drawBest();

    const service = this.registry.get('scoreService') as ScoreService | undefined;
    const player = this.player();
    if (service === undefined || player === undefined) return;
    void service.submit(score, player);
  }
}
