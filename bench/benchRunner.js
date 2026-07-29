// In-page driver for the AI-tuning simulation bench. Only ever loaded by
// bench.html (never by the real index.html) - see bench/README.md for
// what this is and how to run it. Exposes window.__BENCH__, which
// js/bot.js and js/combat.js also read (guarded, so they're no-ops for
// real players) to log per-shot/per-move data - see CLAUDE.md's
// load-bearing decision on the simulation bench.
import { store } from "../js/store.js";
import { MAPS, WIND_LEVELS, COLOR_PALETTE } from "../js/constants.js";
import { startMatch, update } from "../js/main.js";

var nativeSetTimeout = window.setTimeout.bind(window);
var nativeRandom = Math.random.bind(Math);

function nativeDelay(ms) {
  return new Promise(function (resolve) { nativeSetTimeout(resolve, ms); });
}

// Every real setTimeout in the game (tank-select pacing in
// js/tankSelect.js, the toast auto-hide in js/ui.js) collapses to "next
// tick" for the duration of a batch, so the exact same code path runs
// without actually waiting real wall-clock time. Restored after the
// batch via a native reference captured above, before any patching.
function patchTimeouts() {
  window.setTimeout = function (fn) { return nativeSetTimeout(fn, 0); };
}
function unpatchTimeouts() {
  window.setTimeout = nativeSetTimeout;
}

