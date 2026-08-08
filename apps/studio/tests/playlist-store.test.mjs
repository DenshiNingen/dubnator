import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../playlist-store.js", import.meta.url), "utf8");

test("playlist store exposes a safe empty fallback without IndexedDB", async () => {
  const window = {};
  vm.runInNewContext(source, { window, Promise, Array, setTimeout });
  assert.deepEqual(Object.keys(window.DubnatorPlaylistStore).sort(), ["clear", "clearAll", "load", "save"]);
  assert.deepEqual(Array.from(await window.DubnatorPlaylistStore.load("A")), []);
  assert.equal(await window.DubnatorPlaylistStore.save("A", [{ name: "track.wav" }]), null);
  assert.equal(await window.DubnatorPlaylistStore.clear("A"), null);
  assert.equal(await window.DubnatorPlaylistStore.clearAll(), null);
});

test("playlist store keeps audio files in a versioned IndexedDB object store", () => {
  assert.match(source, /dubnator-library/);
  assert.match(source, /createObjectStore\(STORE\)/);
  assert.match(source, /store\.put\(records, key\)/);
  assert.match(source, /store\.get\(key\)/);
  assert.match(source, /new File\(\[record\.blob\]/);
  assert.match(source, /objectStore\(STORE\)\.clear\(\)/);
});
