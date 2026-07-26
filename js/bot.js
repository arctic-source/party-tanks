import { store } from "./store.js";
import {
  GRAVITY, WIND_MAX_ACCEL, TANK_HALF_H, BARREL_LENGTH, BARREL_PIVOT_Y, POWER_TO_SPEED,
  ANGLE_MIN, ANGLE_MAX, POWER_MIN, POWER_MAX, TREE_BASE_HEIGHT, TREE_CANOPY_FRAC, TREE_RADIUS_FRAC,
  AI_LEVELS, AI_SIM_DT, AI_SIM_MAX_TIME, AI_COARSE_ANGLE_STEPS, AI_COARSE_POWER_STEPS, AI_REFINE_STEPS,
  AI_UNREACHABLE_THRESHOLD
} from "./constants.js";
import { terrainHeightAt } from "./terrain.js";
import { randRange, gaussianRandom } from "./utils.js";
import { fire } from "./combat.js";

// Dry-run flight simulator - mirrors the real "flight" physics in
// main.js's update() (same gravity/wind integration and terrain/tree
// stopping conditions) but never touches store.bullet, so the search
// below can try hundreds of candidate shots per turn with no side effects.
// Returns the x where the shot would come to rest (terrain, tree, or the
// edge of the world), which the search compares against a target x.
function simulateLanding(shooterX, shooterIdx, angle, power) {
  var dir = shooterIdx === 0 ? 1 : -1;
  var rad = angle * Math.PI / 180;
  var bx = Math.cos(rad) * dir;
  var by = -Math.sin(rad);
  var speed = power * POWER_TO_SPEED;
  var pivotY = terrainHeightAt(shooterX) - TANK_HALF_H - BARREL_PIVOT_Y;
  var x = shooterX + bx * BARREL_LENGTH;
  var y = pivotY + by * BARREL_LENGTH;
  var vx = bx * speed;
  var vy = by * speed;
  var elapsed = 0;

  while (elapsed < AI_SIM_MAX_TIME) {
    vy += GRAVITY * AI_SIM_DT;
    vx += store.wind * WIND_MAX_ACCEL * AI_SIM_DT;
    x += vx * AI_SIM_DT;
    y += vy * AI_SIM_DT;
    elapsed += AI_SIM_DT;

    if (x < 0) return 0;
    if (x > store.WORLD_W) return store.WORLD_W;

    for (var i = 0; i < store.trees.length; i++) {
      var t = store.trees[i];
      if (t.state !== "alive") continue;
      var tH = TREE_BASE_HEIGHT * t.scale;
      var tCanopyY = terrainHeightAt(t.x) - tH * TREE_CANOPY_FRAC;
      var tdx = x - t.x, tdy = y - tCanopyY;
      var tRadius = tH * TREE_RADIUS_FRAC;
      if (tdx * tdx + tdy * tdy <= tRadius * tRadius) return x;
    }

    if (y >= terrainHeightAt(x)) return x;
  }
  return x;
}

function gridSearch(shooterX, shooterIdx, targetX, angleLo, angleHi, angleSteps, powerLo, powerHi, powerSteps) {
  var best = null;
  for (var ai = 0; ai < angleSteps; ai++) {
    var angle = angleSteps === 1 ? angleLo : angleLo + (angleHi - angleLo) * (ai / (angleSteps - 1));
    for (var pi = 0; pi < powerSteps; pi++) {
      var power = powerSteps === 1 ? powerLo : powerLo + (powerHi - powerLo) * (pi / (powerSteps - 1));
      var landX = simulateLanding(shooterX, shooterIdx, angle, power);
      var dist = Math.abs(landX - targetX);
      if (!best || dist < best.dist) best = { angle: angle, power: power, dist: dist };
    }
  }
  return best;
}

// Coarse-to-fine grid search for the (angle, power) whose simulated landing
// spot is closest to targetX. Terrain/wind/trees make this hard to invert
// analytically, so we search instead - a few hundred dry-run simulations,
// cheap enough to run twice a turn with no perceptible delay.
function findBestShot(shooterX, shooterIdx, targetX) {
  var coarse = gridSearch(shooterX, shooterIdx, targetX, ANGLE_MIN, ANGLE_MAX, AI_COARSE_ANGLE_STEPS, POWER_MIN, POWER_MAX, AI_COARSE_POWER_STEPS);
  var angleSpan = (ANGLE_MAX - ANGLE_MIN) / (AI_COARSE_ANGLE_STEPS - 1);
  var powerSpan = (POWER_MAX - POWER_MIN) / (AI_COARSE_POWER_STEPS - 1);
  var refined = gridSearch(
    shooterX, shooterIdx, targetX,
    Math.max(ANGLE_MIN, coarse.angle - angleSpan), Math.min(ANGLE_MAX, coarse.angle + angleSpan), AI_REFINE_STEPS,
    Math.max(POWER_MIN, coarse.power - powerSpan), Math.min(POWER_MAX, coarse.power + powerSpan), AI_REFINE_STEPS
  );
  return refined.dist < coarse.dist ? refined : coarse;
}

// Perturbs the AIM POINT (not the angle/power outputs) so "how imprecise
// is the bot" is one intuitive, range-independent pixel value instead of
// two separately-tuned angle/power stddevs that would produce inconsistent
// miss distances depending on range. Solves for that perturbed point and
// applies the result directly, then starts the "thinking" pause before
// firing - stateless per turn, no memory of previous shots.
function beginAimAndWait() {
  var p = store.players[store.active];
  var opp = store.players[1 - store.active];
  var level = AI_LEVELS.medium;

  var targetX = opp.x + gaussianRandom(0, level.aimStdDev);
  targetX = Math.max(0, Math.min(store.WORLD_W, targetX));

  var solution = findBestShot(p.x, p.idx, targetX);
  p.angle = Math.max(ANGLE_MIN, Math.min(ANGLE_MAX, solution.angle));
  p.power = Math.max(POWER_MIN, Math.min(POWER_MAX, solution.power));
  store.bot.waitTimer = randRange(level.thinkDelayMin, level.thinkDelayMax);
  store.bot.phase = "waiting";
}

function startBotTurn() {
  store.bot.active = true;
  var p = store.players[store.active];
  var opp = store.players[1 - store.active];

  var feasible = findBestShot(p.x, p.idx, opp.x);
  if (feasible.dist > AI_UNREACHABLE_THRESHOLD && p.fuel > 0) {
    // Can't reach the target at max effort - drive toward the opponent
    // using the same held-key + fuel mechanics a human uses, for the rest
    // of this turn's available fuel (single uninterrupted commit, no
    // re-checking mid-drive), then re-aim once from the new position.
    store.held.left = opp.x < p.x;
    store.held.right = opp.x > p.x;
    store.bot.phase = "moving";
  } else {
    beginAimAndWait();
  }
}

function commitShot() {
  store.bot.phase = null;
  store.bot.active = false;
  fire();
}

export function runBot(dt) {
  if (!store.bot.active) startBotTurn();

  if (store.bot.phase === "moving") {
    if (store.players[store.active].fuel <= 0) {
      store.held.left = false;
      store.held.right = false;
      beginAimAndWait();
    }
  } else if (store.bot.phase === "waiting") {
    store.bot.waitTimer -= dt;
    if (store.bot.waitTimer <= 0) commitShot();
  }
}
