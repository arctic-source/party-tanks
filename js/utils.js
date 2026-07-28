// Small pure helpers with no dependency on game state.

export function randRange(a, b) { return a + Math.random() * (b - a); }
export function randInt(a, b) { return Math.floor(randRange(a, b + 1)); }

// Box-Muller transform - one sample from a normal distribution.
export function gaussianRandom(mean, stddev) {
  var u1 = Math.random() || 1e-9; // avoid log(0)
  var u2 = Math.random();
  var z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z0 * stddev;
}

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

export function lerp(a, b, t) { return a + (b - a) * t; }

// Integrates one dt of ballistic motion in place on a {x,y,vx,vy} object -
// gravity and wind are passed in as plain accelerations (not read from
// store/constants here) so this stays a pure helper. Shared by the real
// bullet flight in main.js's update() and the bot's dry-run flight
// simulator in bot.js: those two used to hand-duplicate this exact
// integration, which meant a physics tweak in one could silently drift
// from the other. Order matters no more than before - velocity updates
// then position updates, same as the original inline code in both places.
export function stepBallistic(p, gravity, windAccel, dt) {
  p.vy += gravity * dt;
  p.vx += windAccel * dt;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  return p;
}

export function lerpColor(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}
