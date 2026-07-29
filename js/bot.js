import { store } from "./store.js";
import {
  GRAVITY, WIND_MAX_ACCEL, POWER_TO_SPEED,
  ANGLE_MIN, ANGLE_MAX, POWER_MIN, POWER_MAX,
  AI_LEVELS, AI_SIM_DT, AI_SIM_MAX_TIME, AI_COARSE_ANGLE_STEPS, AI_COARSE_POWER_STEPS, AI_REFINE_STEPS,
  AI_UNREACHABLE_THRESHOLD
} from "./constants.js";
import { terrainHeightAt } from "./terrain.js";
import { sceneryHitAt } from "./scenery.js";
import { randRange, gaussianRandom, lerp, stepBallistic } from "./utils.js";
import { fire } from "./combat.js";
import { closestAliveOpponent } from "./tanks.js";

// Dry-run flight simulator - reuses the real "flight" physics main.js's
// update() runs on store.bullet (utils.js: stepBallistic for gravity/wind
// integration, scenery.js: sceneryHitAt for tree/rock collision) but never
// touches store.bullet itself, so the search below can try hundreds of
// candidate shots per turn with no side effects. Sharing those two pieces
// instead of hand-copying them means a future physics/collision change
// can't silently drift between the real flight and this simulation.
// Takes the actual shooter tank object (not just x/idx) so the simulated
// spawn point matches that tank type's own barrelPivotX/Y/Length exactly,
// same as the real fire(). Returns the x where the shot would come to
// rest (terrain, tree, or the edge of the world), which the search
// compares against a target x.
function simulateLanding(shooter, angle, power) {
  var shooterX = shooter.x;
  var dir = shooter.dir;
  var rad = angle * Math.PI / 180;
  var bx = Math.cos(rad) * dir;
  var by = -Math.sin(rad);
  var speed = power * POWER_TO_SPEED;
  var pivotX = shooterX + shooter.barrelPivotX * dir;
  var pivotY = terrainHeightAt(shooterX) - shooter.barrelPivotY;
  var pos = {
    x: pivotX + bx * shooter.barrelLength,
    y: pivotY + by * shooter.barrelLength,
    vx: bx * speed,
    vy: by * speed
  };
  var elapsed = 0;

  while (elapsed < AI_SIM_MAX_TIME) {
    stepBallistic(pos, GRAVITY, store.wind * WIND_MAX_ACCEL, AI_SIM_DT);
    elapsed += AI_SIM_DT;

    if (pos.x < 0) return 0;
    if (pos.x > store.WORLD_W) return store.WORLD_W;
    if (sceneryHitAt(pos.x, pos.y)) return pos.x;
    if (pos.y >= terrainHeightAt(pos.x)) return pos.x;
  }
  return pos.x;
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
//   - confidence: how much THIS opponent has moved since THIS shooter's
//     own last shot AT THIS OPPONENT (p.aiMemory[opp.idx].lastOpponentX) -
//     unmoved gets a tighter floor (confidenceNoiseFloorMult), moved past
//     recalibrateDistPx resets fully back to the ceiling. A shooter's
//     first shot at a given opponent has no memory of THEM yet, so it
//     always starts at the ceiling - the "first shot at someone new is
//     exploratory" feel falls out of that for free. Memory is keyed per
//     opponent (not one flat pair) since the bot always targets whoever's
//     currently closest, which can be a different player turn to turn in
//     a 3+ player match - switching targets shouldn't wipe out confidence
//     built up against someone the bot keeps coming back to.
// On "hard", rangeNoiseFloorMult/confidenceNoiseFloorMult are both 1, so
// both multipliers are always 1 and this collapses to the original flat
// aimStdDev - see constants.js: AI_LEVELS.
function computeAimStdDev(level, shooter, opp) {
  var distance = Math.abs(opp.x - shooter.x);
  var rangeT = Math.max(0, Math.min(1, (distance - level.rangeNearPx) / (level.rangeFarPx - level.rangeNearPx)));
  var rangeMult = lerp(level.rangeNoiseFloorMult, 1, rangeT);

  var mem = shooter.aiMemory[opp.idx];
  var confidenceT = 0;
  if (mem && mem.hasFired) {
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
  var opp = closestAliveOpponent(p);
  var level = levelFor(p);

  // Captured before computeAimStdDev mutates anything, purely for the
  // window.__BENCH__ hook below - see CLAUDE.md's load-bearing decision
  // on the simulation bench for why this guard is safe to leave in real
  // builds (window.__BENCH__ is undefined outside bench.html).
  var distance = Math.abs(opp.x - p.x);
  var mem = p.aiMemory[opp.idx];
  var hadMemory = !!(mem && mem.hasFired);
  var movedSinceLastShot = hadMemory ? Math.abs(opp.x - mem.lastOpponentX) : null;

  var stdDev = computeAimStdDev(level, p, opp);
  var targetX = opp.x + gaussianRandom(0, stdDev);
  targetX = Math.max(0, Math.min(store.WORLD_W, targetX));

  var solution = findBestShot(p, targetX);
  p.angle = Math.max(ANGLE_MIN, Math.min(ANGLE_MAX, solution.angle));
  p.power = Math.max(POWER_MIN, Math.min(POWER_MAX, solution.power));

  p.aiMemory[opp.idx] = { hasFired: true, lastOpponentX: opp.x };

  if (window.__BENCH__) {
    window.__BENCH__.logShot({
      shooterIdx: p.idx, shooterAiLevel: p.aiLevel, shooterTankType: p.tankType,
      defenderTankType: opp.tankType, distance: distance, hadMemory: hadMemory,
      movedSinceLastShot: movedSinceLastShot, stdDev: stdDev, angle: p.angle, power: p.power
    });
  }

  store.bot.waitTimer = randRange(level.thinkDelayMin, level.thinkDelayMax);
  store.bot.moveTimer = null;
  store.bot.phase = "waiting";
}

function startBotTurn() {
  store.bot.active = true;
  var p = store.players[store.active];
  var opp = closestAliveOpponent(p);
  var level = levelFor(p);

  // Flee first, if ANY alive opponent's last shot landed close enough to
  // feel dangerous - not just the current closest target's. In a 3+
  // player match the most recently threatening shot can come from
  // someone this bot isn't even about to aim at. Denies whoever fired it
  // an easy follow-up on a target that hasn't moved, the same reason a
  // human player repositions after a near miss. Independent of (and
  // checked before) the reachability drive below; on "hard" evadeChance
  // is 0 so this branch never fires.
  var oppLastShot = null;
  for (var i = 0; i < store.players.length; i++) {
    var o = store.players[i];
    if (o === p || !o.alive) continue;
    var imp = store.lastImpact[o.idx];
    if (imp && (!oppLastShot || Math.abs(imp.x - p.x) < Math.abs(oppLastShot.x - p.x))) oppLastShot = imp;
  }
  var underThreat = oppLastShot && Math.abs(oppLastShot.x - p.x) <= level.evadeTriggerDistPx;

  // evadeRoll/evadeSucceeded are only ever computed inside this same
  // underThreat-&&-fuel guard, exactly matching the original inline
  // `Math.random() < level.evadeChance` short-circuit - purely a
  // refactor to let the window.__BENCH__ hook below see the roll, not a
  // behavior change (Math.random() is still called in exactly the same
  // circumstances, so the PRNG sequence the rest of the match sees is
  // unaffected).
  var evadeRoll = null, evadeSucceeded = false;
  if (underThreat && p.fuel > 0) {
    evadeRoll = Math.random();
    evadeSucceeded = evadeRoll < level.evadeChance;
  }

  if (evadeSucceeded) {
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
    if (window.__BENCH__) {
      window.__BENCH__.logMove({
        botIdx: p.idx, aiLevel: p.aiLevel, kind: "evade",
        underThreat: true, evadeRoll: evadeRoll, plannedDist: dist
      });
    }
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
    if (window.__BENCH__) {
      window.__BENCH__.logMove({
        botIdx: p.idx, aiLevel: p.aiLevel, kind: "unreachable",
        underThreat: underThreat, evadeRoll: evadeRoll, feasibleDist: feasible.dist
      });
    }
  } else {
    if (window.__BENCH__) {
      window.__BENCH__.logMove({
        botIdx: p.idx, aiLevel: p.aiLevel, kind: "none",
        underThreat: underThreat, evadeRoll: evadeRoll, feasibleDist: feasible.dist
      });
    }
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
