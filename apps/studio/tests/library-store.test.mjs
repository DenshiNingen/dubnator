import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../library-store.js", import.meta.url), "utf8");

test("library store exposes a safe empty fallback", async () => {
  const window = {};
  vm.runInNewContext(source, { window, Promise, Array, Date, setTimeout });
  assert.deepEqual(Object.keys(window.DubnatorLibraryStore).sort(), ["clear", "load", "save"]);
  assert.equal(JSON.stringify(await window.DubnatorLibraryStore.load()), JSON.stringify({ version: 1, updated: 0, playlists: [] }));
  assert.equal(await window.DubnatorLibraryStore.save({ playlists: [{ id: "p1", name: "Dub" }] }), null);
  assert.equal(await window.DubnatorLibraryStore.clear(), null);
});

test("library store uses a versioned IndexedDB catalogue object store", () => {
  assert.match(source, /dubnator-playlist-catalogue/);
  assert.match(source, /DB_VERSION = 2/);
  assert.match(source, /createObjectStore\(STORE\)/);
  assert.match(source, /store\.put\(value, "root"\)/);
  assert.match(source, /store\.get\("root"\)/);
});
