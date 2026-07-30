// Tunable numbers for the whole game. Nothing here is ever reassigned at
// runtime - things that change per match (WORLD_W, playerStartXs, etc.)
// live in store.js instead.

export var PLAYER_SPACING = 800; // world px between adjacent players at map-size 1x - 2/3 of the original 1200, the map felt too big
export var WING_MARGIN = 500; // scenery/panning buffer beyond the outermost player, each side
export var MAP_SIZE_MULTIPLIER = 1.0; // future map-size selector (Small/Large) will drive this
export var ARENA_BUFFER = 300; // slack beyond the outermost player still treated as "the arena"

export var GRAVITY = 260; // px/s^2
export var WIND_MAX_ACCEL = 80; // px/s^2 horizontal accel on the bullet at wind magnitude 1.0 - noticeably bends trajectories without overpowering GRAVITY
export var WIND_LEVELS = [
  { name: "None", min: 0, max: 0 },
  { name: "Light", min: 0.15, max: 0.45 },
  { name: "Strong", min: 0.5, max: 1.0 }
];
export var WIND_LEVEL_KEY = "partytanks.windLevel.v1";
export var FUEL_MAX = 100; // shared by all tank types; only drain RATE varies per type
export var SELF_DAMAGE_GRACE = 0.25; // seconds before a bullet can hit its own shooter
export var CRATER_RADIUS = 18; // world px
export var CRATER_DEPTH = 0.05; // fraction of VIEW_H

export var ANGLE_MIN = 5, ANGLE_MAX = 175;
export var ANGLE_RATE = 55; // deg/sec while held
export var POWER_MIN = 15, POWER_MAX = 100;
export var POWER_RATE = 45; // units/sec while held
export var POWER_TO_SPEED = 7.2; // maps power units -> initial bullet speed px/s

export var ZOOM_MIN = 0.5, ZOOM_MAX = 2.5;

// ---------- Tank types ----------
// Each entry is a complete stat + art-anchor block for one selectable tank.
// hitHalfWidth/hitHeight define an axis-aligned hit BOX anchored at ground
// level (not a circle - see CLAUDE.md's load-bearing decisions for why).
// barrelPivotX/Y is the barrel's pivot point in the tank's own "facing
// right" local frame (mirrored via dir when actually drawn/fired), and
// barrelLength/barrelWidth/collar/muzzle drive both the drawn barrel and
// the bullet spawn point identically, same principle as the old shared
// BARREL_LENGTH/BARREL_PIVOT_Y constants, just per type now.
export var TANK_TYPES = [
  {
    key: "trooper",
    name: "Trooper",
    blurb: "Balanced all-rounder.",
    healthMax: 100,
    moveSpeed: 130,
    fuelPerSec: 22,
    minDamage: 30,
    maxDamage: 70,
    hitHalfWidth: 24,
    hitHeight: 28,
    barrelPivotX: -2,
    barrelPivotY: 24,
    barrelLength: 23,
    barrelWidth: 3.2,
    collar: true,
    muzzle: false
  },
  {
    key: "jumper",
    name: "Jumper",
    blurb: "Fast & evasive, fragile.",
    healthMax: 80,
    moveSpeed: 160,
    fuelPerSec: 18,
    minDamage: 30,
    maxDamage: 70,
    hitHalfWidth: 17,
    hitHeight: 56,
    barrelPivotX: 9,
    barrelPivotY: 45,
    barrelLength: 16,
    barrelWidth: 2.4,
    collar: false,
    muzzle: false
  },
  {
    key: "juggernaut",
    name: "Juggernaut",
    blurb: "Slow & big, hits hard.",
    healthMax: 100,
    moveSpeed: 100,
    fuelPerSec: 26,
    minDamage: 40,
    maxDamage: 85,
    hitHalfWidth: 26,
    hitHeight: 33,
    barrelPivotX: -7,
    barrelPivotY: 29,
    barrelLength: 26,
    barrelWidth: 4.6,
    collar: true,
    muzzle: true
  }
];

// ---------- Tank selection ----------
export var TANK_SELECT_BOT_LOOK_MS = 700; // bot: how long its box stays on screen, camera already centered on it, before the pick+reveal fires
export var TANK_SELECT_REVEAL_DELAY_MS = 900; // both: how long the just-revealed tank stays on screen before advancing/panning to the next player (or finishing)

