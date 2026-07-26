import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const app = await readFile(new URL("app.jsx", root), "utf8");
const match = app.match(/const DUB_ECHO_START = Object\.freeze\((\{[\s\S]*?\})\);/);
assert.ok(match, "DUB_ECHO_START is declared");
const dub = vm.runInNewContext(`(${match[1]})`);

test("dub echo starting point is tempo-related, filtered and restrained", () => {
  assert.equal(dub.sync, true);
  assert.equal(dub.syncDiv, "1/8.");
  assert.equal(dub.hpOn, true);
  assert.ok(dub.hp >= 100, "removes sub build-up from the feedback loop");
  assert.ok(dub.filter >= 2000 && dub.filter <= 4000, "keeps repeats dark but intelligible");
  assert.ok(dub.fb >= 0.4 && dub.fb <= 0.55, "rings without approaching runaway feedback");
  assert.ok(dub.dw <= 0.45, "return starts behind the dry source");
  assert.ok(dub.sat <= 0.35, "does not overdrive the feedback loop by default");
});

test("echo throw is a held gesture that restores the previous routing", () => {
  assert.match(app, /echoThrowRestoreRef = useRef\(null\)/);
  assert.match(app, /musicEcho: musicSends\.echo/);
  assert.match(app, /setMusicSends\(s => \(\{ \.\.\.s, echo: previous\.musicEcho \}\)\)/);
  assert.match(app, /"echo\.throw": \(v\) => actionsRef\.current\.echoThrow\?\.\(v > 0\.5\)/);
  assert.match(app, /onPointerDown=\{\(event\) =>/);
  assert.match(app, /onPointerUp=\{\(event\) =>/);
});
