import { store } from "./store.js";
import {
  PLAYER_SPACING, WING_MARGIN, MAP_SIZE_MULTIPLIER, MAPS,
  GRAVITY, WIND_MAX_ACCEL,
  ANGLE_MIN, ANGLE_MAX, ANGLE_RATE, POWER_MIN, POWER_MAX, POWER_RATE,
  SCENERY_TYPES, BURN_TURNS,
  SELF_DAMAGE_GRACE, ELIMINATION_HOLD_TIME
} from "./constants.js";
import { ctx, canvasWrap, resizeCanvas } from "./canvas.js";
import {
  centerCameraOnActive, recenterView, clampCam,
  onPointerDown, onPointerMove, onPointerUp
} from "./camera.js";
import { generateTerrain, terrainHeightAt, drawTerrain } from "./terrain.js";
import { generateScenery, generateBgTrees, generateBgPyramids, generateBgOrchardTrees, drawScenery, sceneryHitAt } from "./scenery.js";
import { stepBallistic, shuffleArray } from "./utils.js";
import { generateClouds, drawBackground, drawClouds } from "./background.js";
import { newTank, drawTank } from "./tanks.js";
import { drawBullet, drawFlash, drawImpactMarks } from "./projectiles.js";
import { updateWreckEffects, drawWreckEffects, spawnExplosion } from "./wreckage.js";
import { fire, resolveImpact, afterResolve, finishTurn } from "./combat.js";
import { showScreen, renderPlayerRows, renderWindConfig, changeWindLevel, renderMapConfig, changeMapIndex, applyPlayerConfigToGame, activePlayerCount } from "./playerConfig.js";
import { updateTurnUI, updateFuelUI, updateAimUI, showToast, updateFsButton } from "./ui.js";
import { runBot } from "./bot.js";
import { beginTankSelection, confirmTankSelection } from "./tankSelect.js";

// Sizes the arena around however many players are actually in the match:
// each active player gets a fixed spacing budget (scaled by map size),
// and the world is that arena plus a fixed scenery/panning margin on
// each end - so terrain generation can treat "near the arena" and "the
// far wings" as genuinely different zones instead of the arena being a
// tiny sliver lost in a much bigger, mostly-irrelevant map.
function computeArenaLayout() {
  var n = store.gameConfig.players.length;
  var spacing = PLAYER_SPACING * MAP_SIZE_MULTIPLIER;
  var arenaSpan = spacing * Math.max(1, n - 1);
  store.WORLD_W = Math.round(arenaSpan + WING_MARGIN * 2);
  var xs = [];
  for (var i = 0; i < n; i++) xs.push(Math.round(WING_MARGIN + i * spacing));
  store.playerStartXs = xs;
}

