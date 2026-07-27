import { store } from "./store.js";
import { TANK_TYPES, WIND_LEVELS, FUEL_MAX } from "./constants.js";
import { randRange } from "./utils.js";
import { centerCameraOnActive } from "./camera.js";
import { applyTankType, drawTankPreview } from "./tanks.js";
import { applyPlayerTheme, updateTurnUI, updateWindUI, showToast } from "./ui.js";

// Wind is constant for the whole round (currently the whole match, since
// rounds are locked to 1) - rolled once here, after both players have
// picked a tank, from the magnitude band the config screen's selected
// level points at.
function generateWind() {
  var level = WIND_LEVELS[store.windLevelIndex];
  if (level.max <= 0) { store.wind = 0; return; }
  var mag = randRange(level.min, level.max);
  store.wind = Math.random() < 0.5 ? -mag : mag;
}

function setOverlayVisible(visible) {
  document.getElementById("tankSelectOverlay").classList.toggle("show", visible);
  document.getElementById("bar").style.display = visible ? "none" : "";
}

function renderTile(type, p) {
  var btn = document.createElement("button");
  btn.className = "tsTile";

  var canvas = document.createElement("canvas");
  canvas.className = "tsTileCanvas";
  canvas.width = 64;
  canvas.height = 78;
  var pctx = canvas.getContext("2d");
  drawTankPreview(pctx, 32, 74, 1, type.key, p.color, p.colorDark, p.color);
  btn.appendChild(canvas);

  var info = document.createElement("div");
  info.className = "tsTileInfo";

  var name = document.createElement("div");
  name.className = "tsTileName";
  name.textContent = type.name;
  info.appendChild(name);

  var stats = document.createElement("div");
  stats.className = "tsTileStats";
  stats.textContent = "HP " + type.healthMax + " · SPD " + type.moveSpeed + " · DMG " + type.minDamage + "-" + type.maxDamage;
  info.appendChild(stats);

  var blurb = document.createElement("div");
  blurb.className = "tsTileBlurb";
  blurb.textContent = type.blurb;
  info.appendChild(blurb);

  btn.appendChild(info);
  btn.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    chooseTankType(type.key);
  });
  return btn;
}

function renderTankSelectMenu() {
  var p = store.players[store.active];
  applyPlayerTheme(p);
  document.getElementById("tsHeaderText").textContent = p.name + ": choose your tank";

  var list = document.getElementById("tsTileList");
  list.innerHTML = "";
  TANK_TYPES.forEach(function (type) {
    list.appendChild(renderTile(type, p));
  });

  setOverlayVisible(true);
}

function finishTankSelection() {
  setOverlayVisible(false);
  generateWind();
  updateWindUI();
  store.active = 0;
  store.state = "aim";
  centerCameraOnActive();
  updateTurnUI();
  showToast("Terrain: " + store.currentLayoutName);
}

function advanceOrFinish() {
  if (store.active === 0) {
    store.active = 1;
    startSelectionTurn();
  } else {
    finishTankSelection();
  }
}

// No "Player X selected Y!" toast here - whichever pick is last in the
// sequence always runs synchronously into either the next player's turn
// or finishTankSelection()'s own toast, so it would just get clobbered
// before ever painting. The box->tank reveal itself is the feedback; both
// tanks become visible together the moment the overlay finally closes.
export function chooseTankType(key) {
  var p = store.players[store.active];
  applyTankType(p, key);
  p.selected = true;
  p.fuel = FUEL_MAX;
  advanceOrFinish();
}

// Bots don't need the UI - they just pick a random type immediately, same
// visible "box becomes tank" reveal a human's pick would trigger.
function startSelectionTurn() {
  centerCameraOnActive();
  var p = store.players[store.active];
  if (p.isBot) {
    var randomType = TANK_TYPES[Math.floor(Math.random() * TANK_TYPES.length)];
    chooseTankType(randomType.key);
  } else {
    renderTankSelectMenu();
  }
}

export function beginTankSelection() {
  store.state = "select";
  store.active = 0;
  store.players.forEach(function (p) { p.selected = false; });
  startSelectionTurn();
}
