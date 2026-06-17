// Build pipeline for Dubnator.
// - Pre-compiles JSX → JS with esbuild (so the runtime no longer needs Babel)
// - Vendors React, ReactDOM, JSZip from node_modules into dist/vendor/
// - Rewrites Dubnator.html to use local vendored deps and compiled scripts
// - Outputs dist/index.html (Tauri's default entry) plus dist/Dubnator.html
// `node build.mjs --serve` watches sources and serves dist/ on :1420 for Tauri dev.

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

const JSX_ENTRIES = ["controls.jsx", "tweaks-panel.jsx", "app.jsx"];
const STATIC_FILES = ["audio-engine.js", "midi.js", "styles.css"];
const VENDOR_MAP = {
  "node_modules/react/umd/react.production.min.js": "react.min.js",
  "node_modules/react-dom/umd/react-dom.production.min.js": "react-dom.min.js",
  "node_modules/jszip/dist/jszip.min.js": "jszip.min.js",
};

async function rewriteHtml() {
  const src = await readFile(join(ROOT, "Dubnator.html"), "utf8");
  const [cssV, audioV, midiV] = await Promise.all([
    assetHash("styles.css"), assetHash("audio-engine.js"), assetHash("midi.js"),
  ]);
  // Compiled JS lives in DIST (esbuild output), so hash those, not the .jsx.
  const jsHashes = {};
  for (const entry of JSX_ENTRIES) {
    const name = entry.replace(/\.jsx$/, "");
    jsHashes[name] = await assetHash(`${name}.js`, DIST);
  }
  const out = src
    .replace(/styles\.css\?v=\d+/g, `styles.css?v=${cssV}`)
    .replace(/audio-engine\.js\?v=\d+/g, `audio-engine.js?v=${audioV}`)
    .replace(/midi\.js\?v=\d+/g, `midi.js?v=${midiV}`)
    .replace(
      /<script src="https:\/\/unpkg\.com\/react@[^"]+"[^>]*><\/script>\s*/,
      `<script src="vendor/react.min.js"></script>\n  `,
    )
    .replace(
      /<script src="https:\/\/unpkg\.com\/react-dom@[^"]+"[^>]*><\/script>\s*/,
      `<script src="vendor/react-dom.min.js"></script>\n  `,
    )
    .replace(/<script src="https:\/\/unpkg\.com\/@babel\/standalone[^"]+"[^>]*><\/script>\s*/, "")
    .replace(
      /<script src="https:\/\/unpkg\.com\/jszip[^"]+"[^>]*><\/script>\s*/,
      `<script src="vendor/jszip.min.js"></script>\n  `,
    )
    .replace(
      /<script type="text\/babel" src="([^"]+?)\.jsx(?:\?v=\d+)?"><\/script>/g,
      (_, name) => `<script src="${name}.js?v=${jsHashes[name] || "0"}"></script>`,
    )
    // PWA: web manifest + theme colour in <head> (harmless in dev).
    .replace(
      /<\/head>/,
      `  <link rel="manifest" href="manifest.webmanifest" />\n  <meta name="theme-color" content="#0a0a0a" />\n  <link rel="apple-touch-icon" href="icon-256.png" />\n</head>`,
    );
  // Register the service worker only in production builds; a cache-first SW
  // would serve stale assets during `--serve` watch development.
  const withSw = SERVE ? out : out.replace(
    /<\/body>/,
    `  <script>\n    if ("serviceWorker" in navigator) {\n      window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));\n    }\n  </script>\n</body>`,
  );
  await writeFile(join(DIST, "index.html"), withSw);
  await writeFile(join(DIST, "Dubnator.html"), withSw);
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
  if (!SERVE) {
    await copyFile(join(ROOT, "sw.js"), join(DIST, "sw.js"));
  }
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
  await rewriteHtml();

  if (SERVE) {
    await ctx.watch();
    const server = await ctx.serve({ servedir: DIST, port: 1420, host: "127.0.0.1" });
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
