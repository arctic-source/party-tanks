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
  tanks.js         tank type stats/art (TANK_TYPES-driven body drawers,
                   supply-crate-until-selected, bullet/flash/impact marks)
  combat.js        fire(), resolveImpact(), tree-fire damage, turn resolution
  playerConfig.js  pre-game screens, player name/color + wind config persistence
  ui.js            turn/fuel/aim HUD text, per-player theming, toasts,
                   fullscreen button state
  bot.js           medium-difficulty AI: dry-run trajectory search + aim
                   noise + move-when-unreachable turn state machine
  tankSelect.js    in-match tank-picking phase: tile menu, bot auto-pick,
                   wind roll + real turn start once both have picked
  main.js          orchestrator: wires up all event listeners, the
                   update/render loop, computeArenaLayout(), boot()
```

Dependency direction is roughly: `store`/`constants`/`utils` (leaves) →
`canvas` → `camera`/`terrain` → `trees`/`tanks`/`background` →
`combat`/`playerConfig`/`ui` → `bot`/`tankSelect` → `main` (root, imports
everything, has no exports). Keep new code flowing in this direction —
e.g. `terrain.js` should never import from `combat.js`.

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
- **Damage falls off linearly with impact distance** from a tank type's
  own `maxDamage` (dead-center) to its own `minDamage` (edge of its hit
  box), in `combat.js: resolveImpact`. This was implemented only after
  being reviewed critically per the user's request — it's intentional,
  not a placeholder. Damage dealt is an **attacker** trait: `resolveImpact`
  reads `store.players[store.active]` (the shooter, not the tank that got
  hit) for `minDamage`/`maxDamage`, so a Juggernaut always hits harder
  regardless of what it hit.
- **Bullets spawn at the barrel tip**, not a fixed offset from the tank
  body. `combat.js: fire()` computes the same pivot point + direction
  vector (per-type `barrelPivotX/Y`, `barrelLength` in `constants.js:
  TANK_TYPES`) that `tanks.js: drawTank()` uses to draw the barrel and the
  yellow aim arrow - so the bullet always visibly leaves from where the
  arrow points, at any angle, for any tank type. Keep the physics and the
  drawing reading from the same per-type values; don't reintroduce a
  separate fixed offset for the spawn point.
- **Hit detection is an axis-aligned BOX, not a circle** (`hitHalfWidth`/
  `hitHeight` per type in `constants.js: TANK_TYPES`; the check itself is
  `main.js: hitTest()`). A circle has one degree of freedom (radius), which
  can't independently match width vs height - Jumper is tall and narrow,
  Juggernaut is wide and squat, and a circle sized to reach a tall tank's
  feet would absurdly overshoot its narrow torso width (or vice versa).
  The box is anchored at ground level (bottom edge at `terrainHeightAt`,
  top edge `hitHeight` above it) and spans `±hitHalfWidth` - deliberately
  sized to contain the tank's full visible body **including its legs**,
  excluding only thin protrusions (barrel, Trooper's antenna) the same way
  those were always allowed to poke slightly outside the old circle.
  `hitTest()` returns a 0..1 "distance to the box edge" (Chebyshev-style:
  `max(|dx|/halfWidth, |dy|/halfHeight)`) that `resolveImpact` uses for
  the same linear damage falloff the circle model used - don't reintroduce
  distance-from-center circle math without re-deriving why it broke down
  for non-square silhouettes.
- **Self-damage has a grace period** (`SELF_DAMAGE_GRACE = 0.25s`) before a
  bullet can hit its own shooter. Without it, every shot would register an
  instant self-hit at the barrel's spawn point, which sits inside the
  shooter's own hit box. Since bullets spawn at the barrel tip (see
  above), self-hits happen on near-vertical shots (roughly 80°-95°) that
  go mostly straight up and fall back down near their own x - not on
  backward-arcing (angle > 90°) shots as an earlier version of this file
  said. That description was written for a since-replaced spawn-point
  formula; re-verify empirically (sweep angles with wind forced to 0, see
  Testing workflow) before trusting either description again if this code
  changes.
- **Three tank types, one shared table** (`TANK_TYPES` in `constants.js`:
  Trooper/Jumper/Juggernaut). Each entry is a complete stat + art-anchor
  block (health, speed, fuel drain, damage range, hit box, barrel pivot/
  length) - adding a fourth type is a new table entry plus a new body-
  drawing function registered in `tanks.js: BODY_DRAWERS`, not new
  branches through the physics/combat code. Tank body art is grey/black
  structure with only 1-2 small accents actually carrying the player's
  color (a stripe, a trim ring, an ID plate) - not the whole silhouette -
  and any glass/viewport/thruster-glow element stays a fixed light blue
  regardless of player, so the accent color is the *only* saturated color
  and reads clearly at a glance. Body art is authored "facing right" and
  mirrored via `ctx.scale(dir, 1)` in `tanks.js: drawTank()`; the barrel
  is drawn *outside* that mirrored scope using dir-aware vectors directly
  (mirroring the barrel's angle via `180 - angle` for dir=-1, not another
  `ctx.scale`) so it's never double-flipped.
- **Tank selection happens inside the match, not on a pre-game screen**
  (`tankSelect.js`). `main.js: startMatch()` generates terrain/trees/wind-
  config as before but hands off to `beginTankSelection()` instead of
  starting the aim phase directly; `store.state` gets a new value,
  `"select"`, gating the aim/flight/resolve branches in `main.js: update()`
  off entirely (nothing needs to happen there - the world still renders
  normally underneath, since `render()` isn't gated by state). Player 0
  picks first, then player 1 (`store.active` doubles as "whose turn to
  pick"); a bot player skips the tile UI and picks a random type
  immediately. Wind is rolled and the real first turn begins only once
  both have picked (`finishTankSelection()`) - don't move wind generation
  earlier, the whole point of gating it here is a clean single moment
  where the match visibly "starts."
- **Tapping a tank tile only highlights it - a separate Confirm button
  commits the pick** (`tankSelect.js: markPending()` sets `pendingKey` and
  toggles `.selected` on the tapped tile; `confirmTankSelection()`, wired
  to `#tsConfirmBtn` in `main.js`, is the only thing that actually calls
  `chooseTankType()`). This was a deliberate QoL change - it also
  incidentally hardens the ghost-duplicate-event fix below, since a stray
  trailing event from a tile tap can now only re-highlight a tile, never
  advance the turn by itself.
