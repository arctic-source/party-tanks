import { store } from "./store.js";
import {
  PLAYER_SPACING, WING_MARGIN, MAP_SIZE_MULTIPLIER,
  GRAVITY, WIND_MAX_ACCEL, WIND_LEVELS, MOVE_SPEED, FUEL_MAX, FUEL_PER_SEC,
  HIT_RADIUS, ANGLE_MIN, ANGLE_MAX, ANGLE_RATE, POWER_MIN, POWER_MAX, POWER_RATE,
  TANK_HALF_H, TREE_BASE_HEIGHT, TREE_CANOPY_FRAC, TREE_RADIUS_FRAC, BURN_TURNS,
  SELF_DAMAGE_GRACE
} from "./constants.js";
import { randRange } from "./utils.js";
import { ctx, canvasWrap, resizeCanvas } from "./canvas.js";
import {
  centerCameraOnActive, recenterView, clampCam,
  onPointerDown, onPointerMove, onPointerUp
} from "./camera.js";
import { generateTerrain, terrainHeightAt, drawTerrain } from "./terrain.js";
import { generateTrees, generateBgTrees, drawTrees } from "./trees.js";
import { generateClouds, drawBackground, drawClouds } from "./background.js";
import { newTank, drawTank, drawBullet, drawFlash, drawImpactMarks } from "./tanks.js";
import { fire, resolveImpact, afterResolve } from "./combat.js";
import { showScreen, renderPlayerRows, renderWindConfig, changeWindLevel, applyPlayerConfigToGame } from "./playerConfig.js";
import { updateTurnUI, updateFuelUI, updateAimUI, updateWindUI, showToast, updateFsButton } from "./ui.js";

// Sizes the arena around however many players are actually in the match:
// each active player gets a fixed spacing budget (scaled by map size),
// and the world is that arena plus a fixed scenery/panning margin on
// each end - so terrain generation can treat "near the arena" and "the
// far wings" as genuinely different zones instead of the arena being a
// tiny sliver lost in a much bigger, mostly-irrelevant map.
function computeArenaLayout() {
  var n = 2; // ACTIVE_SLOTS
  var spacing = PLAYER_SPACING * MAP_SIZE_MULTIPLIER;
  var arenaSpan = spacing * Math.max(1, n - 1);
  store.WORLD_W = Math.round(arenaSpan + WING_MARGIN * 2);
  var xs = [];
  for (var i = 0; i < n; i++) xs.push(Math.round(WING_MARGIN + i * spacing));
  store.playerStartXs = xs;
}

// Wind is constant for the whole round (currently the whole match, since
// rounds are locked to 1) - rolled once here rather than per shot, from
// the magnitude band the config screen's selected level points at.
function generateWind() {
  var level = WIND_LEVELS[store.windLevelIndex];
  if (level.max <= 0) { store.wind = 0; return; }
  var mag = randRange(level.min, level.max);
  store.wind = Math.random() < 0.5 ? -mag : mag;
}

function startMatch() {
  computeArenaLayout();
  generateTerrain();
  store.players = [newTank(0), newTank(1)];
  store.active = 0;
  store.state = "aim";
  store.bullet = null;
  store.impactFlash = null;
  store.lastImpact = [null, null];
  store.mountainSeed1 = Math.random() * 1000;
  store.mountainSeed2 = Math.random() * 1000;
  generateTrees([store.players[0].x, store.players[1].x]);
  generateBgTrees();
  generateClouds();
  generateWind();
  updateWindUI();
  store.camZoom = 1;
  centerCameraOnActive();
  updateTurnUI();
  showToast("Terrain: " + store.currentLayoutName);
  document.getElementById("overlay").classList.remove("show");
}

