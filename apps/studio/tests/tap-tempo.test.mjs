import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const sandbox = { window: {}, module: { exports: {} } };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(await readFile(join(ROOT, "tap-tempo.js"), "utf8"), sandbox, {
  filename: "tap-tempo.js",
});

const { TapTempoTracker, median } = sandbox.window.DubnatorTapTempo;

test("measures slow human taps in milliseconds and BPM", () => {
  const tracker = new TapTempoTracker();
  assert.equal(tracker.tap(0).ready, false);
  assert.deepEqual(
    { intervalMs: tracker.tap(1000).intervalMs, bpm: tracker.tap(2000).bpm },
    { intervalMs: 1000, bpm: 60 },
  );
});

test("rejects the 60–70 ms duplicate that previously dominated tap tempo", () => {
  const tracker = new TapTempoTracker();
  tracker.tap(0);
  assert.deepEqual(
    { accepted: tracker.tap(67).accepted, size: tracker.timestamps.length },
    { accepted: false, size: 1 },
  );
  const result = tracker.tap(1000);
  assert.equal(result.ready, true);
  assert.equal(result.intervalMs, 1000);
  assert.equal(result.bpm, 60);
});

test("uses a recent median so one mistimed tap does not skew the tempo", () => {
  const tracker = new TapTempoTracker();
  tracker.tap(0);
  tracker.tap(500);
  tracker.tap(1000);
  tracker.tap(1600);
  const result = tracker.tap(2100);
  assert.equal(result.intervalMs, 500);
  assert.equal(result.bpm, 120);
  assert.equal(median([600, 500, 500, 500]), 500);
});

test("starts a fresh sequence after a long pause or a clock reset", () => {
  const tracker = new TapTempoTracker();
  tracker.tap(100);
  assert.equal(tracker.tap(4000).reason, "restart");
  assert.equal(tracker.tap(5000).intervalMs, 1000);
  assert.equal(tracker.tap(10).reason, "restart");
  assert.equal(tracker.timestamps.length, 1);
});
