// Minimal Web Audio API mock for running audio-engine.js under Node.
// Enough surface to construct the graph and exercise parameter setters,
// buffer decoding, and routing logic. NOT a DSP simulator — it validates
// wiring/control logic, not sound output.

class AudioParam {
  constructor(value = 0) { this.value = value; this._events = []; }
  setValueAtTime(v) { this.value = v; return this; }
  setTargetAtTime(v) { this.value = v; return this; }
  linearRampToValueAtTime(v) { this.value = v; return this; }
  exponentialRampToValueAtTime(v) { this.value = v; return this; }
  cancelScheduledValues() { return this; }
}

class AudioNode {
  constructor(ctx, type) { this.context = ctx; this._type = type; this._conns = []; }
  connect(dest) { this._conns.push(dest); return dest; }
  disconnect(dest) {
    if (dest === undefined) { this._conns = []; return; }
    this._conns = this._conns.filter((c) => c !== dest);
  }
}

class GainNode extends AudioNode { constructor(c) { super(c, "gain"); this.gain = new AudioParam(1); } }
class BiquadFilterNode extends AudioNode {
  constructor(c) { super(c, "biquad"); this.type = "peaking"; this.frequency = new AudioParam(350); this.Q = new AudioParam(1); this.gain = new AudioParam(0); this.detune = new AudioParam(0); }
}
class StereoPannerNode extends AudioNode { constructor(c) { super(c, "panner"); this.pan = new AudioParam(0); } }
class DelayNode extends AudioNode { constructor(c) { super(c, "delay"); this.delayTime = new AudioParam(0); } }
class ConvolverNode extends AudioNode { constructor(c) { super(c, "convolver"); this.buffer = null; this.normalize = true; } }
class WaveShaperNode extends AudioNode { constructor(c) { super(c, "waveshaper"); this.curve = null; this.oversample = "none"; } }
class ChannelSplitterNode extends AudioNode { constructor(c, n) { super(c, "splitter"); this.numberOfOutputs = n || 6; } }
class ChannelMergerNode extends AudioNode { constructor(c, n) { super(c, "merger"); this.numberOfInputs = n || 6; } }
class DynamicsCompressorNode extends AudioNode {
  constructor(c) { super(c, "compressor"); this.threshold = new AudioParam(-24); this.knee = new AudioParam(30); this.ratio = new AudioParam(12); this.attack = new AudioParam(0.003); this.release = new AudioParam(0.25); this.reduction = 0; }
}
class AnalyserNode extends AudioNode {
  constructor(c) { super(c, "analyser"); this.fftSize = 2048; this.smoothingTimeConstant = 0.8; this.minDecibels = -100; this.maxDecibels = -30; }
  get frequencyBinCount() { return this.fftSize / 2; }
  getByteFrequencyData(a) { a.fill(0); }
  getByteTimeDomainData(a) { a.fill(128); }
  getFloatFrequencyData(a) { a.fill(-100); }
}
class OscillatorNode extends AudioNode {
  constructor(c) { super(c, "osc"); this.type = "sine"; this.frequency = new AudioParam(440); this.detune = new AudioParam(0); }
  start() {} stop() {}
}
class BufferSourceNode extends AudioNode {
  constructor(c) { super(c, "bufsrc"); this.buffer = null; this.loop = false; this.playbackRate = new AudioParam(1); this.onended = null; }
  start() { this._started = true; } stop() { if (!this._started) throw new Error("not started"); this._stopped = true; }
}
class MediaStreamDestinationNode extends AudioNode { constructor(c) { super(c, "msd"); this.stream = { id: "mock-stream", getTracks: () => [] }; } }

class AudioBuffer {
  constructor(numChannels, length, sampleRate) {
    this.numberOfChannels = numChannels; this.length = length; this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this._data = Array.from({ length: numChannels }, () => new Float32Array(length));
  }
  getChannelData(c) { return this._data[c]; }
}

export class MockAudioContext {
  constructor() { this.currentTime = 0; this.sampleRate = 44100; this.state = "running"; this.destination = new AudioNode(this, "destination"); }
  createGain() { return new GainNode(this); }
  createBiquadFilter() { return new BiquadFilterNode(this); }
  createStereoPanner() { return new StereoPannerNode(this); }
  createDelay() { return new DelayNode(this); }
  createConvolver() { return new ConvolverNode(this); }
  createWaveShaper() { return new WaveShaperNode(this); }
  createDynamicsCompressor() { return new DynamicsCompressorNode(this); }
  createAnalyser() { return new AnalyserNode(this); }
  createOscillator() { return new OscillatorNode(this); }
  createChannelSplitter(n) { return new ChannelSplitterNode(this, n); }
  createChannelMerger(n) { return new ChannelMergerNode(this, n); }
  createBufferSource() { return new BufferSourceNode(this); }
  createMediaStreamDestination() { return new MediaStreamDestinationNode(this); }
  createScriptProcessor(bufferSize = 4096, inCh = 2, outCh = 2) {
    const n = new AudioNode(this, "scriptproc");
    n.bufferSize = bufferSize; n.onaudioprocess = null;
    return n;
  }
  createBuffer(numChannels, length, sampleRate) { return new AudioBuffer(numChannels, length, sampleRate); }
  decodeAudioData(arr) {
    // The engine only calls this for real files; in tests we feed AIFF (handled
    // by the engine's own fallback) so reject here to exercise that path.
    return Promise.reject(new DOMException_("EncodingError"));
  }
  resume() { return Promise.resolve(); }
  suspend() { return Promise.resolve(); }
}

function DOMException_(msg) { const e = new Error(msg); e.name = "EncodingError"; return e; }

// Install a browser-ish global environment, load audio-engine.js into it, and
// return the resulting window.DubnatorEngine constructor instance.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

export async function loadEngine() {
  const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
  const [codecs, engine] = await Promise.all([
    readFile(join(ROOT, "audio-codecs.js"), "utf8"),
    readFile(join(ROOT, "audio-engine.js"), "utf8"),
  ]);
  const win = { AudioContext: MockAudioContext, webkitAudioContext: MockAudioContext };
  const sandbox = {
    window: win,
    AudioContext: MockAudioContext,
    webkitAudioContext: MockAudioContext,
    DOMException: function () {},
    MediaRecorder: class { constructor() { this.state = "inactive"; } start() { this.state = "recording"; } stop() { this.state = "inactive"; if (this.onstop) this.onstop(); } },
    Float32Array, Uint8Array, Math, console, Date: { now: () => 0 },
    Blob: globalThis.Blob, ArrayBuffer, DataView, BigInt, Number, Promise,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(codecs, sandbox, { filename: "audio-codecs.js" });
  vm.runInContext(engine, sandbox, { filename: "audio-engine.js" });
  return { win, MockAudioContext };
}

// Load midi.js (a window-IIFE module) into a sandbox and return its exports.
export async function loadMidi() {
  const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
  const code = await readFile(join(ROOT, "midi.js"), "utf8");
  const win = {};
  const sandbox = { window: win, Math, console, Map, Set, Array, Object, Promise, Error };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "midi.js" });
  return win.DubnatorMidi; // { MidiMapper }
}
