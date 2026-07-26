// Tunable numbers for the whole game. Nothing here is ever reassigned at
// runtime - things that change per match (WORLD_W, playerStartXs, etc.)
// live in store.js instead.

export var PLAYER_SPACING = 1200; // world px between adjacent players at map-size 1x
export var WING_MARGIN = 500; // scenery/panning buffer beyond the outermost player, each side
export var MAP_SIZE_MULTIPLIER = 1.0; // future map-size selector (Small/Large) will drive this
export var ARENA_BUFFER = 300; // slack beyond the outermost player still treated as "the arena"

export var GRAVITY = 260; // px/s^2
export var MOVE_SPEED = 130; // px/s
export var FUEL_MAX = 100;
export var FUEL_PER_SEC = 22;
export var HEALTH_MAX = 100;
export var HIT_RADIUS = 26;
export var MIN_DAMAGE = 30; // grazing hit near the edge of HIT_RADIUS
export var MAX_DAMAGE = 70; // dead-center hit
export var SELF_DAMAGE_GRACE = 0.25; // seconds before a bullet can hit its own shooter
export var CRATER_RADIUS = 18; // world px
export var CRATER_DEPTH = 0.05; // fraction of VIEW_H

export var ANGLE_MIN = 5, ANGLE_MAX = 175;
export var ANGLE_RATE = 55; // deg/sec while held
export var POWER_MIN = 15, POWER_MAX = 100;
export var POWER_RATE = 45; // units/sec while held
export var POWER_TO_SPEED = 7.2; // maps power units -> initial bullet speed px/s

export var TANK_HALF_W = 20, TANK_HALF_H = 12;
export var BARREL_LENGTH = 26; // px, at scale 1 - shared by drawing and bullet spawn point
export var BARREL_PIVOT_Y = 4; // px above the tank's local origin where the barrel pivots
export var ZOOM_MIN = 0.5, ZOOM_MAX = 2.5;

export var TREE_BASE_HEIGHT = 40; // px at scale 1
export var TREE_CANOPY_FRAC = 0.52; // fraction of height above ground used as hit-circle center
export var TREE_RADIUS_FRAC = 0.30; // fraction of height used as hit-circle radius
export var TREE_FIRE_RADIUS = 34;
export var TREE_FIRE_DAMAGE = 25;
export var BURN_TURNS = 3;

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
export var ACTIVE_SLOTS = 2;
export var PLAYER_CONFIG_KEY = "partytanks.players.v1";