// ---------- Scenery types ----------
// One entry per placeable scenery item (scenery.js), the same "one shared
// table" pattern as TANK_TYPES. baseHeight/canopyFrac/radiusFrac define
// the hit-circle collision (see scenery.js/main.js/bot.js - all three
// derive tH/canopyY/radius from these three fields identically, so
// changing them here changes collision and drawn size together).
// burnable: false means a bullet hit just blocks/leaves an impact mark -
// the item stays "alive" forever and never enters "burning"/"ash" (see
// main.js's flight-state collision branch, which only assigns
// "burning" when the active map's scenery type allows it).
export var SCENERY_TYPES = {
  pineTree: {
    name: "Pine Tree",
    baseHeight: 80, // px at scale 1 - deliberately taller than any tank's hitHeight so trees are viable to hide behind
    canopyFrac: 0.52,
    radiusFrac: 0.30,
    burnable: true
  },
  cactus: {
    name: "Cactus",
    baseHeight: 65,
    canopyFrac: 0.50,
    radiusFrac: 0.22, // narrower than a pine's canopy - a slender saguaro silhouette
    burnable: false
  },
  autumnTree: {
    name: "Autumn Tree",
    baseHeight: 78,
    canopyFrac: 0.62, // a round canopy sits higher relative to height than pine's stacked triangles
    radiusFrac: 0.42, // wider than pine (0.30) - a broad round canopy, not a spike
    burnable: true
  },
  junkPile: {
    name: "Junk Pile",
    baseHeight: 60,
    canopyFrac: 0.48,
    radiusFrac: 0.34,
    burnable: false,
    // Ambient sparks fire occasionally from every alive (i.e. always, since
    // this type never burns) item of this type, regardless of turn/game
    // state - see scenery.js: updateSceneryEffects(). Purely cosmetic, same
    // "always-on background life" idea as a wreck's ongoing smoke/sparks,
    // just on scenery instead of a destroyed tank.
    ambientSpark: true
  }
};

export var SCENERY_FIRE_RADIUS = 34;
export var SCENERY_FIRE_DAMAGE = 25;
export var BURN_TURNS = 3;

