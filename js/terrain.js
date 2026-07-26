import { store } from "./store.js";
import { ARENA_BUFFER } from "./constants.js";
import { randRange, randInt, pseudoRandom } from "./utils.js";
import { ctx } from "./canvas.js";

// Big terrain mountains: a few large, smooth "bumps" layered on top of
// the fine rolling-hill noise, so they read as dominant shapes instead of
// just more wrinkles. Rather than one placement rule producing endless
// small variations on the same shape, each match rolls one of several
// distinct layout archetypes so sessions feel qualitatively different,
// not just randomized in size/count.
function pickMountainLayout() {
  var roll = Math.random();
  if (roll < 0.15) return "Open Plains";
  if (roll < 0.40) return "The Ridge";
  if (roll < 0.60) return "Twin Peaks";
  if (roll < 0.80) return "Mountain Range";
  return "Off to the Side";
}

function generateTerrainMountains() {
  store.terrainMountains = [];
  var sorted = store.playerStartXs.slice().sort(function (a, b) { return a - b; });
  var loX = sorted[0], hiX = sorted[sorted.length - 1];
  var span = hiX - loX;

  function addMountain(cx, wLo, wHi, dLo, dHi) {
    store.terrainMountains.push({ cx: cx, width: randRange(wLo, wHi), peakDrop: randRange(dLo, dHi) });
  }
  function farFromAllPlayers(x, minDist) {
    return store.playerStartXs.every(function (px) { return Math.abs(x - px) >= minDist; });
  }
  // Sampled relative to the arena (the span across all active players)
  // plus a small buffer, not the full world - so "scattered" features
  // land near the action instead of lost out in the scenery wings.
  function randomArenaX() {
    var x, tries = 0;
    do {
      x = randRange(loX - ARENA_BUFFER, hiX + ARENA_BUFFER);
      tries++;
    } while (tries < 10 && !farFromAllPlayers(x, 300));
    return Math.max(0, Math.min(store.WORLD_W, x));
  }

  var layout = pickMountainLayout();
  store.currentLayoutName = layout;

  if (layout === "Open Plains") {
    // No mountains this match - just the fine rolling-hill texture.
  } else if (layout === "The Ridge") {
    // One big peak in a randomly chosen gap between two adjacent
    // players: every shot across that gap has to arc over it.
    var gapIndex = randInt(0, sorted.length - 2);
    var gMid = (sorted[gapIndex] + sorted[gapIndex + 1]) / 2;
    addMountain(gMid + randRange(-120, 120), 260, 380, 0.38, 0.52);
  } else if (layout === "Twin Peaks") {
    // A ridge flanking each side of the arena, leaving the middle more
    // open - rewards using your own peak as cover while dueling across
    // a clearer lane.
    addMountain(loX + span * 0.28 + randRange(-60, 60), 200, 320, 0.28, 0.42);
    addMountain(loX + span * 0.72 + randRange(-60, 60), 200, 320, 0.28, 0.42);
  } else if (layout === "Mountain Range") {
    // A rugged, scattered range across the arena - unpredictable
    // sightlines everywhere, but always near the action.
    var n = randInt(3, 4);
    for (var i = 0; i < n; i++) addMountain(randomArenaX(), 180, 340, 0.25, 0.48);
  } else {
    // Off to the Side: the arena itself stays clear, but a prominent
    // peak looms just past one end for movement/cover play.
    var outward = Math.random() < 0.5 ? loX - randRange(250, 500) : hiX + randRange(250, 500);
    outward = Math.max(store.WORLD_W * 0.03, Math.min(store.WORLD_W * 0.97, outward));
    addMountain(outward, 240, 380, 0.32, 0.50);
  }
}

function mountainBumpAt(x) {
  var total = 0;
  for (var i = 0; i < store.terrainMountains.length; i++) {
    var m = store.terrainMountains[i];
    var d = Math.abs(x - m.cx);
    if (d >= m.width) continue;
    var t = d / m.width;
    var falloff = Math.cos(t * Math.PI / 2);
    total += m.peakDrop * falloff * falloff;
  }
  return total;
}

function displace(pts, i0, i1, amp) {
  if (i1 - i0 < 2) return;
  var mid = (i0 + i1) >> 1;
  pts[mid] = (pts[i0] + pts[i1]) / 2 + (Math.random() - 0.5) * amp;
  displace(pts, i0, mid, amp * 0.56);
  displace(pts, mid, i1, amp * 0.56);
}

