import { store } from "./store.js";
import {
  GRAVITY, WIND_MAX_ACCEL, POWER_TO_SPEED,
  ANGLE_MIN, ANGLE_MAX, POWER_MIN, POWER_MAX, SCENERY_TYPES,
  AI_LEVELS, AI_SIM_DT, AI_SIM_MAX_TIME, AI_COARSE_ANGLE_STEPS, AI_COARSE_POWER_STEPS, AI_REFINE_STEPS,
  AI_UNREACHABLE_THRESHOLD
} from "./constants.js";
import { terrainHeightAt } from "./terrain.js";
import { randRange, gaussianRandom, lerp } from "./utils.js";
import { fire } from "./combat.js";

// Dry-run flight simulator - mirrors the real "flight" physics in
// main.js's update() (same gravity/wind integration and terrain/tree
// stopping conditions) but never touches store.bullet, so the search
// below can try hundreds of candidate shots per turn with no side effects.
// Takes the actual shooter tank object (not just x/idx) so the simulated
// spawn point matches that tank type's own barrelPivotX/Y/Length exactly,
// same as the real fire(). Returns the x where the shot would come to
// rest (terrain, tree, or the edge of the world), which the search
// compares against a target x.
function simulateLanding(shooter, angle, power) {
  var shooterX = shooter.x;
  var dir = shooter.idx === 0 ? 1 : -1;
  var rad = angle * Math.PI / 180;
  var bx = Math.cos(rad) * dir;
  var by = -Math.sin(rad);
  var speed = power * POWER_TO_SPEED;
  var pivotX = shooterX + shooter.barrelPivotX * dir;
  var pivotY = terrainHeightAt(shooterX) - shooter.barrelPivotY;
  var x = pivotX + bx * shooter.barrelLength;
  var y = pivotY + by * shooter.barrelLength;
  var vx = bx * speed;
  var vy = by * speed;
  var elapsed = 0;
  var sceneryType = SCENERY_TYPES[store.activeMap.scenery];

  while (elapsed < AI_SIM_MAX_TIME) {
    vy += GRAVITY * AI_SIM_DT;
    vx += store.wind * WIND_MAX_ACCEL * AI_SIM_DT;
    x += vx * AI_SIM_DT;
    y += vy * AI_SIM_DT;
    elapsed += AI_SIM_DT;

    if (x < 0) return 0;
    if (x > store.WORLD_W) return store.WORLD_W;

    for (var i = 0; i < store.scenery.length; i++) {
      var t = store.scenery[i];
      if (t.state !== "alive") continue;
      var tH = sceneryType.baseHeight * t.scale;
      var tCanopyY = terrainHeightAt(t.x) - tH * sceneryType.canopyFrac;
      var tdx = x - t.x, tdy = y - tCanopyY;
      var tRadius = tH * sceneryType.radiusFrac;
      if (tdx * tdx + tdy * tdy <= tRadius * tRadius) return x;
    }

    if (y >= terrainHeightAt(x)) return x;
  }
  return x;
}

