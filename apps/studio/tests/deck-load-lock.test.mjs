import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const [app, playlist, css] = await Promise.all([
  readFile(new URL("app.jsx", root), "utf8"),
  readFile(new URL("playlist-modal.jsx", root), "utf8"),
  readFile(new URL("styles.css", root), "utf8"),
]);

test("a playing deck reports a load lock instead of replacing its track", () => {
  assert.match(app, /const canReplaceDeckTrack = \(deckKey\) => \{/);
  assert.match(app, /if \(!deck\?\.playing\) return true;/);
  assert.match(app, /STOP IT BEFORE LOADING ANOTHER TRACK/);
  assert.match(app, /role="alert"/);
  assert.match(css, /\.deck-load-warning\s*\{/);
});

test("every manual track replacement path checks the load lock", () => {
  assert.match(app, /if \(shouldLoad && !canReplaceDeckTrack\(deckKey\)\) return false;/);
  for (const deck of ["A", "B"]) {
    assert.match(app, new RegExp(`nextTrack${deck} = async \\(\\) => \\{[^\\n]+canReplaceDeckTrack\\("${deck}"\\)`));
    assert.match(app, new RegExp(`prevTrack${deck} = async \\(\\) => \\{[^\\n]+canReplaceDeckTrack\\("${deck}"\\)`));
  }
  assert.match(app, /if \(!canReplaceDeckTrack\(which\)\) return;/);
  assert.match(app, /canReplaceDeckTrack=\{canReplaceDeckTrack\}/);
  assert.match(playlist, /const onLoad[\s\S]*?canReplaceDeckTrack\(deckKey\)/);
  assert.match(playlist, /const applyReconcile[\s\S]*?canReplaceDeckTrack\(deckKey\)/);
  assert.match(playlist, /const importZip[\s\S]*?canReplaceDeckTrack\(deckKey\)/);
});

test("adding tracks remains safe unless it would implicitly replace an empty deck", () => {
  assert.match(app, /const shouldLoad = opts\.load \|\| !engDeck\.buffer;/);
  assert.match(playlist, /wasEmpty && canReplaceDeckTrack && !canReplaceDeckTrack\(deckKey\)/);
});
