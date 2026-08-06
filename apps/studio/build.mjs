// Build pipeline for Dubnator.
// - Pre-compiles JSX → JS with esbuild (so the runtime no longer needs Babel)
// - Vendors React, ReactDOM, JSZip from node_modules into dist/vendor/
// - Versions every local asset referenced by the HTML template
// - Outputs dist/index.html (Tauri's default entry) plus dist/Dubnator.html
// `node build.mjs --serve` watches sources and serves dist/ on :1420 by default.
// E2E can provide DUBNATOR_E2E_URL to use an isolated port.

import * as esbuild from "esbuild";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

// Short content hash for cache-busting a static asset's URL. Without this the
// browser caches styles.css / audio-engine.js / midi.js indefinitely (the bare
// URL never changes), so static-asset edits don't show up on reload.
async function assetHash(file, base = ROOT) {
  const buf = await readFile(join(base, file));
  return createHash("sha1").update(buf).digest("hex").slice(0, 8);
}

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, "dist");
const VENDOR = join(DIST, "vendor");
const SERVE = process.argv.includes("--serve");
let servePort = 1420;
try {
  const requestedPort = new URL(process.env.DUBNATOR_E2E_URL || "").port;
  if (requestedPort) servePort = Number(requestedPort);
} catch (_) {}

const JSX_ENTRIES = [
  "controls.jsx",
  "tweaks-panel.jsx",
  "floating-window.jsx",
  "keyboard-map.jsx",
  "launchpad-help.jsx",
  "playlist-modal.jsx",
  "app.jsx",
];
const STATIC_FILES = [
  "track-metadata.js",
  "rekordbox.js",
  "audio-codecs.js",
  "audio-engine.js",
  "bootstrap.js",
  "launchpad.js",
  "midi.js",
  "midi-controls.js",
  "tap-tempo.js",
  "waveform-worker.js",
  "register-sw.js",
  "styles.css",
];
const VENDOR_MAP = {
  "node_modules/react/umd/react.production.min.js": "react.min.js",
  "node_modules/react-dom/umd/react-dom.production.min.js": "react-dom.min.js",
  "node_modules/jszip/dist/jszip.min.js": "jszip.min.js",
};

async function rewriteHtml() {
  const src = await readFile(join(ROOT, "Dubnator.html"), "utf8");
  const [cssV, metadataV, rekordboxV, codecsV, audioV, bootstrapV, launchpadV, midiV, midiControlsV, tapTempoV, waveformWorkerV, registerSwV] = await Promise.all([
    assetHash("styles.css"),
    assetHash("track-metadata.js"),
    assetHash("rekordbox.js"),
    assetHash("audio-codecs.js"),
    assetHash("audio-engine.js"),
    assetHash("bootstrap.js"),
    assetHash("launchpad.js"),
    assetHash("midi.js"),
    assetHash("midi-controls.js"),
    assetHash("tap-tempo.js"),
    assetHash("waveform-worker.js"),
    assetHash("register-sw.js"),
  ]);
  // Compiled JS lives in DIST (esbuild output), so hash those, not the .jsx.
  const jsHashes = {};
  for (const entry of JSX_ENTRIES) {
    const name = entry.replace(/\.jsx$/, "");
    jsHashes[name] = await assetHash(`${name}.js`, DIST);
  }
  let out = src
    .replaceAll("styles.css?v=0", `styles.css?v=${cssV}`)
    .replaceAll("track-metadata.js?v=0", `track-metadata.js?v=${metadataV}`)
    .replaceAll("rekordbox.js?v=0", `rekordbox.js?v=${rekordboxV}`)
    .replaceAll("audio-codecs.js?v=0", `audio-codecs.js?v=${codecsV}`)
    .replaceAll("audio-engine.js?v=0", `audio-engine.js?v=${audioV}`)
    .replaceAll("bootstrap.js?v=0", `bootstrap.js?v=${bootstrapV}`)
    .replaceAll("launchpad.js?v=0", `launchpad.js?v=${launchpadV}`)
    .replaceAll("midi.js?v=0", `midi.js?v=${midiV}`)
    .replaceAll("midi-controls.js?v=0", `midi-controls.js?v=${midiControlsV}`)
    .replaceAll("tap-tempo.js?v=0", `tap-tempo.js?v=${tapTempoV}`);
  out = out.replaceAll("waveform-worker.js?v=0", `waveform-worker.js?v=${waveformWorkerV}`);
  for (const entry of JSX_ENTRIES) {
    const name = entry.replace(/\.jsx$/, "");
    out = out.replaceAll(`${name}.js?v=0`, `${name}.js?v=${jsHashes[name]}`);
  }
  // PWA metadata is injected into both generated entry points.
  out = out.replace(
    /<\/head>/,
    `  <link rel="manifest" href="manifest.webmanifest" />\n  <meta name="theme-color" content="#0a0a0a" />\n  <link rel="apple-touch-icon" href="icon-256.png" />\n</head>`,
  );
  // Register the service worker only in production builds; a cache-first SW
  // would serve stale assets during `--serve` watch development.
  const withSw = SERVE ? out : out.replace(
    /<\/body>/,
    `  <script src="register-sw.js?v=${registerSwV}"></script>\n</body>`,
  );
  await writeFile(join(DIST, "index.html"), withSw);
  await writeFile(join(DIST, "Dubnator.html"), withSw);
  return [
    "index.html",
    `styles.css?v=${cssV}`,
    `track-metadata.js?v=${metadataV}`,
    `rekordbox.js?v=${rekordboxV}`,
    `audio-codecs.js?v=${codecsV}`,
    `audio-engine.js?v=${audioV}`,
    `bootstrap.js?v=${bootstrapV}`,
    `launchpad.js?v=${launchpadV}`,
    `midi.js?v=${midiV}`,
    `midi-controls.js?v=${midiControlsV}`,
    `tap-tempo.js?v=${tapTempoV}`,
    `waveform-worker.js?v=${waveformWorkerV}`,
    `register-sw.js?v=${registerSwV}`,
    ...JSX_ENTRIES.map((entry) => {
      const name = entry.replace(/\.jsx$/, "");
      return `${name}.js?v=${jsHashes[name]}`;
    }),
    ...Object.values(VENDOR_MAP).map((name) => `vendor/${name}`),
    ...PWA_FILES,
    ...Object.values(ICON_MAP),
  ];
}