// ---------- Maps ----------
// One entry per selectable map. Terrain SHAPE (generateTerrain's rolling
// hills + mountain archetypes in terrain.js) is intentionally shared by
// every map - only palette (ground/sky/background) and which scenery
// type populates it vary here. A map with a genuinely different terrain
// shape (flat rooftops, hazards you can fall/drown in, etc.) is a bigger
// change than this table supports today - don't force one in here
// without redesigning terrain.js's generator to be pluggable per map.
//
// bgLayers is an ARRAY, drawn back-to-front in order - any number of
// layers, not a fixed pair - each one independently parallaxed
// (background.js: drawBackground() loops it, pairing store.mountainSeeds[i]
// with each layer index). Every layer needs `shape` (one of "mountains" /
// "pyramids" / "treeLine" / "skyline" / "fence"), `parallax` (0 = fixed to
// the sky, higher = moves faster while panning), `alpha`, `color`, and
// `baseYFrac` (fraction of VIEW_H the shape's base sits at - lower
// fraction = higher up/further away, matching that farther layers should
// sit higher on screen than nearer ones). "mountains" additionally needs
// `ampFrac`/`freq1`/`freq2` (peak height/wobble - a low ampFrac + high
// freq reads as a dense low hedge, not just a mountain range, so "hedge"
// isn't a separate shape) and optional `withDecor` (draws store.bgTrees
// pine silhouettes on the ridge - forest-specific, leave off elsewhere).
// "pyramids" additionally needs `count`. "treeLine" (background.js:
// drawTreeLineLayer) draws store.bgOrchardTrees - a scattered row of
// round autumn-canopy clusters - and needs nothing extra beyond the
// shared fields. "skyline" (drawSkylineLayer) needs `count` (building
// count) and `windowColor`, drawing store.bgSkylineSets[layerIndex] - a
// map can use it twice (far/near) for a layered city depth effect, each
// with its own independently-generated buildings. "fence" (drawFenceLayer)
// is fully procedural (evenly-spaced posts + a sagging wire, no generated
// array needed) and needs nothing extra beyond the shared fields.
export var MAPS = [
  {
    key: "chillForest",
    name: "Chill Forest",
    scenery: "pineTree",
    sky: { dark: [0x22, 0x34, 0x5c], top: [0x7f, 0xa8, 0xcf], bot: [0xc9, 0xdc, 0xed] },
    ground: {
      surfaceTop: "#7a5636", surfaceMid: "#5c3f26", surfaceDeep: "#241811",
      crustTop: "#68c751", crustBottom: "#2f7a34", detailColor: "#2f7a34"
    },
    bgLayers: [
      { shape: "mountains", parallax: 0.12, alpha: 0.22, color: "#7793ab", baseYFrac: 0.62, ampFrac: 0.20, freq1: 0.0021, freq2: 0.006 },
      { shape: "mountains", parallax: 0.28, alpha: 0.32, color: "#5c7a99", baseYFrac: 0.72, ampFrac: 0.15, freq1: 0.004, freq2: 0.011, withDecor: true }
    ]
  },
  {
    key: "desert",
    name: "Desert Dunes",
    scenery: "cactus",
    sky: { dark: [0x0a, 0x14, 0x38], top: [0x1b, 0x3c, 0x78], bot: [0x6f, 0x99, 0xc9] },
    ground: {
      surfaceTop: "#d9b25c", surfaceMid: "#a97c34", surfaceDeep: "#4a3015",
      crustTop: "#e8cd82", crustBottom: "#c9a24a", detailColor: "#9a7530"
    },
    bgLayers: [
      { shape: "mountains", parallax: 0.12, alpha: 0.22, color: "#8a6a42", baseYFrac: 0.62, ampFrac: 0.20, freq1: 0.0021, freq2: 0.006 },
      { shape: "pyramids", parallax: 0.22, alpha: 0.6, color: "#caa25c", baseYFrac: 0.70, count: 3 }
    ]
  },
  {
    key: "autumnOrchard",
    name: "Autumn Orchard",
    scenery: "autumnTree",
    sky: { dark: [0x2e, 0x22, 0x3c], top: [0x8f, 0x6e, 0x84], bot: [0xf2, 0xc9, 0xa8] },
    ground: {
      surfaceTop: "#8a5a34", surfaceMid: "#6b4322", surfaceDeep: "#2e1d10",
      crustTop: "#c9962e", crustBottom: "#9a6f1e", detailColor: "#9a6f1e"
    },
    // Four layers, not the usual two, deliberately more ambitious than
    // the other maps' backgrounds: a barely-moving haze ridge, gentler/
    // rounder rolling hills than a mountain range, a treeLine layer of
    // orchard canopies, and a fast, low, dense "hedge" - which is just
    // the mountains shape with tiny ampFrac + high freq, not a new shape.
    bgLayers: [
      { shape: "mountains", parallax: 0.06, alpha: 0.14, color: "#a98fa0", baseYFrac: 0.58, ampFrac: 0.10, freq1: 0.0018, freq2: 0.005 },
      { shape: "mountains", parallax: 0.16, alpha: 0.30, color: "#b5622e", baseYFrac: 0.66, ampFrac: 0.11, freq1: 0.0016, freq2: 0.004 },
      { shape: "treeLine", parallax: 0.25, alpha: 0.7, color: "#d9822e", baseYFrac: 0.735 },
      { shape: "mountains", parallax: 0.36, alpha: 0.42, color: "#8a4a22", baseYFrac: 0.775, ampFrac: 0.018, freq1: 0.03, freq2: 0.07 }
    ]
  },
  {
    key: "neonScrapyard",
    name: "Neon Scrapyard",
    scenery: "junkPile",
    sky: { dark: [0x05, 0x04, 0x10], top: [0x22, 0x10, 0x30], bot: [0x4a, 0x1f, 0x3a] },
    ground: {
      surfaceTop: "#3a3a42", surfaceMid: "#242429", surfaceDeep: "#0c0c0f",
      // crustTop/crustBottom form the usual gradient band (terrain.js
      // reuses the exact same grass-band rendering, just recolored) - here
      // it reads as a glowing pink edge strip instead of grass; detailColor
      // recolors the scattered tuft ticks cyan, so the two neon accent
      // colors both show up in the terrain itself, not just the background.
      crustTop: "#ff2ea6", crustBottom: "#7a1258", detailColor: "#5be8ff"
    },
    // A night map: a barely-visible magenta smog haze, two independently-
    // generated skyline layers (far dim/cool, near bright/warm) for real
    // city depth rather than one recolored copy, and a chain-link fence
    // right at the terrain line - the most background-code-heavy map yet
    // (two genuinely new shapes, not just mountains re-tuned).
    bgLayers: [
      { shape: "mountains", parallax: 0.05, alpha: 0.16, color: "#7a3a6a", baseYFrac: 0.55, ampFrac: 0.08, freq1: 0.0015, freq2: 0.004 },
      { shape: "skyline", parallax: 0.14, alpha: 0.6, color: "#1c1622", baseYFrac: 0.70, windowColor: "#7adcff", count: 16 },
      { shape: "skyline", parallax: 0.26, alpha: 0.9, color: "#120c16", baseYFrac: 0.77, windowColor: "#ff4fc4", count: 9 },
      { shape: "fence", parallax: 0.42, alpha: 0.85, color: "#1a1a1e", baseYFrac: 0.80 }
    ]
  }
];
export var MAP_KEY = "partytanks.map.v1";

