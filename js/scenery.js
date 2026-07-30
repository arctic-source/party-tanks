import { store } from "./store.js";
import { ARENA_BUFFER, SCENERY_TYPES } from "./constants.js";
import { randRange, randInt, pseudoRandom } from "./utils.js";
import { ctx } from "./canvas.js";
import { terrainHeightAt } from "./terrain.js";

// One scenery item's shape is generic (x/state/scale) - which item TYPE
// it actually is (pine tree, cactus, ...) comes entirely from the active
// map's `scenery` key (constants.js: MAPS), looked up at draw/collision
// time, not stored per-item. A single match only ever has one scenery
// type on the ground at once.
export function makeSceneryItem(x) {
  return {
    x: x, state: "alive", burnTurnsLeft: 0, scale: 0.95 + Math.random() * 0.55,
    // Only meaningful for a type with SCENERY_TYPES[key].ambientSpark set
    // (currently just junkPile) - harmless, unused arrays/timers on every
    // other map's items, same "cheap to allocate regardless" convention
    // as the background generators below.
    sparks: [], sparkTimer: randRange(1, 3)
  };
}

// Circle-hit test against every currently-alive scenery item, at a single
// point in world space. Shared by the real bullet flight resolution
// (main.js) and the bot's dry-run flight simulator (bot.js) - those two
// used to hand-duplicate this exact collision math, which meant a change
// to the collision shape in one could silently drift from the other.
// Returns the hit item, or null.
export function sceneryHitAt(x, y) {
  var sceneryType = SCENERY_TYPES[store.activeMap.scenery];
  for (var i = 0; i < store.scenery.length; i++) {
    var t = store.scenery[i];
    if (t.state !== "alive") continue;
    var h = sceneryType.baseHeight * t.scale;
    var canopyY = terrainHeightAt(t.x) - h * sceneryType.canopyFrac;
    var dx = x - t.x, dy = y - canopyY;
    var radius = h * sceneryType.radiusFrac;
    if (dx * dx + dy * dy <= radius * radius) return t;
  }
  return null;
}

export function generateScenery(tankXs) {
  var items = [];
  var playMinX = Math.max(0, Math.min.apply(null, tankXs) - ARENA_BUFFER);
  var playMaxX = Math.min(store.WORLD_W, Math.max.apply(null, tankXs) + ARENA_BUFFER);
  var minDist = 90;

  function okX(x) {
    return tankXs.every(function (tx) { return Math.abs(x - tx) > minDist; });
  }

  // Density varies match to match, but every match gets a solid baseline
  // of scenery - never bare or nearly bare.
  var roll = Math.random();
  var loneCount, clusterCount;
  if (roll < 0.3) { loneCount = randInt(6, 9); clusterCount = randInt(2, 3); }
  else if (roll < 0.7) { loneCount = randInt(9, 13); clusterCount = randInt(3, 4); }
  else { loneCount = randInt(13, 18); clusterCount = randInt(4, 6); }

  for (var i = 0; i < loneCount; i++) {
    var x = randRange(playMinX, playMaxX);
    var tries = 0;
    while (!okX(x) && tries < 12) { x = randRange(playMinX, playMaxX); tries++; }
    if (okX(x)) items.push(makeSceneryItem(x));
  }

  for (var c = 0; c < clusterCount; c++) {
    var cx = randRange(playMinX, playMaxX);
    var n = randInt(4, 7);
    for (var j = 0; j < n; j++) {
      var tx = cx + (Math.random() - 0.5) * 130;
      tx = Math.max(playMinX, Math.min(playMaxX, tx));
      if (okX(tx)) items.push(makeSceneryItem(tx));
    }
  }
  store.scenery = items;
}

export function generateBgTrees() {
  var bgTrees = [];
  var count = randInt(6, 11);
  for (var i = 0; i < count; i++) bgTrees.push({ rx: Math.random() * 3000, scale: 0.8 + Math.random() * 0.6 });
  store.bgTrees = bgTrees;
}

// A scattered row (not one tight cluster, unlike generateBgPyramids below -
// a "tree line" reads as a spread-out row of trees, not a single formation),
// for the "treeLine" background shape. toneT picks where each tree lands
// between two derived autumn tones (background.js: drawTreeLineLayer) so
// the line isn't a flat single color.
export function generateBgOrchardTrees() {
  var trees = [];
  var count = randInt(14, 22);
  for (var i = 0; i < count; i++) {
    trees.push({ rx: Math.random() * 3000, scale: 0.7 + Math.random() * 0.7, toneT: Math.random() });
  }
  store.bgOrchardTrees = trees;
}