// PWA assets: web manifest + icons always; the service worker only in
// production builds (cache-first SW would defeat the dev watch/live-reload).
const PWA_FILES = ["manifest.webmanifest"];
const ICON_MAP = {
  "src-tauri/icons/128x128.png": "icon-128.png",
  "src-tauri/icons/128x128@2x.png": "icon-256.png",
  "src-tauri/icons/icon.png": "icon-512.png",
};

async function copyStatic() {
  for (const f of STATIC_FILES) {
    await copyFile(join(ROOT, f), join(DIST, f));
  }
  for (const [src, name] of Object.entries(VENDOR_MAP)) {
    await copyFile(join(ROOT, src), join(VENDOR, name));
  }
  for (const f of PWA_FILES) {
    await copyFile(join(ROOT, f), join(DIST, f));
  }
  for (const [src, name] of Object.entries(ICON_MAP)) {
    await copyFile(join(ROOT, src), join(DIST, name));
  }
}

async function writeServiceWorker(shell) {
  const digest = createHash("sha256");
  for (const url of shell) {
    const file = url.split("?")[0];
    digest.update(file);
    digest.update(await readFile(join(DIST, file)));
  }
  const cacheName = `dubnator-${digest.digest("hex").slice(0, 12)}`;
  const template = await readFile(join(ROOT, "sw.js"), "utf8");
  const output = template
    .replace('"__DUBNATOR_CACHE__"', JSON.stringify(cacheName))
    .replace("/*__DUBNATOR_SHELL__*/ []", JSON.stringify(shell, null, 2));
  if (output.includes("__DUBNATOR_")) {
    throw new Error("Service-worker template placeholders were not replaced");
  }
  await writeFile(join(DIST, "sw.js"), output);
}

// Each .jsx is a classic <script> (not a module), but they all declare
// `const { useState, ... } = React` at file scope. Without isolation the
// second `const` would throw a redeclaration SyntaxError under shared globals.
// We wrap each compiled output in an IIFE so file-scope declarations stay
// local; `Object.assign(window, ...)` calls inside still expose components
// globally. This is done via esbuild's banner/footer (not a post-build step)
// so the wrapping is re-applied on every rebuild — including the incremental
// rebuilds esbuild performs in --serve/watch mode, which overwrite the output
// files and would otherwise drop a one-shot post-processing pass.
const IIFE_BANNER = "(function(){";
const IIFE_FOOTER = "})();";

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(VENDOR, { recursive: true });

  const ctx = await esbuild.context({
    entryPoints: JSX_ENTRIES.map((f) => join(ROOT, f)),
    outdir: DIST,
    bundle: false,
    loader: { ".jsx": "jsx" },
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    target: "es2020",
    sourcemap: true,
    banner: { js: IIFE_BANNER },
    footer: { js: IIFE_FOOTER },
    logLevel: "info",
  });

  await ctx.rebuild();
  await copyStatic();
  const shell = await rewriteHtml();
  if (!SERVE) await writeServiceWorker(shell);

  if (SERVE) {
    await ctx.watch();
    const server = await ctx.serve({ servedir: DIST, port: servePort, host: "127.0.0.1" });
    console.log(`\nDubnator dev server: http://${server.host}:${server.port}/`);
    console.log("Watching JSX sources. Static asset edits require a rebuild.\n");
  } else {
    await ctx.dispose();
    console.log(`\nBuilt to ${DIST}/`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
