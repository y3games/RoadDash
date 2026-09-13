# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

RoadDash is an endless vertical-scrolling racer: drive up a winding road, dodge obstacle rows, and
the run ends the moment you touch anything. Vite + TypeScript + Phaser 3.90, deployed as a static
site to GitHub Pages at `https://y3games.github.io/RoadDash/`.

Difficulty rises every 1,000 px, and each level-up bumps exactly **one** axis, taken in rotation:
speed → obstacle density → road width → curve. The rotation caps out at level 28 (~65 s); from level
29 a **tail** keeps tightening gap width and row spacing the same way. There is no ending; the score
is distance times a per-level multiplier.

Player-facing copy is Korean. There is no backend.

## Commands

```bash
npm run dev      # Vite dev server at http://localhost:5173/  (?seed=123 replays a track)
npm run check    # tsc --noEmit && eslint . && vitest run  ← must pass before calling work done
npm test         # vitest only
npm run build    # type-check then produce dist/
```

CI runs `npm run check` before building, so a failing check blocks deployment.

## Architecture

**The whole game runs without Phaser.** `src/game/` is pure TypeScript that imports no engine, and
`stepWorld(world, dt, steer)` is the boundary: scenes collect input, call it, and draw what comes
back. That is what lets `tests/world.test.ts` simulate a full two-minute run headlessly — including
the autopilot test that proves a generated track is passable at all. Do not move a decision into a
scene; that is the one change that makes the fairness claim untestable.

- `src/game/config.ts` — the **only** place tuning lives: the difficulty table (base/step/cap per
  axis), layout, car, track and obstacle constants. A magic number in a scene is a bug.
- `src/game/difficulty.ts` — distance → level → params, and the score multiplier. The rotation and
  the tail are replayed from the base table, so "which axis did level 14 bump?" is answerable by
  reading `axisForLevel()`. `TAIL_START_LEVEL` is derived, never written down.
- `src/game/track.ts` — road geometry. `TrackNode.phase` is **integrated**, not `frequency * s`;
  see the Gotchas.
- `src/game/obstacles.ts` — one gap per row, chosen _first_, then blockers tiled into what is left.
- `src/game/collision.ts` — rectangle overlap and off-road, in (x, s) space.
- `src/game/world.ts` — the simulation, and the only stateful module under `game/`. The score is
  accumulated here per substep, because a px is worth more at a higher level.
- `src/scenes/UIScene.ts` — runs _alongside_ GameScene via `scene.launch()`, so the game-over panel
  stays interactive while the world is frozen.
- `src/services/ScoreService.ts` — the persistence boundary. Adding a leaderboard later means one
  new implementation plus the single injection line in `main.ts`.

Everything is in **(x, s) space** — x across the road, s along it. Screen y exists only at draw
time (`carScreenY - (s - carS)`), so collision is independent of where the car sits on screen.

## Gotchas

These cost real debugging time. Do not reintroduce them.

- **There is no physics engine, on purpose.** `main.ts` has no `physics` block and the car is
  kinematic. Read `docs/02-architecture/adr-004-물리-엔진-제거.md` before "restoring" it to match
  the template — the headless autopilot test depends on its absence.
- **Never compute the centreline as `sin(frequency * s)`.** With s in the tens of thousands, a
  level changing the frequency moves the argument by radians and the road teleports sideways.
  `stepNode()` integrates the phase instead.
- **Geometry and density read the params at the node's own distance; scroll speed reads the car's
  level.** Generation runs a screen ahead. Mix them up and every difficulty change lags half a
  screen, or the road ahead stops matching the speed you arrive at.
- **A row is a stretch of track, not a line.** The car takes `(CAR.length + rowLength)` px to cross
  it and the road slides sideways all the while, so rows are placed against `roadSpanAcross()` —
  the road that is passable over the whole crossing. Placing against the span at the row's own `s`
  wedges the car between a blocker and the verge with nowhere legal to go.
- **The gap-shift budget must subtract the road's own drift.** A curving road already spends
  `maxSlope * scrollSpeed` of the car's lateral speed; only the remainder is available for changing
  lanes. Without that term every row looks reachable and the sequence is not.
- **Anything that steers by `nextRowAhead()` must keep the row it is crossing.** Returning only
  rows ahead of the bumper makes the driver abandon the gap it is halfway into.
- **The HUD announces `axisRaisedAt()`, never `axisForLevel()`.** The latter is the schedule and
  keeps naming axes after they cap; a toast claiming "속도 상승" while nothing rises teaches the
  player to ignore the one thing the difficulty model exists to tell them.
