import { store } from "./store.js";
import { randInt, lerpColor } from "./utils.js";
import { ctx } from "./canvas.js";
import { drawPineTree } from "./trees.js";

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
function skyColorAt(worldY) {
  var f = worldY / store.VIEW_H;
  var dark = [0x22, 0x34, 0x5c];
  var top = [0x7f, 0xa8, 0xcf];
  var bot = [0xc9, 0xdc, 0xed];
  var c;
  if (f <= 0) {
    var t = Math.max(0, Math.min(1, (f + 1.4) / 1.4));
    c = lerpColor(dark, top, t);
  } else {
    c = lerpColor(top, bot, Math.max(0, Math.min(1, f)));
  }
  return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
}

function mountainHeightAt(wx, baseY, amp, freq1, freq2) {
  return baseY - amp * Math.sin(wx * freq1) - amp * 0.5 * Math.sin(wx * freq2 + 1.5);
}

function drawMountainLayer(seed, parallaxFactor, alpha, color, baseY, amp, freq1, freq2, withTrees) {
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

  if (withTrees) {
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

export function drawBackground() {
  var halfH = (store.VIEW_H / 2) / store.camZoom;
  var worldTop = store.camCenterY - halfH;
  var worldBottom = store.camCenterY + halfH;
  var g = ctx.createLinearGradient(0, 0, 0, store.VIEW_H);
  var stops = 6;
  for (var i = 0; i <= stops; i++) {
    var f = i / stops;
    g.addColorStop(f, skyColorAt(worldTop + (worldBottom - worldTop) * f));
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, store.VIEW_W, store.VIEW_H);

  drawMountainLayer(store.mountainSeed1, 0.12, 0.22, "#7793ab", store.VIEW_H * 0.62, store.VIEW_H * 0.20, 0.0021, 0.006, false);
  drawMountainLayer(store.mountainSeed2, 0.28, 0.32, "#5c7a99", store.VIEW_H * 0.72, store.VIEW_H * 0.15, 0.004, 0.011, true);
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
