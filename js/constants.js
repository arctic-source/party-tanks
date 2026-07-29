// Tunable numbers for the whole game. Nothing here is ever reassigned at
// runtime - things that change per match (WORLD_W, playerStartXs, etc.)
// live in store.js instead.

export var PLAYER_SPACING = 1200; // world px between adjacent players at map-size 1x
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
// bgBack is always the far mountain-silhouette layer (background.js:
// drawMountainLayer, just recolored per map); bgFront can instead use
// shape:"pyramids" (background.js: drawPyramidLayer) for a map that
// wants a visually distinct near background layer.
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
    bgBack: { color: "#7793ab" },
    bgFront: { shape: "mountains", color: "#5c7a99", withDecor: true }
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
    bgBack: { color: "#8a6a42" },
    bgFront: { shape: "pyramids", color: "#caa25c", count: 3 }
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
export var ELIMINATION_HOLD_TIME = 1.8; // seconds the camera stays locked on the kill before handing off to the next turn
export var ELIMINATION_ZOOM = ZOOM_MAX * 0.9; // "almost to the max" punch-in for the hold, restored to whatever camZoom was beforehand once it ends
export var EXPLOSION_FLASH_TIME = 0.3;
export var EXPLOSION_SMOKE_COUNT = 7;
export var EXPLOSION_SMOKE_LIFE_MIN = 0.7, EXPLOSION_SMOKE_LIFE_MAX = 1.3;
export var EXPLOSION_DEBRIS_COUNT = 14;
export var EXPLOSION_DEBRIS_LIFE_MIN = 0.9, EXPLOSION_DEBRIS_LIFE_MAX = 1.6;
export var EXPLOSION_DEBRIS_GRAVITY = 220; // px/s^2 - independent of the bullet's GRAVITY so it's tunable separately
