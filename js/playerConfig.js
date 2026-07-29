import { store } from "./store.js";
import { COLOR_PALETTE, PLAYER_SLOTS, ACTIVE_SLOTS, PLAYER_CONFIG_KEY, WIND_LEVELS, WIND_LEVEL_KEY, MAPS, MAP_KEY } from "./constants.js";

export function showScreen(id) {
  ["screenWelcome", "screenPlayers", "screenRounds", "screenMatch"].forEach(function (sid) {
    var el = document.getElementById(sid);
    if (el) el.classList.toggle("show", sid === id);
  });
}

function defaultPlayerConfigs() {
  var arr = [];
  for (var i = 0; i < PLAYER_SLOTS; i++) {
    // Slots 0-1 default to Human (today's 2-player default, unchanged);
    // slots 2-3 (newly active under ACTIVE_SLOTS=4) default to Off so
    // existing setups aren't surprised by two extra live players - a 3rd
    // or 4th player is opt-in.
    arr.push({ name: "Player " + (i + 1), colorIndex: i % COLOR_PALETTE.length, mode: i < 2 ? "human" : "off", aiLevel: "medium" });
  }
  return arr;
}

function loadPlayerConfigs() {
  var defaults = defaultPlayerConfigs();
  try {
    var raw = localStorage.getItem(PLAYER_CONFIG_KEY);
    if (!raw) return defaults;
    var parsed = JSON.parse(raw);
    for (var i = 0; i < PLAYER_SLOTS; i++) {
      if (parsed[i] && typeof parsed[i].name === "string" && parsed[i].name.trim()) {
        defaults[i].name = parsed[i].name.slice(0, 14);
      }
      if (parsed[i] && COLOR_PALETTE[parsed[i].colorIndex]) {
        defaults[i].colorIndex = parsed[i].colorIndex;
      }
    }
  } catch (e) {}
  return defaults;
}

function savePlayerConfigs() {
  try { localStorage.setItem(PLAYER_CONFIG_KEY, JSON.stringify(store.playerConfigs)); } catch (e) {}
}

store.playerConfigs = loadPlayerConfigs();

// Every OTHER active-slot row (0..ACTIVE_SLOTS-1, excluding i) always
// reserves its own color, regardless of that slot's Human/Bot/Off mode -
// same unconditional-reservation behavior the old 2-slot version had,
// just checked against up to 3 other slots instead of 1.
function takenColorIndices(i) {
  var taken = [];
  for (var j = 0; j < ACTIVE_SLOTS; j++) {
    if (j !== i) taken.push(store.playerConfigs[j].colorIndex);
  }
  return taken;
}

export function renderSwatchesForSlot(i) {
  var wrap = document.getElementById("swatches" + i);
  if (!wrap) return;
  wrap.innerHTML = "";
  var taken = i < ACTIVE_SLOTS ? takenColorIndices(i) : [];
  COLOR_PALETTE.forEach(function (c, j) {
    var btn = document.createElement("button");
    btn.className = "swatchBtn" + (store.playerConfigs[i].colorIndex === j ? " selected" : "");
    btn.style.background = c.body;
    btn.disabled = (taken.indexOf(j) !== -1);
    btn.setAttribute("aria-label", c.name);
    btn.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      if (btn.disabled) return;
      store.playerConfigs[i].colorIndex = j;
      savePlayerConfigs();
      for (var k = 0; k < ACTIVE_SLOTS; k++) renderSwatchesForSlot(k);
    });
    wrap.appendChild(btn);
  });
}

function buildPlayerRow(i) {
  var active = i < ACTIVE_SLOTS;
  var cfg = store.playerConfigs[i];

  var row = document.createElement("div");
  row.className = "playerRow" + (active ? "" : " slotDisabled");

  var num = document.createElement("div");
  num.className = "slotNum";
  num.textContent = i + 1;
  row.appendChild(num);

  var nameInput = document.createElement("input");
  nameInput.className = "nameInput";
  nameInput.maxLength = 14;
  nameInput.value = cfg.name;
  nameInput.placeholder = "Player " + (i + 1);
  nameInput.disabled = !active;
  if (active) {
    nameInput.addEventListener("input", function () {
      cfg.name = nameInput.value.slice(0, 14) || ("Player " + (i + 1));
      savePlayerConfigs();
    });
  }
  row.appendChild(nameInput);

  var swatchWrap = document.createElement("div");
  swatchWrap.className = "colorSwatches";
  swatchWrap.id = "swatches" + i;
  row.appendChild(swatchWrap);

  // Human / Bot / Off - a slot that's Off doesn't participate in the
  // match at all, letting a match be anywhere from 2 to ACTIVE_SLOTS
  // players. Built the same iterate-and-generate way the difficulty
  // toggle below already is, rather than hand-writing each button.
  var modeWrap = document.createElement("div");
  modeWrap.className = "modeToggle";
  var MODE_LABELS = { human: "Player", bot: "Bot", off: "Off" };
  ["human", "bot", "off"].forEach(function (mode) {
    var btn = document.createElement("button");
    btn.className = "modeBtn" + (cfg.mode === mode ? " active" : "");
    btn.textContent = MODE_LABELS[mode];
    btn.disabled = !active;
    if (active) {
      btn.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        if (cfg.mode === mode) return;
        cfg.mode = mode;
        savePlayerConfigs();
        renderPlayerRows();
      });
    }
    modeWrap.appendChild(btn);
  });
  row.appendChild(modeWrap);

  // Difficulty only matters for a bot slot - kept as a second toggle
  // group rather than folded into the Player/Bot one so both stay
  // simple pick-one groups. Not shown at all (not just disabled) for a
  // human slot, so it never eats row width when irrelevant.
  if (active && cfg.mode === "bot") {
    var diffWrap = document.createElement("div");
    diffWrap.className = "modeToggle diffToggle";
    ["easy", "medium", "hard"].forEach(function (level) {
      var btn = document.createElement("button");
      btn.className = "modeBtn" + (cfg.aiLevel === level ? " active" : "");
      btn.textContent = level[0].toUpperCase() + level.slice(1);
      btn.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        if (cfg.aiLevel === level) return;
        cfg.aiLevel = level;
        savePlayerConfigs();
        renderPlayerRows();
      });
      diffWrap.appendChild(btn);
    });
    row.appendChild(diffWrap);
  }

  return row;
}

