// Everything about a destroyed tank: the wrecked-body damage decals, the
// ongoing ambient smoke/sparks, and the one-time elimination explosion
// (3 randomized kinds - see EXPLOSION_KINDS in constants.js). Sits on top
// of tankArt.js (reuses its neutral palette + getBodyDrawer for the
// wrecked-body pass); tanks.js sits on top of this module (drawTank()
// routes to drawWreckedTank() for eliminated tanks).
import { store } from "./store.js";
import {
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
import { NEUTRAL_DARK, NEUTRAL_SILVER, getBodyDrawer } from "./tankArt.js";

// ---------- Wreckage (destroyed tank) ----------
// A destroyed tank keeps its type-correct silhouette (still recognizable
// which type it was) with generic damage decals on top instead of bespoke
// per-type damage art: cracked glass (handled inside each body drawer via
// its `wrecked` flag, see tankArt.js), a scorched hole roughly centered on
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
// convention tankArt.js's drawBarrelShape follows for the live barrel.
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

export function drawWreckedTank(p) {
  var sx = p.x;
  var groundY = terrainHeightAt(p.x);
  var ls = 1 / store.camZoom;
  var dir = p.dir;
  var drawBody = getBodyDrawer(p.tankType);

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
