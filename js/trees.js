import { store } from "./store.js";
import { ARENA_BUFFER, TREE_BASE_HEIGHT } from "./constants.js";
import { randRange, randInt } from "./utils.js";
import { ctx } from "./canvas.js";
import { terrainHeightAt } from "./terrain.js";

export function makeTree(x) {
  return { x: x, state: "alive", burnTurnsLeft: 0, scale: 0.95 + Math.random() * 0.55 };
}

export function generateTrees(tankXs) {
  var trees = [];
  var playMinX = Math.max(0, Math.min.apply(null, tankXs) - ARENA_BUFFER);
  var playMaxX = Math.min(store.WORLD_W, Math.max.apply(null, tankXs) + ARENA_BUFFER);
  var minDist = 90;

  function okX(x) {
    return tankXs.every(function (tx) { return Math.abs(x - tx) > minDist; });
  }

  // Density varies match to match, but every match gets a solid baseline
  // of trees - never bare or nearly bare.
  var roll = Math.random();
  var loneCount, clusterCount;
  if (roll < 0.3) { loneCount = randInt(6, 9); clusterCount = randInt(2, 3); }
  else if (roll < 0.7) { loneCount = randInt(9, 13); clusterCount = randInt(3, 4); }
  else { loneCount = randInt(13, 18); clusterCount = randInt(4, 6); }

  for (var i = 0; i < loneCount; i++) {
    var x = randRange(playMinX, playMaxX);
    var tries = 0;
    while (!okX(x) && tries < 12) { x = randRange(playMinX, playMaxX); tries++; }
    if (okX(x)) trees.push(makeTree(x));
  }

  for (var c = 0; c < clusterCount; c++) {
    var cx = randRange(playMinX, playMaxX);
    var n = randInt(4, 7);
    for (var j = 0; j < n; j++) {
      var tx = cx + (Math.random() - 0.5) * 130;
      tx = Math.max(playMinX, Math.min(playMaxX, tx));
      if (okX(tx)) trees.push(makeTree(tx));
    }
  }
  store.trees = trees;
}

export function generateBgTrees() {
  var bgTrees = [];
  var count = randInt(6, 11);
  for (var i = 0; i < count; i++) bgTrees.push({ rx: Math.random() * 3000, scale: 0.8 + Math.random() * 0.6 });
  store.bgTrees = bgTrees;
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

export function drawTree(t) {
  var sx = t.x;
  var groundY = terrainHeightAt(t.x);
  var h = TREE_BASE_HEIGHT * t.scale;

  ctx.save();
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
  ctx.restore();
}

export function drawTrees(filterState) {
  store.trees.forEach(function (t) { if (t.state === filterState) drawTree(t); });
}
