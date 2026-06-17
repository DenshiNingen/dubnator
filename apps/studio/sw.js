// Dubnator service worker — offline app shell.
// Cache-first for same-origin GETs so the rack works fully offline once loaded.
// Cross-origin requests (e.g. Google Fonts) pass straight through to the network.
// Bump CACHE when the shell changes to evict the old bundle on activate.
const CACHE = "dubnator-v1";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "audio-engine.js",
  "midi.js",
  "controls.js",
  "tweaks-panel.js",
  "app.js",
  "vendor/react.min.js",
  "vendor/react-dom.min.js",
  "vendor/jszip.min.js",
  "manifest.webmanifest",
  "icon-128.png",
  "icon-256.png",
  "icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // Don't fail the whole install if one optional asset 404s.
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let cross-origin (fonts) hit the network
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match("index.html")))
  );
});