// ---------- Input: buttons (press-and-hold) ----------
function bindHold(id, key) {
  var el = document.getElementById(id);
  function down(e) { e.preventDefault(); store.held[key] = true; el.classList.add("held"); }
  function up(e) { if (e) e.preventDefault(); store.held[key] = false; el.classList.remove("held"); }
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("pointerleave", up);
}
bindHold("btnLeft", "left");
bindHold("btnRight", "right");
bindHold("btnAngleUp", "angleUp");
bindHold("btnAngleDown", "angleDown");
bindHold("btnPowerUp", "powerUp");
bindHold("btnPowerDown", "powerDown");

document.getElementById("fireBtn").addEventListener("pointerdown", function (e) {
  e.preventDefault();
  fire();
});
document.getElementById("recenterBtn").addEventListener("pointerdown", function (e) {
  e.preventDefault();
  recenterView();
});
document.getElementById("backToSetupBtn").addEventListener("pointerdown", function (e) {
  e.preventDefault();
  store.matchActive = false;
  document.getElementById("overlay").classList.remove("show");
  showScreen("screenPlayers");
});

// ---------- Pre-game screen navigation ----------
document.getElementById("newGameBtn").addEventListener("pointerdown", function (e) {
  e.preventDefault();
  showScreen("screenPlayers");
});
document.getElementById("playersNextBtn").addEventListener("pointerdown", function (e) {
  e.preventDefault();
  showScreen("screenRounds");
});
document.getElementById("roundsBackBtn").addEventListener("pointerdown", function (e) {
  e.preventDefault();
  showScreen("screenPlayers");
});
document.getElementById("startGameBtn").addEventListener("pointerdown", function (e) {
  e.preventDefault();
  beginMatchFromConfig();
});
document.getElementById("windArrowLeftBtn").addEventListener("pointerdown", function (e) {
  e.preventDefault();
  changeWindLevel(-1);
});
document.getElementById("windArrowRightBtn").addEventListener("pointerdown", function (e) {
  e.preventDefault();
  changeWindLevel(1);
});

// ---------- Fullscreen toggle ----------
document.addEventListener("fullscreenchange", updateFsButton);
updateFsButton();

document.getElementById("fsBtn").addEventListener("pointerdown", function (e) {
  e.preventDefault();
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(function () {});
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock("landscape").catch(function () {});
    }
  } else {
    document.exitFullscreen().catch(function () {});
  }
});

// ---------- Input: drag to pan, pinch to zoom ----------
canvasWrap.addEventListener("pointerdown", onPointerDown);
canvasWrap.addEventListener("pointermove", onPointerMove);
canvasWrap.addEventListener("pointerup", onPointerUp);
canvasWrap.addEventListener("pointercancel", onPointerUp);