// Heights are stored as fractions (0..1) of the current viewport height,
// not absolute pixels, so the terrain stays correctly positioned if the
// viewport height changes later (address bar hide/show, orientation
// settling, fullscreen toggle) without needing to regenerate.
export function generateTerrain() {
  generateTerrainMountains();

  var segments = 9; // midpoint displacement depth -> 2^9 = 512 points
  var n = Math.pow(2, segments);
  var pts = new Array(n + 1);
  var baseline = 0.58;
  var roughness = 0.34;
  pts[0] = baseline + (Math.random() - 0.5) * roughness * 0.6;
  pts[n] = baseline + (Math.random() - 0.5) * roughness * 0.6;
  displace(pts, 0, n, roughness);

  // Resample to WORLD_W+1 integer columns.
  var terrain = new Array(store.WORLD_W + 1);
  for (var x = 0; x <= store.WORLD_W; x++) {
    var t = (x / store.WORLD_W) * n;
    var i0 = Math.floor(t);
    var i1 = Math.min(n, i0 + 1);
    var f = t - i0;
    var h = pts[i0] * (1 - f) + pts[i1] * f;
    h -= mountainBumpAt(x);
    var minH = 0.05, maxH = 0.92;
    if (h < minH) h = minH;
    if (h > maxH) h = maxH;
    terrain[x] = h;
  }
  store.terrain = terrain;
}

// Returns the terrain height in current screen pixels (fraction * VIEW_H).
export function terrainHeightAt(x) {
  return terrainFractionAt(x) * store.VIEW_H;
}

export function terrainFractionAt(x) {
  x = Math.max(0, Math.min(store.WORLD_W, x));
  var xi = Math.floor(x);
  var xi1 = Math.min(store.WORLD_W, xi + 1);
  var f = x - xi;
  return store.terrain[xi] * (1 - f) + store.terrain[xi1] * f;
}

// Digs a small crater into the terrain around cx, deepest at the center
// and tapering smoothly to nothing at the edge of the radius. Craters
// stack, so repeated hits in the same spot dig progressively deeper.
export function deformTerrain(cx, radius, depth) {
  var xi0 = Math.max(0, Math.floor(cx - radius));
  var xi1 = Math.min(store.WORLD_W, Math.ceil(cx + radius));
  for (var xi = xi0; xi <= xi1; xi++) {
    var d = Math.abs(xi - cx) / radius;
    if (d > 1) continue;
    var falloff = Math.cos(d * Math.PI / 2);
    store.terrain[xi] = Math.min(0.97, store.terrain[xi] + depth * falloff);
  }
}

export function drawTerrain() {
  var halfW = (store.VIEW_W / 2) / store.camZoom;
  var x0 = Math.max(0, Math.floor(store.camCenterX - halfW));
  var x1 = Math.min(store.WORLD_W, Math.ceil(store.camCenterX + halfW));
  var bottom = 20000; // always far below any pannable/zoomed-out range

  // Shallowest surface currently in view anchors the depth gradient, so
  // the dirt is lightest near the visible ground line and darkens with
  // depth below it, rather than being one flat brown everywhere.
  var minSurfaceY = Infinity;
  for (var xs = x0; xs <= x1; xs += 24) {
    var hs = terrainHeightAt(xs);
    if (hs < minSurfaceY) minSurfaceY = hs;
  }
  if (minSurfaceY === Infinity) minSurfaceY = 0;

  ctx.beginPath();
  ctx.moveTo(x0, bottom);
  for (var x = x0; x <= x1; x += 2) {
    ctx.lineTo(x, terrainHeightAt(x));
  }
  ctx.lineTo(x1, bottom);
  ctx.closePath();
  var dirtGrad = ctx.createLinearGradient(0, minSurfaceY, 0, minSurfaceY + 650);
  dirtGrad.addColorStop(0, "#7a5636");
  dirtGrad.addColorStop(0.35, "#5c3f26");
  dirtGrad.addColorStop(1, "#241811");
  ctx.fillStyle = dirtGrad;
  ctx.fill();

  // Grass layer: a filled, gradient-shaded band instead of a flat
  // single-color stroke, plus scattered tufts for texture.
  var bandThickness = 8;
  ctx.beginPath();
  var first = true;
  for (var xg = x0; xg <= x1; xg += 2) {
    var hy = terrainHeightAt(xg);
    if (first) { ctx.moveTo(xg, hy); first = false; }
    else ctx.lineTo(xg, hy);
  }
  for (var xg2 = x1; xg2 >= x0; xg2 -= 2) {
    ctx.lineTo(xg2, terrainHeightAt(xg2) + bandThickness);
  }
  ctx.closePath();
  var grassGrad = ctx.createLinearGradient(0, minSurfaceY, 0, minSurfaceY + bandThickness + 3);
  grassGrad.addColorStop(0, "#68c751");
  grassGrad.addColorStop(1, "#2f7a34");
  ctx.fillStyle = grassGrad;
  ctx.fill();

  ctx.strokeStyle = "#2f7a34";
  ctx.lineWidth = 1.4 / store.camZoom;
  var tuftSpacing = 13;
  for (var xt = Math.floor(x0 / tuftSpacing) * tuftSpacing; xt <= x1; xt += tuftSpacing) {
    var r = pseudoRandom(xt / tuftSpacing);
    if (r < 0.5) continue;
    var groundY = terrainHeightAt(xt);
    var tuftH = (4 + r * 9) / store.camZoom;
    var lean = (pseudoRandom(xt / tuftSpacing + 99) - 0.5) * 7;
    ctx.beginPath();
    ctx.moveTo(xt, groundY);
    ctx.lineTo(xt + lean, groundY - tuftH);
    ctx.stroke();
  }
}