export var COLOR_PALETTE = [
  { name: "Red", body: "#d1432c", dark: "#8a2a1a" },
  { name: "Blue", body: "#2f7fd1", dark: "#1e578f" },
  { name: "Green", body: "#3fae4a", dark: "#276b2e" },
  { name: "Purple", body: "#8a4fd1", dark: "#5a3389" },
  { name: "Orange", body: "#e08a2e", dark: "#95591a" },
  { name: "Yellow", body: "#d1c22f", dark: "#8a7f1e" },
  { name: "Teal", body: "#2fb5ab", dark: "#1c716a" },
  { name: "Pink", body: "#d1478f", dark: "#8a2e5c" }
];
export var PLAYER_SLOTS = 7;
export var ACTIVE_SLOTS = 4; // up to 4 players in a free-for-all; each slot is Human/Bot/Off
export var PLAYER_CONFIG_KEY = "partytanks.players.v1";

// ---------- Bot AI ----------
// Dry-run trajectory search (bot.js) - how finely it grid-searches
// angle/power before firing. Not a difficulty knob, just a speed/accuracy
// tradeoff for the search itself.
export var AI_SIM_DT = 1 / 30; // seconds per simulated step
export var AI_SIM_MAX_TIME = 8; // seconds - safety cutoff per simulated shot
export var AI_COARSE_ANGLE_STEPS = 18;
export var AI_COARSE_POWER_STEPS = 15;
export var AI_REFINE_STEPS = 10; // per-axis resolution of the refine pass around the coarse best
export var AI_UNREACHABLE_THRESHOLD = 120; // px - beyond this miss distance at max effort, the bot drives closer instead of firing

