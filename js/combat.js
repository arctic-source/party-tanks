import { store } from "./store.js";
import {
  TANK_HALF_W, TANK_HALF_H, POWER_TO_SPEED, HIT_RADIUS, MIN_DAMAGE, MAX_DAMAGE,
  CRATER_RADIUS, CRATER_DEPTH, TREE_FIRE_RADIUS, TREE_FIRE_DAMAGE, FUEL_MAX
} from "./constants.js";
import { terrainHeightAt, deformTerrain } from "./terrain.js";
import { centerCameraOnActive } from "./camera.js";
import { updateTurnUI, showToast } from "./ui.js";

export function fire() {
  if (store.state !== "aim") return;
  var p = store.players[store.active];
  var rad = p.angle * Math.PI / 180;
  var dir = p.idx === 0 ? 1 : -1;
  var speed = p.power * POWER_TO_SPEED;
  store.bullet = {
    x: p.x + dir * (TANK_HALF_W + 6),
    y: terrainHeightAt(p.x) - TANK_HALF_H - 10,
    vx: Math.cos(rad) * speed * dir,
    vy: -Math.sin(rad) * speed,
    elapsed: 0
  };
  store.state = "flight";
}

export function resolveImpact(x, y, hitTank, hitDist) {
  var dmg = null;
  if (hitTank) {
    var t = Math.max(0, Math.min(1, (hitDist || 0) / HIT_RADIUS));
    dmg = Math.round(MAX_DAMAGE - (MAX_DAMAGE - MIN_DAMAGE) * t);
    hitTank.health = Math.max(0, hitTank.health - dmg);
    if (hitTank === store.players[store.active]) {
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
