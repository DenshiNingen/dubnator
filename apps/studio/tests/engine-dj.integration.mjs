import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { tmpdir } from "node:os";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const aesjs = require("aes-js");
const initSqlJs = require("sql.js");
const ROOT = new URL("..", import.meta.url).pathname;
const DRIVE = process.env.ENGINE_DJ_DRIVE || "/Volumes/ELECTRON";
const library = join(DRIVE, "Engine Library");

async function filesBelow(directory) {
  const output = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else {
        const info = await stat(path);
        output.push({
          name: basename(path),
          size: info.size,
          lastModified: info.mtimeMs,
          webkitRelativePath: `Engine Library/${relative(library, path)}`,
          arrayBuffer: async () => {
            const value = await readFile(path);
            return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
          },
        });
      }
    }
  }
  await visit(directory);
  return output;
}

try {
  await stat(join(library, "Database2", "m.db"));
} catch (_) {
  console.log(`SKIP: no Engine DJ drive at ${DRIVE}`);
  process.exit(0);
}

const sandbox = {
  console,
  setTimeout,
  Uint8Array,
  ArrayBuffer,
  DataView,
  BigInt,
  URL: { createObjectURL: (file) => `engine-artwork://${file.name}` },
  btoa: (value) => Buffer.from(value, "binary").toString("base64"),
  window: {
    aesjs,
    initSqlJs: () => initSqlJs({
      locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
    }),
  },
};
vm.createContext(sandbox);
vm.runInContext(await readFile(join(ROOT, "engine-dj.js"), "utf8"), sandbox, { filename: "engine-dj.js" });
const engineDJ = sandbox.window.DubnatorEngineDJ;

const scanned = await engineDJ.scanFiles(await filesBelow(library));
assert.ok(scanned.trackCount > 300, `expected exported library, got ${scanned.trackCount} tracks`);
assert.ok(scanned.stemCount > 100, `expected Engine stems, got ${scanned.stemCount}`);
const artistPlaylist = scanned.playlists.find((item) => item.name === "Biga*Ranx");
assert.equal(artistPlaylist?.path, "ByArtistsss / Biga*Ranx", "Engine PlaylistPath must be normalized from leaf→root to root→leaf");
const playlist = scanned.playlists.find((item) => item.name === "S'horabaixa 2");
assert.equal(playlist?.files.length, 17, playlist?.files.map((file) => file.engineDJ.title).join(" | "));
const hibarnan = playlist.files.find((file) => /hibarnan/i.test(file.engineDJ?.title || file.name));
assert.ok(hibarnan?.engineDJ?.stemFile, "Hibarnan stem file is linked by origin ID + database UUID");

const decrypted = engineDJ.decryptStemMp4(await hibarnan.engineDJ.stemFile.arrayBuffer());
const work = await mkdtemp(join(tmpdir(), "dubnator-engine-stems-"));
const output = join(work, "hibarnan-stems.m4a");
try {
  await writeFile(output, new Uint8Array(decrypted));
  const probe = JSON.parse(execFileSync("ffprobe", [
    "-v", "error", "-select_streams", "a:0",
    "-show_entries", "stream=codec_name,channels,sample_rate",
    "-of", "json", output,
  ], { encoding: "utf8" }));
  assert.equal(probe.streams[0].codec_name, "aac");
  assert.equal(probe.streams[0].channels, 8);
  assert.equal(Number(probe.streams[0].sample_rate), 44100);
} finally {
  await rm(work, { recursive: true, force: true });
}

console.log(`Engine DJ integration OK: ${scanned.playlists.length} playlists, ${scanned.trackCount} tracks, ${scanned.stemCount} stems; Hibarnan decoded to 8-channel AAC.`);
