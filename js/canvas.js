import { store } from "./store.js";
import { clampCam } from "./camera.js";

export var canvas = document.getElementById("c");
export var ctx = canvas.getContext("2d");
export var canvasWrap = document.getElementById("canvasWrap");

export function resizeCanvas() {
  var rect = canvasWrap.getBoundingClientRect();
  var dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  store.VIEW_W = rect.width;
  store.VIEW_H = rect.height;
  clampCam();
}

window.addEventListener("resize", resizeCanvas);
window.addEventListener("orientationchange", resizeCanvas);
