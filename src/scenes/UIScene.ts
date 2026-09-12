import Phaser from 'phaser';

import type { DifficultyAxis } from '../game/config';
import { LAYOUT } from '../game/config';
import type { Player } from '../services/player';
import type { ScoreService } from '../services/ScoreService';
import { renamePlayer } from '../ui/nameGate';
import type { GameOverPayload } from './GameScene';
import { GameEvents, UiEvents } from './GameScene';

/** Canvas text uses system fonts, so a CJK-capable stack needs no font file. */
const FONT = '"Apple SD Gothic Neo", "Noto Sans KR", -apple-system, BlinkMacSystemFont, sans-serif';

/** What the player is told when an axis rises. */
const AXIS_LABEL: Readonly<Record<DifficultyAxis, string>> = {
  speed: '속도 상승',
  density: '장애물 증가',
  roadWidth: '도로 좁아짐',
  curve: '급커브',
};

const CRASH_LABEL: Readonly<Record<GameOverPayload['reason'], string>> = {
  obstacle: '장애물과 충돌했습니다',
  offroad: '도로를 벗어났습니다',
};

interface LevelPayload {
  readonly level: number;
  readonly axis: DifficultyAxis | null;
}

/**
 * HUD and overlays, run *alongside* GameScene via `scene.launch()` rather than
 * inside it, so the game-over panel stays interactive while the world is frozen.
 */
export class UIScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private toast?: Phaser.GameObjects.Text;
  private overlay?: Phaser.GameObjects.Container;
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
    this.bestText = this.add.text(24, 68, '', {
      fontFamily: FONT,
      fontSize: '17px',
      color: '#ffffffaa',
    });
    this.drawBest();

    // Tap the name to rename. `pointerdown`, not `pointerup`: the lock has to be
    // in place before the game sees the same tap as steering.
    this.bestText.setInteractive({ useHandCursor: true });
    this.bestText.on('pointerdown', () => void this.rename());

    this.levelText = this.add
      .text(LAYOUT.width - 24, 24, 'LV 1', {
        fontFamily: FONT,
        fontSize: '20px',
        color: '#ffc400',
        fontStyle: 'bold',
      })
      .setOrigin(1, 0);

    this.hint = this.add
      .text(LAYOUT.width / 2, LAYOUT.carScreenY + 70, '좌우로 조종하세요', {
        fontFamily: FONT,
        fontSize: '18px',
        color: '#ffffffcc',
      })
      .setOrigin(0.5);

    void this.loadBest();

    const onScore = (score: number) => {
      this.scoreText.setText(String(score));
      this.recordBest(score);
    };
    const onLevel = (payload: LevelPayload) => this.showLevel(payload);
    const onStarted = () => this.hint.setVisible(false);
    const onGameOver = (payload: GameOverPayload) => this.showGameOver(payload);

    game.events.on(GameEvents.score, onScore);
    game.events.on(GameEvents.levelUp, onLevel);
    game.events.on(GameEvents.started, onStarted);
    game.events.on(GameEvents.gameOver, onGameOver);

    // Without this the listeners pile up on GameScene across restarts.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      game.events.off(GameEvents.score, onScore);
      game.events.off(GameEvents.levelUp, onLevel);
      game.events.off(GameEvents.started, onStarted);
      game.events.off(GameEvents.gameOver, onGameOver);
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
    // max(), not assignment: the read is async, so a run can already have beaten
    // the stored value by the time it lands.
    this.best = Math.max(this.best, (await service?.getBest()) ?? 0);
    this.drawBest();
  }

  /**
   * Announce the level and the axis that rose.
   *
   * The toast arrives slightly **before** the change it names: the road's width
   * and curve are rate-limited and take a few hundred px to settle. That is the
   * point — it is a warning, not a caption.
   */
  private showLevel({ level, axis }: LevelPayload): void {
    this.levelText.setText(`LV ${level}`);
    if (axis === null) return;

    this.toast?.destroy();
    this.toast = this.add
      .text(LAYOUT.width / 2, 120, `LV ${level} · ${AXIS_LABEL[axis]}`, {
        fontFamily: FONT,
        fontSize: '22px',
        color: '#ffc400',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.tweens.add({
      targets: this.toast,
      alpha: 0,
      y: 96,
      duration: 1100,
      ease: 'Quad.easeIn',
      onComplete: () => this.toast?.destroy(),
    });
  }

  /**
   * Rename without losing the record — `savePlayer()` keeps the id.
   *
   * The lock stops the car for as long as the dialog is open; a DOM overlay over
   * a moving car would otherwise cost the player their run.
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

  /** Keep the HUD's idea of the best score ahead of the run in progress. */
  private recordBest(score: number): void {
    if (score <= this.best) return;
    this.best = score;
    this.drawBest();
  }

  private showGameOver({ score, best, isNewBest, reason }: GameOverPayload): void {
    if (this.overlay !== undefined) return;
    this.best = Math.max(this.best, best);
    this.drawBest();

    const { width, height } = LAYOUT;
    const dim = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.62);
    const panel = this.add
      .rectangle(width / 2, height / 2, width - 96, 300, 0x161b22, 0.98)
      // Alpha is the third argument. Packing it into the colour as 0xffffff22
      // renders a wrong hue with no error at all.
      .setStrokeStyle(2, 0xffffff, 0.16);

    const title = this.add
      .text(width / 2, height / 2 - 104, '게임 오버', {
        fontFamily: FONT,
        fontSize: '30px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const cause = this.add
      .text(width / 2, height / 2 - 64, CRASH_LABEL[reason], {
        fontFamily: FONT,
        fontSize: '16px',
        color: '#ffffff99',
      })
      .setOrigin(0.5);
    const result = this.add
      .text(width / 2, height / 2 - 14, `${score}점`, {
        fontFamily: FONT,
        fontSize: '44px',
        color: '#ffc400',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const note = this.add
      .text(width / 2, height / 2 + 34, isNewBest ? '최고 기록 경신!' : `최고 기록 ${best}점`, {
        fontFamily: FONT,
        fontSize: '18px',
        color: isNewBest ? '#81c784' : '#ffffffaa',
      })
      .setOrigin(0.5);

    const button = this.add
      .rectangle(width / 2, height / 2 + 100, 200, 56, 0xffc400)
      .setInteractive({ useHandCursor: true });
    const buttonLabel = this.add
      .text(width / 2, height / 2 + 100, '다시 하기', {
        fontFamily: FONT,
        fontSize: '20px',
        color: '#0d1117',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    // `once`, and on pointerup: the tap that ends a run must not also restart it.
    button.once('pointerup', () => this.restart());

    this.overlay = this.add.container(0, 0, [
      dim,
      panel,
      title,
      cause,
      result,
      note,
      button,
      buttonLabel,
    ]);
    this.overlay.setAlpha(0);
    this.tweens.add({ targets: this.overlay, alpha: 1, duration: 220 });
  }

  private restart(): void {
    const game = this.scene.get('GameScene');
    // Stop this scene first: GameScene.create() launches a fresh one.
    this.scene.stop();
    game.scene.restart();
  }
}
