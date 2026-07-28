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
  return { x: x, state: "alive", burnTurnsLeft: 0, scale: 0.95 + Math.random() * 0.55 };
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

export function drawSceneryItem(t) {
  var sx = t.x;
  var groundY = terrainHeightAt(t.x);
  var key = store.activeMap.scenery;
  var h = SCENERY_TYPES[key].baseHeight * t.scale;

  ctx.save();
  if (key === "cactus") {
    drawCactus(sx, groundY + 1, h, "#3f8f46");
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