// One clustered formation (a Giza-style trio), not independently scattered
// pyramids - each one smaller than the last and offset to the right just
// enough to overlap its predecessor, so it reads as "in front of" the
// bigger one behind it. Array order IS draw order (background.js:
// drawPyramidLayer iterates in order), so index 0 must be the biggest/
// furthest-back one and later entries progressively smaller/more-front,
// or the overlap reads backwards. The whole cluster's position (baseRx)
// is still randomized per match, just not each pyramid independently.
export function generateBgPyramids(count) {
  var pyramids = [];
  var baseRx = 800 + Math.random() * 1400;
  var cx = baseRx;
  var prevHalfW = 0;
  for (var i = 0; i < count; i++) {
    var scale = 1.0 - i * 0.32; // each one noticeably smaller than the last
    var halfW = 110 * scale; // half of drawPyramidLayer's w = 220 * scale
    if (i > 0) cx += prevHalfW * 0.55 + halfW * 0.55; // shift right by less than the combined half-widths, so they overlap
    pyramids.push({
      rx: cx,
      scale: scale,
      ridgeFrac: (Math.random() - 0.5) * 0.5 // where the light/dark face split sits along the base, as a fraction of half-width either side of center
    });
    prevHalfW = halfW;
  }
  store.bgPyramids = pyramids;
}

// Returns a NEW array of buildings rather than writing directly to
// store (unlike the other bg generators above) - a map can use the
// "skyline" shape twice, at different densities/colors, for a layered
// far/near city depth effect, so main.js: startMatch() calls this once
// per skyline-shaped layer and assigns each result to
// store.bgSkylineSets[layerIndex] itself. `windows` is a per-building
// count only - background.js: drawSkylineLayer derives each window's
// actual position deterministically (pseudoRandom seeded off index), so
// they don't re-randomize (flicker) every frame.
export function generateBgSkyline(count) {
  var buildings = [];
  var cx = 0;
  for (var i = 0; i < count; i++) {
    var w = 40 + Math.random() * 70;
    var h = 60 + Math.random() * 170;
    buildings.push({ rx: cx + w / 2, w: w, h: h, windows: randInt(3, 9) });
    cx += w + 4 + Math.random() * 18; // small gaps, mostly touching for a dense skyline
  }
  return buildings;
}

// A simple stacked-triangle conifer icon (evokes the pine emoji shape
// without depending on the platform's emoji font/colors).
export function drawPineTree(x, groundY, h, foliageColor, trunkColor) {
  var trunkH = h * 0.16, trunkW = h * 0.13;
  ctx.fillStyle = trunkColor;
  ctx.fillRect(x - trunkW / 2, groundY - trunkH, trunkW, trunkH);

  var layers = [
    { w: h * 0.66, h: h * 0.44, yOff: trunkH * 0.5 },
    { w: h * 0.52, h: h * 0.40, yOff: trunkH * 0.5 + h * 0.44 * 0.55 },
    { w: h * 0.37, h: h * 0.36, yOff: trunkH * 0.5 + h * 0.44 * 0.55 + h * 0.40 * 0.55 }
  ];
  ctx.fillStyle = foliageColor;
  layers.forEach(function (l) {
    var by = groundY - l.yOff;
    ctx.beginPath();
    ctx.moveTo(x, by - l.h);
    ctx.lineTo(x - l.w / 2, by);
    ctx.lineTo(x + l.w / 2, by);
    ctx.closePath();
    ctx.fill();
  });
}

