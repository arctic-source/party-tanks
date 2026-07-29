import { store } from "./store.js";
import {
  FUEL_MAX, POWER_MAX, TANK_TYPES, AI_LEVELS,
  WRECK_SMOKE_INTERVAL_MIN, WRECK_SMOKE_INTERVAL_MAX, WRECK_SMOKE_LIFE_MIN, WRECK_SMOKE_LIFE_MAX,
  WRECK_SMOKE_RISE_SPEED, WRECK_SMOKE_MAX,
  WRECK_SPARK_INTERVAL_MIN, WRECK_SPARK_INTERVAL_MAX, WRECK_SPARK_LIFE_MIN, WRECK_SPARK_LIFE_MAX, WRECK_SPARK_MAX,
  EXPLOSION_FLASH_TIME, EXPLOSION_SMOKE_COUNT, EXPLOSION_SMOKE_LIFE_MIN, EXPLOSION_SMOKE_LIFE_MAX,
  EXPLOSION_DEBRIS_COUNT, EXPLOSION_DEBRIS_LIFE_MIN, EXPLOSION_DEBRIS_LIFE_MAX, EXPLOSION_DEBRIS_GRAVITY,
  EXPLOSION_SPARK_SPRAY_COUNT, EXPLOSION_SPARK_SPRAY_LIFE_MIN, EXPLOSION_SPARK_SPRAY_LIFE_MAX, EXPLOSION_SPARK_SPRAY_GRAVITY,
  EXPLOSION_WAVE_MAX_RADIUS, EXPLOSION_KINDS, EXPLOSION_KIND_KEYS
} from "./constants.js";
import { ctx } from "./canvas.js";
import { terrainHeightAt } from "./terrain.js";
import { randRange } from "./utils.js";

// ---------- Shared neutral palette ----------
// Structure (hull/legs/turret) stays this grey/black regardless of player -
// only a couple of small, deliberate accents per type carry the player's
// actual color. See CLAUDE.md's load-bearing decisions for why.
var NEUTRAL_LIGHT = "#5a6069";
var NEUTRAL_DARK = "#2b2f36";
var NEUTRAL_SILVER = "#aab2c0";
var NEUTRAL_RIVET = "#e9edf2";
var GLASS_BLUE = "rgba(175,222,255,0.55)";
var GLASS_BLUE_SOLID = "#8fd8ff";
var THRUSTER_GLOW = "#8fd8ff";
var HAZARD_YELLOW = "#c9a227";

function findType(key) {
  for (var i = 0; i < TANK_TYPES.length; i++) if (TANK_TYPES[i].key === key) return TANK_TYPES[i];
  return TANK_TYPES[0];
}

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
    wreck: null, // set once by initWreck() the instant this tank is eliminated - {smoke, sparks, smokeTimer, sparkTimer}
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