- **The tail starts one level _after_ the rotation caps.** A tail level replaces that level's
  rotation bump, so `TAIL_START_LEVEL = firstMaxedLevel()` silently ate the last road-width step and
  left the road 6 px short of its cap forever. It is `firstMaxedLevel() + 1`.
- **The tail cannot end a run, and nothing fair can.** While I1 and I2 hold, a frame-perfect driver
  survives indefinitely — the autopilot does. The tail shrinks a human's margin for error; do not
  write a test that expects it to kill the autopilot.
- **`cap.curveAmplitude` is bounded by what the road can draw**: `maxSlope * π / (2 * cap.frequency)`
  ≈ 110 px. Above it the slew limit clips the sine and the ramp raises a number nobody sees.
- **Pointer steering is clamped to `drivableBounds()`.** Unclamped, tapping the side of the screen —
  the first thing anyone does on a phone — drives a new player off the road in 0.28 s.
- **`SCORE.pxPerPoint` and `SCORE.levelBonus` are frozen once records exist.** Changing either
  makes every stored `roaddash.best` incomparable with new runs.
- **Clamp the frame delta and substep by distance.** `MOTION.maxFrameMs` stops a tab switch from
  teleporting the car; `MOTION.maxSubStepPx` is what makes tunnelling impossible rather than
  unlikely. Both are pinned by `tests/config.test.ts`.
- **Floats do not land on the caps.** Adding 0.0006 six times gives 0.007799999999999999, so a
  capped axis never compares equal to its cap. `difficulty.ts` rounds each step to 1e-6.
- **Create the road `Graphics` once and `clear()` it every frame.** Creating it in `update()` leaks
  invisibly; forgetting `clear()` smears the last frame under this one.
- **Draw the road as one polygon, not per-segment quads.** Adjacent antialiased quads leave a
  hairline seam at every joint.
- `Rectangle.setStrokeStyle(width, color, alpha)` takes alpha as a third argument. Packing it into
  the colour (`0xffffff22`) renders a wrong hue with no error.
- **Every field is re-initialised in `create()`.** `scene.restart()` reuses the instance.
- **Do not hardcode `base` in `vite.config.ts`.** It is derived from `GITHUB_REPOSITORY`.
- **`GAME_ID` is `'roaddash'`** and must equal the portal catalog's `id`. Every game on
  `y3games.github.io` shares one localStorage; `roaddash.best` holds a **bare number** because the
  portal parses it with `Number()`.
- **Steering is continuous, so it acts on `pointerdown`/`pointermove`, not `pointerup`.** That
  departs from the house rule, which exists to stop a tap from colliding with a scroll gesture; the
  CSS (`touch-action: none`, `overscroll-behavior: none`) serves that purpose here instead. The one
  discrete control, the 다시 하기 button, stays on `pointerup`.
- **Only the first pointer steers.** A second finger creates a second pointer and `activePointer`
  flips between them, teleporting the car.

## Players

Identity is inherited from the template unchanged: a name and a uuid in an origin-wide `player`
cookie, mirrored to localStorage, no login. `main.ts` awaits `ensurePlayer()` before creating the
game and puts the result in the registry. Tapping the name in the HUD reopens the dialog in rename
mode, and `UiEvents.inputLock` freezes the world while it is open — unlike a puzzle game, a running
car would drive itself off the road while the player types.

| Key                                     | Scope        | Value                                |
| --------------------------------------- | ------------ | ------------------------------------ |
| `player` (cookie + localStorage mirror) | whole origin | `{"id":"<uuid>","name":"…"}`         |
| `roaddash.best`                         | this game    | a bare number — the portal parses it |
| `roaddash.best.owner`                   | this game    | the name that set it                 |

## Testing a game without a visible browser

A hidden browser tab does not merely throttle to ~1 FPS — it stops requestAnimationFrame entirely,
so the game will sit on its BootScene and nothing will progress. Drive the loop directly instead:

```js
const g = window.__game; // dev-only handle, see main.ts
for (let i = 0, t = performance.now(); i < 200; i++) {
  t += 16.666;
  g.step(t, 16.666);
}
```

To drive it, shadow the scene's steering: `g.scene.getScene('GameScene').steer = () => -1`.
Note that a hidden tab also stops repainting, so screenshots return a stale frame — verify
anything visual in a visible window or on the deployed site.

Synthetic keyboard events need `keyCode`: Phaser identifies keys by `event.keyCode`, so
`new KeyboardEvent('keydown', { code: 'ArrowLeft' })` alone does nothing. The browser tool's
`key: "Space"` arrives as an empty event with `keyCode: 0`; dispatch `{ keyCode: 32 }` instead to
test the restart key.

## Documentation

Follow the `save-docs` skill for anything under `docs/`.
