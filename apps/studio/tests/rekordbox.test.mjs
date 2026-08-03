import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../rekordbox.js", import.meta.url), "utf8");
const window = {};
vm.runInNewContext(source, { window, URL, String, Set, Array, Map, Number });
const rb = window.DubnatorRekordbox;

const file = (name, relative = "") => ({ name, webkitRelativePath: relative });

test("decodes Rekordbox file URLs and keeps platform paths readable", () => {
  assert.equal(
    rb.decodedPath("file://localhost/Users/dj/Music/King%20Tubby.mp3"),
    "/Users/dj/Music/King Tubby.mp3",
  );
  assert.equal(rb.baseName("C:\\Music\\Dub\\Track.wav"), "Track.wav");
});

test("matches local files in Rekordbox order and reports missing tracks", () => {
  const playlist = {
    tracks: [
      { id: "3", name: "Third", path: "/Music/Dub/03 Third.flac", fileName: "03 Third.flac" },
      { id: "1", name: "First", path: "/Music/Dub/01 First.mp3", fileName: "01 First.mp3" },
      { id: "2", name: "Missing", path: "/Music/Dub/02 Missing.wav", fileName: "02 Missing.wav" },
    ],
  };
  const first = file("01 First.mp3", "Music/Dub/01 First.mp3");
  const third = file("03 Third.flac", "Music/Dub/03 Third.flac");
  const extra = file("Loose Tune.aiff", "Music/Loose Tune.aiff");
  const result = rb.matchPlaylistFiles(playlist, [first, extra, third]);
  assert.deepEqual(Array.from(result.ordered, (entry) => entry.name), ["03 Third.flac", "01 First.mp3"]);
  assert.deepEqual(Array.from(result.missing, (entry) => entry.id), ["2"]);
  assert.deepEqual(Array.from(result.unused, (entry) => entry.name), ["Loose Tune.aiff"]);
});

test("duplicate filenames consume separate local files once", () => {
  const playlist = { tracks: [
    { fileName: "Version.wav", path: "/A/Version.wav" },
    { fileName: "Version.wav", path: "/B/Version.wav" },
  ] };
  const a = file("Version.wav", "A/Version.wav");
  const b = file("Version.wav", "B/Version.wav");
  const result = rb.matchPlaylistFiles(playlist, [a, b]);
  assert.equal(result.ordered.length, 2);
  assert.notEqual(result.ordered[0], result.ordered[1]);
});
