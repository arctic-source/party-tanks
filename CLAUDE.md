# Party Tanks

A 2D pass-and-play tank artillery game, played in a mobile browser (landscape,
fullscreen PWA). Two players share one phone, taking turns aiming and firing
across procedurally generated terrain. No backend, no build step: static
files deployed straight from this repo via GitHub Pages.

- **Deploy branch**: `claude/tank-artillery-game-vfqtfj` — GitHub Pages serves
  directly from this branch. There is no separate build/publish step; whatever
  is pushed here is what's live.
- **Stack**: vanilla HTML/CSS/JS, ES modules (`<script type="module">`), no
  framework, no bundler, no npm dependencies for the game itself.

## Architecture

```
index.html        markup only — links styles.css, boots js/main.js
styles.css         all styling (control bar, pre-game screens, canvas)
sw.js              PWA service worker (network-first cache)
js/
  store.js         shared MUTABLE state — see "The store pattern" below
  constants.js     tunable numbers/tables, never reassigned at runtime
  utils.js         pure helpers (random, color math) — no state dependency
  canvas.js         canvas/ctx/canvasWrap DOM refs + resizeCanvas()
  camera.js        center+zoom camera math, pan/pinch gesture handlers
  terrain.js       terrain generation/query/deform + drawTerrain()
  trees.js         tree lifecycle + drawing (alive/burning/ash)
  background.js    sky gradient, parallax mountain layers, clouds
  tanks.js         tank creation + drawing (tank/bullet/flash/impact marks)
  combat.js        fire(), resolveImpact(), tree-fire damage, turn resolution
  playerConfig.js  pre-game screens, player name/color persistence
  ui.js            turn/fuel/aim HUD text, toasts, fullscreen button state
  main.js          orchestrator: wires up all event listeners, the
                   update/render loop, computeArenaLayout(), boot()
```

Dependency direction is roughly: `store`/`constants`/`utils` (leaves) →
`canvas` → `camera`/`terrain` → `trees`/`tanks`/`background` →
`combat`/`playerConfig`/`ui` → `main` (root, imports everything, has no
exports). Keep new code flowing in this direction — e.g. `terrain.js`
should never import from `combat.js`.

### The store pattern

ES module bindings are **live but read-only to importers** — a module can't
reassign a `let`/`var` it imported from elsewhere. Since most game state
(current player, camera position, terrain array, tanks, etc.) gets
reassigned constantly, it all lives as properties on one object,
`store` (`js/store.js`), exported once and imported everywhere it's needed:

```js
import { store } from "./store.js";
store.active = 1;          // fine — mutating a property
store.camCenterX = 500;    // fine
// export var active = 0; ... active = 1;  <- would NOT work from another module
```

When adding new runtime-mutable state, add it as a `store` property, not a
new module-level `export var`. Constants that are set once and never
reassigned belong in `constants.js` instead.

## Load-bearing design decisions

These came out of real back-and-forth with the user — don't casually
"simplify" or revert them without checking in first.

- **Terrain stored as fractions of `VIEW_H`, not absolute pixels.**
  (`store.terrain[x]` is 0..1, converted via `terrainHeightAt`/
  `terrainFractionAt` in `terrain.js`.) Storing absolute pixel heights broke
  when the viewport height changed post-generation (address bar hide/show,
  fullscreen toggle) — terrain and tanks would desync from the new viewport.
- **Camera is center+zoom** (`camCenterX/Y`, `camZoom`), not top-left-offset.
  This makes pinch-zoom-around-midpoint math simple. Don't refactor to an
  offset-based camera without re-deriving the pinch anchoring in `camera.js`.
- **Arena sizing is tied to player count and map size**, not a flat world
  width: `WORLD_W = PLAYER_SPACING * MAP_SIZE_MULTIPLIER * max(1, n-1) +
  WING_MARGIN*2` (`main.js: computeArenaLayout`). This exists because a flat
  world width put interesting terrain features far from the actual players
  most of the time. Mountain placement (`terrain.js`) and tree placement
  (`trees.js`) both key off `playerStartXs`/`ARENA_BUFFER`, not `WORLD_W`
  directly — keep that if you touch scenery generation.
- **5 weighted mountain layout archetypes** (Open Plains / The Ridge / Twin
  Peaks / Mountain Range / Off to the Side, in `terrain.js:
  pickMountainLayout`) instead of one placement rule with randomized
  parameters. This was a deliberate fix for terrain feeling "samey" —
  don't collapse it back to a single rule.
- **Damage falls off linearly with impact distance** from `MAX_DAMAGE`
  (dead-center) to `MIN_DAMAGE` (edge of `HIT_RADIUS`), in
  `combat.js: resolveImpact`. This was implemented only after being reviewed
  critically per the user's request — it's intentional, not a placeholder.
