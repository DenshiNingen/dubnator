import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const [app, playlist, metadata, rekordbox, css] = await Promise.all([
  readFile(new URL("app.jsx", root), "utf8"),
  readFile(new URL("playlist-modal.jsx", root), "utf8"),
  readFile(new URL("track-metadata.js", root), "utf8"),
  readFile(new URL("rekordbox.js", root), "utf8"),
  readFile(new URL("styles.css", root), "utf8"),
]);

test("shared playlists default on and can be separated without sharing playback state", () => {
  assert.match(app, /localStorage\.getItem\(PLAYLIST_LINK_KEY\) !== "0"/);
  assert.match(app, /target\.playlist = \[\.\.\.\(source\.playlist \|\| \[\]\)\]/);
  assert.match(app, /target\.playlistIdx = preservedIndex/);
  assert.match(app, /className={`deck-playlist-link/);
  assert.match(playlist, /onTogglePlaylistLink\?\.\(!playlistsLinked\)/);
});

test("artwork is visible in compact, overview, expanded and playlist views", () => {
  assert.match(metadata, /APIC/);
  assert.match(metadata, /type === 6/);
  assert.match(metadata, /covr/);
  assert.match(app, /className="deck-strip-art"/);
  assert.match(app, /className="td-art"/);
  assert.match(app, /className="deck-focus-cover"/);
  assert.match(playlist, /info\.artworkUrl/);
  assert.match(css, /\.c-art img/);
});

test("Rekordbox XML import exposes playlist choice, order matching and folder picking", () => {
  assert.match(rekordbox, /new DOMParser\(\)/);
  assert.match(rekordbox, /PLAYLISTS > NODE/);
  assert.match(playlist, /REKORDBOX XML/);
  assert.match(playlist, /APPLY TO LOADED/);
  assert.match(playlist, /webkitdirectory=""/);
  assert.match(playlist, /onPlaylistChange\?\.\(deckKey\)/);
});

test("playlist rows expose a paused load action separately from load and play", () => {
  assert.match(playlist, /title="Load paused"/);
  assert.match(playlist, /onClick=\{\(\) => onLoad\(i, false\)\}/);
  assert.match(playlist, /title="Load & play"/);
});

test("advanced mode exposes a safe control to clear persisted deck files", () => {
  assert.match(app, /const clearSavedSession = \(\) =>/);
  assert.match(app, /store\.clearAll\(\)/);
  assert.match(app, /CLEAR SAVED SESSION/);
  assert.match(app, /Active decks will not change/);
});