// mulberry32 - tiny, fast, good enough for "make an A/B tuning comparison
// use the same terrain/tank-pick/wind/aim-noise sequence on both runs",
// not for anything security-sensitive.
function mulberry32(seed) {
  var s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function patchRandom(seed) { Math.random = mulberry32(seed); }
function unpatchRandom() { Math.random = nativeRandom; }

async function waitUntil(predicate, maxTicks) {
  for (var i = 0; i < maxTicks; i++) {
    if (predicate()) return true;
    await nativeDelay(0);
  }
  return predicate();
}

// dt the bench chooses for each update() call - small and physics-accurate
// during bullet flight (matches the real game's per-frame dt scale, so
// collision timing against terrain/scenery/tanks isn't affected), a bit
// coarser while a bot is driving/evading (position math is dt-exact
// regardless of step size, but a smaller step keeps movement distances
// close to what was actually planned), and large while nothing but a
// countdown timer is ticking (aim "thinking" pause, resolve's impact
// flash) since precision there doesn't matter at all.
function pickDt() {
  if (store.state === "flight") return 1 / 60;
  if (store.state === "aim" && store.bot.phase === "moving") return 0.1;
  return 1.0;
}

function driveMatchToCompletion(maxIters) {
  var lastState = store.state;
  for (var i = 0; i < maxIters; i++) {
    if (store.state === "gameover") return true;
    update(pickDt());
    if (store.state === "aim" && lastState !== "aim") {
      window.__BENCH__.currentTurnIndex++;
    }
    lastState = store.state;
  }
  return store.state === "gameover";
}

// levels: array of 2-4 aiLevel strings, one per bot - "Bot A".."Bot D".
// Note startMatch() shuffles store.gameConfig.players itself (that's the
// real N-player position/turn-order feature, not bench-specific), so
// which of these ends up store.players[0] varies match to match - see
// bench/analyze.js, which keys off aiLevel via match_start's recorded
// players list rather than assuming a fixed slot.
function setupPlayers(levels) {
  store.gameConfig.players = levels.map(function (level, i) {
    var c = COLOR_PALETTE[i];
    return { name: "Bot " + String.fromCharCode(65 + i), color: c.body, colorDark: c.dark, isBot: true, aiLevel: level };
  });
}

function setupMap(mapPolicy) {
  if (mapPolicy === "random") {
    store.mapIndex = Math.floor(Math.random() * MAPS.length);
    return;
  }
  var idx = -1;
  for (var i = 0; i < MAPS.length; i++) if (MAPS[i].key === mapPolicy) idx = i;
  store.mapIndex = idx >= 0 ? idx : 0;
}

function setupWind(windPolicy) {
  if (windPolicy === "random") {
    store.windLevelIndex = Math.floor(Math.random() * WIND_LEVELS.length);
    return;
  }
  var wanted = { none: "None", light: "Light", strong: "Strong" }[windPolicy] || windPolicy;
  var idx = -1;
  for (var i = 0; i < WIND_LEVELS.length; i++) if (WIND_LEVELS[i].name === wanted) idx = i;
  store.windLevelIndex = idx >= 0 ? idx : 1;
}

window.__BENCH__ = {
  log: [],
  pendingShot: null,
  currentMatchId: 0,
  currentTurnIndex: 0,

  logShot: function (entry) {
    entry.type = "shot";
    entry.matchId = window.__BENCH__.currentMatchId;
    entry.turnIndex = window.__BENCH__.currentTurnIndex;
    window.__BENCH__.log.push(entry);
    window.__BENCH__.pendingShot = entry;
  },

  logMove: function (entry) {
    entry.type = "move";
    entry.matchId = window.__BENCH__.currentMatchId;
    entry.turnIndex = window.__BENCH__.currentTurnIndex;
    window.__BENCH__.log.push(entry);
  },

  // config: { matchups: [{levels:["medium","hard"]}, ...] (2-4 levels per
  //           matchup), matchesPerMatchup,
  //           mapPolicy: "random"|mapKey, windPolicy: "random"|"none"|"light"|"strong",
  //           seed, maxTurnIters }
  runBatch: async function (config) {
    config = config || {};
    var matchups = config.matchups || [{ levels: ["medium", "medium"] }];
    var matchesPerMatchup = config.matchesPerMatchup || 10;
    var mapPolicy = config.mapPolicy || "random";
    var windPolicy = config.windPolicy || "random";
    var maxTurnIters = config.maxTurnIters || 50000;

    window.__BENCH__.log = [];
    var seeded = config.seed != null;
    if (seeded) patchRandom(config.seed);
    patchTimeouts();

    try {
      for (var mi = 0; mi < matchups.length; mi++) {
        var matchup = matchups[mi];
        for (var k = 0; k < matchesPerMatchup; k++) {
          window.__BENCH__.currentMatchId++;
          var matchId = window.__BENCH__.currentMatchId;
          window.__BENCH__.currentTurnIndex = 0;
          window.__BENCH__.pendingShot = null;

          setupPlayers(matchup.levels);
          setupMap(mapPolicy);
          setupWind(windPolicy);
          startMatch();

          var selected = await waitUntil(function () {
            return store.state === "aim" || store.state === "gameover";
          }, 2000);
          if (!selected) {
            window.__BENCH__.log.push({ type: "error", matchId: matchId, message: "tank selection never resolved" });
            continue;
          }
          window.__BENCH__.currentTurnIndex = 1;

          window.__BENCH__.log.push({
            type: "match_start",
            matchId: matchId,
            matchup: { levels: matchup.levels },
            mapKey: store.activeMap.key,
            mapName: store.activeMap.name,
            layoutName: store.currentLayoutName,
            windValue: store.wind,
            // Post-shuffle order (startMatch() shuffles store.gameConfig.players
            // itself to decide position/turn order) - idx here is each
            // player's actual in-match slot, not their position in
            // matchup.levels above.
            players: store.players.map(function (p) {
              return { idx: p.idx, aiLevel: p.aiLevel, tankType: p.tankType };
            })
          });

          var completed = driveMatchToCompletion(maxTurnIters);

          // Winner is whoever's still alive - works for any player count,
          // unlike inferring it from a single "the other one died" check.
          // null (a draw) is possible but rare - see combat.js: afterResolve().
          var winnerIdx = null;
          for (var wi = 0; wi < store.players.length; wi++) {
            if (store.players[wi].alive) { winnerIdx = wi; break; }
          }

          var shotsThisMatch = 0;
          for (var li = 0; li < window.__BENCH__.log.length; li++) {
            var e = window.__BENCH__.log[li];
            if (e.type === "shot" && e.matchId === matchId) shotsThisMatch++;
          }

          window.__BENCH__.log.push({
            type: "match_end",
            matchId: matchId,
            completed: completed,
            winnerIdx: winnerIdx,
            turns: window.__BENCH__.currentTurnIndex,
            totalShots: shotsThisMatch,
            finalHealth: store.players.map(function (p) { return p.health; })
          });
        }
      }
    } finally {
      unpatchTimeouts();
      if (seeded) unpatchRandom();
    }

    return window.__BENCH__.log;
  }
};
