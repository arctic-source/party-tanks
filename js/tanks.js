import { store } from "./store.js";
import { HEALTH_MAX, FUEL_MAX, TANK_HALF_W, TANK_HALF_H, POWER_MAX } from "./constants.js";
import { ctx } from "./canvas.js";
import { terrainHeightAt } from "./terrain.js";

export function newTank(idx) {
  var startX = store.playerStartXs[idx];
  var cfg = store.gameConfig.players[idx];
  return {
    idx: idx,
    x: startX,
    health: HEALTH_MAX,
    fuel: FUEL_MAX,
    angle: 55,
    power: 55,
    name: cfg.name,
    color: cfg.color,
    colorDark: cfg.colorDark,
    alive: true
  };
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawTank(p) {
  var sx = p.x;
  var groundY = terrainHeightAt(p.x);
  var cy = groundY - TANK_HALF_H;

  ctx.save();
  ctx.translate(sx, cy);

  // body
  ctx.fillStyle = p.color;
  ctx.strokeStyle = p.colorDark;
  ctx.lineWidth = 2 / store.camZoom;
  roundRect(-TANK_HALF_W, -TANK_HALF_H, TANK_HALF_W * 2, TANK_HALF_H * 2, 5);
  ctx.fill(); ctx.stroke();

  // wheels
  ctx.fillStyle = "#22262f";
  ctx.beginPath(); ctx.arc(-TANK_HALF_W + 6, TANK_HALF_H, 6, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(TANK_HALF_W - 6, TANK_HALF_H, 6, 0, 7); ctx.fill();

  // barrel
  var dir = p.idx === 0 ? 1 : -1;
  var rad = p.angle * Math.PI / 180;
  var bx = Math.cos(rad) * dir;
  var by = -Math.sin(rad);
  ctx.strokeStyle = p.colorDark;
  ctx.lineWidth = 5 / store.camZoom;
  ctx.beginPath();
  ctx.moveTo(0, -4);
  ctx.lineTo(bx * 26, -4 + by * 26);
  ctx.stroke();

  ctx.restore();

  // aim arrow (active tank only, during aim)
  if (store.state === "aim" && p.idx === store.active) {
    var len = 20 + (p.power / POWER_MAX) * 55;
    ctx.strokeStyle = "rgba(255,255,60,0.9)";
    ctx.lineWidth = 3 / store.camZoom;
    ctx.beginPath();
    ctx.moveTo(sx, cy - 4);
    ctx.lineTo(sx + bx * len, cy - 4 + by * len);
    ctx.stroke();
    // arrow head
    ctx.beginPath();
    var hx = sx + bx * len, hy = cy - 4 + by * len;
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
  var pct = Math.max(0, p.health) / HEALTH_MAX;
  ctx.fillStyle = pct > 0.4 ? "#4caf50" : (pct > 0.15 ? "#e0b93a" : "#d1432c");
  ctx.fillRect(bx0, by0, barW * pct, barH);
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
