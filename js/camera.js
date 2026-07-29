import { store } from "./store.js";
import { ZOOM_MIN, ZOOM_MAX } from "./constants.js";

// Terrain/cloud heights are stored as fractions of VIEW_H with worldY=0
// meaning "top of the classic (pre-zoom) viewport". Biased below the
// true center (VIEW_H/2) so the resting/aiming view shows more sky and
// trajectory room above the tank than empty ground below it.
export function defaultCamCenterY() { return store.VIEW_H * 0.40; }

export function centerCameraOnActive() {
  store.camCenterX = store.players[store.active].x;
  store.camCenterY = defaultCamCenterY();
  clampCam();
}

// Same as centerCameraOnActive, but shifts the active player's box to the
// middle of the visible strip to the right of a UI panel of width
// offsetPx (e.g. the tank-select side panel), instead of dead-center of
// the whole viewport where the panel would cover it.
export function centerCameraOnActiveOffset(offsetPx) {
  store.camCenterX = store.players[store.active].x - (offsetPx / 2) / store.camZoom;
  store.camCenterY = defaultCamCenterY();
  clampCam();
}

export function recenterView() {
  store.camZoom = 1;
  centerCameraOnActive();
}

export function clampCam() {
  var halfW = (store.VIEW_W / 2) / store.camZoom;
  if (store.WORLD_W > halfW * 2) {
    store.camCenterX = Math.max(halfW, Math.min(store.WORLD_W - halfW, store.camCenterX));
  } else {
    store.camCenterX = store.WORLD_W / 2;
  }
  var base = defaultCamCenterY();
  var camYMin = base - store.VIEW_H * 2.0, camYMax = base + store.VIEW_H * 1.4;
  store.camCenterY = Math.max(camYMin, Math.min(camYMax, store.camCenterY));
}

export function screenToWorld(sx, sy) {
  return {
    x: store.camCenterX + (sx - store.VIEW_W / 2) / store.camZoom,
    y: store.camCenterY + (sy - store.VIEW_H / 2) / store.camZoom
  };
}

// ---------- Drag to pan, pinch to zoom ----------
function pointerIds() { return Object.keys(store.activePointers); }
function ptrDist(idA, idB) {
  var a = store.activePointers[idA], b = store.activePointers[idB];
  return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
}
function ptrMid(idA, idB) {
  var a = store.activePointers[idA], b = store.activePointers[idB];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function beginPan(id) {
  store.gestureMode = "pan";
  store.dragStartX = store.activePointers[id].x;
  store.dragStartY = store.activePointers[id].y;
  store.dragStartCamX = store.camCenterX;
  store.dragStartCamY = store.camCenterY;
}

export function onPointerDown(e) {
  // Also blocked during "eliminated" - the camera is deliberately locked
  // on a just-destroyed tank for that beat (combat.js: afterResolve()),
  // and a stray pan/pinch shouldn't be able to fight that framing.
  if (store.state === "gameover" || store.state === "select" || store.state === "eliminated") return;
  store.activePointers[e.pointerId] = { x: e.clientX, y: e.clientY };
  var ids = pointerIds();
  if (ids.length === 2) {
    store.gestureMode = "pinch";
    store.pinchStartDist = ptrDist(ids[0], ids[1]);
    store.pinchStartZoom = store.camZoom;
    var mid = ptrMid(ids[0], ids[1]);
    var w = screenToWorld(mid.x, mid.y);
    store.pinchAnchorWorldX = w.x;
    store.pinchAnchorWorldY = w.y;
  } else if (ids.length === 1) {
    beginPan(ids[0]);
  }
}

export function onPointerMove(e) {
  if (!(e.pointerId in store.activePointers)) return;
  store.activePointers[e.pointerId] = { x: e.clientX, y: e.clientY };
  var ids = pointerIds();
  if (store.gestureMode === "pinch" && ids.length === 2) {
    var dist = ptrDist(ids[0], ids[1]);
    store.camZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, store.pinchStartZoom * (dist / store.pinchStartDist)));
    var mid = ptrMid(ids[0], ids[1]);
    store.camCenterX = store.pinchAnchorWorldX - (mid.x - store.VIEW_W / 2) / store.camZoom;
    store.camCenterY = store.pinchAnchorWorldY - (mid.y - store.VIEW_H / 2) / store.camZoom;
    clampCam();
  } else if (store.gestureMode === "pan" && ids.length === 1) {
    var dx = e.clientX - store.dragStartX;
    var dy = e.clientY - store.dragStartY;
    store.camCenterX = store.dragStartCamX - dx / store.camZoom;
    store.camCenterY = store.dragStartCamY - dy / store.camZoom;
    clampCam();
  }
}

export function onPointerUp(e) {
  delete store.activePointers[e.pointerId];
  var ids = pointerIds();
  if (ids.length === 1) {
    beginPan(ids[0]);
  } else {
    store.gestureMode = null;
  }
}
