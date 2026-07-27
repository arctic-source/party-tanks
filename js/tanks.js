import { store } from "./store.js";
import { FUEL_MAX, POWER_MAX, TANK_TYPES } from "./constants.js";
import { ctx } from "./canvas.js";
import { terrainHeightAt } from "./terrain.js";

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
    angle: 55,
    power: 55,
    fuel: FUEL_MAX,
    name: cfg.name,
    color: cfg.color,
    colorDark: cfg.colorDark,
    isBot: !!cfg.isBot,
    alive: true,
    selected: false
  };
  applyTankType(p, "trooper"); // sensible default until the player actually picks
  p.fuel = FUEL_MAX;
  return p;
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

// ---------- Trooper ----------
function drawTrooperBody(c, ls, color, dark, accentColor) {
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
  c.fillStyle = GLASS_BLUE_SOLID;
  c.fill();

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
function drawJumperBody(c, ls, color, dark, accentColor) {
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

  glassDome(c, ls, 7, -50, 5.5, accentColor);
}

// ---------- Juggernaut ----------
function drawJuggernautBody(c, ls, color, dark, accentColor) {
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
  c.fillStyle = GLASS_BLUE_SOLID;
  c.fill();

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

  var sx = p.x;
  var groundY = terrainHeightAt(p.x);
  var ls = 1 / store.camZoom;
  var dir = p.idx === 0 ? 1 : -1;
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
