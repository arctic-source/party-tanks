import { store } from "./store.js";
import {
  POWER_TO_SPEED, CRATER_RADIUS, CRATER_DEPTH, SCENERY_FIRE_RADIUS, SCENERY_FIRE_DAMAGE, FUEL_MAX
} from "./constants.js";
import { terrainHeightAt, deformTerrain } from "./terrain.js";
import { centerCameraOnActive } from "./camera.js";
import { updateTurnUI, showToast } from "./ui.js";
import { closestAliveOpponent } from "./tanks.js";

// Spawns at the barrel tip rather than a fixed offset from the tank body,
// using the same pivot point + direction vector drawTank() draws the
// barrel/aim arrow with - so the bullet always visibly leaves from where
// the yellow arrow points, at any angle. Pivot/length are per-tank-type
// now (constants.js: TANK_TYPES), not shared globals.
export function fire() {
  if (store.state !== "aim") return;
  var p = store.players[store.active];
  var rad = p.angle * Math.PI / 180;
  var dir = p.dir;
  var bx = Math.cos(rad) * dir;
  var by = -Math.sin(rad);
  var speed = p.power * POWER_TO_SPEED;
  var pivotX = p.x + p.barrelPivotX * dir;
  var pivotY = terrainHeightAt(p.x) - p.barrelPivotY;
  store.bullet = {
    x: pivotX + bx * p.barrelLength,
    y: pivotY + by * p.barrelLength,
    vx: bx * speed,
    vy: by * speed,
    elapsed: 0
  };
  store.state = "flight";
}

// t is a box-normalized 0..1 distance from the hit tank's own center to
// its box edge (0 = dead center, 1 = right at the edge) - computed by the
// caller via main.js's hitTest(), since it depends on that tank's own
// hitHalfWidth/hitHeight. Damage dealt uses the SHOOTER's own min/max
// damage (an attacker trait), not the defender's.
//
// reason is optional ("scenery"/"offworld"/"terrain"/"self"/"defender",
// passed by each of main.js's five call sites) and unused by the real
// game - it exists only so bench/benchRunner.js's window.__BENCH__ hook
// below can tell apart the three cases that already pass hitTank: null
// (scenery/offworld/terrain), which are otherwise indistinguishable from
// outside this function. See CLAUDE.md's load-bearing decision on the
// simulation bench for why this guard pattern is safe to leave in place.
export function resolveImpact(x, y, hitTank, t, reason) {
  var dmg = null;
  var shooter = store.players[store.active];
  if (hitTank) {
    var tt = Math.max(0, Math.min(1, t || 0));
    dmg = Math.round(shooter.maxDamage - (shooter.maxDamage - shooter.minDamage) * tt);
    hitTank.health = Math.max(0, hitTank.health - dmg);
    if (hitTank === shooter) {
      showToast("💥 " + hitTank.name + " caught themselves in the blast for " + dmg + " damage!");
    }
  }
  if (window.__BENCH__ && window.__BENCH__.pendingShot) {
    // "Miss distance" against the closest alive opponent - the same
    // reference point bot.js's real targeting uses - since a free-for-all
    // has no single fixed "the defender" to measure against.
    var refOpp = closestAliveOpponent(shooter);
    window.__BENCH__.pendingShot.landingX = x;
    window.__BENCH__.pendingShot.landingY = y;
    window.__BENCH__.pendingShot.missDistance = refOpp ? Math.abs(x - refOpp.x) : null;
    window.__BENCH__.pendingShot.hitOpponent = !!hitTank && hitTank !== shooter;
    window.__BENCH__.pendingShot.hitSelf = hitTank === shooter;
    window.__BENCH__.pendingShot.damage = dmg;
    window.__BENCH__.pendingShot.reason = reason || null;
    window.__BENCH__.pendingShot = null;
  }
  store.impactFlash = { x: x, y: y, t: 0.5, damageText: dmg };
  store.lastImpact[store.active] = { x: x, y: y, hitTank: !!hitTank };
  store.bullet = null;
  if (x >= 0 && x <= store.WORLD_W) deformTerrain(x, CRATER_RADIUS, CRATER_DEPTH);
  store.state = "resolve";
}

export function applySceneryFireDamage() {
  var messages = [];
  for (var i = 0; i < store.players.length; i++) {
    var p = store.players[i];
    var burned = store.scenery.some(function (t) {
      return t.state === "burning" && Math.abs(p.x - t.x) < SCENERY_FIRE_RADIUS;
    });
    if (burned) {
      p.health = Math.max(0, p.health - SCENERY_FIRE_DAMAGE);
      messages.push(p.name + " took " + SCENERY_FIRE_DAMAGE + " HP from a burning tree!");
    }
  }
  if (messages.length) showToast("🔥 " + messages.join(" "));
}

export function decayScenery() {
  store.scenery.forEach(function (t) {
    if (t.state === "burning") {
      t.burnTurnsLeft--;
      if (t.burnTurnsLeft <= 0) t.state = "ash";
    }
  });
}

export function afterResolve() {
  applySceneryFireDamage();

  // Mark anyone newly at 0 health as eliminated - stays on the field as
  // wreckage (still drawn, never hit-tested, never gets another turn)
  // rather than being removed. Usually at most one player crosses this
  // per resolve (a single bullet only ever hits one tank), but burning-
  // scenery damage above can finish off more than one at once.
  store.players.forEach(function (p) {
    if (p.alive && p.health <= 0) {
      p.alive = false;
      showToast("💥 " + p.name + " eliminated!");
    }
  });

  var survivors = store.players.filter(function (p) { return p.alive; });
  if (survivors.length <= 1) {
    // survivors.length === 0 is a rare simultaneous-elimination edge case
    // (e.g. fire damage finishing off the last two players in the same
    // resolve) - call it a draw rather than crashing on an undefined winner.
    var winner = survivors[0];
    document.getElementById("winText").textContent = winner ? winner.name + " Wins!" : "Draw!";
    document.getElementById("overlay").classList.add("show");
    store.state = "gameover";
    return;
  }

  decayScenery();
  do {
    store.active = (store.active + 1) % store.players.length;
  } while (!store.players[store.active].alive);
  store.players[store.active].fuel = FUEL_MAX;
  store.state = "aim";
  centerCameraOnActive();
  updateTurnUI();
}
