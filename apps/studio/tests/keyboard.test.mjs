// Keyboard-shortcut consistency: every labeled key in the KEY_ROWS overlay must
// have a matching branch in the down() keydown handler, and vice-versa for the
// keys we explicitly bind. Guards against the overlay drifting away from the
// real behavior (the bug this test was written to fix: ~12 keys mislabeled or
// dead, e.g. "0=Full Screen" actually did echo-time-down, "[ ]" said "Scroll"
// but stepped the siren preset, and several keys had no handler at all).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "app.jsx"), "utf8");
const KEYBOARD_SRC = readFileSync(join(ROOT, "keyboard-map.jsx"), "utf8");

// Slice out the down() keydown handler body (from "const down = (e) =>" up to
// the "const up = (e) =>" that follows it) so we only match real bindings.
const downStart = SRC.indexOf("const down = (e) =>");
const upStart = SRC.indexOf("const up = (e) =>");
assert.ok(downStart > 0 && upStart > downStart, "could not locate down()/up() handlers");
const DOWN = SRC.slice(downStart, upStart);

// Canonical map: overlay display-key -> { token: the e.key string the handler
// matches, label: substring expected on the overlay key's top label }.
// This IS the spec — overlay and handler are both checked against it.
const CANON = [
  ["Esc", "Escape", "Close Floating Window"],
  ["1", "1", "Siren Trigger"],
  ["2", "2", "Preset Down"],
  ["3", "3", "Preset Up"],
  ["4", "4", "Sample Trigger"],
  ["5", "5", "Reverb Band Lower"],
  ["6", "6", "Reverb Band Higher"],
  ["7", "7", "Echo Band Lower"],
  ["8", "8", "Echo Band Higher"],
  ["9", "9", "Echo Tap Tempo"],
  ["0", "0", "Full Screen"],
  ["−", "-", "Dub Filter LP"],
  ["+", "=", "Dub Filter HP"],
  ["Q", "q", "Reverb Trigger"],
  ["W", "w", "Echo Trigger"],
  ["E", "e", "Echo 100% Feedback"],
  ["R", "r", "Sample Select"],
  ["T", "t", "Load Track A"],
  ["Y", "y", "Load Track B"],
  ["U", "u", "Sample Reverb"],
  ["I", "i", "Sample Echo"],
  ["O", "o", "Mic Reverb"],
  ["P", "p", "Mic Echo"],
  ["[", "[", "Scroll Down A"],
  ["]", "]", "Scroll Up A"],
  ["\\\\", "\\\\", "FX Direct"],
  ["A", "a", "Echo Time Fast"],
  ["S", "s", "Echo Time Slow"],
  ["D", "d", "Echo 70% Feedback"],
  ["F", "f", "Echo 90% Feedback"],
  ["G", "g", "Play Track A"],
  ["H", "h", "Play Track B"],
  ["J", "j", "Mute 1"],
  ["K", "k", "Mute 2"],
  ["L", "l", "Mic Mute"],
  [";", ";", "Scroll Down B"],
  ["'", "'", "Scroll Up B"],
  ["Z", "z", "Sub Kill"],
  ["X", "x", "Low Kill"],
  ["C", "c", "Mid Kill"],
  ["V", "v", "High Kill"],
  ["B", "b", "Top Kill"],
  ["M", "m", "Stop A"],
  [",", ",", "Stop B"],
  [".", ".", "Load & Play A"],
  ["/", "/", "Load & Play B"],
  ["Space", " ", "Playbar List View"],
  ["←", "ArrowLeft", "Dub Filter Down"],
  ["→", "ArrowRight", "Dub Filter Up"],
];

// A handler branch for a token looks like `k === "<token>"` or `kl === "<token>"`.
// Build the exact match strings (the source escapes backslash/quote as needed).
function tokenMatchers(token) {
  if (token === "\\\\") return ['k === "\\\\"']; // backslash key, source: k === "\\"
  if (token === " ") return ['k === " "'];
  return [`k === "${token}"`, `kl === "${token}"`];
}

test("every labeled overlay key has a matching down() handler branch", () => {
  const missing = [];
  for (const [disp, token] of CANON) {
    const ok = tokenMatchers(token).some((m) => DOWN.includes(m));
    if (!ok) missing.push(`${disp} (expected handler for e.key "${token}")`);
  }
  assert.deepEqual(missing, [], `keys labeled in the overlay but missing a handler:\n  ${missing.join("\n  ")}`);
});

test("every canonical overlay key carries the expected top label", () => {
  // Pull the KEY_ROWS literal and check each expected label substring is present.
  const krStart = KEYBOARD_SRC.indexOf("const KEY_ROWS = [");
  const krEnd = KEYBOARD_SRC.indexOf("const COLOR_LEGEND");
  assert.ok(krStart > 0 && krEnd > krStart, "could not locate KEY_ROWS");
  const KR = KEYBOARD_SRC.slice(krStart, krEnd);
  const missing = CANON.filter(([, , label]) => !KR.includes(`"${label}"`)).map(([d, , l]) => `${d}: "${l}"`);
  assert.deepEqual(missing, [], `overlay labels missing/renamed:\n  ${missing.join("\n  ")}`);
});

test("the dead botLabel field is gone (it never rendered)", () => {
  assert.ok(!KEYBOARD_SRC.includes("botLabel"), "KEY_ROWS still has a botLabel field, which KeyboardMap never renders");
});

test("removed mis-bindings are actually gone", () => {
  // 0 / 9 no longer adjust echo time; [ ] no longer step the siren preset.
  assert.ok(!/k === "0".*setEcho/.test(DOWN), "key 0 still adjusts echo time (should be Full Screen)");
  assert.ok(!/k === "\["\) \{ e\.preventDefault\(\); setSiren/.test(DOWN), "[ still steps the siren preset (should scroll deck A)");
  assert.ok(DOWN.includes("toggleFullscreen()"), "key 0 should call toggleFullscreen()");
});

test("siren preset moved to keys 2 and 3", () => {
  assert.ok(/k === "2".*stepSirenPreset\(s, -1\)/.test(DOWN), "key 2 should step siren preset down");
  assert.ok(/k === "3".*stepSirenPreset\(s, \+1\)/.test(DOWN), "key 3 should step siren preset up");
});

test("global performance shortcuts ignore focused controls and open tools", () => {
  assert.match(SRC, /closest\?\.\("input, textarea, select, button, \[role='slider'\]/);
  assert.match(SRC, /if \(helpOpen \|\| sirenSetupOpen \|\| playlistOpen \|\| midiOpen \|\| deckFocusOpen\) return/);
  assert.match(SRC, /if \(deckFocusOpen\) \{ setDeckFocusOpen\(false\); return; \}/);
  assert.match(SRC, /if \(midiOpen\) \{ setMidiOpen\(false\); return; \}/);
});