function roundRectPath(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function drawTrackBand(c, ls, w, thickness, hubXs) {
  roundRectPath(c, -w / 2, -thickness, w, thickness, thickness * 0.35);
  c.fillStyle = "#20242c";
  c.fill();
  c.strokeStyle = "#3a3f4a";
  c.lineWidth = 0.8 * ls;
  c.beginPath();
  for (var x = -w / 2 + 3; x < w / 2 - 1; x += w / 11) {
    c.moveTo(x, -thickness + 1.5);
    c.lineTo(x, -1.5);
  }
  c.stroke();
  c.fillStyle = "#565d6b";
  hubXs.forEach(function (hx) {
    c.beginPath();
    c.arc(hx, -thickness * 0.62, thickness * 0.24, 0, Math.PI * 2);
    c.fill();
  });
}

// Shared barrel renderer - also defines the exact pivot/tip geometry that
// combat.js's fire() must match so the bullet always leaves from where
// this visibly points, at any angle. See per-type barrelPivotX/Y in
// constants.js.
export function drawBarrelShape(c, ls, pivotX, pivotY, len, lw, angleDeg, collar, muzzle) {
  var rad = angleDeg * Math.PI / 180;
  var bx = Math.cos(rad), by = -Math.sin(rad);
  var tipX = pivotX + bx * len, tipY = pivotY + by * len;
  c.strokeStyle = NEUTRAL_DARK;
  c.lineWidth = lw * ls;
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(pivotX, pivotY);
  c.lineTo(tipX, tipY);
  c.stroke();
  if (collar) {
    var cx = pivotX + bx * len * 0.6, cy = pivotY + by * len * 0.6;
    c.save();
    c.translate(cx, cy);
    c.rotate(rad);
    c.fillStyle = NEUTRAL_SILVER;
    roundRectPath(c, -lw * 0.9, -lw * 0.9, lw * 1.8, lw * 1.8, lw * 0.3);
    c.fill();
    c.restore();
  }
  if (muzzle) {
    c.save();
    c.translate(tipX, tipY);
    c.rotate(rad);
    c.fillStyle = NEUTRAL_SILVER;
    c.beginPath();
    c.moveTo(-2, -lw * 1.3);
    c.lineTo(3, -lw * 1.6);
    c.lineTo(3, lw * 1.6);
    c.lineTo(-2, lw * 1.3);
    c.closePath();
    c.fill();
    c.restore();
  } else {
    c.fillStyle = NEUTRAL_DARK;
    c.beginPath();
    c.arc(tipX, tipY, lw * 0.55, 0, Math.PI * 2);
    c.fill();
  }
}

function mechLeg(c, ls, hipX, hipY, kneeX, kneeY, footX, footY, bend) {
  c.strokeStyle = NEUTRAL_DARK;
  c.lineWidth = 3 * ls;
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(hipX, hipY);
  c.lineTo(kneeX, kneeY);
  c.lineTo(footX, footY);
  c.stroke();

  var pdx = (kneeX - hipX), pdy = (kneeY - hipY);
  var plen = Math.hypot(pdx, pdy);
  var nx = -pdy / plen, ny = pdx / plen;
  var off = bend * 2.6;
  var p0x = hipX + nx * off, p0y = hipY + ny * off;
  var p1x = kneeX + nx * off * 0.4, p1y = kneeY + ny * off * 0.4;
  c.strokeStyle = NEUTRAL_SILVER;
  c.lineWidth = 1.4 * ls;
  c.beginPath();
  c.moveTo(p0x, p0y);
  c.lineTo(p1x, p1y);
  c.stroke();
  var midx = (p0x + p1x) / 2, midy = (p0y + p1y) / 2;
  c.save();
  c.translate(midx, midy);
  c.rotate(Math.atan2(pdy, pdx));
  c.fillStyle = NEUTRAL_SILVER;
  roundRectPath(c, -2.2, -1.4, 4.4, 2.8, 0.8);
  c.fill();
  c.restore();

  c.fillStyle = NEUTRAL_SILVER;
  [[hipX, hipY], [kneeX, kneeY], [footX, footY]].forEach(function (j) {
    c.beginPath();
    c.arc(j[0], j[1], 2.1, 0, Math.PI * 2);
    c.fill();
  });

  c.save();
  c.translate(footX, footY);
  c.fillStyle = NEUTRAL_DARK;
  roundRectPath(c, -4.5, 0, 9, 2.6, 1);
  c.fill();
  c.restore();
}

function rocketPod(c, x, y, w, h, angleDeg) {
  c.save();
  c.translate(x, y);
  c.rotate(angleDeg * Math.PI / 180);
  roundRectPath(c, -w / 2, -h / 2, w, h, w * 0.35);
  c.fillStyle = NEUTRAL_DARK;
  c.fill();
  c.beginPath();
  c.moveTo(-w / 2, h / 2);
  c.lineTo(-w / 2 - w * 0.35, h / 2 + h * 0.3);
  c.lineTo(-w / 2, h / 2 - h * 0.15);
  c.closePath();
  c.fill();
  c.beginPath();
  c.arc(0, h / 2, w * 0.32, 0, Math.PI * 2);
  c.fillStyle = "#1c1f24";
  c.fill();
  c.beginPath();
  c.moveTo(-w * 0.22, h / 2 + 1);
  c.lineTo(w * 0.22, h / 2 + 1);
  c.lineTo(0, h / 2 + h * 0.55);
  c.closePath();
  c.fillStyle = THRUSTER_GLOW;
  c.globalAlpha = 0.85;
  c.fill();
  c.globalAlpha = 1;
  c.restore();
}

function glassDome(c, ls, x, y, r, accentColor) {
  c.beginPath();
  c.arc(x, y, r, Math.PI, 0);
  c.closePath();
  c.fillStyle = GLASS_BLUE;
  c.fill();
  c.strokeStyle = NEUTRAL_DARK;
  c.lineWidth = 1.4 * ls;
  c.stroke();
  c.strokeStyle = accentColor;
  c.lineWidth = 1.8 * ls;
  c.beginPath();
  c.moveTo(x - r, y);
  c.lineTo(x + r, y);
  c.stroke();
  c.beginPath();
  c.arc(x - r * 0.35, y - r * 0.15, r * 0.35, 0, Math.PI * 2);
  c.fillStyle = "rgba(255,255,255,0.55)";
  c.fill();
  c.beginPath();
  c.arc(x, y + r * 0.15, r * 0.22, 0, Math.PI * 2);
  c.fillStyle = "rgba(20,25,35,0.65)";
  c.fill();
}

// Same silhouette as glassDome, but dark/shattered instead of lit blue -
// used for Jumper's canopy when wrecked (see drawJumperBody's `wrecked`
// branch below).
function crackedGlassDome(c, ls, x, y, r) {
  c.beginPath();
  c.arc(x, y, r, Math.PI, 0);
  c.closePath();
  c.fillStyle = "#14171c";
  c.fill();
  c.strokeStyle = NEUTRAL_DARK;
  c.lineWidth = 1.4 * ls;
  c.stroke();
  c.strokeStyle = "rgba(220,230,240,0.55)";
  c.lineWidth = 0.7 * ls;
  c.beginPath();
  c.moveTo(x, y - r * 0.1);
  c.lineTo(x - r * 0.55, y - r * 0.55);
  c.moveTo(x, y - r * 0.1);
  c.lineTo(x + r * 0.45, y - r * 0.7);
  c.moveTo(x, y - r * 0.1);
  c.lineTo(x - r * 0.1, y - r * 0.85);
  c.stroke();
}

// ---------- Trooper ----------
function drawTrooperBody(c, ls, color, dark, accentColor, wrecked) {
  drawTrackBand(c, ls, 48, 8, [-16, -2, 12]);

  c.beginPath();
  c.moveTo(-24, -8);
  c.lineTo(-22, -20);
  c.lineTo(-4, -23);
  c.lineTo(10, -21);
  c.lineTo(24, -14);
  c.lineTo(22, -8);
  c.closePath();
  c.fillStyle = NEUTRAL_LIGHT;
  c.fill();
  c.strokeStyle = NEUTRAL_DARK;
  c.lineWidth = 1.3 * ls;
  c.stroke();

  c.strokeStyle = accentColor;
  c.lineWidth = 2.1 * ls;
  c.beginPath();
  c.moveTo(-18, -14);
  c.lineTo(16, -14);
  c.stroke();

  roundRectPath(c, -8, -28, 12, 8, 2);
  c.fillStyle = NEUTRAL_DARK;
  c.fill();

  c.beginPath();
  c.arc(1, -24, 1.8, 0, Math.PI * 2);
  c.fillStyle = wrecked ? "#14171c" : GLASS_BLUE_SOLID;
  c.fill();
  if (wrecked) {
    c.strokeStyle = "rgba(220,230,240,0.6)";
    c.lineWidth = 0.5 * ls;
    c.beginPath();
    c.moveTo(0, -25.2);
    c.lineTo(2, -22.8);
    c.stroke();
  }

  c.strokeStyle = NEUTRAL_DARK;
  c.lineWidth = 1 * ls;
  c.beginPath();
  c.moveTo(-5, -28);
  c.lineTo(-9, -37);
  c.stroke();

  c.beginPath();
  c.arc(-9, -37, 1, 0, Math.PI * 2);
  c.fillStyle = accentColor;
  c.fill();
}

// ---------- Jumper ----------
function drawJumperBody(c, ls, color, dark, accentColor, wrecked) {
  mechLeg(c, ls, -7, -40, -15, -23, -6, -2, -1);
  mechLeg(c, ls, 7, -40, 15, -23, 6, -2, 1);

  roundRectPath(c, -10, -52, 20, 14, 2.5);
  c.fillStyle = NEUTRAL_LIGHT;
  c.fill();
  c.strokeStyle = NEUTRAL_DARK;
  c.lineWidth = 1.3 * ls;
  c.stroke();

  c.strokeStyle = NEUTRAL_DARK;
  c.lineWidth = 0.9 * ls;
  c.globalAlpha = 0.6;
  c.beginPath(); c.moveTo(-10, -46); c.lineTo(10, -46); c.stroke();
  c.globalAlpha = 1;

  c.strokeStyle = accentColor;
  c.lineWidth = 1.8 * ls;
  c.beginPath(); c.moveTo(-10, -42); c.lineTo(10, -42); c.stroke();

  c.fillStyle = NEUTRAL_RIVET;
  [[-8, -50], [8, -50], [-8, -40], [8, -40]].forEach(function (p) { c.beginPath(); c.arc(p[0], p[1], 0.8, 0, Math.PI * 2); c.fill(); });

  roundRectPath(c, -17, -54, 7, 19, 2.5);
  c.fillStyle = NEUTRAL_DARK;
  c.fill();
  c.strokeStyle = "#000";
  c.globalAlpha = 0.3;
  c.lineWidth = 0.8 * ls;
  [-49, -45, -41].forEach(function (y) { c.beginPath(); c.moveTo(-16, y); c.lineTo(-11, y); c.stroke(); });
  c.globalAlpha = 1;
  c.beginPath();
  c.arc(-13.5, -35, 2.6, 0, Math.PI * 2);
  c.fillStyle = "#1c1f24";
  c.fill();
  c.beginPath();
  c.moveTo(-16, -34);
  c.lineTo(-11, -34);
  c.lineTo(-13.5, -29);
  c.closePath();
  c.fillStyle = THRUSTER_GLOW;
  c.globalAlpha = 0.85;
  c.fill();
  c.globalAlpha = 1;

  if (wrecked) {
    crackedGlassDome(c, ls, 7, -50, 5.5);
  } else {
    glassDome(c, ls, 7, -50, 5.5, accentColor);
  }
}

// ---------- Juggernaut ----------
function drawJuggernautBody(c, ls, color, dark, accentColor, wrecked) {
  drawTrackBand(c, ls, 52, 9, [-19, 0, 19]);

  c.beginPath();
  c.moveTo(-24, -9);
  c.lineTo(-24, -24);
  c.lineTo(19, -24);
  c.lineTo(24, -19);
  c.lineTo(24, -9);
  c.closePath();
  c.fillStyle = NEUTRAL_LIGHT;
  c.fill();
  c.strokeStyle = NEUTRAL_DARK;
  c.lineWidth = 1.6 * ls;
  c.stroke();

  c.strokeStyle = NEUTRAL_DARK;
  c.lineWidth = 1 * ls;
  [-8, 8].forEach(function (x) {
    c.beginPath();
    c.moveTo(x, -24);
    c.lineTo(x, -9);
    c.stroke();
  });
  c.fillStyle = NEUTRAL_RIVET;
  [[-8, -22], [-8, -11], [8, -22], [8, -11]].forEach(function (p) {
    c.beginPath();
    c.arc(p[0], p[1], 0.9, 0, Math.PI * 2);
    c.fill();
  });

  roundRectPath(c, 9, -21, 8, 6, 1);
  c.fillStyle = accentColor;
  c.fill();

  roundRectPath(c, -3, -22, 5, 3, 1);
  c.fillStyle = wrecked ? "#14171c" : GLASS_BLUE_SOLID;
  c.fill();
  if (wrecked) {
    c.strokeStyle = "rgba(220,230,240,0.6)";
    c.lineWidth = 0.5 * ls;
    c.beginPath();
    c.moveTo(-3, -22);
    c.lineTo(2, -19.2);
    c.stroke();
  }

  roundRectPath(c, -22, -9, 10, 5, 1);
  c.fillStyle = NEUTRAL_DARK;
  c.fill();
  roundRectPath(c, 6, -9, 13, 5, 1);
  c.fillStyle = NEUTRAL_DARK;
  c.fill();
  c.save();
  roundRectPath(c, 6, -9, 13, 5, 1);
  c.clip();
  c.strokeStyle = HAZARD_YELLOW;
  c.lineWidth = 1.4 * ls;
  for (var sx = 5; sx < 20; sx += 3.5) {
    c.beginPath();
    c.moveTo(sx, -9);
    c.lineTo(sx + 4, -4);
    c.stroke();
  }
  c.restore();

  roundRectPath(c, -12, -33, 16, 9, 2);
  c.fillStyle = NEUTRAL_DARK;
  c.fill();
  c.strokeStyle = accentColor;
  c.lineWidth = 1.2 * ls;
  roundRectPath(c, -12, -33, 16, 9, 2);
  c.stroke();

  roundRectPath(c, 2, -30, 5, 4, 1);
  c.fillStyle = NEUTRAL_DARK;
  c.fill();

  c.fillStyle = NEUTRAL_DARK;
  roundRectPath(c, -22, -28, 3, 5, 1);
  c.fill();
  roundRectPath(c, -17, -28, 3, 5, 1);
  c.fill();
  c.beginPath();
  c.arc(-20.5, -30, 1.6, 0, Math.PI * 2);
  c.fillStyle = "rgba(160,160,160,0.5)";
  c.fill();
}

var BODY_DRAWERS = {
  trooper: drawTrooperBody,
  jumper: drawJumperBody,
  juggernaut: drawJuggernautBody
};

// ---------- Wreckage (destroyed tank) ----------
// A destroyed tank keeps its type-correct silhouette (still recognizable
// which type it was) with generic damage decals on top instead of bespoke
// per-type damage art: cracked glass (handled inside each BODY_DRAWERS
// entry via its `wrecked` flag above), a scorched hole roughly centered on
// the hull, and a snapped, drooping barrel. Sizing the hole off this
// type's own hitHalfWidth/hitHeight (rather than hardcoded per-type
// coordinates) is what lets one function cover all three types.
function drawWreckDamage(c, ls, p) {
  var hw = p.hitHalfWidth, hh = p.hitHeight;
  var cx = 0, cy = -hh * 0.55;
  var r = Math.min(hw, hh) * 0.34;

  // Soot smudge - a few overlapping low-alpha dark blobs, not one clean
  // circle, so it reads as scorching rather than a painted dot.
  c.save();
  c.globalAlpha = 0.4;
  c.fillStyle = "#101114";
  [[-0.25, 0.35], [0.2, -0.15], [0, 0.05]].forEach(function (o) {
    c.beginPath();
    c.arc(cx + o[0] * hw, cy + o[1] * hh, r * 0.85, 0, Math.PI * 2);
    c.fill();
  });
  c.globalAlpha = 1;
  c.restore();

  // The hole itself - a jagged polygon from a fixed multi-harmonic sine
  // wobble (deterministic, not Math.random()) so the outline is stable
  // frame to frame instead of visibly vibrating; seeded off p.idx so
  // different tanks' wrecks don't all show the exact same shape.
  c.save();
  c.beginPath();
  var pts = 9;
  for (var i = 0; i <= pts; i++) {
    var a = (i / pts) * Math.PI * 2;
    var rr = r * (1 + 0.22 * Math.sin(a * 3 + p.idx * 1.7) + 0.14 * Math.cos(a * 5 + p.idx * 0.9));
    var px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr * 0.85;
    if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
  }
  c.closePath();
  c.fillStyle = "#050506";
  c.fill();
  c.strokeStyle = "#6b3a1f";
  c.lineWidth = 1.6 * ls;
  c.stroke();
  c.restore();
}

// Fixed drooping/snapped pose, independent of the tank's actual aim angle
// (nothing to aim anymore) - a short stub with a jagged torn tip instead
// of the normal clean muzzle/collar. Drawn outside the mirrored
// ctx.scale(dir,1) scope using dir-aware vectors directly, same
// convention drawBarrelShape follows for the live barrel.
function drawBrokenBarrel(c, ls, pivotX, pivotY, len, lw, dir) {
  var angleDeg = -72;
  var rad = angleDeg * Math.PI / 180;
  var bx = Math.cos(rad) * dir, by = -Math.sin(rad);
  var stubLen = len * 0.5;
  var tipX = pivotX + bx * stubLen, tipY = pivotY + by * stubLen;

  c.strokeStyle = NEUTRAL_DARK;
  c.lineWidth = lw * ls;
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(pivotX, pivotY);
  c.lineTo(tipX, tipY);
  c.stroke();

  var nx = -by, ny = bx;
  c.strokeStyle = NEUTRAL_SILVER;
  c.lineWidth = lw * 0.55 * ls;
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(tipX - nx * lw * 0.9, tipY - ny * lw * 0.9);
  c.lineTo(tipX + bx * lw * 0.6, tipY + by * lw * 0.6);
  c.lineTo(tipX + nx * lw * 0.5, tipY + ny * lw * 0.5);
  c.stroke();
}

function drawWreckedTank(p) {
  var sx = p.x;
  var groundY = terrainHeightAt(p.x);
  var ls = 1 / store.camZoom;
  var dir = p.dir;
  var drawBody = BODY_DRAWERS[p.tankType] || drawTrooperBody;

  ctx.save();
  ctx.translate(sx, groundY);
  ctx.save();
  ctx.scale(dir, 1);
  drawBody(ctx, ls, p.color, p.colorDark, p.color, true);
  drawWreckDamage(ctx, ls, p);
  ctx.restore();

  var pivotX = p.barrelPivotX * dir;
  var pivotY = -p.barrelPivotY;
  drawBrokenBarrel(ctx, ls, pivotX, pivotY, p.barrelLength, p.barrelWidth, dir);
  ctx.restore();
}

// Called exactly once, from combat.js: afterResolve() the instant a tank
// is eliminated. Purely cosmetic state - no gameplay effect.
export function initWreck(p) {
  p.wreck = { smoke: [], sparks: [], smokeTimer: 0, sparkTimer: 0, explosion: null };
}

// The shared "blast" - flash, a handful of big black smoke puffs that
// billow outward, and small black debris "pixels" that launch out and
// fall under their own gravity until they hit the ground and settle.
// Reused by every EXPLOSION_KINDS entry (see spawnExplosion() below) -
// scale multiplies particle counts/sizes/speeds so "wave"'s bigger blast
// is the exact same code, not a second copy. Coordinates are relative to
// the same ground-anchored origin drawWreckEffects()/updateWreckEffects()
// already use for the ongoing wreck smoke/sparks.
function buildBlast(p, scale) {
  var smoke = [];
  var smokeCount = Math.round(EXPLOSION_SMOKE_COUNT * scale);
  for (var i = 0; i < smokeCount; i++) {
    var ang = randRange(0, Math.PI * 2);
    var spd = randRange(20, 55) * scale;
    var life = randRange(EXPLOSION_SMOKE_LIFE_MIN, EXPLOSION_SMOKE_LIFE_MAX);
    smoke.push({
      x: randRange(-6, 6), y: randRange(-10, 0),
      vx: Math.cos(ang) * spd * 0.4, vy: -Math.abs(Math.sin(ang) * spd) - 15,
      r: randRange(6, 10) * scale, life: life, maxLife: life
    });
  }
  var debris = [];
  var debrisCount = Math.round(EXPLOSION_DEBRIS_COUNT * scale);
  for (var j = 0; j < debrisCount; j++) {
    var a2 = randRange(0, Math.PI * 2);
    var s2 = randRange(40, 110) * scale;
    var life2 = randRange(EXPLOSION_DEBRIS_LIFE_MIN, EXPLOSION_DEBRIS_LIFE_MAX);
    debris.push({
      x: 0, y: -p.hitHeight * 0.4,
      vx: Math.cos(a2) * s2, vy: -Math.abs(Math.sin(a2) * s2) - 30,
      life: life2, maxLife: life2, landed: false
    });
  }
  return { flashT: EXPLOSION_FLASH_TIME, flashScale: scale, smoke: smoke, debris: debris };
}

// "sparks" kind's pre-blast phase: a brief fountain of hot pixel sparks
// sprayed from two points on the tank's body (left/right of its own
// hitbox center), arcing down to the ground under their own gravity
// before the shared blast takes over. Independent life timers per
// particle rather than a hard phase cutoff, so a few stragglers can
// still be finishing their fall right as the blast starts instead of
// vanishing on the frame the phase switches.
function buildSpraySparks(p) {
  var sparks = [];
  var groundY = p.hitHeight * 0.55; // same ground-relative offset EXPLOSION_DEBRIS lands at
  [-1, 1].forEach(function (side) {
    var ox = side * p.hitHalfWidth * 0.45;
    for (var i = 0; i < EXPLOSION_SPARK_SPRAY_COUNT; i++) {
      var life = randRange(EXPLOSION_SPARK_SPRAY_LIFE_MIN, EXPLOSION_SPARK_SPRAY_LIFE_MAX);
      sparks.push({
        x: ox + randRange(-3, 3), y: randRange(-6, 2),
        vx: side * randRange(15, 45), vy: randRange(-30, 10),
        life: life, maxLife: life, groundY: groundY, landed: false
      });
    }
  });
  return sparks;
}

// Called once, from combat.js: afterResolve(), right after initWreck() -
// separate from the ongoing wreck smoke/sparks above (which start empty
// and build up gradually; this is a sudden one-time burst that fades out
// on its own and leaves p.wreck.explosion null again once it has). Picks
// one of EXPLOSION_KINDS at random unless a specific kind is passed
// (bench/debug hooks only - the real game never does). "classic" has no
// pre-phase so its blast is built immediately; "sparks"/"wave" build their
// pre-phase state now and defer building the shared blast until that
// pre-phase's timer elapses, in updateWreckEffects() below.
export function spawnExplosion(p, kind) {
  if (!p.wreck) initWreck(p);
  var chosenKind = (kind && EXPLOSION_KINDS[kind]) ? kind : EXPLOSION_KIND_KEYS[Math.floor(Math.random() * EXPLOSION_KIND_KEYS.length)];
  var cfg = EXPLOSION_KINDS[chosenKind];
  var explosion = {
    kind: chosenKind, preKind: cfg.preKind, preDuration: cfg.preDuration,
    preTimer: cfg.preDuration, blastScale: cfg.blastScale,
    blast: null, spraySparks: null, wave: null
  };
  if (cfg.preKind === "sparks") explosion.spraySparks = buildSpraySparks(p);
  else if (cfg.preKind === "wave") explosion.wave = { radius: 0 };
  else explosion.blast = buildBlast(p, cfg.blastScale);
  p.wreck.explosion = explosion;
}

// Called every frame for every eliminated tank regardless of game state
// (aim/flight/resolve) - see main.js: update(). dt can be large under the
// AI-tuning bench's adaptive stepping; spawn timers and per-particle life
// decay both degrade gracefully under a big dt (at most one spawn per
// call each for smoke/sparks, particles older than their life just get
// pruned - no runaway growth or backlog).
export function updateWreckEffects(p, dt) {
  var w = p.wreck;
  if (!w) return;

  w.smokeTimer -= dt;
  if (w.smokeTimer <= 0 && w.smoke.length < WRECK_SMOKE_MAX) {
    var life = randRange(WRECK_SMOKE_LIFE_MIN, WRECK_SMOKE_LIFE_MAX);
    w.smoke.push({
      x: randRange(-4, 4), y: 0,
      vx: store.wind * 8 + randRange(-4, 4),
      vy: -randRange(WRECK_SMOKE_RISE_SPEED * 0.7, WRECK_SMOKE_RISE_SPEED * 1.3),
      r: randRange(3, 5),
      life: life, maxLife: life
    });
    w.smokeTimer = randRange(WRECK_SMOKE_INTERVAL_MIN, WRECK_SMOKE_INTERVAL_MAX);
  }
  w.smoke = w.smoke.filter(function (s) {
    s.life -= dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.r += dt * 3;
    return s.life > 0;
  });

  w.sparkTimer -= dt;
  if (w.sparkTimer <= 0 && w.sparks.length < WRECK_SPARK_MAX) {
    var sLife = randRange(WRECK_SPARK_LIFE_MIN, WRECK_SPARK_LIFE_MAX);
    w.sparks.push({
      x: randRange(-5, 5), y: randRange(-3, 3),
      vx: randRange(-6, 6), vy: randRange(-14, -4),
      life: sLife, maxLife: sLife
    });
    w.sparkTimer = randRange(WRECK_SPARK_INTERVAL_MIN, WRECK_SPARK_INTERVAL_MAX);
  }
  w.sparks = w.sparks.filter(function (s) {
    s.life -= dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    return s.life > 0;
  });

  if (w.explosion) {
    var ex = w.explosion;

    if (ex.spraySparks) {
      ex.spraySparks.forEach(function (s) {
        s.life -= dt;
        if (!s.landed) {
          s.vy += EXPLOSION_SPARK_SPRAY_GRAVITY * dt;
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          if (s.y >= s.groundY) { s.y = s.groundY; s.landed = true; s.vx = 0; s.vy = 0; }
        }
      });
      ex.spraySparks = ex.spraySparks.filter(function (s) { return s.life > 0; });
    }

    if (!ex.blast) {
      // Still in the pre-blast phase ("sparks" or "wave") - count its
      // timer down and grow the wave ring in step, then hand off to the
      // shared blast once it elapses.
      ex.preTimer -= dt;
      if (ex.wave) {
        ex.wave.radius = Math.min(EXPLOSION_WAVE_MAX_RADIUS, (1 - Math.max(0, ex.preTimer) / ex.preDuration) * EXPLOSION_WAVE_MAX_RADIUS);
      }
      if (ex.preTimer <= 0) {
        ex.blast = buildBlast(p, ex.blastScale);
      }
    } else {
      ex.blast.flashT = Math.max(0, ex.blast.flashT - dt);

      ex.blast.smoke.forEach(function (s) {
        s.life -= dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 40 * dt; // billow decelerates/settles rather than rising forever
        s.r += dt * 10;
      });
      ex.blast.smoke = ex.blast.smoke.filter(function (s) { return s.life > 0; });

      // Same ground-relative origin drawWreckEffects() anchors everything
      // to (terrainHeightAt(p.x) - hitHeight*0.55) - so "the ground" in
      // this local frame is +hitHeight*0.55 below that origin.
      var groundOffsetY = p.hitHeight * 0.55;
      ex.blast.debris.forEach(function (d) {
        d.life -= dt;
        if (!d.landed) {
          d.vy += EXPLOSION_DEBRIS_GRAVITY * dt;
          d.x += d.vx * dt;
          d.y += d.vy * dt;
          if (d.y >= groundOffsetY) { d.y = groundOffsetY; d.landed = true; d.vx = 0; d.vy = 0; }
        }
      });
      ex.blast.debris = ex.blast.debris.filter(function (d) { return d.life > 0; });

      var blastDone = ex.blast.flashT <= 0 && ex.blast.smoke.length === 0 && ex.blast.debris.length === 0;
      var sparksDone = !ex.spraySparks || ex.spraySparks.length === 0;
      if (blastDone && sparksDone) w.explosion = null;
    }
  }
}

// Drawn in world space (no ctx.scale(dir,1) needed - smoke/sparks are
// symmetric), anchored near the same hole drawWreckDamage() draws so the
// smoke visibly comes from the damage. Called from main.js: render()
// after all tanks are drawn.
export function drawWreckEffects(p) {
  var w = p.wreck;
  if (!w) return;
  var originX = p.x, originY = terrainHeightAt(p.x) - p.hitHeight * 0.55;

  w.smoke.forEach(function (s) {
    var t = Math.max(0, s.life / s.maxLife);
    ctx.save();
    ctx.globalAlpha = t * 0.45;
    ctx.fillStyle = "#767b82";
    ctx.beginPath();
    ctx.arc(originX + s.x, originY + s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  w.sparks.forEach(function (s) {
    var t = Math.max(0, s.life / s.maxLife);
    ctx.save();
    ctx.globalAlpha = t;
    ctx.fillStyle = "#ff9a2e";
    ctx.beginPath();
    ctx.arc(originX + s.x, originY + s.y, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffe066";
    ctx.beginPath();
    ctx.arc(originX + s.x, originY + s.y, 1.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  if (w.explosion) {
    var ex = w.explosion;

    if (ex.wave && !ex.blast) {
      var waveProgress = 1 - Math.max(0, ex.preTimer) / ex.preDuration;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - waveProgress) * 0.85;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 4 * (1 - waveProgress * 0.6);
      ctx.beginPath();
      ctx.arc(originX, originY, ex.wave.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (ex.spraySparks) {
      ex.spraySparks.forEach(function (s) {
        var t = Math.max(0, s.life / s.maxLife);
        // Hot white when freshly sprayed, cooling toward yellow-orange as
        // it ages - "yellowish to whitish" sparks, not a flat single color.
        var g = Math.round(240 - (1 - t) * 60);
        var b = Math.round(220 - (1 - t) * 200);
        ctx.save();
        ctx.globalAlpha = Math.min(1, t * 1.4);
        ctx.fillStyle = "rgb(255," + g + "," + b + ")";
        ctx.beginPath();
        ctx.arc(originX + s.x, originY + s.y, 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }

    if (ex.blast) {
      var bl = ex.blast;
      if (bl.flashT > 0) {
        var ft = bl.flashT / EXPLOSION_FLASH_TIME;
        ctx.save();
        ctx.globalAlpha = ft;
        ctx.fillStyle = "#fff3c4";
        ctx.beginPath();
        ctx.arc(originX, originY, (10 + (1 - ft) * 40) * bl.flashScale, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      bl.smoke.forEach(function (s) {
        var t = Math.max(0, s.life / s.maxLife);
        ctx.save();
        ctx.globalAlpha = t * 0.7;
        ctx.fillStyle = "#111214";
        ctx.beginPath();
        ctx.arc(originX + s.x, originY + s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
      bl.debris.forEach(function (d) {
        var t = Math.max(0, d.life / d.maxLife);
        ctx.save();
        ctx.globalAlpha = Math.min(1, t * 1.5);
        ctx.fillStyle = "#0a0a0a";
        ctx.fillRect(originX + d.x - 1.5, originY + d.y - 1.5, 3, 3);
        ctx.restore();
      });
    }
  }
}

// A crate sits at each unselected player's starting position - "boxes on
// the map" until that player picks a tank, at which point drawTank()
// simply stops calling this and draws the real body instead (an instant
// swap, no separate reveal animation/state needed).
export function drawSupplyCrate(p) {
  var sx = p.x;
  var groundY = terrainHeightAt(p.x);
  var ls = 1 / store.camZoom;
  ctx.save();
  ctx.translate(sx, groundY);

  roundRectPath(ctx, -18, -28, 36, 28, 3);
  ctx.fillStyle = "#5a4a38";
  ctx.fill();
  ctx.strokeStyle = "#2e2519";
  ctx.lineWidth = 1.6 * ls;
  ctx.stroke();

  ctx.strokeStyle = "#2e2519";
  ctx.lineWidth = 1.2 * ls;
  ctx.beginPath();
  ctx.moveTo(-18, -14); ctx.lineTo(18, -14);
  ctx.moveTo(-9, -28); ctx.lineTo(-9, 0);
  ctx.moveTo(9, -28); ctx.lineTo(9, 0);
  ctx.stroke();

  roundRectPath(ctx, -18, -21, 36, 6, 1);
  ctx.fillStyle = p.color;
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.font = "bold " + Math.round(14 * ls) + "px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("?", 0, -3);

  ctx.restore();
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
  var drawBody = BODY_DRAWERS[p.tankType] || drawTrooperBody;

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

// Static preview for tank-select tiles - draws onto an arbitrary canvas
// context at a fixed friendly angle, always "facing right" (no mirroring,
// there's no opponent to face). Reuses the exact same body/barrel drawing
// code the real match uses, so the tile is a true preview, not a mockup.
export function drawTankPreview(previewCtx, cx, groundY, scale, typeKey, color, dark, accentColor) {
  var t = findType(typeKey);
  previewCtx.save();
  previewCtx.translate(cx, groundY);
  previewCtx.scale(scale, scale);
  var drawBody = BODY_DRAWERS[t.key] || drawTrooperBody;
  drawBody(previewCtx, 1, color, dark, accentColor);
  drawBarrelShape(previewCtx, 1, t.barrelPivotX, -t.barrelPivotY, t.barrelLength, t.barrelWidth, 32, t.collar, t.muzzle);
  previewCtx.restore();
}

export function drawBullet() {
  if (!store.bullet) return;
  ctx.fillStyle = "#1a1a1a";
  ctx.beginPath();
  ctx.arc(store.bullet.x, store.bullet.y, 4, 0, Math.PI * 2);
  ctx.fill();
}

export function drawFlash() {
  var impactFlash = store.impactFlash;
  if (!impactFlash) return;
  var progress = 1 - impactFlash.t / 0.5;
  var r = 18 * (1 - progress) + 6;
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - progress);
  ctx.fillStyle = "#ffdd55";
  ctx.beginPath();
  ctx.arc(impactFlash.x, impactFlash.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (impactFlash.damageText != null) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - progress);
    ctx.fillStyle = "#fff59d";
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 3 / store.camZoom;
    ctx.font = "bold " + Math.round(16 / store.camZoom) + "px sans-serif";
    ctx.textAlign = "center";
    var ty = impactFlash.y - (14 + progress * 22) / store.camZoom;
    var label = "-" + impactFlash.damageText;
    ctx.strokeText(label, impactFlash.x, ty);
    ctx.fillText(label, impactFlash.x, ty);
    ctx.restore();
  }
}

export function drawImpactMarks() {
  for (var i = 0; i < store.lastImpact.length; i++) {
    var mark = store.lastImpact[i];
    if (!mark || mark.hitTank) continue;
    var mx = mark.x;
    ctx.save();
    ctx.strokeStyle = store.players[i].color;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 3 / store.camZoom;
    var r = 7;
    ctx.beginPath();
    ctx.moveTo(mx - r, mark.y - r); ctx.lineTo(mx + r, mark.y + r);
    ctx.moveTo(mx + r, mark.y - r); ctx.lineTo(mx - r, mark.y + r);
    ctx.stroke();
    ctx.restore();
  }
}
