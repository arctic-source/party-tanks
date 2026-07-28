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
bench.html         internal dev tool entry point — NOT linked from
                   index.html, NOT in sw.js's precache list. See
                   bench/README.md and the load-bearing decision below.
bench/             AI-tuning simulation bench (Claude runs this, not the
                   user) — benchRunner.js (in-page driver), run.js
                   (Playwright CLI), analyze.js (stats), README.md
js/
  store.js         shared MUTABLE state — see "The store pattern" below
  constants.js     tunable numbers/tables, never reassigned at runtime
  utils.js         pure helpers (random, color math) — no state dependency
  canvas.js         canvas/ctx/canvasWrap DOM refs + resizeCanvas()
  camera.js        center+zoom camera math, pan/pinch gesture handlers
  terrain.js       terrain generation/query/deform + drawTerrain() (shape
                   shared by every map; only drawTerrain()'s colors,
                   read from store.activeMap.ground, vary per map)
  scenery.js       scenery item lifecycle + drawing (alive/burning/ash) -
                   generic over item TYPE (pine tree, cactus, ...), see
                   MAPS/SCENERY_TYPES in constants.js
  background.js    sky gradient (per-map colors), parallax background
                   layers (mountains or pyramids, per map), clouds
  tanks.js         tank type stats/art (TANK_TYPES-driven body drawers,
                   supply-crate-until-selected, bullet/flash/impact marks)
  combat.js        fire(), resolveImpact(), scenery-fire damage, turn resolution
  playerConfig.js  pre-game screens, player name/color + wind/map config persistence
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
`canvas` → `camera`/`terrain` → `scenery`/`tanks`/`background` →
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
  most of the time. Mountain placement (`terrain.js`) and scenery placement
  (`scenery.js`) both key off `playerStartXs`/`ARENA_BUFFER`, not `WORLD_W`
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
- **The angle buttons are screen-relative (Left/Right), not
  angle-relative (Up/Down).** (`main.js: update()`'s aim-phase branch.)
  A flat `p.angle += ANGLE_RATE * dt` for one button and `-=` for the
  other would rotate the barrel *clockwise for one player and
  anticlockwise for the other*, since `combat.js: fire()`'s `bx =
  cos(angle) * dir` already mirrors which screen-direction a given angle
  points for `dir = -1` - that mismatch between "which button" and
  "which way it visibly spins" was the actual bug report, not just a
  labeling issue. The fix scales the delta by the same `dir` used
  everywhere else (`p.angle -= ANGLE_RATE * dt * dir` for Right, `+=` for
  Left) so Right always visibly tilts the barrel tip toward screen-right
  for both players, matching how the Move Left/Right buttons already
  work in screen space. Don't revert to a flat, dir-independent delta
  without re-deriving why that reintroduces the mirrored-rotation
  confusion.
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
- **Scenery has a 3-state lifecycle, but only for burnable types**: alive
  → burning (ignites on bullet hit, stops blocking bullets, damages
  nearby tanks each turn via `applySceneryFireDamage`) → ash
  (`BURN_TURNS` turns later, rendered behind tanks, no collision).
  Whether a hit can even start that transition is gated by the active
  map's scenery type (`constants.js: SCENERY_TYPES[key].burnable`) - see
  the maps/scenery load-bearing decision below. Preserve the state
  machine if you touch scenery behavior.
- **Maps are one shared table, not per-map code paths - same pattern as
  `TANK_TYPES`/`AI_LEVELS`.** (`MAPS` in `constants.js`, resolved once
  per match into `store.activeMap` by `main.js: startMatch()`.) Every
  file that used to hardcode a color or a tree-specific constant now
  reads it from `store.activeMap` instead: `terrain.js: drawTerrain()`
  reads `.ground.*` for the dirt/grass/tuft colors, `background.js:
  drawBackground()` reads `.sky`/`.bgBack`/`.bgFront`, and
  `scenery.js`/`main.js`/`bot.js` all read `SCENERY_TYPES[.scenery]` for
  which item populates the map and its collision profile
  (`baseHeight`/`canopyFrac`/`radiusFrac`/`burnable`). Terrain SHAPE
  (`terrain.js: generateTerrain`'s rolling hills + mountain archetypes)
  is deliberately shared by every map, unlike everything else - a map
  that needs a genuinely different shape (flat rooftops, a hazard you
  can fall/drown in, etc.) is a bigger change than this table supports
  and would need `generateTerrain` itself to become pluggable per map;
  don't force one into this table without that redesign.
- **A map's background can use a different near-layer SHAPE, not just
  different colors.** (`background.js`.) `bgBack` is always the existing
  sine-wave mountain silhouette (`drawMountainLayer`), just recolored -
  it doubles as convincing distant dunes for the desert map with zero
  new code. `bgFront` can instead set `shape: "pyramids"` to use
  `drawPyramidLayer`, drawing `store.bgPyramids` - one Giza-style
  cluster (`scenery.js: generateBgPyramids`), not independently
  scattered triangles: each entry is deliberately smaller than the
  previous and offset just enough right to overlap it, and array order
  IS draw order, so index 0 (biggest) paints first/furthest-back and
  each later, smaller pyramid paints on top - "in front of" the one
  before it. Don't reintroduce independent random placement per
  pyramid; the overlap is the point, not something to avoid. Each
  pyramid is drawn as two triangles, not one - a lit face and a shaded
  face sharing the apex and a ridge line down to `py.ridgeFrac` along
  the base (stored per-pyramid for variety) - both computed from the
  exact same `sx`/`w`/`h` every frame, so they can't drift apart under
  panning without a second, separately-tracked object; don't split them
  into two entries in `store.bgPyramids` to "simplify" this, that would
  reintroduce exactly the desync risk this avoids. Both
  `store.bgTrees` and `store.bgPyramids` are generated unconditionally
  every match regardless of which the active map's `bgFront` actually
  draws - simpler than gating generation itself, and cheap enough that
  generating the unused one is not worth the extra branch.
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
  → `simulateLanding`, a dry-run flight simulation that never touches
  `store.bullet`) to find the angle/power whose simulated landing spot is
  closest to a target x. `simulateLanding` shares its physics/collision
  with the real flight resolution in `main.js: update()` via two
  extracted helpers - `utils.js: stepBallistic()` for the gravity/wind
  integration step, `scenery.js: sceneryHitAt()` for the tree/rock circle
  collision - rather than hand-duplicating that math a second time; the
  two used to be separate hand-copies that could silently drift apart
  when one was edited and not the other. Don't reintroduce a local copy
  of either in `bot.js` - import and call the shared helper instead. To
  miss on purpose, it perturbs that
  target x with one Gaussian *before* searching, rather than adding two
  separately-tuned angle and power noise terms after. This was a
  deliberate simplification: a fixed angle-space error produces wildly
  different miss distances depending on range (tiny angle error + max
  range = huge miss; same error at point-blank barely moves the landing
  spot), while target-point noise gives a consistent, easy-to-tune miss
  radius regardless of range. Don't reintroduce angle/power-space noise
  without re-deriving that tradeoff.
- **The Gaussian's stddev is itself computed per shot, not a flat
  constant** (`bot.js: computeAimStdDev()`), from two multipliers against
  the `AI_LEVELS[level].aimStdDev` ceiling: how close the shooter is to
  the opponent right now (`rangeNearPx`/`rangeFarPx`/
  `rangeNoiseFloorMult` - closer shots get a tighter floor), and how much
  the opponent has moved since *this shooter's own* last shot
  (`recalibrateDistPx`/`confidenceNoiseFloorMult` - an unmoved opponent
  gets a tighter floor too, fully reset back to the ceiling once they've
  moved past `recalibrateDistPx`). Both are pure multipliers on the same
  ceiling, so this is still one Gaussian on one target point - it hasn't
  grown a second noise mechanism, just a smarter derivation of the one
  stddev that feeds it. Important nuance if you touch this: `simulateLanding`
  already reads the real `store.wind` and the opponent's exact current
  `x`, so the bot isn't actually uncertain about either - this dial is a
  difficulty/game-feel choice ("reward the human for keeping the bot
  guessing"), not a simulation of the bot learning something true about
  the world. Don't describe it as the bot "learning wind" in comments;
  it already knows the wind exactly.
- **The bot has one shot of memory, not zero and not more.**
  (`p.aiMemory = { hasFired, lastOpponentX }`, set in `tanks.js: newTank()`
  and updated at the end of `bot.js: beginAimAndWait()`.) It's *only* the
  opponent's x at this shooter's last shot - enough to compute the
  confidence multiplier above, nothing else. A shooter's first shot of
  the match has `hasFired: false`, so confidence starts unearned (full
  noise) - the "first shot is exploratory" feel falls out of that for
  free, no special-casing needed. There's still no bracketing/walking-in
  of the actual aim point itself, and still no memory of anything before
  the immediately preceding shot - keep it that way; a longer history is
  a bigger change than "one more shot of context" and should be its own
  discussion.
- **The bot moves for two different reasons, both driven by the same
  single-commit held-key + fuel mechanic a human uses** (no re-checking
  mid-drive, one re-aim after). The original reason - can't reach the
  true target at max effort (`AI_UNREACHABLE_THRESHOLD`) - drives toward
  the opponent for the rest of the turn's fuel, fuel-gated only
  (`store.bot.moveTimer = null`). The newer reason - the opponent's last
  shot (`store.lastImpact[opp.idx]`) landed within `evadeTriggerDistPx`,
  checked and rolled (`evadeChance`) *before* the reachability check in
  `startBotTurn()` - flees away from that impact point for a *sampled
  distance*, not until fuel runs out: `dist = lerp(evadeDistMin,
  evadeDistMax, Math.random()²)`. Squaring a uniform sample biases it
  toward `evadeDistMin` with an occasional roll toward `evadeDistMax` -
  "usually a bit, sometimes a lot more," not a flat or symmetric spread.
  That distance is converted to a duration via the mover's own
  `moveSpeed` and stored in `store.bot.moveTimer`; `runBot()` ends the
  "moving" phase on fuel-empty OR timer-expired, whichever comes first -
  one phase, one optional field, not two state machines. `main.js:
  update()` gates the shared movement code with `!p.isBot ||
  store.bot.phase === "moving"` specifically so a stray held-key state
  can't reposition the bot's tank during its post-aim "waiting to fire"
  pause.
- **`hard`'s `evadeChance` is 0.75 - higher than medium's 0.6, not
  zeroed.** It was originally 0 (hard was meant to be the flat-Gaussian,
  original-model bot with no adaptive layer at all), but a bench batch
  (`bench/run.js --matchup hard:hard --matches 100`) showed that with
  `evadeChance: 0`, hard bots never moved once in 100 matches - `distance`
  was logged as *exactly* `PLAYER_SPACING` (1200px) on every single shot,
  since neither side ever repositions and `AI_UNREACHABLE_THRESHOLD` never
  triggers at that range. That reads as "a static target with perfect
  aim," not "a harder opponent" - it never forces the human to re-aim
  mid-round the way a moving target does. Raising `evadeChance` (while
  leaving `aimStdDev`/`rangeNoiseFloorMult`/`confidenceNoiseFloorMult`
  untouched - hard's *precision* is still what should carry the
  difficulty) makes hard flee a nearby impact about as often as medium,
  giving the human something to actually react to, on top of - not
  instead of - hard's tighter aim. Don't zero this back out without
  re-running the bench to confirm hard bots are moving at all.
- **Bot difficulty is one shared table, not per-level code paths -
  including the new adaptive behavior above.** (`AI_LEVELS` in
  `constants.js`: `easy`, `medium`, `hard`.) Every knob introduced by the
  range/confidence/evade mechanics is a multiplier or a chance, and each
  level's `aimStdDev` is the thing that actually carries the difficulty
  ladder (`easy` 180 → `medium` 90 → `hard` 45 - each roughly halves the
  aim noise of the one before). `hard`'s range/confidence knobs are tuned
  as no-ops (`rangeNoiseFloorMult`/`confidenceNoiseFloorMult` at `1`) so
  it collapses to a flat Gaussian at its tight ceiling; `easy` and
  `medium` share the same range/confidence/evade shape (300/1200/0.65/
  120/0.75/0.6) - only the aim ceiling differs between them - so the
  precision axis stays the one deliberate differentiator and the
  adaptive-movement axis doesn't accidentally become a second one.
  `bot.js` never checks which level it's running; only the table values
  differ. `evadeChance` is *not* zeroed for hard (0.75, even higher than
  medium/easy's 0.6) - see the load-bearing note on evasive movement
  below for why a static, purely-precise hard bot turned out to be the
  wrong call. Bench-measured ladder (`bench/run.js --matchup
  easy:easy,medium:medium,hard:hard --matches 60`+): first-shot hit rate
  15.0% / 31.0% / 54.0%, overall hit rate 17.5% / 27.3% / 41.7%, avg
  turns-to-decide 17.2 / 11.7 / 8.0 - monotonic on every metric, which is
  the bar a future 4th level should also clear before shipping. Each
  active player slot picks its own level via `playerConfig.js` (an
  Easy/Medium/Hard toggle, built by iterating `["easy", "medium",
  "hard"]` so a new level is one array entry, shown only when that slot
  is set to Bot) - `p.aiLevel` lives on the player object like `p.isBot`,
  read once in `tanks.js: newTank()` from
  `store.gameConfig.players[idx].aiLevel`. That read is a whitelist
  against `AI_LEVELS` itself (`AI_LEVELS[cfg.aiLevel] ? cfg.aiLevel :
  "medium"`), not a hardcoded string comparison - the `easy` level was
  briefly a silent no-op (measuring identically to `medium`) because an
  earlier version of this line only special-cased `"hard"` and treated
  every other value, including `"easy"`, as `"medium"`. If you add a
  level to `AI_LEVELS`, re-check this line still resolves it instead of
  falling through. Like the Player/Bot mode toggle it sits next to, the
  difficulty choice does **not** persist across a page reload (only
  name/color do) - that's intentional, not a gap to fix, matching the
  existing mode toggle's behavior.
- **There's a headless simulation bench (`bench.html` + `bench/`) for
  tuning the bot AI with real numbers instead of eyeballing matches** -
  an internal tool Claude runs, not the user (see `bench/README.md`).
  It drives the *actual* `main.js: startMatch()`/`update()` (both now
  exported for exactly this reason) directly - no reimplemented physics
  or AI - so results reflect the real game. Speed comes from two
  sources, neither of which is a simplification of the simulation
  itself: real `setTimeout` pacing (tank-select reveal delays) is
  patched to fire on the next tick for the batch's duration, and matches
  are driven by calling `update(dt)` in a tight loop with a `dt` the
  bench chooses (small during `"flight"` for physics accuracy, larger
  while only a countdown timer is ticking) instead of real
  `requestAnimationFrame` time. `js/bot.js` and `js/combat.js` each
  contain a couple of `if (window.__BENCH__) ...` hooks that log
  per-shot/per-move data - `window.__BENCH__` is only ever defined by
  `bench/benchRunner.js`, which only `bench.html` loads, so these are
  true no-ops (one `if` check) for every real player on `index.html`.
  Don't strip them as dead code, and don't move the actual decision
  logic they read (distance, memory/confidence state, the evade dice
  roll) into the hooks themselves - they only ever read values the
  surrounding function already computed for its own purposes.

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
  (currently `party-tanks-v16`). **Bump this version any time you change
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
- **Map size multiplier** (`MAP_SIZE_MULTIPLIER` in `constants.js`) is
  fixed at `1.0` — there's no Small/Large selector yet, though
  `computeArenaLayout()` already reads this constant so wiring one up is
  mostly a UI task.
- **Bot/AI opponents**: player slots 3-7 are still visibly present but
  disabled (no >2-player support yet). Slots 0-1 support a real Bot
  toggle plus an Easy/Medium/Hard difficulty toggle (`AI_LEVELS` in
  `constants.js`) - see the load-bearing decisions above for how the
  levels differ. Adding a level is mostly a new table entry
  (`playerConfig.js`'s toggle already builds its buttons by iterating
  `["easy", "medium", "hard"]`, so a 4th key just needs adding to that
  array) - but see the `tanks.js: newTank()` note below the `AI_LEVELS`
  table decision for a whitelist gotcha that bit the `easy` addition.
- **Tank type choice doesn't persist** across matches the way player
  name/color/wind level do - every match starts both players back at
  `newTank()`'s Trooper default and re-runs the full `tankSelect.js` flow.
  Not an oversight; nothing has asked for a "remember my tank" shortcut
  yet, and picking is already a required, unskippable step every match.