- **Self-damage has a grace period** (`SELF_DAMAGE_GRACE = 0.25s`) before a
  bullet can hit its own shooter. Without it, every shot would register an
  instant self-hit at the barrel's spawn point, which sits inside the
  shooter's own `HIT_RADIUS`. Realistic self-hits require a backward-arcing
  shot (angle > 90°) so the bullet's x crosses back through the shooter.
- **Trees have a 3-state lifecycle**: alive → burning (ignites on bullet
  hit, stops blocking bullets, damages nearby tanks each turn via
  `applyTreeFireDamage`) → ash (`BURN_TURNS` turns later, rendered behind
  tanks, no collision). Preserve the state machine if you touch tree
  behavior.
- **Player config (names/colors) persists via `localStorage`**
  (`PLAYER_CONFIG_KEY` in `constants.js`), loaded once at module init in
  `playerConfig.js`. Only slots `0..ACTIVE_SLOTS-1` are editable; the rest
  are locked placeholders for a future bot/more-players feature — that's
  intentional, not a bug.

## Conventions

- `var`, not `let`/`const` — matches the codebase's existing style
  throughout; stay consistent rather than mixing styles file-to-file.
- No build step. Anything added must run as-is via `<script type="module">`.
  This means: relative imports need explicit `.js` extensions, and the app
  **must be served over http(s)** (or `localhost`) — ES modules don't load
  over `file://`. GitHub Pages satisfies this for the real deployment;
  local testing needs a local server (e.g. `python3 -m http.server`).
- Default to no comments; only add one when the *why* is genuinely
  non-obvious (see the "load-bearing decisions" list above for examples of
  what warrants one).

## Testing workflow

There's no test framework in the repo. The established pattern for
verifying changes is a headless Playwright script:

1. Copy the whole site (or just serve it in place) via
   `python3 -m http.server <port>` from the project root — needed because
   ES modules require http(s), not `file://`.
2. Add a small test-only `js/debug.js` module (not committed) that imports
   `store` and whatever functions you need to call directly, and assigns
   them to `window.__debug`:
   ```js
   import { store } from "./store.js";
   import { fire } from "./combat.js";
   window.__debug = { store, fire };
   ```
   Reference it with an extra `<script type="module" src="js/debug.js">`
   tag appended after `main.js` in a scratch copy of `index.html` — never
   commit this hook or tag to the real files.
3. Drive it with Playwright: `chromium.launch({ executablePath:
   '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:
   ['--no-sandbox'] })`, then click through screens and inspect/mutate
   `window.__debug.store` directly to force specific game states (e.g. set
   a player's health to 1 before firing to test the win condition without
   waiting out a real kill shot).
4. Check `page.on('pageerror', ...)` / `console` output for errors — the
   module split makes cross-file typos (bad import names, wrong paths)
   silent-until-runtime, so this catches what static reading won't.

## Deployment notes

- GitHub Pages serves straight from the deploy branch — pushing to it *is*
  deploying. There's no staging step.
- `sw.js` uses network-first caching with a versioned `CACHE_NAME`
  (currently `party-tanks-v3`). **Bump this version any time you change
  which files exist or change caching-relevant behavior** — otherwise
  clients can end up serving a stale mix of old/new files from cache.
  Also keep `sw.js`'s `ASSETS` list in sync with the actual file set (every
  `js/*.js` file, `styles.css`, etc.) so offline play still works.
- Because of service worker caching, a fix to the service worker itself
  needs one extra refresh cycle to take effect (the old SW has to be
  superseded before the new caching logic runs).

## Keeping this file current

This file is the only memory that carries forward between sessions — treat
it as living documentation, not a one-time snapshot. Update it as part of
the same commit whenever a change:
- adds/removes/renames a `js/*.js` module, or changes what it owns
- adds a new load-bearing design decision (something reviewed/debated with
  the user that a future session could plausibly "simplify" back to a worse
  version)
- changes a convention (e.g. if the codebase ever moves off `var`)
- locks/unlocks one of the "Deferred / intentionally locked" features below
- changes deployment behavior (cache versioning scheme, branch, etc.)

Small bug fixes and tuning-constant tweaks don't need an entry. When in
doubt, prefer a short addition over silence — this file staying accurate is
more valuable than it staying short.

## Deferred / intentionally locked features

Not bugs — these are stubbed for future work and are locked in the UI on
purpose:
- **Rounds** is locked to 1 (no best-of-N yet).
- **Map** is locked to "Chill Forest" (no map selector yet, though the
  terrain-generation system already supports variation within it).
- **Wind** is locked to "None" (no wind mechanic implemented).
- **Map size multiplier** (`MAP_SIZE_MULTIPLIER` in `constants.js`) is
  fixed at `1.0` — there's no Small/Large selector yet, though
  `computeArenaLayout()` already reads this constant so wiring one up is
  mostly a UI task.
- **Bot/AI opponents**: player slots 3-7 and the "Bot" mode toggle are
  visibly present but disabled — no AI implementation exists yet.