// Difficulty presets - one shared code path in bot.js for all three; every
// behavioral difference between them is a parameter value here, not a
// branch. "hard" is deliberately tuned so its range/confidence knobs are
// no-ops (rangeNoiseFloorMult/confidenceNoiseFloorMult at 1 = no effect),
// which collapses aim to exactly the original flat-Gaussian model - only
// aimStdDev itself carries hard's extra precision. See CLAUDE.md's
// load-bearing decisions for the reasoning behind each knob - short
// version: aimStdDev/thinkDelay* are unchanged from the original model;
// the range/confidence/evade knobs are an adaptive layer on top.
export var AI_LEVELS = {
  easy: {
    aimStdDev: 180,            // 2x medium's ceiling. Bench-measured (bench/run.js --matchup
    // easy:easy --matches 60): 15.0% first-shot hit rate, 17.5% overall, 17.2 turns/match,
    // avg 4.66 shots to first hit - a clean step down from medium's 31.0%/27.3%/11.7/2.69 and
    // hard's 54.0%/41.7%/8.0/1.65, so the three levels form a monotonic ladder on every metric.
    // Re-measure the same way before retuning this.
    thinkDelayMin: 0.5,
    thinkDelayMax: 1.2,
    rangeNearPx: 300,
    rangeFarPx: 1200,
    rangeNoiseFloorMult: 0.65, // same adaptive shape as medium - aimStdDev is what should carry
    recalibrateDistPx: 120,    // the difficulty difference, not a different response to range/
    confidenceNoiseFloorMult: 0.75, // confidence/threat, so these match medium's values.
    evadeChance: 0.6,          // same as medium, for the same reason (see CLAUDE.md's note on
    evadeTriggerDistPx: 180,   // why hard's evadeChance was raised rather than left at 0 - the
    evadeDistMin: 40,          // point is a moving target regardless of aim tier).
    evadeDistMax: 350
  },
  medium: {
    aimStdDev: 90,             // px - stddev ceiling of the Gaussian-perturbed aim point around the opponent
    // Doubled from the original 45 after measuring real bot-vs-bot play
    // (25 matches, 204 logged shots): first shots (full ceiling, no
    // memory) were landing directly on the opponent 46% of the time -
    // basically just what a flat 45px stddev produces against a ~17-26px
    // hit-box half-width, unrelated to the range/confidence knobs below.
    // At 90, the same measurement model predicts ~24% - closer to "an
    // exploratory guess that occasionally gets lucky" than "usually
    // right." Don't lower this back toward 45 without re-measuring
    // first-shot hit rate the same way (js/bot.js: beginAimAndWait(),
    // instrument a shot log the way this measurement did).
    thinkDelayMin: 0.5,        // seconds of "thinking" pause before committing to a shot
    thinkDelayMax: 1.2,
    rangeNearPx: 300,          // at or below this shooter-opponent distance, noise is at its floor
    rangeFarPx: 1200,          // at or above this distance, noise is at its full (aimStdDev) ceiling
    rangeNoiseFloorMult: 0.65, // noise multiplier at rangeNearPx or closer
    recalibrateDistPx: 120,    // opponent displacement (since this shooter's last shot) that fully resets confidence
    confidenceNoiseFloorMult: 0.75, // noise multiplier when the opponent hasn't moved at all since last shot
    // These two floors compound multiplicatively (close AND confident applies
    // both), so tune them together. Important caveat from the same
    // measurement pass: real matches almost never bring shooters within
    // rangeFarPx of each other (median observed distance was ~1300px,
    // 99.5% of shots were beyond 700px) - the range floor is honest about
    // what it does, but in practice confidence (not range) is the knob
    // that's actually active most of the time.
    evadeChance: 0.6,          // odds of fleeing instead of aiming, when the opponent's last shot landed close
    evadeTriggerDistPx: 180,   // "close" threshold for the above
    evadeDistMin: 40,          // px - most evasive moves are small...
    evadeDistMax: 350          // ...but occasionally much bigger (see startBotTurn's squared-uniform sample)
  },
  hard: {
    aimStdDev: 45,
    thinkDelayMin: 0.5,
    thinkDelayMax: 1.2,
    rangeNearPx: 300,
    rangeFarPx: 1200,
    rangeNoiseFloorMult: 1.0,  // no range effect - always full noise, like the original model
    recalibrateDistPx: 120,
    confidenceNoiseFloorMult: 1.0, // no confidence effect - never gets more precise from memory
    evadeChance: 0.75,         // higher than medium's 0.6 - a bench run (100v100) showed hard
    // bots never move at all (evadeChance was 0), landing at exactly the map's spawn
    // distance shot after shot with no repositioning. Hard keeps its full aim precision
    // (aimStdDev/confidence/range knobs above are unchanged) but now flees a fixed-position
    // shot almost as often as medium - the precision is what should make hard feel harder,
    // not a static target. Don't lower this back toward 0 without a reason; see CLAUDE.md.
    evadeTriggerDistPx: 180,
    evadeDistMin: 40,
    evadeDistMax: 350
  }
};

// ---------- Wreckage effects ----------
// Purely cosmetic (no gameplay effect) - a destroyed tank keeps smoking
// and sparking for the rest of the match. See tanks.js: initWreck() /
// updateWreckEffects() / drawWreckEffects().
export var WRECK_SMOKE_INTERVAL_MIN = 0.15, WRECK_SMOKE_INTERVAL_MAX = 0.35;
export var WRECK_SMOKE_LIFE_MIN = 1.4, WRECK_SMOKE_LIFE_MAX = 2.4;
export var WRECK_SMOKE_RISE_SPEED = 18; // px/s upward, before per-puff randomization
export var WRECK_SMOKE_MAX = 14; // safety cap on concurrent puffs per wreck
export var WRECK_SPARK_INTERVAL_MIN = 0.06, WRECK_SPARK_INTERVAL_MAX = 0.18;
export var WRECK_SPARK_LIFE_MIN = 0.15, WRECK_SPARK_LIFE_MAX = 0.35;
export var WRECK_SPARK_MAX = 5; // safety cap on concurrent sparks per wreck