- **The tank-select menu is a left-anchored sliding panel, not a
  full-screen overlay** (`#tankSelectOverlay` in `styles.css`: fixed
  `width: min(340px, 58vw)`, slid in/out via `transform: translateX()`
  rather than the old `display:none`/`.show{display:flex}` toggle, so its
  layout width stays measurable via `getBoundingClientRect()` even while
  hidden off-screen). This leaves the active player's box/tank visible in
  the strip to the panel's right instead of hiding it behind a full dark
  overlay. `camera.js: centerCameraOnActiveOffset(offsetPx)` shifts
  `camCenterX` so the active player lands in the middle of that visible
  strip rather than dead-center of the whole viewport; `tankSelect.js:
  panelOffsetPx()` reads the panel's real rendered width so the two can
  never drift out of sync. The panel is only slid in/out when its
  visibility actually changes (human turn shows it, `finishTankSelection()`
  hides it) - a human-to-human handoff re-renders the tile list in place
  without re-triggering the slide transition, and a bot's turn defensively
  hides the panel first (`startSelectionTurn()`) since it has no menu to
  show. Near a world edge, `clampCam()` can still override the offset to
  keep the camera from showing space past the world boundary - the box
  stays visible either way, just not perfectly centered in the strip; treat
  that as an acceptable boundary case, not a bug, if you touch this code.
- **Each unselected player is drawn as a supply crate, not their tank**
  (`tanks.js: drawSupplyCrate`, gated by `p.selected`). There's no separate
  reveal animation/state - `drawTank()` just stops calling
  `drawSupplyCrate` and starts drawing the real body the instant
  `p.selected` flips true, so the "box becomes a tank" moment is a single
  boolean flip, not a tween. Don't add crate→tank animation state without
  a reason; the instant swap was a deliberate scope cut.