// A two-capsule saguaro silhouette: a tall trunk plus one shorter side
// arm. The arm's side is a deterministic function of x (pseudoRandom),
// not stored per-item, so cacti get some visual variety without needing
// a new field on the scenery item itself.
export function drawCactus(x, groundY, h, color) {
  function capsule(cx, topY, botY, w) {
    var r = w / 2;
    ctx.beginPath();
    ctx.moveTo(cx - r, botY);
    ctx.lineTo(cx - r, topY + r);
    ctx.arc(cx, topY + r, r, Math.PI, 0, false);
    ctx.lineTo(cx + r, botY);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = color;
  var trunkW = h * 0.22;
  var trunkH = h * 0.92;
  var armDir = pseudoRandom(x) < 0.5 ? -1 : 1;
  var armW = trunkW * 0.7;
  var armH = trunkH * 0.38;
  var armBotY = groundY - trunkH * 0.45;
  capsule(x + armDir * trunkW * 0.9, armBotY - armH, armBotY, armW);
  capsule(x, groundY - trunkH, groundY, trunkW);
}

// A round, clustered-canopy silhouette (three overlapping circles, the
// same "blobby cluster" trick background.js: drawTreeLineLayer uses for
// the distant orchard row) on a trunk - deliberately broader/rounder than
// drawPineTree's stacked triangles, so an orchard tree reads as a
// different species at a glance, not just a recolored pine.
export function drawAutumnTree(x, groundY, h, foliageColor, trunkColor) {
  var trunkH = h * 0.32, trunkW = h * 0.14;
  ctx.fillStyle = trunkColor;
  ctx.fillRect(x - trunkW / 2, groundY - trunkH, trunkW, trunkH);

  var r = h * 0.36;
  var cy = groundY - trunkH - r * 0.5;
  ctx.fillStyle = foliageColor;
  [[-r * 0.45, r * 0.15], [r * 0.45, r * 0.15], [0, -r * 0.35]].forEach(function (o) {
    ctx.beginPath();
    ctx.arc(x + o[0], cy + o[1], r * 0.62, 0, Math.PI * 2);
    ctx.fill();
  });
}

// A jagged, irregular blob (crushed metal, not a clean geometric shape)
// with a bent antenna/pipe poking out the top - the one silhouette detail
// that reads as "junk" rather than a rock or stump - plus a rim-light
// stroke in accentColor so it picks up a bit of the map's neon glow.
export function drawJunkPile(x, groundY, h, color, accentColor) {
  var w = h * 0.9;
  var pts = [
    [-w * 0.5, 0], [-w * 0.42, -h * 0.35], [-w * 0.15, -h * 0.55],
    [w * 0.1, -h * 0.42], [w * 0.48, -h * 0.5], [w * 0.5, -h * 0.1],
    [w * 0.32, 0]
  ];
  ctx.beginPath();
  ctx.moveTo(x + pts[0][0], groundY + pts[0][1]);
  for (var i = 1; i < pts.length; i++) ctx.lineTo(x + pts[i][0], groundY + pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  ctx.strokeStyle = "#54545c";
  ctx.lineWidth = h * 0.05;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - w * 0.1, groundY - h * 0.5);
  ctx.lineTo(x - w * 0.05, groundY - h * 0.85);
  ctx.lineTo(x + w * 0.08, groundY - h * 0.95);
  ctx.stroke();
}

// Occasional spark bursts from every alive junk pile (SCENERY_TYPES[key]
// .ambientSpark gates this generically, not a hardcoded key check) -
// always-on ambient life for a scenery type that never burns/changes
// state otherwise, same idea as a wreck's ongoing smoke/sparks but on
// intact scenery instead of a destroyed tank. Called every frame
// regardless of turn/game state, same as updateWreckEffects().
export function updateSceneryEffects(dt) {
  var sceneryType = SCENERY_TYPES[store.activeMap.scenery];
  if (!sceneryType.ambientSpark) return;
  var baseH = sceneryType.baseHeight;
  store.scenery.forEach(function (t) {
    t.sparkTimer -= dt;
    if (t.sparkTimer <= 0) {
      var life = randRange(0.15, 0.35);
      t.sparks.push({
        x: randRange(-6, 6) * t.scale, y: -randRange(0.3, 0.55) * baseH * t.scale,
        life: life, maxLife: life,
        color: Math.random() < 0.5 ? "#ff4fc4" : "#5be8ff"
      });
      t.sparkTimer = randRange(1.5, 4); // infrequent - flickers of life, not a constant shower
    }
    t.sparks = t.sparks.filter(function (s) { s.life -= dt; return s.life > 0; });
  });
}

export function drawSceneryItem(t) {
  var sx = t.x;
  var groundY = terrainHeightAt(t.x);
  var key = store.activeMap.scenery;
  var h = SCENERY_TYPES[key].baseHeight * t.scale;

  ctx.save();
  if (key === "cactus") {
    drawCactus(sx, groundY + 1, h, "#3f8f46");
  } else if (key === "autumnTree") {
    if (t.state === "burning") {
      ctx.shadowColor = "rgba(255,110,20,0.95)";
      ctx.shadowBlur = 16;
      drawAutumnTree(sx, groundY + 1, h, "#c94a1e", "#5b3a22");
      ctx.shadowBlur = 0;
    } else if (t.state === "ash") {
      ctx.globalAlpha = 0.7;
      drawAutumnTree(sx, groundY + 1, h, "#4a4a4a", "#3a3a3a");
    } else {
      drawAutumnTree(sx, groundY + 1, h, "#d9822e", "#5b3a22");
    }
  } else if (key === "junkPile") {
    var accent = pseudoRandom(sx) < 0.5 ? "#ff4fc4" : "#5be8ff";
    drawJunkPile(sx, groundY + 1, h, "#3a3a42", accent);
    t.sparks.forEach(function (s) {
      var st = Math.max(0, s.life / s.maxLife);
      ctx.save();
      ctx.globalAlpha = st;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(sx + s.x, groundY + s.y, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  } else {
    // pineTree (also the fallback for any future burnable type that
    // hasn't earned its own branch yet)
    if (t.state === "burning") {
      ctx.shadowColor = "rgba(255,110,20,0.95)";
      ctx.shadowBlur = 16;
      drawPineTree(sx, groundY + 1, h, "#c94a1e", "#5b3a22");
      ctx.shadowBlur = 0;
    } else if (t.state === "ash") {
      ctx.globalAlpha = 0.7;
      drawPineTree(sx, groundY + 1, h, "#4a4a4a", "#3a3a3a");
    } else {
      drawPineTree(sx, groundY + 1, h, "#2e7d32", "#5b3a22");
    }
  }
  ctx.restore();
}

export function drawScenery(filterState) {
  store.scenery.forEach(function (t) { if (t.state === filterState) drawSceneryItem(t); });
}
