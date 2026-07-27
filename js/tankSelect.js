import { store } from "./store.js";
import { TANK_TYPES, WIND_LEVELS, FUEL_MAX } from "./constants.js";
import { randRange } from "./utils.js";
import { centerCameraOnActive, centerCameraOnActiveOffset } from "./camera.js";
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

// The panel's CSS width is fixed regardless of its slide transform, so
// this stays accurate whether the panel is currently shown or hidden -
// letting the camera-offset math below always match the real layout.
function panelOffsetPx() {
  return document.getElementById("tankSelectOverlay").getBoundingClientRect().width;
}

// Tapping a tile only highlights it (pendingKey) - the actual pick isn't
// applied until Confirm is pressed. This is also a second, independent
// line of defense against the ghost-duplicate-event bug fixed earlier:
// a stray trailing event from a tile tap can at most re-highlight the
// same or another tile, never advance the turn on its own.
var pendingKey = null;

function markPending(key, name) {
  pendingKey = key;
  document.querySelectorAll("#tsTileList .tsTile").forEach(function (t) {
    t.classList.toggle("selected", t.dataset.key === key);
  });
  var btn = document.getElementById("tsConfirmBtn");
  btn.disabled = false;
  btn.textContent = "Confirm " + name;
}

function renderTile(type, p) {
  var btn = document.createElement("button");
  btn.className = "tsTile";
  btn.dataset.key = type.key;

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
    e.stopPropagation();
    markPending(type.key, type.name);
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

  pendingKey = null;
  var confirmBtn = document.getElementById("tsConfirmBtn");
  confirmBtn.disabled = true;
  confirmBtn.textContent = "Select a tank";

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
//
// advanceOrFinish() is deferred by one frame rather than called inline -
// a single physical tap on a touch device can dispatch more than one
// pointer event (pointerdown, then a trailing pointerup/synthetic click),
// and advanceOrFinish() replaces the tapped tile's entire DOM subtree
// (rendering the next player's list at the same on-screen position). A
// stray trailing event from the same tap landing on that freshly-drawn
// list, before the browser has finished this tap's event sequence, was
// exactly the bug reported: it read the now-advanced store.active and
// applied a second, unintended pick to the other player, who never saw
// their own screen. The p.selected guard below is the real backstop -
// deferring just keeps the DOM stable long enough for a same-tap ghost
// event to resolve against the tile that's still there, not a new one.
export function chooseTankType(key) {
  var p = store.players[store.active];
  if (p.selected) return;
  applyTankType(p, key);
  p.selected = true;
  p.fuel = FUEL_MAX;
  requestAnimationFrame(advanceOrFinish);
}

// Wired to the Confirm button in main.js. A tile tap only sets
// pendingKey (see markPending); the pick itself only happens here.
export function confirmTankSelection() {
  if (!pendingKey) return;
  chooseTankType(pendingKey);
}

// Bots don't need the UI - they just pick a random type immediately, same
// visible "box becomes tank" reveal a human's pick would trigger. The
// panel is slid away for a bot's turn (defensive: guards against a human
// turn immediately preceding a bot's and leaving stale content on
// screen for a frame) since there's no menu to show over its box.
function startSelectionTurn() {
  var p = store.players[store.active];
  if (p.isBot) {
    setOverlayVisible(false);
    centerCameraOnActive();
    var randomType = TANK_TYPES[Math.floor(Math.random() * TANK_TYPES.length)];
    chooseTankType(randomType.key);
  } else {
    centerCameraOnActiveOffset(panelOffsetPx());
    renderTankSelectMenu();
  }
}

export function beginTankSelection() {
  store.state = "select";
  store.active = 0;
  store.players.forEach(function (p) { p.selected = false; });
  startSelectionTurn();
}