// Exported (nothing in the real app imports from main.js today - it's the
// root module) so bench/benchRunner.js can drive a full match headlessly,
// without going through requestAnimationFrame or the pre-game screens.
export function startMatch() {
  store.activeMap = MAPS[store.mapIndex];
  // One shuffle decides both starting position (playerStartXs[i] below)
  // and turn order (store.active cycles 0..N-1 later) - "going around the
  // table." See CLAUDE.md's load-bearing decision on N-player matches.
  shuffleArray(store.gameConfig.players);
  computeArenaLayout();
  generateTerrain();
  store.players = store.gameConfig.players.map(function (_, i) { return newTank(i); });
  store.bullet = null;
  store.impactFlash = null;
  store.lastImpact = store.players.map(function () { return null; });
  store.mountainSeeds = store.activeMap.bgLayers.map(function () { return Math.random() * 1000; });
  generateScenery(store.players.map(function (p) { return p.x; }));
  // Both generated unconditionally every match regardless of which the
  // active map's bgLayers actually use - simpler than gating generation
  // itself, and cheap enough that generating the unused one isn't worth
  // the extra branch (same call as bgTrees/bgPyramids already made).
  generateBgTrees();
  generateBgOrchardTrees();
  var pyramidLayer = store.activeMap.bgLayers.find(function (l) { return l.shape === "pyramids"; });
  generateBgPyramids(pyramidLayer ? (pyramidLayer.count || 3) : 3);
  generateClouds();
  store.held.left = false;
  store.held.right = false;
  store.bot.active = false;
  store.bot.phase = null;
  store.bot.waitTimer = 0;
  store.bot.moveTimer = null;
  store.camZoom = 1;
  document.getElementById("overlay").classList.remove("show");
  // Wind/turn-start toast/camera-centering happen once every player has
  // picked a tank - see tankSelect.js: finishTankSelection().
  beginTankSelection();
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
bindHold("btnAngleLeft", "angleLeft");
bindHold("btnAngleRight", "angleRight");
bindHold("btnPowerUp", "powerUp");
bindHold("btnPowerDown", "powerDown");

document.getElementById("fireBtn").addEventListener("pointerdown", function (e) {
  e.preventDefault();
  if (store.players[store.active].isBot) return; // the bot fires itself via bot.js
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
  // Belt-and-suspenders alongside playersNextBtn's own disabled state
  // (renderPlayerRows()): Start Game gets the same active-player-count
  // check the moment we navigate to it, so a match can't be started with
  // fewer than 2 participants regardless of how this screen was reached.
  document.getElementById("startGameBtn").disabled = activePlayerCount() < 2;
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
document.getElementById("tsConfirmBtn").addEventListener("pointerdown", function (e) {
  e.preventDefault();
  confirmTankSelection();
});
document.getElementById("windArrowLeftBtn").addEventListener("pointerdown", function (e) {
  e.preventDefault();
  changeWindLevel(-1);
});
document.getElementById("windArrowRightBtn").addEventListener("pointerdown", function (e) {
  e.preventDefault();
  changeWindLevel(1);
});
document.getElementById("mapArrowLeftBtn").addEventListener("pointerdown", function (e) {
  e.preventDefault();
  changeMapIndex(-1);
});
document.getElementById("mapArrowRightBtn").addEventListener("pointerdown", function (e) {
  e.preventDefault();
  changeMapIndex(1);
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

// Axis-aligned hit BOX anchored at ground level (see CLAUDE.md - a circle
// can't independently match width vs height, and our three tank types
// have very different aspect ratios). Returns a 0..1 "how close to
// center" value for damage falloff (0 = dead center, 1 = right at the
// box edge), or null if the bullet is outside the box entirely.
function hitTest(bullet, tank) {
  var dx = bullet.x - tank.x;
  var halfH = tank.hitHeight / 2;
  var centerY = terrainHeightAt(tank.x) - halfH;
  var dy = bullet.y - centerY;
  if (Math.abs(dx) > tank.hitHalfWidth || Math.abs(dy) > halfH) return null;
  return Math.max(Math.abs(dx) / tank.hitHalfWidth, Math.abs(dy) / halfH);
}

// ---------- Update loop ----------
// Exported for bench/benchRunner.js, which calls this directly in a tight
// loop with a dt it chooses itself (instead of real elapsed rAF time) -
// see CLAUDE.md's load-bearing decision on the simulation bench.
export function update(dt) {
  // Runs every frame regardless of aim/flight/resolve state - an
  // eliminated tank keeps smoking/sparking through the rest of the match,
  // not just during its own (nonexistent) turn.
  store.players.forEach(function (p) {
    if (!p.alive) updateWreckEffects(p, dt);
  });

  if (store.state === "aim") {
    var p = store.players[store.active];
    if (p.isBot) {
      runBot(dt);
    } else {
      // Buttons are screen-relative (Left/Right tilt the barrel tip
      // toward that side of the screen), not angle-relative (Up/Down
      // rotating clockwise vs anticlockwise depending on which way the
      // tank happens to face) - the old Up/Down labels meant opposite
      // rotation directions depending on facing, which is exactly what
      // made them confusing. p.angle's 0..180 sweep already goes from
      // "barrel tip toward dir" through straight up to "away from dir"
      // (see combat.js: fire()'s bx = cos(angle) * dir), so reaching
      // screen-right consistently means increasing angle when dir is -1
      // and decreasing it when dir is 1 - i.e. scaling the delta by dir
      // flips which button increases/decreases p.angle per facing, so
      // every tank's Right button always visibly tilts the barrel
      // rightward regardless of which way it's facing.
      var dir = p.dir;
      if (store.held.angleRight) p.angle = Math.max(ANGLE_MIN, Math.min(ANGLE_MAX, p.angle - ANGLE_RATE * dt * dir));
      if (store.held.angleLeft) p.angle = Math.max(ANGLE_MIN, Math.min(ANGLE_MAX, p.angle + ANGLE_RATE * dt * dir));
      if (store.held.powerUp) p.power = Math.min(POWER_MAX, p.power + POWER_RATE * dt);
      if (store.held.powerDown) p.power = Math.max(POWER_MIN, p.power - POWER_RATE * dt);
    }

    // The bot reuses this same movement/fuel mechanic for its own
    // "drive toward the opponent" phase (see bot.js) - but only then, so a
    // stray held-key state can't reposition the bot's tank during its
    // "waiting to fire" pause after it's already aimed from a position.
    var canMove = !p.isBot || store.bot.phase === "moving";
    if (canMove && p.fuel > 0) {
      var mv = 0;
      if (store.held.left) mv -= 1;
      if (store.held.right) mv += 1;
      if (mv !== 0) {
        var dist = p.moveSpeed * dt;
        p.x += mv * dist;
        p.x = Math.max(10, Math.min(store.WORLD_W - 10, p.x));
        p.fuel = Math.max(0, p.fuel - p.fuelPerSec * dt);
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
    stepBallistic(bullet, GRAVITY, store.wind * WIND_MAX_ACCEL, dt);
    bullet.elapsed += dt;

    // camera follows bullet
    store.camCenterX = bullet.x;
    store.camCenterY = bullet.y;
    clampCam();

    var shooter = store.players[store.active];

    // Self-damage only arms after a brief grace period so the bullet
    // clears its own barrel first - otherwise every shot would trigger
    // an instant self-hit at the spawn point right next to the tank.
    var selfT = bullet.elapsed >= SELF_DAMAGE_GRACE ? hitTest(bullet, shooter) : null;

    // Test every other still-alive tank, not one fixed "the" opponent -
    // resolves on whichever one the bullet is actually inside. Eliminated
    // tanks are wreckage, not obstacles: excluded here so a bullet passes
    // straight through them.
    var defender = null, defT = null;
    for (var di = 0; di < store.players.length; di++) {
      var candidate = store.players[di];
      if (candidate === shooter || !candidate.alive) continue;
      var t = hitTest(bullet, candidate);
      if (t !== null) { defender = candidate; defT = t; break; }
    }

    var sceneryType = SCENERY_TYPES[store.activeMap.scenery];
    var hitItem = sceneryHitAt(bullet.x, bullet.y);

    if (hitItem) {
      // Non-burnable scenery (a rock, a cactus, ...) just blocks the
      // bullet and stays exactly as it was - no state change at all.
      if (sceneryType.burnable) {
        hitItem.state = "burning";
        hitItem.burnTurnsLeft = BURN_TURNS;
      }
      resolveImpact(bullet.x, bullet.y, null, null, "scenery");
    } else if (bullet.x < 0 || bullet.x > store.WORLD_W) {
      resolveImpact(bullet.x, bullet.y, null, null, "offworld");
    } else if (selfT !== null) {
      resolveImpact(bullet.x, bullet.y, shooter, selfT, "self");
    } else if (defT !== null) {
      resolveImpact(bullet.x, bullet.y, defender, defT, "defender");
    } else if (bullet.y >= terrainHeightAt(bullet.x)) {
      resolveImpact(bullet.x, terrainHeightAt(bullet.x), null, null, "terrain");
    }
  } else if (store.state === "resolve") {
    store.impactFlash.t -= dt;
    if (store.impactFlash.t <= 0) {
      store.impactFlash = null;
      afterResolve();
    }
  } else if (store.state === "eliminated") {
    // Camera-held beat on a kill (afterResolve() already snapped the
    // camera onto the dying tank and punched the zoom in) - split into two
    // sub-phases so the punch-in actually registers before anything blows
    // up. "pause": camera sits zoomed in on the tank, nothing happening
    // yet. Once it elapses, spawn the explosion for every pending kill and
    // switch to "hold", which just waits ELIMINATION_HOLD_TIME more so the
    // player can see the blast/wreck before the pre-punch-in zoom is
    // restored (re-clamping position for it, since finishTurn()'s win-
    // overlay branch doesn't otherwise touch the camera at all) and control
    // hands off to finishTurn() for the win-check/turn-advance a non-kill
    // resolve would have run immediately. The wreck's own explosion burst
    // and ongoing smoke/sparks, once spawned, keep animating via the
    // unconditional updateWreckEffects() loop above regardless of phase.
    store.eliminationTimer -= dt;
    if (store.eliminationTimer <= 0) {
      if (store.eliminationPhase === "pause") {
        store.pendingEliminated.forEach(spawnExplosion);
        store.pendingEliminated = [];
        store.eliminationPhase = "hold";
        store.eliminationTimer = ELIMINATION_HOLD_TIME;
      } else {
        store.camZoom = store.eliminationPrevZoom;
        clampCam();
        finishTurn();
      }
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
  drawScenery("ash");
  store.players.forEach(drawTank);
  store.players.forEach(drawWreckEffects);
  drawScenery("alive");
  drawScenery("burning");
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
  // Hard stop, not just a disabled button: whatever screen/route got us
  // here, a match with fewer than 2 participants can't actually play
  // (afterResolve()'s win-check assumes at least 2) - it would start into
  // an empty, un-interactive world instead of erroring loudly. Bounce
  // back to setup rather than let that happen.
  if (store.gameConfig.players.length < 2) {
    showToast("Need at least 2 players to start a match.");
    showScreen("screenPlayers");
    return;
  }
  showScreen("screenMatch");
  resizeCanvas();
  store.matchActive = true;
  startMatch();
}

// ---------- Boot ----------
function boot() {
  renderPlayerRows();
  renderWindConfig();
  renderMapConfig();
  showScreen("screenWelcome");
  requestAnimationFrame(frame);
}
boot();

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(function () {});
}