function gridSearch(shooter, targetX, angleLo, angleHi, angleSteps, powerLo, powerHi, powerSteps) {
  var best = null;
  for (var ai = 0; ai < angleSteps; ai++) {
    var angle = angleSteps === 1 ? angleLo : angleLo + (angleHi - angleLo) * (ai / (angleSteps - 1));
    for (var pi = 0; pi < powerSteps; pi++) {
      var power = powerSteps === 1 ? powerLo : powerLo + (powerHi - powerLo) * (pi / (powerSteps - 1));
      var landX = simulateLanding(shooter, angle, power);
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
function findBestShot(shooter, targetX) {
  var coarse = gridSearch(shooter, targetX, ANGLE_MIN, ANGLE_MAX, AI_COARSE_ANGLE_STEPS, POWER_MIN, POWER_MAX, AI_COARSE_POWER_STEPS);
  var angleSpan = (ANGLE_MAX - ANGLE_MIN) / (AI_COARSE_ANGLE_STEPS - 1);
  var powerSpan = (POWER_MAX - POWER_MIN) / (AI_COARSE_POWER_STEPS - 1);
  var refined = gridSearch(
    shooter, targetX,
    Math.max(ANGLE_MIN, coarse.angle - angleSpan), Math.min(ANGLE_MAX, coarse.angle + angleSpan), AI_REFINE_STEPS,
    Math.max(POWER_MIN, coarse.power - powerSpan), Math.min(POWER_MAX, coarse.power + powerSpan), AI_REFINE_STEPS
  );
  return refined.dist < coarse.dist ? refined : coarse;
}

function levelFor(p) { return AI_LEVELS[p.aiLevel] || AI_LEVELS.medium; }

// How imprecise this shot's aim point should be, as one stddev in px.
// The dry-run simulator above reads the real store.wind and the
// opponent's exact current x - the bot isn't actually uncertain about
// either, so this isn't modeling the bot "learning" anything physical.
// It's a difficulty dial with two independent inputs, multiplied
// together against the aimStdDev ceiling:
//   - range: closer shots get a tighter floor (rangeNoiseFloorMult at
//     rangeNearPx, no reduction at rangeFarPx+). Pure function of
//     current positions, no memory involved.
//   - confidence: how much the opponent has moved since THIS shooter's
//     own last shot (p.aiMemory.lastOpponentX) - unmoved gets a tighter
//     floor (confidenceNoiseFloorMult), moved past recalibrateDistPx
//     resets fully back to the ceiling. A shooter's first shot of the
//     match has no memory yet, so it always starts at the ceiling - the
//     "first shot is exploratory" feel falls out of that for free.
// On "hard", rangeNoiseFloorMult/confidenceNoiseFloorMult are both 1, so
// both multipliers are always 1 and this collapses to the original flat
// aimStdDev - see constants.js: AI_LEVELS.
function computeAimStdDev(level, shooter, opp) {
  var distance = Math.abs(opp.x - shooter.x);
  var rangeT = Math.max(0, Math.min(1, (distance - level.rangeNearPx) / (level.rangeFarPx - level.rangeNearPx)));
  var rangeMult = lerp(level.rangeNoiseFloorMult, 1, rangeT);

  var mem = shooter.aiMemory;
  var confidenceT = 0;
  if (mem.hasFired) {
    var moved = Math.abs(opp.x - mem.lastOpponentX);
    confidenceT = Math.max(0, 1 - moved / level.recalibrateDistPx);
  }
  var confidenceMult = lerp(1, level.confidenceNoiseFloorMult, confidenceT);

  return level.aimStdDev * rangeMult * confidenceMult;
}

// Perturbs the AIM POINT (not the angle/power outputs) so "how imprecise
// is the bot" is one intuitive pixel value instead of two separately-
// tuned angle/power stddevs that would produce inconsistent miss
// distances depending on range - see computeAimStdDev for how that one
// value is itself derived. Solves for the perturbed point and applies
// the result directly, then starts the "thinking" pause before firing.
function beginAimAndWait() {
  var p = store.players[store.active];
  var opp = store.players[1 - store.active];
  var level = levelFor(p);

  var stdDev = computeAimStdDev(level, p, opp);
  var targetX = opp.x + gaussianRandom(0, stdDev);
  targetX = Math.max(0, Math.min(store.WORLD_W, targetX));

  var solution = findBestShot(p, targetX);
  p.angle = Math.max(ANGLE_MIN, Math.min(ANGLE_MAX, solution.angle));
  p.power = Math.max(POWER_MIN, Math.min(POWER_MAX, solution.power));

  p.aiMemory.hasFired = true;
  p.aiMemory.lastOpponentX = opp.x;

  store.bot.waitTimer = randRange(level.thinkDelayMin, level.thinkDelayMax);
  store.bot.moveTimer = null;
  store.bot.phase = "waiting";
}

function startBotTurn() {
  store.bot.active = true;
  var p = store.players[store.active];
  var opp = store.players[1 - store.active];
  var level = levelFor(p);

  // Flee first, if the opponent's last shot landed close enough to feel
  // dangerous - denies them an easy follow-up on a target that hasn't
  // moved, the same reason a human player repositions after a near
  // miss. Independent of (and checked before) the reachability drive
  // below; on "hard" evadeChance is 0 so this branch never fires.
  var oppLastShot = store.lastImpact[opp.idx];
  var underThreat = oppLastShot && Math.abs(oppLastShot.x - p.x) <= level.evadeTriggerDistPx;
  if (underThreat && p.fuel > 0 && Math.random() < level.evadeChance) {
    // Squared-uniform sample: most rolls land near evadeDistMin, with an
    // occasional roll toward evadeDistMax - "usually a bit, sometimes
    // a lot more" instead of a flat or symmetric spread.
    var t = Math.random();
    t = t * t;
    var dist = lerp(level.evadeDistMin, level.evadeDistMax, t);
    store.held.left = oppLastShot.x >= p.x;
    store.held.right = oppLastShot.x < p.x;
    store.bot.moveTimer = dist / p.moveSpeed;
    store.bot.phase = "moving";
    return;
  }

  var feasible = findBestShot(p, opp.x);
  if (feasible.dist > AI_UNREACHABLE_THRESHOLD && p.fuel > 0) {
    // Can't reach the target at max effort - drive toward the opponent
    // using the same held-key + fuel mechanics a human uses, for the rest
    // of this turn's available fuel (single uninterrupted commit, no
    // re-checking mid-drive), then re-aim once from the new position.
    store.held.left = opp.x < p.x;
    store.held.right = opp.x > p.x;
    store.bot.moveTimer = null;
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
    if (store.bot.moveTimer !== null) store.bot.moveTimer -= dt;
    var timedOut = store.bot.moveTimer !== null && store.bot.moveTimer <= 0;
    if (store.players[store.active].fuel <= 0 || timedOut) {
      store.held.left = false;
      store.held.right = false;
      beginAimAndWait();
    }
  } else if (store.bot.phase === "waiting") {
    store.bot.waitTimer -= dt;
    if (store.bot.waitTimer <= 0) commitShot();
  }
}
