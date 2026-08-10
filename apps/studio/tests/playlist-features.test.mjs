import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const [app, playlist, metadata, rekordbox, engineDJ, css] = await Promise.all([
  readFile(new URL("app.jsx", root), "utf8"),
  readFile(new URL("playlist-modal.jsx", root), "utf8"),
  readFile(new URL("track-metadata.js", root), "utf8"),
  readFile(new URL("rekordbox.js", root), "utf8"),
  readFile(new URL("engine-dj.js", root), "utf8"),
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

test("Engine DJ library uses a hierarchical master-detail browser", () => {
  assert.match(playlist, /className="engine-browser-tree"/);
  assert.match(playlist, /className="engine-browser-detail"/);
  assert.match(playlist, /setSelectedLibraryId\(id\)/);
  assert.match(playlist, /Selected playlist tracks/);
  assert.match(playlist, /loadEnginePlaylist\(playlist, \{ index, stayInLibrary: true \}\)/);
  assert.match(playlist, /loadEnginePlaylist\(playlist, \{ index, play: true, stayInLibrary: true \}\)/);
  assert.match(css, /\.engine-browser\s*\{[\s\S]*?grid-template-columns:/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.engine-browser\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
});

test("Engine DJ catalogue keeps metadata needed by the track preview", () => {
  assert.match(engineDJ, /split\(";"\)[\s\S]*?\.reverse\(\)/);
  assert.match(playlist, /onClick=\{\(\) => toggleLibraryFolder\(node\.path\)\}/);
  assert.match(playlist, /aria-label=\{`View \$\{node\.name\} playlist`\}/);
  assert.match(playlist, /active\?\.files\?\.length \? active : playlist/);
  assert.match(playlist, /mergeLibraryCatalogue\(catalogue\.playlists, current\)/);
  for (const field of ["album", "genre", "duration", "bpm"]) {
    assert.match(engineDJ, new RegExp(`${field}: file\\.engineDJ\\.${field}`));
  }
});

test("large library folders paginate tracks and keep collapse separate from selection", () => {
  assert.match(playlist, /const LIBRARY_TRACK_PAGE_SIZE = 200/);
  assert.match(playlist, /const selectedLibraryView = useMemo/);
  assert.match(playlist, /visibleTracks\.slice\(pageStart, pageStart \+ LIBRARY_TRACK_PAGE_SIZE\)/);
  assert.match(playlist, /className="engine-track-pagination"/);
  assert.match(css, /\.engine-browser-folder-toggle/);
  assert.match(css, /\.engine-track-pagination/);
});

test("Engine drive picker skips unrelated files when the drive root is selected", async () => {
  const sandbox = {
    ArrayBuffer,
    BigInt,
    DataView,
    URL: { createObjectURL: () => "blob:test" },
    Uint8Array,
    console,
    setTimeout,
    window: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(engineDJ, sandbox, { filename: "engine-dj.js" });

  let unrelatedVisited = false;
  const database = {
    kind: "file",
    getFile: async () => ({ name: "m.db", size: 1, lastModified: 0 }),
  };
  const databaseDirectory = {
    kind: "directory",
    name: "Database2",
    async *entries() { yield ["m.db", database]; },
  };
  const libraryDirectory = {
    kind: "directory",
    name: "Engine Library",
    async *entries() { yield ["Database2", databaseDirectory]; },
  };
  const unrelatedDirectory = {
    kind: "directory",
    name: "Unrelated",
    async *entries() { unrelatedVisited = true; },
  };
  const drive = {
    kind: "directory",
    name: "ELECTRON",
    getDirectoryHandle: async (name) => {
      if (name === "Engine Library") return libraryDirectory;
      throw new Error("not found");
    },
    async *entries() {
      yield ["Engine Library", libraryDirectory];
      yield ["Unrelated", unrelatedDirectory];
    },
  };

  const files = await sandbox.window.DubnatorEngineDJ.filesFromDirectoryHandle(drive);
  assert.equal(unrelatedVisited, false);
  assert.equal(files.length, 1);
  assert.equal(files[0].relativePath, "Engine Library/Database2/m.db");
  assert.match(playlist, /engineDJ\.chooseAndScan\(options\)/);
  assert.match(playlist, /typeof window\.showDirectoryPicker === "function"/);
});

test("playlist library tracks can be sorted without changing their load index", () => {
  assert.match(playlist, /sortLibraryTracks\(previewTracks\.filter/);
  assert.match(playlist, /librarySortLabel\("position", "#"\)/);
  assert.match(playlist, /librarySortLabel\("title", "TITLE \/ ARTIST"\)/);
  assert.match(playlist, /librarySortLabel\("bpm", "BPM"\)/);
  assert.match(playlist, /librarySortLabel\("duration", "TIME"\)/);
  assert.match(playlist, /loadEnginePlaylist\(playlist, \{ index, stayInLibrary: true \}\)/);
  assert.match(rekordbox, /duration: Number\(node\.getAttribute\("TotalTime"\)\)/);
  assert.match(css, /\.engine-track-sort\.active/);
});

test("advanced mode exposes a safe control to clear persisted deck files", () => {
  assert.match(app, /const clearSavedSession = \(\) =>/);
  assert.match(app, /store\.clearAll\(\)/);
  assert.match(app, /CLEAR SAVED SESSION/);
  assert.match(app, /Active decks will not change/);
});