// ---------- Elimination explosion ----------
// The one-time kill burst (flash + black smoke + falling debris pixels)
// plus the camera-hold beat around it. See CLAUDE.md's load-bearing
// decision on the elimination sequence; combat.js/main.js drive the
// state machine (store.state === "eliminated"), tanks.js owns the burst
// particles (spawnExplosion(), folded into updateWreckEffects()/
// drawWreckEffects() alongside the ongoing wreck smoke/sparks above).
export var ELIMINATION_PRE_EXPLOSION_DELAY = 0.45; // seconds the camera holds zoomed-in on the tank, nothing happening yet, before the explosion actually starts
export var ELIMINATION_HOLD_TIME = 1.8; // seconds the camera stays locked on the wreck AFTER the explosion starts, before handing off to the next turn
export var ELIMINATION_ZOOM = ZOOM_MAX * 0.9; // "almost to the max" punch-in for the hold, restored to whatever camZoom was beforehand once it ends
// The shared "blast" - flash + black smoke + falling debris pixels - reused
// by every EXPLOSION_KINDS entry below, just scaled by that kind's
// blastScale (see tanks.js: buildBlast()). These base numbers are the
// "classic" kind's actual values (blastScale 1).
export var EXPLOSION_FLASH_TIME = 0.3;
export var EXPLOSION_SMOKE_COUNT = 7;
export var EXPLOSION_SMOKE_LIFE_MIN = 0.7, EXPLOSION_SMOKE_LIFE_MAX = 1.3;
export var EXPLOSION_DEBRIS_COUNT = 14;
export var EXPLOSION_DEBRIS_LIFE_MIN = 0.9, EXPLOSION_DEBRIS_LIFE_MAX = 1.6;
export var EXPLOSION_DEBRIS_GRAVITY = 220; // px/s^2 - independent of the bullet's GRAVITY so it's tunable separately

// "sparks" kind's pre-blast phase: a violent, continuous shower of hot
// pixel sparks launched OUT of the tank at high speed (not a gentle rain
// down to the ground - see EXPLOSION_SPARK_SPRAY_ANGLE_MIN/MAX below),
// spawned in quick little batches for the whole pre-phase (not one static
// puff) so it reads as an ongoing spray that the blast then cuts off.
export var EXPLOSION_SPARK_SPRAY_BATCH_SIZE = 2; // sparks spawned per origin each spawn tick
export var EXPLOSION_SPARK_SPRAY_SPAWN_INTERVAL_MIN = 0.035, EXPLOSION_SPARK_SPRAY_SPAWN_INTERVAL_MAX = 0.06;
export var EXPLOSION_SPARK_SPRAY_LIFE_MIN = 0.25, EXPLOSION_SPARK_SPRAY_LIFE_MAX = 0.5;
export var EXPLOSION_SPARK_SPRAY_GRAVITY = 380; // px/s^2 - arcs the flight, doesn't bring sparks to rest (they fade out via life first)
// Launch angle measured up from horizontal, mirrored per side by spawnSparkBatch()'s
// `side` - 20-85deg covers everywhere from "shoots out to the side" to
// "shoots almost straight up above the tank", deliberately excluding
// anything angled downward.
export var EXPLOSION_SPARK_SPRAY_ANGLE_MIN = 20, EXPLOSION_SPARK_SPRAY_ANGLE_MAX = 85;
export var EXPLOSION_SPARK_SPRAY_SPEED_MIN = 110, EXPLOSION_SPARK_SPRAY_SPEED_MAX = 260; // px/s - high velocity, dramatic pre-blast burst

// "wave" kind's pre-blast phase: a single expanding white pressure-wave
// ring, before a bigger-than-normal shared blast (see EXPLOSION_KINDS.wave
// below) takes over.
export var EXPLOSION_WAVE_MAX_RADIUS = 75; // world px

// One shared table (same pattern as TANK_TYPES/AI_LEVELS/MAPS) - a new
// explosion kind is a new entry here plus, if it needs a genuinely new
// pre-blast visual, one pre-phase builder/updater/drawer trio in tanks.js
// (see spawnExplosion()'s preKind dispatch) - never a new bespoke full
// explosion implementation, since all three kinds end in the exact same
// shared blast. spawnExplosion() picks one of these keys at random per
// kill unless told otherwise.
export var EXPLOSION_KINDS = {
  classic: { preKind: null, preDuration: 0, blastScale: 1 },
  // Long enough for the continuous spark rain to read as "for a moment",
  // cut off by the blast starting.
  sparks: { preKind: "sparks", preDuration: 0.55, blastScale: 1 },
  // Short - the wave should land almost the same instant as the (bigger)
  // blast, not with a noticeable pause between them.
  wave: { preKind: "wave", preDuration: 0.12, blastScale: 1.45 }
};
export var EXPLOSION_KIND_KEYS = Object.keys(EXPLOSION_KINDS);
