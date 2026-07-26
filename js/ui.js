import { store } from "./store.js";
import { FUEL_MAX, POWER_MAX } from "./constants.js";
import { hexToRgb, mixHex } from "./utils.js";

export function updateTurnUI() {
  var p = store.players[store.active];
  document.getElementById("turnLabel").textContent = p.name + "'s Turn";
  document.getElementById("turnLabel").style.color = p.color;

  var bar = document.getElementById("bar");
  var rgb = hexToRgb(p.color);
  bar.style.setProperty("--accent", p.color);
  bar.style.setProperty("--accent-bg", mixHex(p.color, "#1b1f27", 0.72));
  bar.style.setProperty("--accent-glow", "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",.45)");
}

export function updateFuelUI() {
  var pct = Math.max(0, store.players[store.active].fuel) / FUEL_MAX * 100;
  document.getElementById("fuelFill").style.width = pct + "%";
}

export function updateAimUI() {
  var p = store.players[store.active];
  document.getElementById("angleVal").textContent = Math.round(p.angle);
  document.getElementById("powerVal").textContent = Math.round(p.power);
}

// Wind is constant for the whole round, so this only needs to be called
// once at match start, not every frame.
export function updateWindUI() {
  var w = store.wind;
  var arrowEl = document.getElementById("windArrow");
  var pctEl = document.getElementById("windPct");
  if (!arrowEl || !pctEl) return;
  if (w === 0) {
    arrowEl.textContent = "–"; // –
    arrowEl.style.opacity = "0.5";
    pctEl.textContent = "Calm";
  } else {
    var pct = Math.round(Math.abs(w) * 100);
    arrowEl.textContent = w > 0 ? "→" : "←"; // → or ←
    arrowEl.style.opacity = (0.55 + Math.abs(w) * 0.45).toFixed(2);
    pctEl.textContent = pct + "%";
  }
}

export function showToast(msg) {
  var el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(store.toastTimeoutHandle);
  store.toastTimeoutHandle = setTimeout(function () { el.classList.remove("show"); }, 2800);
}

// ---------- Fullscreen toggle ----------
var FS_ICON_EXPAND = '<path d="M4 9V4h5"></path><path d="M20 9V4h-5"></path><path d="M4 15v5h5"></path><path d="M20 15v5h-5"></path>';
var FS_ICON_COMPRESS = '<path d="M9 4v5H4"></path><path d="M15 4v5h5"></path><path d="M9 20v-5H4"></path><path d="M15 20v-5h5"></path>';

export function updateFsButton() {
  var isFs = !!document.fullscreenElement;
  document.getElementById("fsIcon").innerHTML = isFs ? FS_ICON_COMPRESS : FS_ICON_EXPAND;
  document.getElementById("fsLabel").textContent = isFs ? "Exit" : "Fullscreen";
}
