import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../track-metadata.js", import.meta.url), "utf8");
const objectUrls = [];
const window = {};
vm.runInNewContext(source, {
  window,
  URL: { createObjectURL: (blob) => { objectUrls.push(blob); return `blob:test-${objectUrls.length}`; } },
  Blob,
  TextDecoder,
  Uint8Array,
  WeakMap,
  Math,
  String,
});

function u32(value) {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function synchsafe(value) {
  return [(value >>> 21) & 127, (value >>> 14) & 127, (value >>> 7) & 127, value & 127];
}

function frame(id, data) {
  return [...Buffer.from(id), ...u32(data.length), 0, 0, ...data];
}

test("reads ID3 text and embedded cover art", () => {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4];
  const frames = [
    ...frame("TIT2", [3, ...Buffer.from("Dub Test")]),
    ...frame("TPE1", [3, ...Buffer.from("Sound System")]),
    ...frame("APIC", [3, ...Buffer.from("image/png"), 0, 3, 0, ...png]),
  ];
  const bytes = Uint8Array.from([
    ...Buffer.from("ID3"), 3, 0, 0, ...synchsafe(frames.length), ...frames,
  ]);
  const metadata = window.DubnatorTrackMetadata.parseId3(bytes);
  assert.equal(metadata.title, "Dub Test");
  assert.equal(metadata.artist, "Sound System");
  assert.equal(metadata.artworkMime, "image/png");
  assert.equal(metadata.artworkUrl, "blob:test-1");
  assert.equal(objectUrls.length, 1);
});

test("metadata reads are cached by local File-like object", async () => {
  let reads = 0;
  const bytes = Uint8Array.from([...Buffer.from("ID3"), 3, 0, 0, 0, 0, 0, 0]);
  const file = {
    size: bytes.length,
    slice() {
      return { arrayBuffer: async () => { reads += 1; return bytes.buffer.slice(0); } };
    },
  };
  const first = window.DubnatorTrackMetadata.get(file);
  const second = window.DubnatorTrackMetadata.get(file);
  assert.equal(first, second);
  await first;
  assert.equal(reads, 1);
});

test("finds artwork in an AIFF ID3 chunk placed after a large audio chunk", async () => {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 5, 6, 7, 8];
  const frames = [
    ...frame("TIT2", [3, ...Buffer.from("Late AIFF cover")]),
    ...frame("APIC", [3, ...Buffer.from("image/png"), 0, 3, 0, ...png]),
  ];
  const id3 = Uint8Array.from([
    ...Buffer.from("ID3"), 3, 0, 0, ...synchsafe(frames.length), ...frames,
  ]);
  const audioSize = (2 * 1024 * 1024) + 64;
  const id3HeaderOffset = 12 + 8 + audioSize;
  const bytes = new Uint8Array(id3HeaderOffset + 8 + id3.length);
  bytes.set(Buffer.from("FORM"), 0);
  bytes.set(u32(bytes.length - 8), 4);
  bytes.set(Buffer.from("AIFFSSND"), 8);
  bytes.set(u32(audioSize), 16);
  bytes.set(Buffer.from("ID3 "), id3HeaderOffset);
  bytes.set(u32(id3.length), id3HeaderOffset + 4);
  bytes.set(id3, id3HeaderOffset + 8);
  const file = {
    size: bytes.length,
    slice(start = 0, end = bytes.length) {
      const value = bytes.slice(start, end);
      return { arrayBuffer: async () => value.buffer };
    },
  };

  const metadata = await window.DubnatorTrackMetadata.get(file);
  assert.equal(metadata.title, "Late AIFF cover");
  assert.equal(metadata.artworkMime, "image/png");
  assert.equal(metadata.artworkUrl, "blob:test-2");
});
