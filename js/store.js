// Shared mutable game/world state. ES module bindings are read-only to
// importers, so anything that needs to be reassigned (not just mutated in
// place) lives as a property on this one exported object instead of as a
// separate exported variable - every module that needs it imports `store`
// and reads/writes its properties directly, e.g. `store.active = 1`.
export var store = {
  // Viewport, kept in sync by canvas.js's resizeCanvas().
  VIEW_W: 0,
  VIEW_H: 0,

  // Arena sizing, recomputed each match by main.js's computeArenaLayout().
  WORLD_W: 2200,
  playerStartXs: [],

  // Terrain.
  terrain: [],
  terrainMountains: [],
  currentLayoutName: "",

  // Scenery.
  trees: [],
  bgTrees: [],
  clouds: [],
  mountainSeed1: 0,
  mountainSeed2: 0,

  // Match/game.
  matchActive: false,
  players: null,
  active: 0,
  state: "aim", // aim | flight | resolve | gameover
  bullet: null,
  impactFlash: null, // {x, y, t, damageText}
  lastImpact: [null, null], // per-player last shot landing spot {x, y, hitTank}

  // Wind: constant for the whole round (currently the whole match, since
  // rounds are locked to 1). Signed magnitude in [-1, 1] - sign is
  // direction, |value| is strength - rolled once per round from the band
  // the selected windLevelIndex points at in WIND_LEVELS.
  wind: 0,
  windLevelIndex: 1, // overwritten by the persisted value on load (playerConfig.js)

  // Bot turn state (bot.js). Only one player ever acts at a time, so this
  // is a single shared slot, not per-player - reset each time a bot's
  // turn begins.
  bot: {
    active: false, // true for the whole duration of the bot's turn (any phase)
    phase: null, // null | "moving" | "waiting"
    waitTimer: 0, // seconds left in the "waiting" (thinking) phase before firing
    moveTimer: null // seconds left in a distance-capped "moving" phase (evasive move); null = no cap, just fuel-gated (reachability drive)
  },

  // Camera: camCenterX/Y is the world point shown at the center of the
  // screen; camZoom scales world units to screen pixels.
  camCenterX: 0,
  camCenterY: 0,
  camZoom: 1,
  activePointers: {}, // pointerId -> {x, y}
  gestureMode: null, // null | 'pan' | 'pinch'
  dragStartX: 0,
  dragStartY: 0,
  dragStartCamX: 0,
  dragStartCamY: 0,
  pinchStartDist: 1,
  pinchStartZoom: 1,
  pinchAnchorWorldX: 0,
  pinchAnchorWorldY: 0,

  // Press-and-hold control state, keyed by control name (left/right/
  // angleLeft/angleRight/powerUp/powerDown).
  held: {},

  // Player setup (persisted names/colors + the config actually applied
  // to the current match).
  playerConfigs: [],
  gameConfig: { players: [] },

  toastTimeoutHandle: null,
  lastT: null
};
