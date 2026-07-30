// Bullet-in-flight and impact-moment rendering - the small, stateless
// pieces of combat.js's model (store.bullet, store.impactFlash,
// store.lastImpact) that need to be drawn. No dependency on tank art or
// wreckage; a true leaf module like terrain.js/scenery.js.
import { store } from "./store.js";
import { ctx } from "./canvas.js";

// A thin light outline around the dark fill so the bullet stays visible
// against any background - a flat black fill alone can nearly vanish
// against a dark map (e.g. Neon Scrapyard's night sky/asphalt) even
// though it read fine against every map's lighter sky/dirt tones. Keeping
// the black fill (not recoloring the bullet per map) means it still looks
// like "the same bullet" everywhere - only the outline exists for contrast.
export function drawBullet() {
  if (!store.bullet) return;
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1.2 / store.camZoom;
  ctx.fillStyle = "#1a1a1a";
  ctx.beginPath();
  ctx.arc(store.bullet.x, store.bullet.y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
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
