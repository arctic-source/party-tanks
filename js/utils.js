// Small pure helpers with no dependency on game state.

export function randRange(a, b) { return a + Math.random() * (b - a); }
export function randInt(a, b) { return Math.floor(randRange(a, b + 1)); }

export function pseudoRandom(seed) {
  var v = Math.sin(seed * 12.9898) * 43758.5453;
  return v - Math.floor(v);
}

export function hexToRgb(hex) {
  var v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function mixHex(hexA, hexB, t) {
  var a = hexToRgb(hexA), b = hexToRgb(hexB);
  var r = Math.round(a[0] + (b[0] - a[0]) * t);
  var g = Math.round(a[1] + (b[1] - a[1]) * t);
  var bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return "rgb(" + r + "," + g + "," + bl + ")";
}

export function lerpColor(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}
