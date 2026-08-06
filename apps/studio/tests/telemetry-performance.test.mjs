import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const app = await readFile(new URL("../app.jsx", import.meta.url), "utf8");

test("deck transport telemetry uses an external store instead of App state", () => {
  assert.match(app, /useSyncExternalStore/);
  assert.match(app, /publishDeckTelemetry\("A"/);
  assert.match(app, /publishDeckTelemetry\("B"/);
  assert.match(app, /function DeckTransportRow/);
  assert.doesNotMatch(app, /setDeckA\(\(s\) => \(\{ \.\.\.s, time:/);
  assert.doesNotMatch(app, /setDeckB\(\(s\) => \(\{ \.\.\.s, time:/);
});
