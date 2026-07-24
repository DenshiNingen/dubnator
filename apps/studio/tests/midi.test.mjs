// MIDI mapping core tests (pure, no browser). Run: node tests/midi.test.mjs
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const code = await readFile(join(ROOT, "midi.js"), "utf8");
const sandbox = { window: {}, module: { exports: {} }, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "midi.js" });
const { MidiMapper } = sandbox.window.DubnatorMidi;

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + msg); } };
const section = (s) => console.log("\n• " + s);

// MIDI message helpers
const cc = (num, val, ch = 0) => [0xb0 | ch, num, val];
const noteOn = (num, vel = 127, ch = 0) => [0x90 | ch, num, vel];
const noteOff = (num, ch = 0) => [0x80 | ch, num, 0];

section("parse");
{
  ok(MidiMapper.parse(cc(7, 127)).value01 === 1, "CC value 127 → 1.0");
  ok(Math.abs(MidiMapper.parse(cc(7, 64)).value01 - 64 / 127) < 1e-9, "CC value 64 normalised");
  ok(MidiMapper.parse(noteOn(36)).press === true, "note-on is a press");
  ok(MidiMapper.parse(noteOff(36)).press === false, "note-off is a release");
  ok(MidiMapper.parse([0xf8]) === null, "clock byte ignored");
}

section("learn → bind → fire a range control");
{
  const m = new MidiMapper();
  let last = -1;
  m.register("master.gain", (v) => { last = v; }, { type: "range" });
  m.armLearn("master.gain");
  ok(m.isLearning(), "armed");
  const r = m.handleMessage(cc(7, 100));
  ok(r && r.learned && r.learned.controlId === "master.gain", "learned the CC");
  ok(!m.isLearning(), "learn auto-disarms after binding");
  m.handleMessage(cc(7, 127));
  ok(last === 1, "subsequent CC drives the handler to 1.0");
  m.handleMessage(cc(7, 0));
  ok(last === 0, "CC 0 → 0.0");
}

section("momentary button");
{
  const m = new MidiMapper();
  const seq = [];
  m.register("kill.sub", (v) => seq.push(v), { type: "button", momentary: true });
  m.armLearn("kill.sub");
  m.handleMessage(noteOn(36));   // learn binds on press
  m.handleMessage(noteOn(36));   // press → 1
  m.handleMessage(noteOff(36));  // release → 0
  ok(seq.join(",") === "1,0", "momentary fires 1 on press, 0 on release");
}

section("toggle button");
{
  const m = new MidiMapper();
  const seq = [];
  m.register("eq.bypass", (v) => seq.push(v), { type: "button", momentary: false });
  m.bind("note:0:40", "eq.bypass");
  m.handleMessage(noteOn(40)); m.handleMessage(noteOff(40)); // first press toggles on
  m.handleMessage(noteOn(40)); m.handleMessage(noteOff(40)); // second press toggles off
  ok(seq.join(",") === "1,0", "toggle flips on each press, ignores release");
}

section("many-to-one (one knob → several controls)");
{
  const m = new MidiMapper();
  const hit = [];
  m.register("kill.bass", () => hit.push("bass"), { type: "button" });
  m.register("kill.mid", () => hit.push("mid"), { type: "button" });
  m.register("kill.top", () => hit.push("top"), { type: "button" });
  ["kill.bass", "kill.mid", "kill.top"].forEach((id) => m.bind("note:0:41", id));
  m.handleMessage(noteOn(41));
  ok(hit.length === 3 && hit.includes("bass") && hit.includes("mid") && hit.includes("top"), "one note fired all three (sub-solo button)");
}

section("one-to-many (one control from several keys)");
{
  const m = new MidiMapper();
  let n = 0;
  m.register("xfade", () => { n++; }, { type: "range" });
  m.bind("cc:0:1", "xfade");
  m.bind("cc:0:2", "xfade");
  m.handleMessage(cc(1, 10));
  m.handleMessage(cc(2, 20));
  ok(n === 2, "xfade driven from two different CCs");
}

section("unbind + serialize/load round-trip");
{
  const m = new MidiMapper();
  m.register("a", () => {}); m.register("b", () => {});
  m.bind("cc:0:1", "a"); m.bind("cc:0:2", "b");
  ok(m.bindingKeysFor("a").join() === "cc:0:1", "bindingKeysFor reports binding");
  const json = JSON.stringify(m.serialize());
  m.unbind("a");
  ok(m.bindingKeysFor("a").length === 0, "unbind removes binding");
  const m2 = new MidiMapper();
  m2.register("a", () => {}); m2.register("b", () => {});
  m2.load(JSON.parse(json));
  ok(m2.bindingKeysFor("a").join() === "cc:0:1" && m2.bindingKeysFor("b").join() === "cc:0:2", "load restores all bindings");
}

section("channel isolation");
{
  const m = new MidiMapper();
  let fired = false;
  m.register("x", () => { fired = true; });
  m.bind("cc:0:5", "x");           // channel 0
  m.handleMessage(cc(5, 100, 1));  // channel 1 — different key
  ok(!fired, "same CC on a different channel does not fire");
  m.handleMessage(cc(5, 100, 0));
  ok(fired, "correct channel fires");
}

section("semantic surface dispatch");
{
  const m = new MidiMapper();
  const values = [];
  m.register("surface.range", (value, event) => values.push({ value, surface: event.surface }), { type: "range" });
  ok(m.dispatch("surface.range", 0.75, { device: "launchpad-a" }) === true, "registered surface control dispatches");
  ok(values.length === 1 && values[0].value === 0.75 && values[0].surface === true, "surface event reaches the handler");
  ok(m.dispatch("missing", 1) === false, "unknown semantic control is ignored safely");
}

console.log(`\n${fail === 0 ? "✓ PASS" : "✗ FAIL"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
