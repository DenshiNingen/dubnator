import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../waveform-worker.js", import.meta.url), "utf8");
const window = {};
vm.runInNewContext(source, { window, Float32Array, Math, Array });

test("waveform worker returns normalized envelopes and beat grids", () => {
  const samples = new Float32Array(4096);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 11) * (i / samples.length);
  const result = window.DubnatorWaveform.computeWaveformEnvelope(samples, 8, 120, 720);
  assert.equal(result.body.length, 720);
  assert.equal(result.core.length, 720);
  assert.ok(result.body.some((value) => value > 1));
  assert.ok(result.core.every((value) => value >= 0.55));
  assert.ok(result.bars.length >= 4);
  assert.equal(result.bars[0], 0);
  assert.ok(result.beats.length > result.bars.length);
});

test("waveform worker handles empty input without NaN values", () => {
  const result = window.DubnatorWaveform.computeWaveformEnvelope(new Float32Array(), 0, 120, 8);
  assert.equal(result.body.length, 8);
  assert.ok([...result.body, ...result.core].every(Number.isFinite));
});
