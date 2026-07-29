// Tank lifecycle and stats (creation, type application, targeting) plus
// the drawTank() dispatcher that decides which of "supply crate" / "live
// body" / "wrecked body" to actually draw for a given tank this frame.
// The body art itself lives in tankArt.js, wreck art/particles in
// wreckage.js - this module owns the tank as a game-state concept, not
// its pixels.
import { store } from "./store.js";
import { FUEL_MAX, POWER_MAX, AI_LEVELS } from "./constants.js";
import { ctx } from "./canvas.js";
import { terrainHeightAt } from "./terrain.js";
import { findType, drawBarrelShape, drawSupplyCrate, getBodyDrawer } from "./tankArt.js";
import { drawWreckedTank } from "./wreckage.js";

export function applyTankType(p, key) {
  var t = findType(key);
  p.tankType = t.key;
  p.healthMax = t.healthMax;
  p.health = t.healthMax;
  p.moveSpeed = t.moveSpeed;
  p.fuelPerSec = t.fuelPerSec;
  p.minDamage = t.minDamage;
  p.maxDamage = t.maxDamage;
  p.hitHalfWidth = t.hitHalfWidth;
  p.hitHeight = t.hitHeight;
  p.barrelPivotX = t.barrelPivotX;
  p.barrelPivotY = t.barrelPivotY;
  p.barrelLength = t.barrelLength;
  p.barrelWidth = t.barrelWidth;
  p.collar = t.collar;
  p.muzzle = t.muzzle;
}

export function newTank(idx) {
  var startX = store.playerStartXs[idx];
  var cfg = store.gameConfig.players[idx];
  var p = {
    idx: idx,
    x: startX,
    // Facing is decided once, here, from which half of the arena this
    // tank starts in - left half faces right (dir=1), right half faces
    // left (dir=-1); a tank exactly on the centerline ties toward facing
    // right. Fixed for the whole match, even if the tank later moves.
    dir: startX <= store.WORLD_W / 2 ? 1 : -1,
    angle: 55,
    power: 55,
    fuel: FUEL_MAX,
    name: cfg.name,
    color: cfg.color,
    colorDark: cfg.colorDark,
    isBot: !!cfg.isBot,
    aiLevel: AI_LEVELS[cfg.aiLevel] ? cfg.aiLevel : "medium",
    // Keyed by opponent idx - {hasFired, lastOpponentX} per opponent, not
    // one flat pair - since bot.js now targets whichever opponent is
    // currently closest, which can change turn to turn in a 3+ player
    // match. Entries are created lazily the first time this shooter aims
    // at a given opponent (bot.js: computeAimStdDev/beginAimAndWait).
    aiMemory: {},
    alive: true, // flips false in combat.js: afterResolve() once health hits 0 - eliminated tanks stay on the field as wreckage but never act or block bullets again
    wreck: null, // set once by wreckage.js: initWreck() the instant this tank is eliminated - {smoke, sparks, smokeTimer, sparkTimer}
    selected: false
  };
  applyTankType(p, "trooper"); // sensible default until the player actually picks
  p.fuel = FUEL_MAX;
  return p;
}

// Shared by bot.js (real targeting - bots always go for whoever's closest,
// see CLAUDE.md's load-bearing decision on N-player matches) and
// combat.js's window.__BENCH__ hook (measuring miss distance against a
// sensible reference in a free-for-all). Lives here rather than in
// bot.js/combat.js so both can import it without a circular dependency
// (bot.js already imports from combat.js). Returns null if p has no alive
// opponents (shouldn't happen mid-match - the match would already be over).
export function closestAliveOpponent(p) {
  var best = null, bestDist = Infinity;
  for (var i = 0; i < store.players.length; i++) {
    var o = store.players[i];
    if (o === p || !o.alive) continue;
    var d = Math.abs(o.x - p.x);
    if (d < bestDist) { bestDist = d; best = o; }
  }
  return best;
}

// Draws the currently-selected (or default) body for a live tank, then
// the shared barrel/aim-arrow/health-bar using that tank type's own
// pivot/length stats. Body art is authored "facing right" and mirrored
// with ctx.scale(dir,1) - the barrel/arrow keep using dir-aware vectors
// directly (unchanged from before), drawn outside that mirrored scope so
// they're never double-flipped.
export function drawTank(p) {
  if (!p.selected) { drawSupplyCrate(p); return; }
  if (!p.alive) { drawWreckedTank(p); return; }

  var sx = p.x;
  var groundY = terrainHeightAt(p.x);
  var ls = 1 / store.camZoom;
  var dir = p.dir;
  var drawBody = getBodyDrawer(p.tankType);

  ctx.save();
  ctx.translate(sx, groundY);
  ctx.save();
  ctx.scale(dir, 1);
  drawBody(ctx, ls, p.color, p.colorDark, p.color);
  ctx.restore();

  var rad = p.angle * Math.PI / 180;
  var bx = Math.cos(rad) * dir;
  var by = -Math.sin(rad);
  var pivotX = p.barrelPivotX * dir;
  var pivotY = -p.barrelPivotY;
  // drawBarrelShape computes its own cos/sin with no dir awareness, so
  // mirror the angle itself for player 2 (cos(180-a)=-cos(a), sin(180-a)=
  // sin(a)) rather than passing dir through - this keeps bx/by here and
  // the shape's internal vector in agreement.
  var barrelAngle = dir === 1 ? p.angle : 180 - p.angle;
  drawBarrelShape(ctx, ls, pivotX, pivotY, p.barrelLength, p.barrelWidth, barrelAngle, p.collar, p.muzzle);
  ctx.restore();

  // aim arrow (active tank only, during aim)
  if (store.state === "aim" && p.idx === store.active) {
    var len = 20 + (p.power / POWER_MAX) * 55;
    var ax = sx + pivotX, ay = groundY + pivotY;
    ctx.strokeStyle = "rgba(255,255,60,0.9)";
    ctx.lineWidth = 3 * ls;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + bx * len, ay + by * len);
    ctx.stroke();
    ctx.beginPath();
    var hx = ax + bx * len, hy = ay + by * len;
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx - bx * 8 - by * 5, hy - by * 8 + bx * 5);
    ctx.lineTo(hx - bx * 8 + by * 5, hy - by * 8 - bx * 5);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,60,0.9)";
    ctx.fill();
  }

  // health bar BELOW tank
  var barW = 40, barH = 5;
  var bx0 = sx - barW / 2, by0 = groundY + 10;
  ctx.fillStyle = "#20242c";
  ctx.fillRect(bx0, by0, barW, barH);
  var pct = Math.max(0, p.health) / p.healthMax;
  ctx.fillStyle = pct > 0.4 ? "#4caf50" : (pct > 0.15 ? "#e0b93a" : "#d1432c");
  ctx.fillRect(bx0, by0, barW * pct, barH);
}