- **Picking a tank holds the reveal on screen before advancing** -
  `tankSelect.js: chooseTankType()` still applies the stats and flips
  `p.selected` immediately (the crate→tank swap itself isn't delayed),
  but `advanceOrFinish()` - which moves to the next player or calls
  `finishTankSelection()` - is deferred via `setTimeout(...,
  TANK_SELECT_REVEAL_DELAY_MS)` (`constants.js`) instead of running
  inline. This is deliberate: without a real pause, the camera pan to the
  next player happened in the same tick as the reveal and nobody actually
  saw the box turn into a tank. The panel's tiles/Confirm button are
  disabled and relabeled ("<Tank> deployed!") for the same window
  (`lockSelectionUI()`) purely so a stray tap during the pause can't look
  like it did something - `p.selected` was already the real guard against
  a double-pick. Bots get an equivalent beat: `startSelectionTurn()`
  centers the camera on a bot's box first, waits
  `TANK_SELECT_BOT_LOOK_MS`, *then* calls `chooseTankType()` with a random
  type, so a bot's box is visibly on screen before it becomes a tank too,
  not just a human's. Still no separate "Player X selected Y!" `#toast` -
  the reveal + button relabel are the feedback; a toast would just add a
  second, redundant message on top of what's already on screen during the
  same pause.
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
- **Wind is rolled once per round, not per shot.** (`store.wind`, a signed
  value in `[-1, 1]` — sign is direction, magnitude is strength — set by
  `tankSelect.js: generateWind()`, called once both players have picked a
  tank, not at `startMatch()` time - see the tank-selection decision
  below for why.) It only affects the
  bullet in flight (`bullet.vx += store.wind * WIND_MAX_ACCEL * dt`, next to
  gravity's `vy` accel in `main.js: update()`), never tank movement. The
  magnitude is drawn from a band picked by the config screen's None/Light/
  Strong selector (`WIND_LEVELS` in `constants.js`); the selected level
  persists via `localStorage` (`WIND_LEVEL_KEY`), same pattern as player
  config. The in-match arrow+percentage readout (`ui.js: updateWindUI()`)
  is set once at match start, not per frame — wind doesn't change mid-round
  so there's nothing to re-render.
- **The bot AI aims by perturbing the target point, not the angle/power
  outputs.** (`bot.js`.) It runs a coarse-to-fine grid search (`findBestShot`
  → `simulateLanding`, a dry-run copy of the real flight physics that never
  touches `store.bullet`) to find the angle/power whose simulated landing
  spot is closest to a target x. To miss on purpose, it perturbs that
  target x with one Gaussian (`AI_LEVELS.medium.aimStdDev`) *before*
  searching, rather than adding two separately-tuned angle and power noise
  terms after. This was a deliberate simplification: a fixed angle-space
  error produces wildly different miss distances depending on range (tiny
  angle error + max range = huge miss; same error at point-blank barely
  moves the landing spot), while target-point noise gives a consistent,
  easy-to-tune miss radius regardless of range. Don't reintroduce
  angle/power-space noise without re-deriving that tradeoff.
- **The bot has no memory between shots.** Every turn re-runs the search
  from scratch against a freshly-rolled perturbed target — no bracketing/
  walking-in behavior, intentionally, to keep it stateless and simple.
  This was an explicit scope cut for the first (medium-only) difficulty
  level; don't add cross-turn aim correction without discussing it first,
  since easy/hard tiers may want to build on this differently.
- **The bot only moves when the true target is unreachable at max
  effort** (`AI_UNREACHABLE_THRESHOLD` in `constants.js`), and when it
  does, it commits to one uninterrupted drive using the exact same
  held-key + fuel mechanics a human uses, for the rest of the turn's fuel,
  with no re-checking mid-drive — then re-aims exactly once from the new
  position. This was a deliberate simplification over an earlier
  iterative "move a bit, recheck, repeat" design: a single commit avoids
  a multi-attempt retry loop entirely while still producing the visible
  "bot drives closer when it has to" behavior. `main.js: update()` gates
  the shared movement code with `!p.isBot || store.bot.phase ===
  "moving"` specifically so a stray held-key state can't reposition the
  bot's tank during its post-aim "waiting to fire" pause.
- **Bot difficulty is one shared table, not per-level code paths.**
  (`AI_LEVELS` in `constants.js`, currently only the `medium` entry.)
  Easy/hard should be added as new entries with different `aimStdDev`/
  `thinkDelay*` values, not new branches in `bot.js` - the search and
  move-when-unreachable logic aren't difficulty-specific.

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
  (currently `party-tanks-v8`). **Bump this version any time you change
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
- **Map size multiplier** (`MAP_SIZE_MULTIPLIER` in `constants.js`) is
  fixed at `1.0` — there's no Small/Large selector yet, though
  `computeArenaLayout()` already reads this constant so wiring one up is
  mostly a UI task.
- **Bot/AI opponents**: player slots 3-7 are still visibly present but
  disabled (no >2-player support yet). Slots 0-1 now support a real Bot
  toggle, but only one difficulty exists (`AI_LEVELS.medium` in
  `constants.js`) - there's no easy/hard selector yet, though `bot.js`
  is already structured so adding one is new table entries, not new logic.
- **Tank type choice doesn't persist** across matches the way player
  name/color/wind level do - every match starts both players back at
  `newTank()`'s Trooper default and re-runs the full `tankSelect.js` flow.
  Not an oversight; nothing has asked for a "remember my tank" shortcut
  yet, and picking is already a required, unskippable step every match.
