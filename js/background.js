import { store } from "./store.js";
import { randInt, lerpColor, hexToRgb } from "./utils.js";
import { ctx } from "./canvas.js";
import { drawPineTree } from "./scenery.js";

// Static (non-drifting) foreground clouds living high up in the extended
// sky. yFrac is a fraction of VIEW_H, same resolution-independent
// convention as terrain, so they stay correctly placed on resize.
export function generateClouds() {
  var clouds = [];
  var count = randInt(6, 10);
  for (var i = 0; i < count; i++) {
    clouds.push({
      x: Math.random() * store.WORLD_W,
      yFrac: -0.75 - Math.random() * 0.35,
      scale: 0.8 + Math.random() * 0.7
    });
  }
  store.clouds = clouds;
}

// Sky/mountains are drawn in plain screen space (not the world zoom/pan
// transform) - the backdrop doesn't magnify with zoom, only the world
// layer does. The gradient's colors are still altitude-aware: panning up
// into the taller sky shifts the sampled colors toward a darker blue.
// dark/top/bot come from the active map (constants.js: MAPS[].sky) so
// each map can have its own sky, not just its own ground.
function skyColorAt(worldY, sky) {
  var f = worldY / store.VIEW_H;
  var c;
  if (f <= 0) {
    var t = Math.max(0, Math.min(1, (f + 1.4) / 1.4));
    c = lerpColor(sky.dark, sky.top, t);
  } else {
    c = lerpColor(sky.top, sky.bot, Math.max(0, Math.min(1, f)));
  }
  return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
}

function mountainHeightAt(wx, baseY, amp, freq1, freq2) {
  return baseY - amp * Math.sin(wx * freq1) - amp * 0.5 * Math.sin(wx * freq2 + 1.5);
}

// The far layer for every map so far - a soft sine-wave silhouette,
// recolored per map (works fine as distant dunes for desert too, not
// just mountains). withDecor draws store.bgTrees (small pine silhouettes
// along the ridge) on top - forest-specific, left off for maps whose
// front layer uses a different shape entirely.
function drawMountainLayer(seed, parallaxFactor, alpha, color, baseY, amp, freq1, freq2, withDecor) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  var parallax = store.camCenterX * parallaxFactor;
  ctx.beginPath();
  ctx.moveTo(0, store.VIEW_H);
  for (var x = 0; x <= store.VIEW_W; x += 30) {
    var h = mountainHeightAt(x + parallax + seed, baseY, amp, freq1, freq2);
    ctx.lineTo(x, h);
  }
  ctx.lineTo(store.VIEW_W, store.VIEW_H);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  if (withDecor) {
    ctx.save();
    ctx.globalAlpha = alpha + 0.15;
    for (var i = 0; i < store.bgTrees.length; i++) {
      var sx = store.bgTrees[i].rx - parallax;
      if (sx < -20 || sx > store.VIEW_W + 20) continue;
      var h2 = mountainHeightAt(store.bgTrees[i].rx + seed, baseY, amp, freq1, freq2);
      drawPineTree(sx, h2 + 2, 20 * store.bgTrees[i].scale, color, color);
    }
    ctx.restore();
  }
}

