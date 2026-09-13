import Phaser from 'phaser';

import type { CarColorId, DifficultyAxis } from '../game/config';
import { CAR, CAR_COLORS, COLORS, DEFAULT_CAR_COLOR, LAYOUT, TOUCH_ZONE } from '../game/config';
import type { CarStore } from '../services/CarStore';
import type { Player } from '../services/player';
import type { ScoreService } from '../services/ScoreService';
import { renamePlayer } from '../ui/nameGate';
import { carTextureKey } from './BootScene';
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
  /** Everything that belongs to the pre-run screen: gone once the car moves. */
  private startScreen: Phaser.GameObjects.GameObject[] = [];
  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private toast?: Phaser.GameObjects.Text;
  private overlay?: Phaser.GameObjects.Container;
  /** Mirrors storage so a new record is recognised without awaiting a read. */
  private best = 0;
  /** The level the run ended on, shown on the panel. */
  private level = 1;
  /** Guards the button and the key racing each other into a double restart. */
  private restarting = false;

  constructor() {
    super('UIScene');
  }

  create(): void {
    const game = this.scene.get('GameScene');
    // scene.restart() reuses this instance, so every field is re-initialised
    // here. Leaving `overlay` set from the previous run makes the guard in
    // showGameOver() swallow the panel, and the second death of a session has
    // no 다시 하기 button at all.
    this.best = 0;
    this.level = 1;
    this.restarting = false;
    this.overlay = undefined;
    this.toast = undefined;

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

    this.startScreen = [];
    this.drawTouchZone();
    this.drawCarPicker();

    // The strip is where a thumb goes, so on a touch device the instruction
    // belongs in it; with a keyboard it belongs under the car.
    const touch = this.isTouch();
    this.hint = this.add
      .text(
        LAYOUT.width / 2,
        touch ? this.touchZoneTop() + 44 : LAYOUT.carScreenY + 70,
        touch ? '이 영역을 드래그해 조종하세요' : '← → 또는 A · D 로 조종하세요',
        { fontFamily: FONT, fontSize: '17px', color: '#ffffffcc' },
      )
      .setOrigin(0.5);
    this.startScreen.push(this.hint);

    void this.loadBest();

    const onScore = (score: number) => {
      this.scoreText.setText(String(score));
      this.recordBest(score);
    };
    const onLevel = (payload: LevelPayload) => this.showLevel(payload);
    const onStarted = () => this.dismissStartScreen();
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

  /** Phaser knows whether this browser reports touch; the strip is for those. */
  private isTouch(): boolean {
    return this.sys.game.device.input.touch;
  }

  private touchZoneTop(): number {
    return LAYOUT.carScreenY + TOUCH_ZONE.topOffset;
  }

  /**
   * The steering strip: a barely-there band across the bottom of a touch
   * screen, below the car.
   *
   * Steering works from anywhere on the screen — this marks where to put a
   * thumb so that it is not covering the car or the road ahead, which is what
   * happens when someone drags in the middle of the screen. It stays visible
   * during the run (the affordance is still true) while its label goes away.
   */
  private drawTouchZone(): void {
    if (!this.isTouch()) return;

    const top = this.touchZoneTop();
    const height = LAYOUT.height - top;
    const band = this.add
      .rectangle(LAYOUT.width / 2, top + height / 2, LAYOUT.width, height, COLORS.touchZone)
      .setAlpha(TOUCH_ZONE.fillAlpha);
    // Alpha as the third argument. Packed into the colour it renders a wrong
    // hue with no error at all.
    band.setStrokeStyle(1, COLORS.touchZone, TOUCH_ZONE.borderAlpha);

    for (const [x, glyph] of [
      [56, '‹'],
      [LAYOUT.width - 56, '›'],
    ] as const) {
      this.add
        .text(x, top + height / 2, glyph, {
          fontFamily: FONT,
          fontSize: '34px',
          color: '#ffffff55',
        })
        .setOrigin(0.5);
    }
  }

  /**
   * Pick a car before the run starts.
   *
   * It sits in the middle of the screen rather than in the touch strip: a tap
   * down there is a steering input, and the world starts on the first one.
   * Each swatch still locks input while it is pressed, so choosing a colour
   * cannot also launch the run.
   */
  private drawCarPicker(): void {
    const store = this.registry.get('carStore') as CarStore | undefined;
    let chosen: CarColorId = store?.read() ?? DEFAULT_CAR_COLOR;

    const label = this.add
      .text(LAYOUT.width / 2, LAYOUT.height / 2 + 44, '차 색상', {
        fontFamily: FONT,
        fontSize: '15px',
        color: '#ffffff88',
      })
      .setOrigin(0.5);
    this.startScreen.push(label);

    const gap = 62;
    const left = LAYOUT.width / 2 - (gap * (CAR_COLORS.length - 1)) / 2;
    const rings = new Map<CarColorId, Phaser.GameObjects.Rectangle>();

    CAR_COLORS.forEach((color, index) => {
      const x = left + index * gap;
      const y = LAYOUT.height / 2 + 92;

      const ring = this.add
        .rectangle(x, y, CAR.width + 18, CAR.length + 14)
        .setStrokeStyle(2, 0xffc400, color.id === chosen ? 1 : 0);
      const swatch = this.add
        .image(x, y, carTextureKey(color.id))
        .setInteractive({ useHandCursor: true });

      swatch.on('pointerdown', () => {
        // GameScene starts the world on any steering input, and a tap on a
        // swatch is one. Lock first, exactly as the rename button does.
        const game = this.scene.get('GameScene');
        game.events.emit(UiEvents.inputLock, true);

        chosen = color.id;
        store?.save(chosen);
        for (const [id, other] of rings) other.setStrokeStyle(2, 0xffc400, id === chosen ? 1 : 0);
        game.events.emit(UiEvents.carColor, chosen);
      });
      swatch.on('pointerup', () => {
        this.scene.get('GameScene').events.emit(UiEvents.inputLock, false);
      });
      swatch.on('pointerout', () => {
        this.scene.get('GameScene').events.emit(UiEvents.inputLock, false);
      });

      rings.set(color.id, ring);
      this.startScreen.push(ring, swatch);
    });
  }

  /** Fade the pre-run screen out the moment the car moves. */
  private dismissStartScreen(): void {
    if (this.startScreen.length === 0) return;
    const targets = this.startScreen;
    this.startScreen = [];

    for (const object of targets) {
      if ('disableInteractive' in object) (object as Phaser.GameObjects.Image).disableInteractive();
    }
    this.tweens.add({
      targets,
      alpha: 0,
      duration: 260,
      onComplete: () => {
        for (const object of targets) object.destroy();
      },
    });
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
    this.level = level;
    this.levelText.setText(`LV ${level}`);
    // No axis means the level-up moved nothing — say nothing rather than claim
    // a rise that did not happen.
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
    // Only guards a second gameOver event within one run, never a later run:
    // create() clears this.
    if (this.overlay !== undefined) return;
    this.best = Math.max(this.best, best);
    this.drawBest();

    const { width, height } = LAYOUT;
    const dim = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.62);
    const panel = this.add
      .rectangle(width / 2, height / 2, width - 96, 340, 0x161b22, 0.98)
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
    const reached = this.add
      .text(width / 2, height / 2 + 26, `LV ${this.level} 도달`, {
        fontFamily: FONT,
        fontSize: '17px',
        color: '#ffffff99',
      })
      .setOrigin(0.5);
    const note = this.add
      .text(width / 2, height / 2 + 54, isNewBest ? '최고 기록 경신!' : `최고 기록 ${best}점`, {
        fontFamily: FONT,
        fontSize: '18px',
        color: isNewBest ? '#81c784' : '#ffffffaa',
      })
      .setOrigin(0.5);

    const button = this.add
      .rectangle(width / 2, height / 2 + 112, 200, 56, 0xffc400)
      .setInteractive({ useHandCursor: true });
    const buttonLabel = this.add
      .text(width / 2, height / 2 + 112, '다시 하기', {
        fontFamily: FONT,
        fontSize: '20px',
        color: '#0d1117',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    // `once`, and on pointerup: the tap that ends a run must not also restart it.
    button.once('pointerup', () => this.restart());

    const hint = this.add
      .text(width / 2, height / 2 + 152, 'SPACE / ENTER', {
        fontFamily: FONT,
        fontSize: '13px',
        color: '#ffffff66',
      })
      .setOrigin(0.5);
    // A run is under two minutes, so the hand should never have to leave the
    // keyboard to start the next one.
    this.input.keyboard?.once('keydown-SPACE', () => this.restart());
    this.input.keyboard?.once('keydown-ENTER', () => this.restart());

    this.overlay = this.add.container(0, 0, [
      dim,
      panel,
      title,
      cause,
      result,
      reached,
      note,
      button,
      buttonLabel,
      hint,
    ]);
    this.overlay.setAlpha(0);
    this.tweens.add({ targets: this.overlay, alpha: 1, duration: 220 });
  }

  private restart(): void {
    // The button and the keys are separate paths into here; the first one wins.
    if (this.restarting) return;
    this.restarting = true;

    const game = this.scene.get('GameScene');
    // Stop this scene first: GameScene.create() launches a fresh one.
    this.scene.stop();
    game.scene.restart();
  }
}
