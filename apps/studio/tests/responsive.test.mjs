import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const [html, css, app, bootstrap, controls] = await Promise.all([
  readFile(new URL("Dubnator.html", root), "utf8"),
  readFile(new URL("styles.css", root), "utf8"),
  readFile(new URL("app.jsx", root), "utf8"),
  readFile(new URL("bootstrap.js", root), "utf8"),
  readFile(new URL("controls.jsx", root), "utf8"),
]);

test("uses the real device viewport without disabling pinch zoom", () => {
  assert.match(
    html,
    /name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/,
  );
  assert.doesNotMatch(html, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i);
});

test("defines distinct tablet, phone, and coarse-pointer layouts", () => {
  assert.match(css, /@media \(min-width: 1101px\) and \(max-width: 1366px\) and \(pointer: fine\)/);
  assert.match(css, /@media \(max-width: 1100px\), \(pointer: coarse\) and \(max-width: 1280px\)/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /@media \(pointer: coarse\)/);
  assert.match(
    css,
    /\.grid-top,\s*\.grid-mid,\s*\.grid-bottom,\s*\.right-rail,\s*\.transport-row\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/,
  );
});

test("compact screens expose a sticky section navigator without widening the page", () => {
  assert.match(app, /aria-label="Rack sections"/);
  for (const id of ["rack-inputs", "rack-eq", "rack-decks", "rack-fx", "rack-kills", "rack-pads", "rack-output"]) {
    assert.match(app, new RegExp(`id="${id}"`), id);
  }
  assert.match(css, /@media \(max-width: 900px\), \(pointer: coarse\) and \(max-width: 1280px\)/);
  assert.match(css, /\.compact-rack-nav-track\s*\{[\s\S]*?width: 0;[\s\S]*?overflow-x: auto/);
  assert.match(css, /#root\s*\{[\s\S]*?min-width: 0/);
});

test("short coarse-pointer screens make floating tools full-screen", () => {
  assert.match(css, /@media \(max-width: 900px\) and \(max-height: 600px\) and \(pointer: coarse\)/);
  assert.match(
    css,
    /\.floating-window\s*\{[\s\S]*?width: 100vw !important;[\s\S]*?height: 100dvh !important/,
  );
});

test("custom touch controls cancel safely and expose keyboard slider semantics", () => {
  assert.match(controls, /function useWindowPointerDrag\(\)/);
  assert.match(controls, /addEventListener\("pointercancel", finish\)/);
  assert.match(controls, /function handleSliderKey\(/);
  assert.ok((controls.match(/role="slider"/g) || []).length >= 4);
  assert.ok((controls.match(/tabIndex=\{0\}/g) || []).length >= 4);
  assert.match(css, /\.knob:focus-visible,[\s\S]*?outline: 2px solid var\(--accent\)/);
  assert.match(css, /\.fader-track::before,[\s\S]*?inset: 0 -10px/);
  assert.match(css, /\.xfader::before\s*\{[\s\S]*?inset: -8px 0/);
  assert.match(app, /className="setup-tabs" role="tablist"/);
  assert.match(app, /aria-label="Music reverb send" aria-pressed=/);
  assert.match(app, /role="button" tabIndex=\{0\}/);
  assert.match(app, /<DeckWaveform engineDeck=\{(?:ready \? deck\(\) : null|engineDeck)/);
  assert.match(controls, /function DeckWaveform\(/);
  assert.match(controls, /aria-label=\{`Deck \$\{label\} \$\{windowSeconds > 0 \? "detailed " : ""\}waveform playhead`\}/);
  assert.match(css, /\.deck-waveform-loop\s*\{/);
  assert.match(css, /\.deck-waveform-cue\s*\{/);
  assert.match(controls, /event\.stopPropagation\(\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("visual feedback work pauses or throttles when it cannot help the user", () => {
  assert.match(app, /const METER_FRAME_MS = 1000 \/ 30/);
  assert.match(app, /const METER_UI_FRAME_MS = 1000 \/ 20/);
  assert.match(app, /now - lastUiFrame >= METER_UI_FRAME_MS/);
  assert.match(app, /document\.hidden \|\| now - lastFrame < METER_FRAME_MS/);
  assert.match(controls, /new IntersectionObserver/);
  assert.match(controls, /document\.addEventListener\("visibilitychange"/);
  assert.match(controls, /observer\?\.disconnect\(\)/);
  assert.match(bootstrap, /observer\.disconnect\(\)/);
  assert.doesNotMatch(bootstrap, /setInterval/);
});

test("native output routing uses an explicit user-gesture button", () => {
  assert.match(app, /value=\{pendingOutDeviceId\}/);
  assert.match(app, /onClick=\{\(\) => onPickOutput\(pendingOutDeviceId\)\}/);
  assert.match(app, />\s*APPLY OUTPUT\s*<\/button>/);
  assert.doesNotMatch(app, /onChange=\{\(e\) => onPickOutput\(e\.target\.value\)\}/);
  assert.doesNotMatch(app, /if \(selected\?\.deviceId\) \{\s*await eng\.setOutputDevice/);
});

test("labels every main rack region for stable responsive placement", () => {
  for (const className of [
    "rack-music",
    "rack-mic",
    "rack-setup",
    "rack-geq",
    "rack-parametric",
    "rack-siren",
    "rack-reverb",
    "rack-echo",
    "rack-sample-fx",
    "rack-master",
    "rack-kill",
    "rack-sample-triggers",
    "rack-limiters",
    "rack-recorder",
  ]) {
    assert.match(app, new RegExp(`className=[^\\n]*${className}`), className);
  }
});

test("wide performance surfaces scroll inside their panels on phones", () => {
  assert.match(css, /\.rack-music \.strip-row\s*\{[\s\S]*?overflow-x: auto/);
  assert.match(css, /\.rack-geq \.panel-body\s*\{[\s\S]*?overflow-x: auto/);
  assert.match(css, /\.lp-help-boards,[\s\S]*?scroll-snap-type: x mandatory/);
});

test("deck transport expands into synchronized single and double performance views", () => {
  assert.match(app, /aria-label="Open expanded deck view"/);
  assert.match(app, /function DeckFocusView\(/);
  assert.match(app, /aria-label="Deck view mode"/);
  assert.match(app, /aria-pressed=\{mode === "single"\}/);
  assert.match(app, /aria-pressed=\{mode === "double"\}/);
  assert.match(app, /<DeckWaveform engineDeck=\{engineDeck\}/);
  assert.match(app, /windowSeconds=\{zoomSeconds\}/);
  assert.match(app, /aria-label=\{`Zoom in Deck \$\{label\} waveform`\}/);
  assert.match(app, /aria-label=\{`Deck \$\{label\} waveform zoom`\}/);
  assert.match(app, /Math\.exp\(Math\.max\(-120, Math\.min\(120, input\)\) \* 0\.0015\)/);
  assert.match(app, /aria-label=\{`\$\{(?:state|liveState)\.playing \? "Pause" : "Play"\} Deck \$\{label\}`\}/);
  assert.match(app, /aria-label=\{`Rewind Deck \$\{label\}`\}/);
  assert.match(app, /aria-label=\{`Halve loop on Deck \$\{label\}`\}/);
  assert.match(app, /aria-label=\{`Double loop on Deck \$\{label\}`\}/);
  assert.match(controls, /Math\.ceil\(buffer\.duration \* 28\)/);
  assert.match(controls, /className="deck-waveform-body"/);
  assert.match(css, /\.deck-focus-grid-double\s*\{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(
    css,
    /@media \(max-width: 700px\)[\s\S]*?\.deck-focus-grid-double\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/,
  );
  assert.match(css, /\.deck-focus-modal\s*\{[\s\S]*?height: min\(820px, 92dvh\)/);
});

test("legacy viewport scaling cannot shrink the responsive rack", () => {
  assert.match(bootstrap, /chassis\.style\.transform = "none"/);
  assert.doesNotMatch(bootstrap, /Math\.min\(window\.innerWidth/);
});