// An alternate front-layer shape for maps that want something other than
// another mountain silhouette - a handful of large, evenly-spaced
// triangles (store.bgPyramids, generated once per match in scenery.js:
// generateBgPyramids). No seed/sine-wave involved since positions are
// discrete, not procedural - only the pan parallax offset moves them.
//
// Each pyramid is two triangles, not one - a lit face and a shaded face
// sharing the apex and a ridge line down to a point along the base
// (py.ridgeFrac, stored per-pyramid for a bit of natural variety). Both
// triangles are computed from the exact same sx/w/h every frame, so they
// can never drift apart under panning - there's no separate "second
// object" to keep in sync, just two fills of one shape split down the
// middle.
function drawPyramidLayer(parallaxFactor, alpha, color, baseY) {
  ctx.save();
  ctx.globalAlpha = alpha;
  var rgb = hexToRgb(color);
  var lightRgb = lerpColor(rgb, [255, 255, 255], 0.22);
  var darkRgb = lerpColor(rgb, [0, 0, 0], 0.26);
  var lightColor = "rgb(" + lightRgb[0] + "," + lightRgb[1] + "," + lightRgb[2] + ")";
  var darkColor = "rgb(" + darkRgb[0] + "," + darkRgb[1] + "," + darkRgb[2] + ")";
  var parallax = store.camCenterX * parallaxFactor;

  for (var i = 0; i < store.bgPyramids.length; i++) {
    var py = store.bgPyramids[i];
    var sx = py.rx - parallax;
    var w = 220 * py.scale, h = 170 * py.scale;
    if (sx + w / 2 < 0 || sx - w / 2 > store.VIEW_W) continue;

    var apexY = baseY - h;
    var leftX = sx - w / 2, rightX = sx + w / 2;
    var ridgeX = sx + (w / 2) * py.ridgeFrac;

    ctx.fillStyle = lightColor;
    ctx.beginPath();
    ctx.moveTo(sx, apexY);
    ctx.lineTo(leftX, baseY);
    ctx.lineTo(ridgeX, baseY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = darkColor;
    ctx.beginPath();
    ctx.moveTo(sx, apexY);
    ctx.lineTo(ridgeX, baseY);
    ctx.lineTo(rightX, baseY);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// An orchard-specific near/mid background shape (unlike mountains/pyramids,
// which both work for any map recolored) - a scattered row of round,
// clustered-blob canopies (store.bgOrchardTrees, generated once per match
// in scenery.js: generateBgOrchardTrees). Each tree blends between two
// derived autumn tones per its own toneT so the row isn't one flat color.
function drawTreeLineLayer(parallaxFactor, alpha, color, baseY) {
  ctx.save();
  ctx.globalAlpha = alpha;
  var rgb = hexToRgb(color);
  var warmRgb = lerpColor(rgb, [255, 214, 120], 0.35);
  var coolRgb = lerpColor(rgb, [90, 30, 10], 0.3);
  var parallax = store.camCenterX * parallaxFactor;

  for (var i = 0; i < store.bgOrchardTrees.length; i++) {
    var t = store.bgOrchardTrees[i];
    var sx = t.rx - parallax;
    var r = 26 * t.scale;
    if (sx + r < 0 || sx - r > store.VIEW_W) continue;

    var blend = lerpColor(coolRgb, warmRgb, t.toneT);
    ctx.fillStyle = "rgb(" + blend[0] + "," + blend[1] + "," + blend[2] + ")";
    [[-r * 0.4, 0], [r * 0.4, 0], [0, -r * 0.35]].forEach(function (o) {
      ctx.beginPath();
      ctx.arc(sx + o[0], baseY - r * 0.5 + o[1], r * 0.62, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = "rgba(40,20,10,0.5)";
    ctx.fillRect(sx - r * 0.06, baseY - r * 0.15, r * 0.12, r * 0.5);
  }
  ctx.restore();
}

// Draws store.activeMap.bgLayers back-to-front (array order IS draw
// order, same convention as store.bgPyramids) - any number of layers, not
// a fixed back/front pair, each with its own parallaxFactor so they pan
// at genuinely different speeds. store.mountainSeeds[i] is paired with
// layer index i regardless of that layer's shape (unused for
// non-"mountains" layers, harmless) - sized to the active map's layer
// count each match in main.js: startMatch(), not a fixed pair of fields.
export function drawBackground() {
  var map = store.activeMap;
  var halfH = (store.VIEW_H / 2) / store.camZoom;
  var worldTop = store.camCenterY - halfH;
  var worldBottom = store.camCenterY + halfH;
  var g = ctx.createLinearGradient(0, 0, 0, store.VIEW_H);
  var stops = 6;
  for (var i = 0; i <= stops; i++) {
    var f = i / stops;
    g.addColorStop(f, skyColorAt(worldTop + (worldBottom - worldTop) * f, map.sky));
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, store.VIEW_W, store.VIEW_H);

  map.bgLayers.forEach(function (layer, i) {
    var baseY = store.VIEW_H * layer.baseYFrac;
    if (layer.shape === "pyramids") {
      drawPyramidLayer(layer.parallax, layer.alpha, layer.color, baseY);
    } else if (layer.shape === "treeLine") {
      drawTreeLineLayer(layer.parallax, layer.alpha, layer.color, baseY);
    } else {
      drawMountainLayer(store.mountainSeeds[i], layer.parallax, layer.alpha, layer.color, baseY, store.VIEW_H * layer.ampFrac, layer.freq1, layer.freq2, !!layer.withDecor);
    }
  });
}

function drawCloud(c) {
  var y = c.yFrac * store.VIEW_H;
  var s = 26 * c.scale;
  var lobes = [
    [-0.7, 0, 0.55], [0, -0.25, 0.7], [0.7, 0, 0.55], [-0.15, 0.2, 0.6], [0.55, 0.15, 0.5]
  ];
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = "#ffffff";
  lobes.forEach(function (l) {
    ctx.beginPath();
    ctx.arc(c.x + l[0] * s, y + l[1] * s, l[2] * s, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

export function drawClouds() {
  store.clouds.forEach(drawCloud);
}
