import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

const [html, serviceWorker] = await Promise.all([
  readFile(join(DIST, "index.html"), "utf8"),
  readFile(join(DIST, "sw.js"), "utf8"),
]);

function localAssets(document) {
  return [...document.matchAll(/(?:href|src)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((url) => !url.startsWith("http") && !url.startsWith("#"));
}

test("production HTML uses only local runtime assets", () => {
  assert.doesNotMatch(html, /(?:src|href)="https?:\/\//);
  assert.doesNotMatch(html, /type="text\/babel"/);
  assert.equal([...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)].length, 0);
  assert.match(html, /vendor\/react\.min\.js/);
  assert.match(html, /audio-codecs\.js\?v=[a-f0-9]{8}/);
});

test("compatibility globals load before their consumers", () => {
  const ordered = [
    "audio-codecs.js",
    "audio-engine.js",
    "midi.js",
    "midi-controls.js",
    "launchpad.js",
    "tap-tempo.js",
    "floating-window.js",
    "keyboard-map.js",
    "launchpad-help.js",
    "playlist-modal.js",
    "app.js",
  ];
  const positions = ordered.map((asset) => html.indexOf(asset));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

test("service worker receives a content-derived cache name", () => {
  assert.match(serviceWorker, /const CACHE = "dubnator-[a-f0-9]{12}"/);
  assert.doesNotMatch(serviceWorker, /__DUBNATOR_/);
});

test("precache contains the exact versioned URLs emitted by HTML", () => {
  const missing = localAssets(html).filter((url) => !serviceWorker.includes(JSON.stringify(url)));
  assert.deepEqual(missing, []);
});

test("only navigations fall back to the application shell", () => {
  assert.match(serviceWorker, /req\.mode === "navigate"/);
  assert.equal(
    [...serviceWorker.matchAll(/catch\(\(\) => caches\.match\("index\.html"\)\)/g)].length,
    1,
  );
});
