var CACHE_NAME = "party-tanks-v3";
var ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./js/main.js",
  "./js/store.js",
  "./js/constants.js",
  "./js/utils.js",
  "./js/canvas.js",
  "./js/camera.js",
  "./js/terrain.js",
  "./js/trees.js",
  "./js/background.js",
  "./js/tanks.js",
  "./js/combat.js",
  "./js/playerConfig.js",
  "./js/ui.js"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// Network-first: while we're actively iterating, a refresh should always
// pick up the latest deploy. Cache is only a fallback for offline play.
self.addEventListener("fetch", function (event) {
  event.respondWith(
    fetch(event.request).then(function (resp) {
      var copy = resp.clone();
      caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
      return resp;
    }).catch(function () {
      return caches.match(event.request);
    })
  );
});
