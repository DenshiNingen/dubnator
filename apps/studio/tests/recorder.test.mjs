// WAV/AIFF encoder tests — exercises the pure PCM encoders exposed by the
// engine, including an AIFF encode→decode round-trip through the engine's own
// decodeAiff fallback. Run: node tests/recorder.test.mjs
import { loadEngine } from "./webaudio-mock.mjs";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + msg); } };
const section = (s) => console.log("\n• " + s);

const { win } = await loadEngine();
const encodeWav = win.DubnatorEncodeWav;
const encodeAiff = win.DubnatorEncodeAiff;

// Known test signal: 6 frames, distinct L/R values incl. clipping extremes.
const L = new Float32Array([0, 0.5, -0.5, 1, -1, 0.25]);
const R = new Float32Array([0, -0.5, 0.5, -1, 1, -0.25]);
const SR = 44100;

section("WAV encoder produces a valid 16-bit PCM header");
{
  const buf = encodeWav([L, R], SR);
  const dv = new DataView(buf);
  const tag = (o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  ok(tag(0) === "RIFF", "RIFF magic");
  ok(tag(8) === "WAVE", "WAVE form");
  ok(tag(12) === "fmt ", "fmt chunk");
  ok(dv.getUint16(20, true) === 1, "audioFormat = PCM(1)");
  ok(dv.getUint16(22, true) === 2, "numChannels = 2");
  ok(dv.getUint32(24, true) === SR, "sampleRate correct");
  ok(dv.getUint16(32, true) === 4, "blockAlign = 4 (2ch*16bit)");
  ok(dv.getUint16(34, true) === 16, "bitsPerSample = 16");
  ok(tag(36) === "data", "data chunk");
  ok(dv.getUint32(40, true) === 6 * 4, "data size = frames*blockAlign");
  ok(buf.byteLength === 44 + 6 * 4, "total file size correct");
  // sample checks (interleaved LE int16)
  ok(dv.getInt16(44, true) === 0, "frame0 L = 0");
  ok(dv.getInt16(44 + 2, true) === 0, "frame0 R = 0");
  ok(dv.getInt16(44 + 4, true) === Math.round(0.5 * 0x7fff), "frame1 L = +0.5");
  ok(dv.getInt16(44 + 6, true) === Math.round(-0.5 * 0x8000), "frame1 R = -0.5");
  ok(dv.getInt16(44 + 12, true) === 32767, "frame3 L clips to +32767");
  ok(dv.getInt16(44 + 16, true) === -32768, "frame4 L clips to -32768");
}

section("AIFF encoder header + 80-bit sample rate");
{
  const buf = encodeAiff([L, R], SR);
  const dv = new DataView(buf);
  const tag = (o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  ok(tag(0) === "FORM" && tag(8) === "AIFF", "FORM/AIFF magic");
  ok(tag(12) === "COMM", "COMM chunk");
  ok(dv.getInt16(20) === 2, "COMM numChannels = 2 (big-endian)");
  ok(dv.getUint32(22) === 6, "COMM numSampleFrames = 6");
  ok(dv.getInt16(26) === 16, "COMM sampleSize = 16");
  // 80-bit extended for 44100 is 0x400E AC44 0000 0000 0000
  ok(dv.getUint16(28) === 0x400e, "extended exponent field = 0x400E");
  ok(dv.getUint16(30) === 0xac44, "extended mantissa top16 = 0xAC44");
}

section("AIFF round-trip: encode → engine.decodeAiff → samples match");
{
  await win.DubnatorEngine.init();
  const buf = encodeAiff([L, R], SR);
  const fakeFile = { name: "roundtrip.aiff", arrayBuffer: async () => buf };
  await win.DubnatorEngine.deckB.load(fakeFile);
  const ab = win.DubnatorEngine.deckB.buffer;
  ok(ab && ab.numberOfChannels === 2 && ab.length === 6, "decoded 2ch / 6 frames");
  const dL = ab.getChannelData(0), dR = ab.getChannelData(1);
  // 16-bit quantization tolerance
  let okSamples = true;
  for (let i = 0; i < 6; i++) {
    if (Math.abs(dL[i] - L[i]) > 1 / 32767 + 1e-4) okSamples = false;
    if (Math.abs(dR[i] - R[i]) > 1 / 32767 + 1e-4) okSamples = false;
  }
  ok(okSamples, "all samples survive encode→decode within 16-bit tolerance");
}

section("recorder format toggle");
{
  const eng = win.DubnatorEngine;
  eng.setRecordFormat("aiff"); ok(eng.recordFormat === "aiff", "format set to aiff");
  eng.setRecordFormat("wav"); ok(eng.recordFormat === "wav", "format set to wav");
  eng.setRecordFormat("xyz"); ok(eng.recordFormat === "wav", "unknown format falls back to wav");
  // capture wiring: start creates a processor, stop returns a Blob
  eng.startRecord(); ok(eng.recording && eng.recProc, "startRecord arms capture");
  const blob = eng.stopRecord();
  ok(!eng.recording && blob && blob.type === "audio/wav", "stopRecord returns a wav Blob and disarms");
}

console.log(`\n${fail === 0 ? "✓ PASS" : "✗ FAIL"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
