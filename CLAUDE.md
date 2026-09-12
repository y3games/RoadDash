# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A Phaser 3 web game template: Vite + TypeScript + Phaser 3.90 (Matter.js physics), deployed as a
static site to GitHub Pages by GitHub Actions.

The game in `src/` is a **placeholder demo** — drop balls, score them when they land. It exists to
prove the pipeline end to end. Replace it with the real game; keep the structure around it.

Player-facing copy is Korean. There is no backend.

## Commands

```bash
npm run dev      # Vite dev server at http://localhost:5173/
npm run check    # tsc --noEmit && eslint . && vitest run  ← must pass before calling work done
npm test         # vitest only
npm run build    # type-check then produce dist/
```

CI runs `npm run check` before building, so a failing check blocks deployment.

## Architecture

**Game rules never touch Phaser.** `src/game/` holds rules and tuning as pure modules that do not
import Phaser, so the rule set is unit-tested without booting a game. Scenes translate engine
events into calls on those functions and apply the result. Do not move rule logic into a scene —
that is the one change that makes the whole thing untestable.

- `src/game/config.ts` — the **only** place tuning lives: the ball table, spawn weights, layout,
  physics constants. A magic number in a scene is a bug.
- `src/game/rules.ts` — pure functions. `pickKind()` takes the random value as an argument instead
  of calling `Math.random()`, which is what makes it deterministic and testable.
- `src/scenes/BootScene.ts` — draws ball textures at runtime with `Graphics`. **No image assets
  ship.** To use real art, load files here; nothing else knows anything but the texture keys.
- `src/scenes/GameScene.ts` — Matter world, input, game loop.
- `src/scenes/UIScene.ts` — runs _alongside_ GameScene via `scene.launch()`, not inside it, so
  overlays stay interactive while the physics scene is paused.
- `src/services/ScoreService.ts` — the persistence boundary. The game never calls `localStorage`
  or `fetch` directly. Adding a leaderboard later means one new implementation plus the single
  injection line in `main.ts`.
- `src/services/player.ts` — anonymous identity: a name and a uuid in a cookie, no account. The
  cookie is origin-wide (`path=/`), so identity is _shared_ by every game while scores stay per
  game. Mirrored to localStorage because Safari caps script-written cookies at 7 days.
- `src/ui/nameGate.ts` — the first-visit name prompt. Plain DOM over the canvas, and the game does
  not boot until it resolves.
- `src/main.ts` — `GAME_ID` names this game's saved data and **must be changed when scaffolding a
  new game** (see below).

## Scaffolding a new game: set `GAME_ID`

`main.ts` injects `GAME_ID` into `LocalScoreService`, which stores the personal best under
`<GAME_ID>.best`. Set it to the new repository's name, lowercased.

Every game deploys to the same GitHub Pages origin (`https://y3games.github.io`), so they all share
**one** localStorage. A key hardcoded in the template — as `game.best` once was — means two
template-derived games silently overwrite each other's high score, and nothing about the symptom
points at storage. Deriving the key from the id makes the collision impossible.

`<id>.best` is also the convention the games portal reads to show a card's best score, so keep
`GAME_ID` equal to that game's `id` in the portal catalog. The constructor rejects anything that is
not a slug (lowercase letters, digits, hyphens), so a typo fails loudly at boot rather than writing
to a stray key.

Changing `GAME_ID` on an already-deployed game abandons the scores stored under the old key. That
is fine for a fresh game; for a live one, the portal's `scoreKey` override exists to point at the
old key instead.

## Gotchas

These cost real debugging time. Do not reintroduce them.

- **Never tween `scale` on a `Phaser.Physics.Matter.Image`.** Phaser's Matter transform rescales
  the physics body too. If the object is destroyed mid-tween, the tween keeps writing to a dead
  body and throws inside Matter, killing the whole game loop — the game freezes silently with no
  visible error. Tween alpha instead, and `killTweensOf()` before `destroy()`.
- **Never mutate the physics world inside a collision callback.** Queue the work and apply it in
  `update()`. Removing a body mid-step corrupts the engine.
- **A body spawns at rest, so `speed < threshold` is true on its first frame.** Any "has it
  settled?" check must first require that the body has actually moved, or it fires at spawn. The
  demo's scoring hit exactly this.
- Prefer a gate that is _guaranteed_ to become true (e.g. "has exceeded a speed threshold") over
  a positional one (e.g. "has crossed below a line"). A positional gate can silently never open.
- `Rectangle.setStrokeStyle(width, color, alpha)` takes alpha as a third argument. Packing it into
  the colour (`0xffffff22`) renders a wrong hue with no error.
- **Every game on `y3games.github.io` shares one localStorage.** Never hardcode a storage key;
  derive it from `GAME_ID` so keys stay per-game (see _Scaffolding a new game_ above). A shared key
  looks fine until a second game is deployed, then both games' scores start overwriting each other.
- **An id rule with `display` defeats the `hidden` attribute.** `#welcome { display: flex }` beats
  the UA stylesheet's `[hidden] { display: none }`, so the name overlay stayed on screen after it
  was dismissed — the game was running, invisible, behind it. Any element toggled with `hidden`
  needs its own `#id[hidden] { display: none }`.
- **Do not hardcode `base` in `vite.config.ts`.** It is derived from `GITHUB_REPOSITORY` so a repo
  created from this template works under any name. Hardcoding it 404s every asset on deploy.

## Players

There is no login. The first visit asks for a name, stores `{id, name}` in the `player` cookie, and
every later visit is recognised by it. `main.ts` awaits `ensurePlayer()` before creating the game
and puts the result in the registry, so any scene can read `registry.get('player')`.

`ScoreService.submit(score, player)` takes the player rather than reading storage itself — a
server-backed implementation needs the id and name in its request body, and keeping the read out of
the service preserves the rule that `main.ts` is the only injection site.

Storage layout, and why it is split:

| Key                                     | Scope        | Value                                                    |
| --------------------------------------- | ------------ | -------------------------------------------------------- |
| `player` (cookie + localStorage mirror) | whole origin | `{"id":"<uuid>","name":"…"}`                             |
| `<GAME_ID>.best`                        | one game     | a bare number — **the portal parses it with `Number()`** |
| `<GAME_ID>.best.owner`                  | one game     | the name that set it                                     |

Never put the name inside `<GAME_ID>.best`. The games portal reads that key directly, and a JSON
value there breaks its score display with no error on either side.

Tapping the name in the HUD reopens the same overlay in rename mode. `savePlayer()` keeps the id, so
the record stays theirs, and `ScoreService.renameOwner()` refreshes the stored attribution — but
only when the ids match, so a best score left by someone else on a shared browser keeps its name.

The overlay is DOM on top of a running game, which is why `UiEvents.inputLock` exists: GameScene
drops a ball on `pointerup`, so the HUD opens the dialog on `pointerdown` and locks dropping first.
Without that, opening the dialog also drops a ball.

This is identity, **not authentication**: both fields are editable in devtools. A future server must
not trust them for anything that matters.

## Testing a game without a visible browser

A hidden browser tab is throttled to ~1 FPS, so waiting on wall-clock time gives misleading
results. Drive the loop directly instead:

```js
const g = window.__game; // dev-only handle, see main.ts
for (let i = 0, t = performance.now(); i < 200; i++) {
  t += 16.666;
  g.step(t, 16.666);
}
```

## Documentation

Follow the `save-docs` skill for anything under `docs/`.
