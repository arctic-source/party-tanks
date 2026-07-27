import { store } from "./store.js";
import { COLOR_PALETTE, PLAYER_SLOTS, ACTIVE_SLOTS, PLAYER_CONFIG_KEY, WIND_LEVELS, WIND_LEVEL_KEY } from "./constants.js";

export function showScreen(id) {
  ["screenWelcome", "screenPlayers", "screenRounds", "screenMatch"].forEach(function (sid) {
    var el = document.getElementById(sid);
    if (el) el.classList.toggle("show", sid === id);
  });
}

function defaultPlayerConfigs() {
  var arr = [];
  for (var i = 0; i < PLAYER_SLOTS; i++) {
    arr.push({ name: "Player " + (i + 1), colorIndex: i % COLOR_PALETTE.length, mode: "human", aiLevel: "medium" });
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

function otherActiveColorIndex(i) {
  return store.playerConfigs[i === 0 ? 1 : 0].colorIndex;
}

export function renderSwatchesForSlot(i) {
  var wrap = document.getElementById("swatches" + i);
  if (!wrap) return;
  wrap.innerHTML = "";
  var takenByOther = i < ACTIVE_SLOTS ? otherActiveColorIndex(i) : -1;
  COLOR_PALETTE.forEach(function (c, j) {
    var btn = document.createElement("button");
    btn.className = "swatchBtn" + (store.playerConfigs[i].colorIndex === j ? " selected" : "");
    btn.style.background = c.body;
    btn.disabled = (j === takenByOther);
    btn.setAttribute("aria-label", c.name);
    btn.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      if (btn.disabled) return;
      store.playerConfigs[i].colorIndex = j;
      savePlayerConfigs();
      renderSwatchesForSlot(0);
      renderSwatchesForSlot(1);
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

  var modeWrap = document.createElement("div");
  modeWrap.className = "modeToggle";
  var humanBtn = document.createElement("button");
  humanBtn.className = "modeBtn" + (cfg.mode === "human" ? " active" : "");
  humanBtn.textContent = "Player";
  humanBtn.disabled = !active;
  var botBtn = document.createElement("button");
  botBtn.className = "modeBtn" + (cfg.mode === "bot" ? " active" : "");
  botBtn.textContent = "Bot";
  botBtn.disabled = !active;
  if (active) {
    humanBtn.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      if (cfg.mode === "human") return;
      cfg.mode = "human";
      savePlayerConfigs();
      renderPlayerRows();
    });
    botBtn.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      if (cfg.mode === "bot") return;
      cfg.mode = "bot";
      savePlayerConfigs();
      renderPlayerRows();
    });
  }
  modeWrap.appendChild(humanBtn);
  modeWrap.appendChild(botBtn);
  row.appendChild(modeWrap);

  // Difficulty only matters for a bot slot - kept as a second toggle
  // group rather than folded into the Player/Bot one so both stay a
  // simple two-state pick. Not shown at all (not just disabled) for a
  // human slot, so it never eats row width when irrelevant.
  if (active && cfg.mode === "bot") {
    var diffWrap = document.createElement("div");
    diffWrap.className = "modeToggle diffToggle";
    var medBtn = document.createElement("button");
    medBtn.className = "modeBtn" + (cfg.aiLevel !== "hard" ? " active" : "");
    medBtn.textContent = "Medium";
    var hardBtn = document.createElement("button");
    hardBtn.className = "modeBtn" + (cfg.aiLevel === "hard" ? " active" : "");
    hardBtn.textContent = "Hard";
    medBtn.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      if (cfg.aiLevel !== "hard") return;
      cfg.aiLevel = "medium";
      savePlayerConfigs();
      renderPlayerRows();
    });
    hardBtn.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      if (cfg.aiLevel === "hard") return;
      cfg.aiLevel = "hard";
      savePlayerConfigs();
      renderPlayerRows();
    });
    diffWrap.appendChild(medBtn);
    diffWrap.appendChild(hardBtn);
    row.appendChild(diffWrap);
  }

  return row;
}

export function renderPlayerRows() {
  var container = document.getElementById("playerRows");
  container.innerHTML = "";
  for (var i = 0; i < PLAYER_SLOTS; i++) container.appendChild(buildPlayerRow(i));
  for (var j = 0; j < ACTIVE_SLOTS; j++) renderSwatchesForSlot(j);
}

export function applyPlayerConfigToGame() {
  store.gameConfig.players = [0, 1].map(function (i) {
    var cfg = store.playerConfigs[i];
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
