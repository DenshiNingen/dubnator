import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const [app, controls, css] = await Promise.all([
  readFile(new URL("app.jsx", root), "utf8"),
  readFile(new URL("controls.jsx", root), "utf8"),
  readFile(new URL("styles.css", root), "utf8"),
]);

test("knobs expose semantic colour tones without changing their control API", () => {
  assert.match(controls, /midiId, tone = ""/);
  assert.match(controls, /control-tone-\$\{tone\}/);
  for (const tone of ["mint", "cyan", "blue", "yellow", "orange", "red", "violet", "magenta"]) {
    assert.match(css, new RegExp(`\\.control-tone-${tone}\\s*\\{`), tone);
  }
});

test("reverb and echo share a functional colour vocabulary", () => {
  for (const mapping of [
    ['k: "send", label: "SEND", tone: "violet"'],
    ['k: "dw", label: "D/W", tone: "violet"'],
    ['k: "mod", label: "MOD", tone: "magenta"'],
    ['k: "send", label: "SEND", tone: "orange"'],
    ['k: "dw", label: "D/W", tone: "orange"'],
    ['k: "sat", label: "SAT", tone: "red"'],
    ['k: "fb", label: "F.B.", tone: "yellow"'],
    ['k: "wow", label: "WOW", tone: "magenta"'],
  ]) {
    assert.ok(app.includes(mapping), mapping);
  }
});

test("processor identity and dangerous actions retain distinct colours", () => {
  assert.match(css, /\.rack-reverb\s*\{[\s\S]*?--fx-colour: #a879ff/);
  assert.match(css, /\.rack-echo\s*\{[\s\S]*?--fx-colour: #ff9f43/);
  assert.match(app, /className="btn-xs btn fx-action fx-panic"/);
  assert.match(css, /\.fx-panic\s*\{[\s\S]*?--action-colour: #ff5c5c/);
});