export function activePlayerCount() {
  var n = 0;
  for (var i = 0; i < ACTIVE_SLOTS; i++) {
    if (store.playerConfigs[i].mode !== "off") n++;
  }
  return n;
}

export function renderPlayerRows() {
  var container = document.getElementById("playerRows");
  container.innerHTML = "";
  for (var i = 0; i < PLAYER_SLOTS; i++) container.appendChild(buildPlayerRow(i));
  for (var j = 0; j < ACTIVE_SLOTS; j++) renderSwatchesForSlot(j);
  // A match needs at least 2 real participants - block advancing past the
  // players screen with 0-1 (e.g. everyone but one slot switched Off).
  var nextBtn = document.getElementById("playersNextBtn");
  if (nextBtn) nextBtn.disabled = activePlayerCount() < 2;
}

export function applyPlayerConfigToGame() {
  store.gameConfig.players = store.playerConfigs.slice(0, ACTIVE_SLOTS)
    .filter(function (cfg) { return cfg.mode !== "off"; })
    .map(function (cfg) {
      var c = COLOR_PALETTE[cfg.colorIndex];
      return { name: cfg.name, color: c.body, colorDark: c.dark, isBot: cfg.mode === "bot", aiLevel: cfg.aiLevel };
    });
}

function loadWindLevelIndex() {
  try {
    var raw = localStorage.getItem(WIND_LEVEL_KEY);
    var idx = raw !== null ? parseInt(raw, 10) : NaN;
    if (!isNaN(idx) && WIND_LEVELS[idx]) return idx;
  } catch (e) {}
  return 1; // default: Light
}

function saveWindLevelIndex() {
  try { localStorage.setItem(WIND_LEVEL_KEY, String(store.windLevelIndex)); } catch (e) {}
}

store.windLevelIndex = loadWindLevelIndex();

export function renderWindConfig() {
  var valueEl = document.getElementById("windValueDisplay");
  var leftBtn = document.getElementById("windArrowLeftBtn");
  var rightBtn = document.getElementById("windArrowRightBtn");
  if (!valueEl) return;
  valueEl.textContent = WIND_LEVELS[store.windLevelIndex].name;
  leftBtn.disabled = store.windLevelIndex <= 0;
  rightBtn.disabled = store.windLevelIndex >= WIND_LEVELS.length - 1;
}

export function changeWindLevel(delta) {
  var next = Math.max(0, Math.min(WIND_LEVELS.length - 1, store.windLevelIndex + delta));
  if (next === store.windLevelIndex) return;
  store.windLevelIndex = next;
  saveWindLevelIndex();
  renderWindConfig();
}

function loadMapIndex() {
  try {
    var raw = localStorage.getItem(MAP_KEY);
    var idx = raw !== null ? parseInt(raw, 10) : NaN;
    if (!isNaN(idx) && MAPS[idx]) return idx;
  } catch (e) {}
  return 0; // default: first map (Chill Forest)
}

function saveMapIndex() {
  try { localStorage.setItem(MAP_KEY, String(store.mapIndex)); } catch (e) {}
}

store.mapIndex = loadMapIndex();

export function renderMapConfig() {
  var valueEl = document.getElementById("mapValueDisplay");
  var leftBtn = document.getElementById("mapArrowLeftBtn");
  var rightBtn = document.getElementById("mapArrowRightBtn");
  if (!valueEl) return;
  valueEl.textContent = MAPS[store.mapIndex].name;
  leftBtn.disabled = store.mapIndex <= 0;
  rightBtn.disabled = store.mapIndex >= MAPS.length - 1;
}

export function changeMapIndex(delta) {
  var next = Math.max(0, Math.min(MAPS.length - 1, store.mapIndex + delta));
  if (next === store.mapIndex) return;
  store.mapIndex = next;
  saveMapIndex();
  renderMapConfig();
}
