// Dubnator service-worker template.
//
// build.mjs replaces both placeholders below with a content-derived cache name
// and the exact URLs emitted into index.html (including their ?v= hashes). That
// keeps first-install offline support and upgrades in lockstep with the build.
const CACHE = "__DUBNATOR_CACHE__";
const SHELL = /*__DUBNATOR_SHELL__*/ [];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k.startsWith("dubnator-") && k !== CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations are network-first so an online visit immediately receives the
  // latest HTML. Only document requests fall back to index.html; returning HTML
  // for a failed script/style request hides the real failure behind parse errors.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("index.html", copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match("index.html"))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }))
  );
});
