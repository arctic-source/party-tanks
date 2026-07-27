import { store } from "./store.js";
import {
  POWER_TO_SPEED, CRATER_RADIUS, CRATER_DEPTH, TREE_FIRE_RADIUS, TREE_FIRE_DAMAGE, FUEL_MAX
} from "./constants.js";
import { terrainHeightAt, deformTerrain } from "./terrain.js";
import { centerCameraOnActive } from "./camera.js";
import { updateTurnUI, showToast } from "./ui.js";

// Spawns at the barrel tip rather than a fixed offset from the tank body,
// using the same pivot point + direction vector drawTank() draws the
// barrel/aim arrow with - so the bullet always visibly leaves from where
// the yellow arrow points, at any angle. Pivot/length are per-tank-type
// now (constants.js: TANK_TYPES), not shared globals.
export function fire() {
  if (store.state !== "aim") return;
  var p = store.players[store.active];
  var rad = p.angle * Math.PI / 180;
  var dir = p.idx === 0 ? 1 : -1;
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
export function resolveImpact(x, y, hitTank, t) {
  var dmg = null;
  if (hitTank) {
    var shooter = store.players[store.active];
    var tt = Math.max(0, Math.min(1, t || 0));
    dmg = Math.round(shooter.maxDamage - (shooter.maxDamage - shooter.minDamage) * tt);
    hitTank.health = Math.max(0, hitTank.health - dmg);
    if (hitTank === shooter) {
      showToast("💥 " + hitTank.name + " caught themselves in the blast for " + dmg + " damage!");
    }
  }
  store.impactFlash = { x: x, y: y, t: 0.5, damageText: dmg };
  store.lastImpact[store.active] = { x: x, y: y, hitTank: !!hitTank };
  store.bullet = null;
  if (x >= 0 && x <= store.WORLD_W) deformTerrain(x, CRATER_RADIUS, CRATER_DEPTH);
  store.state = "resolve";
}

export function applyTreeFireDamage() {
  var messages = [];
  for (var i = 0; i < store.players.length; i++) {
    var p = store.players[i];
    var burned = store.trees.some(function (t) {
      return t.state === "burning" && Math.abs(p.x - t.x) < TREE_FIRE_RADIUS;
    });
    if (burned) {
      p.health = Math.max(0, p.health - TREE_FIRE_DAMAGE);
      messages.push(p.name + " took " + TREE_FIRE_DAMAGE + " HP from a burning tree!");
    }
  }
  if (messages.length) showToast("🔥 " + messages.join(" "));
}

export function decayTrees() {
  store.trees.forEach(function (t) {
    if (t.state === "burning") {
      t.burnTurnsLeft--;
      if (t.burnTurnsLeft <= 0) t.state = "ash";
    }
  });
}

export function afterResolve() {
  applyTreeFireDamage();

  var loser = store.players.filter(function (p) { return p.health <= 0; })[0];
  if (loser) {
    var winner = store.players[1 - loser.idx];
    document.getElementById("winText").textContent = winner.name + " Wins!";
    document.getElementById("overlay").classList.add("show");
    store.state = "gameover";
    return;
  }
  decayTrees();
  store.active = 1 - store.active;
  store.players[store.active].fuel = FUEL_MAX;
  store.state = "aim";
  centerCameraOnActive();
  updateTurnUI();
}