// ---------- Update loop ----------
function update(dt) {
  if (store.state === "aim") {
    var p = store.players[store.active];
    if (store.held.angleUp) p.angle = Math.min(ANGLE_MAX, p.angle + ANGLE_RATE * dt);
    if (store.held.angleDown) p.angle = Math.max(ANGLE_MIN, p.angle - ANGLE_RATE * dt);
    if (store.held.powerUp) p.power = Math.min(POWER_MAX, p.power + POWER_RATE * dt);
    if (store.held.powerDown) p.power = Math.max(POWER_MIN, p.power - POWER_RATE * dt);

    if (p.fuel > 0) {
      var mv = 0;
      if (store.held.left) mv -= 1;
      if (store.held.right) mv += 1;
      if (mv !== 0) {
        var dist = MOVE_SPEED * dt;
        p.x += mv * dist;
        p.x = Math.max(10, Math.min(store.WORLD_W - 10, p.x));
        p.fuel = Math.max(0, p.fuel - FUEL_PER_SEC * dt);
        // Auto-follow horizontally while driving so the tank never drifts
        // out of view; vertical framing/zoom stay untouched.
        store.camCenterX = p.x;
        clampCam();
      }
    }
    updateFuelUI();
    updateAimUI();
  } else if (store.state === "flight") {
    var bullet = store.bullet;
    bullet.vy += GRAVITY * dt;
    bullet.vx += store.wind * WIND_MAX_ACCEL * dt;
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.elapsed += dt;

    // camera follows bullet
    store.camCenterX = bullet.x;
    store.camCenterY = bullet.y;
    clampCam();

    var shooter = store.players[store.active];
    var defender = store.players[1 - store.active];
    var dx = bullet.x - defender.x;
    var dy = bullet.y - (terrainHeightAt(defender.x) - TANK_HALF_H);
    var dist2 = dx * dx + dy * dy;

    // Self-damage only arms after a brief grace period so the bullet
    // clears its own barrel first - otherwise every shot would trigger
    // an instant self-hit at the spawn point right next to the tank.
    var selfDist2 = null;
    if (bullet.elapsed >= SELF_DAMAGE_GRACE) {
      var sdx = bullet.x - shooter.x;
      var sdy = bullet.y - (terrainHeightAt(shooter.x) - TANK_HALF_H);
      selfDist2 = sdx * sdx + sdy * sdy;
    }

    var hitTree = null;
    for (var ti = 0; ti < store.trees.length; ti++) {
      var tr = store.trees[ti];
      if (tr.state !== "alive") continue;
      var tH = TREE_BASE_HEIGHT * tr.scale;
      var tCanopyY = terrainHeightAt(tr.x) - tH * TREE_CANOPY_FRAC;
      var tdx = bullet.x - tr.x, tdy = bullet.y - tCanopyY;
      var tRadius = tH * TREE_RADIUS_FRAC;
      if (tdx * tdx + tdy * tdy <= tRadius * tRadius) { hitTree = tr; break; }
    }

    if (hitTree) {
      hitTree.state = "burning";
      hitTree.burnTurnsLeft = BURN_TURNS;
      resolveImpact(bullet.x, bullet.y, null);
    } else if (bullet.x < 0 || bullet.x > store.WORLD_W) {
      resolveImpact(bullet.x, bullet.y, null);
    } else if (selfDist2 !== null && selfDist2 <= HIT_RADIUS * HIT_RADIUS) {
      resolveImpact(bullet.x, bullet.y, shooter, Math.sqrt(selfDist2));
    } else if (dist2 <= HIT_RADIUS * HIT_RADIUS) {
      resolveImpact(bullet.x, bullet.y, defender, Math.sqrt(dist2));
    } else if (bullet.y >= terrainHeightAt(bullet.x)) {
      resolveImpact(bullet.x, terrainHeightAt(bullet.x), null);
    }
  } else if (store.state === "resolve") {
    store.impactFlash.t -= dt;
    if (store.impactFlash.t <= 0) {
      store.impactFlash = null;
      afterResolve();
    }
  }
}

// ---------- Render ----------
function render() {
  drawBackground();
  ctx.save();
  ctx.translate(store.VIEW_W / 2, store.VIEW_H / 2);
  ctx.scale(store.camZoom, store.camZoom);
  ctx.translate(-store.camCenterX, -store.camCenterY);
  drawTerrain();
  drawImpactMarks();
  drawTrees("ash");
  store.players.forEach(drawTank);
  drawTrees("alive");
  drawTrees("burning");
  drawBullet();
  drawFlash();
  drawClouds();
  ctx.restore();
}

// ---------- Main loop ----------
function frame(t) {
  if (store.lastT === null) store.lastT = t;
  var dt = Math.min(0.05, (t - store.lastT) / 1000);
  store.lastT = t;
  if (store.matchActive) {
    update(dt);
    render();
  }
  requestAnimationFrame(frame);
}

function beginMatchFromConfig() {
  applyPlayerConfigToGame();
  showScreen("screenMatch");
  resizeCanvas();
  store.matchActive = true;
  startMatch();
}

// ---------- Boot ----------
function boot() {
  renderPlayerRows();
  renderWindConfig();
  showScreen("screenWelcome");
  requestAnimationFrame(frame);
}
boot();

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(function () {});
}
