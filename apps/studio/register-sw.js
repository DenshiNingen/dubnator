// Production-web-only service-worker registration. build.mjs injects this file
// into the generated HTML; it is absent from dev-server HTML and ignored by
// Tauri as an additional guard.
if ("serviceWorker" in navigator && !window.__TAURI_INTERNALS__) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js", { updateViaCache: "none" })
      .catch(() => {});
  });
}
