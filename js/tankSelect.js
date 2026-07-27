import { store } from "./store.js";
import { TANK_TYPES, WIND_LEVELS, FUEL_MAX, TANK_SELECT_BOT_LOOK_MS, TANK_SELECT_REVEAL_DELAY_MS } from "./constants.js";
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

// The top #bar (aim/fire controls) has nothing to do during any part of
// tank selection - not just while the panel itself is up - so it's
// hidden once for the whole "select" state (beginTankSelection) and
// restored once at the very end (finishTankSelection), rather than
// toggling with the panel. A bot's turn hides the panel but has no aim
// controls to show in its place; toggling the bar there too used to be
// harmless only because it lasted under a frame - now that bot turns
// have a real look-then-reveal pause (see chooseTankType/
// startSelectionTurn), leaving the bar tied to the panel would flash
// the stale aim-phase bar for that whole pause.
function setPanelVisible(visible) {
  document.getElementById("tankSelectOverlay").classList.toggle("show", visible);
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

function findTypeByKey(key) {
  var found = null;
  TANK_TYPES.forEach(function (t) { if (t.key === key) found = t; });
  return found;
}

// Freezes the panel's tiles/button right after a pick, for the duration
// of the reveal pause - the pick is already committed (p.selected is
// true by the time this runs), so this is purely to stop a stray tap
// during the pause from looking like it does something.
function lockSelectionUI(type) {
  document.querySelectorAll("#tsTileList .tsTile").forEach(function (t) { t.disabled = true; });
  var btn = document.getElementById("tsConfirmBtn");
  btn.disabled = true;
  btn.textContent = type.name + " deployed!";
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

  setPanelVisible(true);
}

function finishTankSelection() {
  setPanelVisible(false);
  document.getElementById("bar").style.display = "";
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

// The box->tank reveal is the feedback for a pick, so advanceOrFinish()
// is held off for TANK_SELECT_REVEAL_DELAY_MS - long enough to actually
// see the swap - before panning away to the next player or finishing.
// This also doubles as the fix for a real reported bug: a single
// physical tap on a touch device can dispatch more than one pointer
// event (pointerdown, then a trailing pointerup/synthetic click), and
// advanceOrFinish() replaces the tapped tile's entire DOM subtree
// (rendering the next player's list at the same on-screen position). A
// stray trailing event from the same tap landing on that freshly-drawn
// list, before the browser had finished the tap's event sequence, used
// to read the now-advanced store.active and apply a second, unintended
// pick to the other player, who never saw their own screen. The
// p.selected guard below is the real backstop - the delay (formerly a
// single deferred frame, now a much longer deliberate pause) just keeps
// the DOM stable long enough for a same-tap ghost event to resolve
// against the tile that's still there, not a new one.
export function chooseTankType(key) {
  var p = store.players[store.active];
  if (p.selected) return;
  applyTankType(p, key);
  p.selected = true;
  p.fuel = FUEL_MAX;
  lockSelectionUI(findTypeByKey(key));
  setTimeout(advanceOrFinish, TANK_SELECT_REVEAL_DELAY_MS);
}

// Wired to the Confirm button in main.js. A tile tap only sets
// pendingKey (see markPending); the pick itself only happens here.
export function confirmTankSelection() {
  if (!pendingKey) return;
  chooseTankType(pendingKey);
}

// Bots don't need the UI, but they get the same "camera shows the box,
// then it becomes a tank" beat a human gets while picking - the camera
// centers on the bot's box first, and only after TANK_SELECT_BOT_LOOK_MS
// (giving the viewer a moment to register whose turn it is) does the
// bot actually pick, which triggers the same reveal + post-reveal pause
// as a human's chooseTankType() call. The panel is slid away for a
// bot's turn (defensive: guards against a human turn immediately
// preceding a bot's and leaving stale content on screen for a frame)
// since there's no menu to show over its box.
function startSelectionTurn() {
  var p = store.players[store.active];
  if (p.isBot) {
    setPanelVisible(false);
    centerCameraOnActive();
    setTimeout(function () {
      var randomType = TANK_TYPES[Math.floor(Math.random() * TANK_TYPES.length)];
      chooseTankType(randomType.key);
    }, TANK_SELECT_BOT_LOOK_MS);
  } else {
    centerCameraOnActiveOffset(panelOffsetPx());
    renderTankSelectMenu();
  }
}

export function beginTankSelection() {
  store.state = "select";
  store.active = 0;
  document.getElementById("bar").style.display = "none";
  store.players.forEach(function (p) { p.selected = false; });
  startSelectionTurn();
}
