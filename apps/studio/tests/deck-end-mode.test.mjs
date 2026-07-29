import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const app = await readFile(new URL("../app.jsx", import.meta.url), "utf8");

function readArrow(name) {
  const match = app.match(new RegExp(`const ${name} = (.*);`));
  assert.ok(match, `${name} is declared`);
  return vm.runInNewContext(`(${match[1]})`);
}

const fromValue = readArrow("deckEndModeFromValue");
const toValue = readArrow("deckEndModeValue");

test("deck end mode maps cleanly onto the MIDI and Launchpad range", () => {
  assert.equal(fromValue(0), "stop");
  assert.equal(fromValue(0.24), "stop");
  assert.equal(fromValue(0.25), "loop");
  assert.equal(fromValue(0.74), "loop");
  assert.equal(fromValue(0.75), "next");
  assert.equal(fromValue(1), "next");
  assert.equal(toValue("stop"), 0);
  assert.equal(toValue("loop"), 0.5);
  assert.equal(toValue("next"), 1);
});

test("STOP is the default and old AUTO presets migrate without restoring implicit looping", () => {
  assert.match(app, /useState\("stop"\).*stop, repeat current track/);
  assert.match(app, /p\.autoAdvance \? "next" : "stop"/);
  assert.match(app, /d\.setLoopSingle\(deckEndMode === "loop"\)/);
  assert.match(app, /d\.nextTrack\(\{ wrap: false \}\)/);
});

test("the rack exposes all three end behaviours explicitly", () => {
  assert.match(app, /role="radiogroup" aria-label="Deck end mode"/);
  for (const mode of ["STOP", "LOOP", "NEXT"]) {
    assert.ok(app.includes(`"${mode.toLowerCase()}"`), `${mode} mode is present`);
  }
});
