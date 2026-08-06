// Dubnator audio engine. Singleton wrapper around Web Audio.
// Graph (per deck): source -> killSub -> killBass -> killMid -> killHigh -> killTop
//                   -> 10-band geq -> 4-band parametric -> deckGain -> crossfader
// crossfader -> masterGain -> [direct + reverbSend + echoSend] -> limiter -> destination + analyser
// siren -> sirenGain -> reverbSend/echoSend/master
// samples -> sampleGain -> reverbSend/echoSend/master

(function () {
  const FREQS_10 = [32, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const KILL_BANDS = {
    sub: { type: "lowshelf", freq: 90 },
    bass: { type: "peaking", freq: 250, q: 1.0 },
    mid: { type: "peaking", freq: 1500, q: 0.9 },
    top: { type: "highshelf", freq: 6000 },
  };
  const {
    decodeAiff,
    aiffDuration,
    encodeWavPCM16,
    encodeAiffPCM16,
  } = window.DubnatorAudioCodecs;

  // Lightweight offline analysis for the deck overview. It deliberately uses
  // bounded, downsampled windows so even long tracks finish without scanning
  // every sample or touching the live audio graph.
  function analyzeTrackBuffer(buffer) {
    if (!buffer || !buffer.length || !buffer.sampleRate) return null;
    const channel = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;

    // Onset-envelope autocorrelation. Weighting slightly favours the slower
    // member of common half/double-tempo pairs, which suits reggae and dub.
    const envelopeRate = 200;
    const hop = Math.max(32, Math.round(sampleRate / envelopeRate));
    const analysisSamples = Math.min(channel.length, Math.floor(sampleRate * 150));
    const envelope = [];
    let previous = 0;
    for (let start = 0; start < analysisSamples; start += hop) {
      const end = Math.min(analysisSamples, start + hop);
      let energy = 0;
      for (let sample = start; sample < end; sample++) {
        const value = channel[sample] || 0;
        energy += value * value;
      }
      energy = Math.sqrt(energy / Math.max(1, end - start));
      envelope.push(Math.max(0, energy - previous * 0.92));
      previous = energy;
    }
    const minBpm = 60;
    const maxBpm = 180;
    const minLag = Math.floor((envelopeRate * 60) / maxBpm);
    const maxLag = Math.min(envelope.length - 1, Math.ceil((envelopeRate * 60) / minBpm));
    let bestLag = 0;
    let bestScore = 0;
    let scoreSum = 0;
    let scoreCount = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let cross = 0;
      let left = 0;
      let right = 0;
      for (let i = lag; i < envelope.length; i++) {
        const a = envelope[i];
        const b = envelope[i - lag];
        cross += a * b;
        left += a * a;
        right += b * b;
      }
      const normalized = cross / Math.max(1e-12, Math.sqrt(left * right));
      const weighted = normalized * Math.pow(lag / maxLag, 0.16);
      scoreSum += weighted;
      scoreCount++;
      if (weighted > bestScore) {
        bestScore = weighted;
        bestLag = lag;
      }
    }
    const bpm = bestLag ? Math.round((envelopeRate * 60) / bestLag) : null;
    const bpmConfidence = bestScore
      ? Math.max(0, Math.min(1, (bestScore - scoreSum / Math.max(1, scoreCount)) / bestScore))
      : 0;

    // Coarse chroma via a bounded Goertzel bank (C2–B5). Comparing the pitch
    // classes with major/minor key profiles gives an intentionally approximate
    // musical key, useful as a starting point rather than a claim of certainty.
    const targetRate = 8000;
    const downsample = Math.max(1, Math.floor(sampleRate / targetRate));
    const chromaRate = sampleRate / downsample;
    const chromaSamples = Math.min(
      Math.floor(channel.length / downsample),
      Math.floor(chromaRate * 24),
    );
    const chroma = new Float64Array(12);
    for (let midi = 36; midi <= 83; midi++) {
      const frequency = 440 * Math.pow(2, (midi - 69) / 12);
      const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / chromaRate);
      let q0 = 0;
      let q1 = 0;
      let q2 = 0;
      for (let i = 0, source = 0; i < chromaSamples; i++, source += downsample) {
        q0 = (channel[source] || 0) + coefficient * q1 - q2;
        q2 = q1;
        q1 = q0;
      }
      const power = Math.max(0, q1 * q1 + q2 * q2 - coefficient * q1 * q2);
      chroma[midi % 12] += Math.sqrt(power);
    }
    const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
    const noteNames = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
    const candidates = [];
    const profileScore = (profile, root) => {
      let dot = 0;
      let energy = 0;
      let profileEnergy = 0;
      for (let pitch = 0; pitch < 12; pitch++) {
        const weight = profile[(pitch - root + 12) % 12];
        dot += chroma[pitch] * weight;
        energy += chroma[pitch] * chroma[pitch];
        profileEnergy += weight * weight;
      }
      return dot / Math.max(1e-12, Math.sqrt(energy * profileEnergy));
    };
    for (let root = 0; root < 12; root++) {
      candidates.push({ key: noteNames[root], score: profileScore(majorProfile, root) });
      candidates.push({ key: `${noteNames[root]}m`, score: profileScore(minorProfile, root) });
    }
    candidates.sort((a, b) => b.score - a.score);
    const keyConfidence = candidates[0]?.score
      ? Math.max(0, Math.min(1, (candidates[0].score - candidates[1].score) / candidates[0].score))
      : 0;
    return {
      bpm,
      key: candidates[0]?.key || null,
      confidence: +Math.min(bpmConfidence, Math.max(0.05, keyConfidence * 4)).toFixed(2),
      tempoSource: "audio",
    };
  }

  class Deck {
    constructor(ctx, label) {
      this.ctx = ctx;
      this.label = label;
      this.buffer = null;
      this.source = null;
      this.startedAt = 0;
      this.offset = 0;
      this.playing = false;
      this.name = "—";
      this.file = null;
      this.metadata = {};
      this.cuePoint = null; // hot-cue position (seconds), null = unset
      this.analysis = null;

      // kill chain — 5 evenly-spaced isolator bands (SUB 80 · LOW 300 · MID 1000
      // · HIGH 3000 · TOP 8000)
      this.killSub = ctx.createBiquadFilter();
      this.killSub.type = "lowshelf";
      this.killSub.frequency.value = 80;
      this.killSub.gain.value = 0;

      this.killBass = ctx.createBiquadFilter();
      this.killBass.type = "peaking";
      this.killBass.frequency.value = 300;
      this.killBass.Q.value = 1.0;
      this.killBass.gain.value = 0;

      this.killMid = ctx.createBiquadFilter();
      this.killMid.type = "peaking";
      this.killMid.frequency.value = 1000;
      this.killMid.Q.value = 0.9;
      this.killMid.gain.value = 0;

      this.killHigh = ctx.createBiquadFilter();
      this.killHigh.type = "peaking";
      this.killHigh.frequency.value = 3000;
      this.killHigh.Q.value = 0.9;
      this.killHigh.gain.value = 0;

      this.killTop = ctx.createBiquadFilter();
      this.killTop.type = "highshelf";
      this.killTop.frequency.value = 8000;
      this.killTop.gain.value = 0;

      // 10 band GEQ
      this.geq = FREQS_10.map((f, i) => {
        const b = ctx.createBiquadFilter();
        b.type = i === 0 ? "lowshelf" : i === 9 ? "highshelf" : "peaking";
        b.frequency.value = f;
        b.Q.value = 1.0;
        b.gain.value = 0;
        return b;
      });

      // 4-band parametric
      this.params = [
        { type: "lowshelf", freq: 80 },
        { type: "peaking", freq: 240 },
        { type: "peaking", freq: 2400 },
        { type: "highshelf", freq: 12000 },
      ].map((cfg) => {
        const b = ctx.createBiquadFilter();
        b.type = cfg.type;
        b.frequency.value = cfg.freq;
        b.Q.value = 1.0;
        b.gain.value = 0;
        return b;
      });

      this.gain = ctx.createGain();
      this.gain.gain.value = 0.85;
      this.autoGain = ctx.createGain();
      this.autoGain.gain.value = 1;
      // Flat-mode trim: unity normally; carries the flat-mode gain when all
      // four kills are engaged (isolator bypassed → signal passes flat).
      this.flat = ctx.createGain();
      this.flat.gain.value = 1;
      this.panner = ctx.createStereoPanner();

      // analyser for meter
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;

      // chain
      const chain = [
        this.killSub,
        this.killBass,
        this.killMid,
        this.killHigh,
        this.killTop,
        ...this.geq,
        ...this.params,
        this.gain,
        this.autoGain,
        this.flat,
        this.panner,
      ];
      for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
      this.panner.connect(this.analyser);
      this.input = this.killSub;
      this.output = this.panner;

      // playlist
      this.playlist = [];
      this.playlistIdx = 0;
      // section loop (in/out) — 0/0 = no region
      this.loopA = 0;
      this.loopB = 0;
    }
    setPan(v) { this.panner.pan.setTargetAtTime(v, this.ctx.currentTime, 0.01); }
    setAutoGain(on) { this.autoGain.gain.setTargetAtTime(on ? 1.7 : 1, this.ctx.currentTime, 0.05); }
    addToPlaylist(file) { this.playlist.push(file); }
    async loadPlaylistIndex(i) {
      if (!this.playlist[i]) return;
      this.playlistIdx = i;
      await this.load(this.playlist[i]);
    }
    async nextTrack(options = {}) {
      if (!this.playlist.length) return false;
      const next = this.playlistIdx + 1;
      if (options.wrap === false && next >= this.playlist.length) return false;
      await this.loadPlaylistIndex(next % this.playlist.length);
      return true;
    }
    async prevTrack() {
      if (!this.playlist.length) return;
      await this.loadPlaylistIndex((this.playlistIdx - 1 + this.playlist.length) % this.playlist.length);
    }
    removeAt(i) {
      if (i < 0 || i >= this.playlist.length) return;
      this.playlist.splice(i, 1);
      if (i < this.playlistIdx) this.playlistIdx -= 1;
      else if (i === this.playlistIdx) this.playlistIdx = Math.min(this.playlistIdx, this.playlist.length - 1);
    }
    clearPlaylist() {
      this.playlist = [];
      this.playlistIdx = 0;
    }
    movePlaylistItem(from, to) {
      if (from < 0 || from >= this.playlist.length) return;
      if (to < 0 || to >= this.playlist.length) return;
      if (from === to) return;
      const [item] = this.playlist.splice(from, 1);
      this.playlist.splice(to, 0, item);
      // track current playing index
      if (this.playlistIdx === from) this.playlistIdx = to;
      else if (from < this.playlistIdx && to >= this.playlistIdx) this.playlistIdx -= 1;
      else if (from > this.playlistIdx && to <= this.playlistIdx) this.playlistIdx += 1;
    }
    shufflePlaylist() {
      const cur = this.playlist[this.playlistIdx];
      for (let i = this.playlist.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.playlist[i], this.playlist[j]] = [this.playlist[j], this.playlist[i]];
      }
      this.playlistIdx = Math.max(0, this.playlist.indexOf(cur));
    }
    // stopAfter=true → "rewind & stop" (cue back then pause, DJ/radio style);
    // false → "rewind & replay" (keep playing from the new position).
    rewind(seconds = 4, stopAfter = false) {
      const cur = this.getCurrentTime();
      const dur = this.getDuration();
      if (!dur) return;
      const target = Math.max(0, cur - seconds);
      this.seek(target / dur);
      if (stopAfter && this.playing) this.pause();
    }

    getCurrentTime() {
      if (!this.buffer) return 0;
      if (this.playing) {
        const raw = this.offset + (this.ctx.currentTime - this.startedAt);
        // A section loop physically wraps the audio inside [loopA, loopB]; mirror
        // that in the reported position so the playhead/readout don't march past it.
        if (this.loopB > this.loopA && raw >= this.loopB) {
          const len = this.loopB - this.loopA;
          return this.loopA + ((raw - this.loopB) % len);
        }
        return Math.min(this.buffer.duration, raw);
      }
      return this.offset;
    }

    getDuration() {
      return this.buffer ? this.buffer.duration : 0;
    }

    async load(file) {
      const arr = await file.arrayBuffer();
      let buffer;
      try {
        // decodeAudioData detaches the ArrayBuffer it's handed, so pass a copy
        // and keep `arr` intact for the AIFF fallback below.
        buffer = await this.ctx.decodeAudioData(arr.slice(0));
      } catch (err) {
        // Chrome's decodeAudioData can't decode AIFF (WebKit/Safari can). When
        // the browser bails, decode uncompressed AIFF/AIFC PCM ourselves.
        const fallback = decodeAiff(this.ctx, arr);
        if (!fallback) {
          throw new Error(`Could not decode "${file.name}": ${err && err.message || err}`);
        }
        buffer = fallback;
      }
      this.buffer = buffer;
      this.name = file.name;
      this.file = file;
      this.metadata = {};
      const metadataReader = window.DubnatorTrackMetadata;
      if (metadataReader?.get) {
        metadataReader.get(file).then((metadata) => {
          if (this.file === file) this.metadata = metadata || {};
        }).catch(() => {});
      }
      this.analysis = null;
      this.offset = 0;
      this.loopA = 0; this.loopB = 0; // a new track clears any section loop
      this.cuePoint = null;
      this.stop();
      // Populate the always-visible BPM/key readout without making the user
      // open the deck's secondary controls. Analysis runs on the next idle
      // opportunity and guards against a newer track replacing this buffer.
      this.analyze().catch(() => {});
    }

    async loadSynthetic(seed = 1) {
      // Synthetic dub-ish loop: kick on 1+3, offbeat skank, sub bass.
      const sr = this.ctx.sampleRate;
      const dur = 8;
      const buf = this.ctx.createBuffer(2, sr * dur, sr);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        const bpm = 75;
        const beat = 60 / bpm;
        for (let i = 0; i < d.length; i++) {
          const t = i / sr;
          // kick
          const beatPos = (t / beat) % 4;
          if (beatPos < 0.15 || (beatPos > 2 && beatPos < 2.15)) {
            const env = Math.exp(-((beatPos % 2) * 30));
            d[i] += Math.sin(2 * Math.PI * 55 * t) * env * 0.6;
          }
          // sub bass walking
          const note = [55, 55, 73, 65][Math.floor(t / beat) % 4];
          d[i] += Math.sin(2 * Math.PI * note * t) * 0.18;
          // offbeat skank (filtered noise burst)
          const offbeat = beatPos % 1;
          if (offbeat > 0.5 && offbeat < 0.6) {
            d[i] += (Math.random() - 0.5) * 0.25 * (1 - (offbeat - 0.5) * 10);
          }
          // hat
          if ((beatPos * 2) % 1 < 0.04) {
            d[i] += (Math.random() - 0.5) * 0.15;
          }
          // seed variation
          d[i] *= 0.9 + 0.1 * Math.sin(seed * t * 0.3);
        }
      }
      this.buffer = buf;
      this.name = seed === 1 ? "DUB LOOP A — 75 BPM" : "DUB LOOP B — 75 BPM";
      this.file = null;
      this.metadata = {};
      this.analysis = { bpm: 75, key: null, confidence: 1 };
      this.offset = 0;
      this.loopA = 0; this.loopB = 0; this.cuePoint = null;
      this.stop();
    }

    play() {
      if (!this.buffer || this.playing) return;
      this._manualStop = false; // fresh playback; a prior stop must not leak through
      this.source = this.ctx.createBufferSource();
      this.source.buffer = this.buffer;
      // loopSingle (default) loops the track forever; when off, the track plays
      // through once and onended fires so the deck can auto-advance a playlist.
      this.source.loop = this.loopSingle !== false;
      // Section loop (loop in/out): if a region is set, loop just that part.
      if (this.loopB > this.loopA) {
        this.source.loopStart = this.loopA;
        this.source.loopEnd = this.loopB;
        this.source.loop = true;
      }
      this.source.connect(this.input);
      this.source.onended = () => {
        if (this._manualStop) { this._manualStop = false; return; }
        if (this.loopSingle === false) {
          this.playing = false;
          this.source = null;
          this.offset = 0;
          if (typeof this.onTrackEnd === "function") this.onTrackEnd();
        }
      };
      this.source.start(0, this.offset % this.buffer.duration);
      this.startedAt = this.ctx.currentTime;
      this.playing = true;
    }
    setLoopSingle(on) { this.loopSingle = on !== false; }
    // Section loop in/out (seconds). Applies live to a playing source.
    setLoopRegion(a, b) {
      const dur = this.buffer ? this.buffer.duration : Infinity;
      this.loopA = Math.max(0, Math.min(dur, a || 0));
      this.loopB = Math.max(0, Math.min(dur, b || 0)); // clamp so loopEnd never exceeds the buffer
      if (this.source) {
        if (this.loopB > this.loopA) {
          this.source.loopStart = this.loopA;
          this.source.loopEnd = this.loopB;
          this.source.loop = true;
        } else {
          this.source.loopStart = 0; this.source.loopEnd = 0;
          this.source.loop = this.loopSingle !== false;
        }
      }
    }
    clearLoopRegion() { this.setLoopRegion(0, 0); }
    hasLoopRegion() { return this.loopB > this.loopA; }

    pause() {
      if (!this.playing) return;
      this.offset =
        (this.offset + (this.ctx.currentTime - this.startedAt)) %
        this.buffer.duration;
      this._manualStop = true; // suppress the onended auto-advance
      try {
        this.source.stop();
      } catch (e) {}
      this.source = null;
      this.playing = false;
    }

    stop() {
      if (this.source) {
        this._manualStop = true; // suppress the onended auto-advance
        try {
          this.source.stop();
        } catch (e) {}
        this.source = null;
      }
      this.playing = false;
      this.offset = 0;
    }

    seek(pct) {
      if (!this.buffer) return;
      const wasPlaying = this.playing;
      if (this.playing) this.pause();
      this.offset = pct * this.buffer.duration;
      if (wasPlaying) this.play();
    }
    // Hot cue: store the current playhead, then jump back to it on demand.
    setCue() { if (this.buffer) this.cuePoint = this.getCurrentTime(); return this.cuePoint; }
    jumpToCue() {
      if (this.cuePoint == null || !this.buffer) return;
      this.seek(this.cuePoint / this.buffer.duration);
    }
    clearCue() { this.cuePoint = null; }
    hasCue() { return this.cuePoint != null; }
    async analyze() {
      if (!this.buffer) return null;
      const target = this.buffer;
      await new Promise((resolve) => {
        if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(resolve, { timeout: 250 });
        else if (typeof window.setTimeout === "function") window.setTimeout(resolve, 0);
        else resolve();
      });
      const result = analyzeTrackBuffer(target);
      // DJ/radio files very often carry an explicitly verified BPM in their
      // filename. Prefer that over an acoustic half/double-tempo guess.
      const nameBpm = String(this.name || "").match(/(?:^|\D)(\d{2,3}(?:\.\d+)?)\s*bpm(?:\D|$)/i);
      const hintedBpm = nameBpm ? Number(nameBpm[1]) : 0;
      if (result && hintedBpm >= 40 && hintedBpm <= 240) {
        result.bpm = Math.round(hintedBpm);
        result.tempoSource = "filename";
      }
      if (this.buffer === target) this.analysis = result;
      return result;
    }
    // Beat-loop: loop `beats` worth of audio from the current playhead, sized
    // to the given BPM. Reuses the section-loop machinery (clamps to buffer).
    setBeatLoop(bpm, beats) {
      if (!this.buffer) return;
      const beatSec = 60 / Math.max(20, Math.min(400, bpm || 120));
      const a = this.getCurrentTime();
      this.setLoopRegion(a, a + Math.max(0.01, (beats || 1) * beatSec));
    }
    // Loop roll: halve/double the active loop length (kept anchored at loopA).
    halveLoop() {
      if (this.loopB > this.loopA) this.setLoopRegion(this.loopA, this.loopA + (this.loopB - this.loopA) / 2);
    }
    doubleLoop() {
      if (this.loopB > this.loopA) this.setLoopRegion(this.loopA, this.loopA + (this.loopB - this.loopA) * 2);
    }
  }

  class DubSiren {
    constructor(ctx) {
      this.ctx = ctx;
      this.gain = ctx.createGain();
      this.gain.gain.value = 0;
      // Bitcrusher (waveshaper to quantize) + sample-rate reduction (downsampler emulated via lowpass)
      this.crush = ctx.createWaveShaper();
      this.crush.curve = this.makeCrushCurve(16); // 16 levels by default = no crush
      this.srLP = ctx.createBiquadFilter();
      this.srLP.type = "lowpass";
      this.srLP.frequency.value = 18000;
      this.srLP.Q.value = 0.7;
      this.gain.connect(this.crush).connect(this.srLP);
      // Stereo auto-pan: a slow sine LFO sweeps the siren across the stereo
      // field (classic dub move). Depth 0 = centred / static.
      this.pan = ctx.createStereoPanner();
      this.srLP.connect(this.pan);
      this.autoPan = 0;
      this.panLfo = ctx.createOscillator();
      this.panLfo.type = "sine";
      this.panLfo.frequency.value = 0.35;
      this.panDepth = ctx.createGain();
      this.panDepth.gain.value = 0;
      this.panLfo.connect(this.panDepth).connect(this.pan.pan);
      try { this.panLfo.start(); } catch (e) {}
      this.output = this.pan;
      this.osc = null;
      this.lfo1 = null; this.lfo2 = null;
      this.preset = 0;
      this.pitch = 220;
      this.lfo1Rate = 6; this.lfo1Depth = 40;
      this.lfo2Rate = 12; this.lfo2Depth = 0;
      this.bits = 16; // 2..16
      this.srRatio = 1; // 0..1 (1 = no SR reduction)
      this.holding = false;
    }
    makeCrushCurve(levels) {
      const n = 1024;
      const c = new Float32Array(n);
      const L = Math.max(2, Math.floor(levels));
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        c[i] = Math.round(x * (L / 2)) / (L / 2);
      }
      return c;
    }
    presets() {
      // 12-slot dub-siren bank.
      return DubSiren.PRESETS;
    }
    setPreset(i) {
      this.preset = i;
      const p = this.presets()[i];
      if (!p) return;
      this.wave = p.wave;
      this.pitch = p.pitch;
      this.lfo1Rate = p.lfo1Rate; this.lfo1Depth = p.lfo1Depth;
      this.lfo2Rate = p.lfo2Rate; this.lfo2Depth = p.lfo2Depth;
    }
    setPitch(hz) { this.pitch = hz; if (this.osc) this.osc.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.01); }
    setLfo1(rate, depth) { this.lfo1Rate = rate; this.lfo1Depth = depth; if (this.lfo1) { this.lfo1.frequency.value = rate; } if (this.lfo1Gain) this.lfo1Gain.gain.value = depth; }
    setLfo2(rate, depth) { this.lfo2Rate = rate; this.lfo2Depth = depth; if (this.lfo2) { this.lfo2.frequency.value = rate; } if (this.lfo2Gain) this.lfo2Gain.gain.value = depth; }
    setBits(b) { this.bits = b; this.crush.curve = this.makeCrushCurve(b); }
    // Stereo auto-pan depth (0..1): 0 = centred, 1 = full L↔R sweep.
    setAutoPan(depth) {
      const d = Math.max(0, Math.min(1, depth || 0));
      this.autoPan = d;
      if (this.panDepth) this.panDepth.gain.setTargetAtTime(d, this.ctx.currentTime, 0.05);
    }
    setSR(ratio) {
      this.srRatio = ratio;
      // 1 -> 18kHz, 0 -> 800Hz (severe SR reduction)
      this.srLP.frequency.value = 800 + ratio * 17200;
    }
    triggerOn() {
      if (this.holding) return;
      this.holding = true;
      this.start();
      // ramp up
      const t = this.ctx.currentTime;
      this.gain.gain.cancelScheduledValues(t);
      this.gain.gain.setValueAtTime(this.gain.gain.value, t);
      this.gain.gain.linearRampToValueAtTime(0.35, t + 0.02);
    }
    triggerOff() {
      if (!this.holding) return;
      this.holding = false;
      const t = this.ctx.currentTime;
      this.gain.gain.cancelScheduledValues(t);
      this.gain.gain.setValueAtTime(this.gain.gain.value, t);
      this.gain.gain.linearRampToValueAtTime(0, t + 0.05);
      // stop oscillators after fade
      if (this.osc) { try { this.osc.stop(t + 0.1); } catch(e){} this.osc = null; }
      if (this.lfo1) { try { this.lfo1.stop(t + 0.1); } catch(e){} this.lfo1 = null; }
      if (this.lfo2) { try { this.lfo2.stop(t + 0.1); } catch(e){} this.lfo2 = null; }
    }
    start() {
      const t = this.ctx.currentTime;
      // tear down any old
      if (this.osc) { try { this.osc.stop(); } catch(e){} }
      if (this.lfo1) { try { this.lfo1.stop(); } catch(e){} }
      if (this.lfo2) { try { this.lfo2.stop(); } catch(e){} }
      this.osc = this.ctx.createOscillator();
      this.osc.type = this.wave || "square";
      this.osc.frequency.value = this.pitch;
      // LFO1 sine, LFO2 square
      this.lfo1 = this.ctx.createOscillator();
      this.lfo1.type = "sine";
      this.lfo1.frequency.value = this.lfo1Rate;
      this.lfo1Gain = this.ctx.createGain();
      this.lfo1Gain.gain.value = this.lfo1Depth;
      this.lfo1.connect(this.lfo1Gain).connect(this.osc.frequency);
      this.lfo2 = this.ctx.createOscillator();
      this.lfo2.type = "square";
      this.lfo2.frequency.value = this.lfo2Rate;
      this.lfo2Gain = this.ctx.createGain();
      this.lfo2Gain.gain.value = this.lfo2Depth;
      this.lfo2.connect(this.lfo2Gain).connect(this.osc.frequency);
      this.osc.connect(this.gain);
      this.osc.start(t);
      this.lfo1.start(t);
      this.lfo2.start(t);
    }
    // legacy fixed-duration trigger for keyboard 'S'
    trigger(durationMs = 600) {
      this.triggerOn();
      setTimeout(() => this.triggerOff(), durationMs);
    }
  }
  // 12-slot dub-siren preset bank. Each: wave, base pitch (Hz), and two LFOs
  // (rate Hz / depth Hz) modulating pitch. Named for the UI grid.
  // Dub/reggae sound-system siren bank — the air horn, fog horn, steppers wail,
  // lazer, machine-gun rattle, dub wobble, dive bomb, etc. lfo1Depth is the
  // pitch-sweep depth in Hz; big depths (> pitch) bottom out at 0 for a "dive".
  DubSiren.PRESETS = [
    { name: "AIR HORN",  wave: "square",   pitch: 165,  lfo1Rate: 5.5, lfo1Depth: 10,  lfo2Rate: 0,   lfo2Depth: 0  }, // fat held reggae horn, slight vibrato
    { name: "FOG HORN",  wave: "square",   pitch: 98,   lfo1Rate: 0.4, lfo1Depth: 7,   lfo2Rate: 0,   lfo2Depth: 0  }, // deep slow ship horn
    { name: "STEPPERS",  wave: "sawtooth", pitch: 520,  lfo1Rate: 1.2, lfo1Depth: 280, lfo2Rate: 0,   lfo2Depth: 0  }, // rising/falling steppers wail
    { name: "LAZER",     wave: "sawtooth", pitch: 720,  lfo1Rate: 22,  lfo1Depth: 190, lfo2Rate: 0,   lfo2Depth: 0  }, // fast pew-pew zapper
    { name: "BIRD",      wave: "sine",     pitch: 1400, lfo1Rate: 7,   lfo1Depth: 45,  lfo2Rate: 0,   lfo2Depth: 0  }, // high steppers whistle / bird call
    { name: "RATTLE",    wave: "square",   pitch: 200,  lfo1Rate: 28,  lfo1Depth: 40,  lfo2Rate: 0,   lfo2Depth: 0  }, // machine-gun / rewind rattle
    { name: "WOBBLE",    wave: "square",   pitch: 120,  lfo1Rate: 4.5, lfo1Depth: 90,  lfo2Rate: 0,   lfo2Depth: 0  }, // dub bass wub-wub
    { name: "SPACESHIP", wave: "sine",     pitch: 330,  lfo1Rate: 0.4, lfo1Depth: 240, lfo2Rate: 9,   lfo2Depth: 25 }, // alien sweep + shimmer
    { name: "DIVE BOMB", wave: "sawtooth", pitch: 640,  lfo1Rate: 0.7, lfo1Depth: 360, lfo2Rate: 0,   lfo2Depth: 0  }, // big dramatic fall
    { name: "ALARM",     wave: "square",   pitch: 440,  lfo1Rate: 3,   lfo1Depth: 120, lfo2Rate: 0,   lfo2Depth: 0  }, // urgent nee-naw alarm
    { name: "WARP",      wave: "triangle", pitch: 480,  lfo1Rate: 1.5, lfo1Depth: 150, lfo2Rate: 13,  lfo2Depth: 35 }, // weird two-LFO warp
    { name: "DUB SIREN", wave: "sawtooth", pitch: 280,  lfo1Rate: 6,   lfo1Depth: 100, lfo2Rate: 0,   lfo2Depth: 0  }, // the classic all-rounder
  ];

  class SamplePlayer {
    constructor(ctx) {
      this.ctx = ctx;
      this.gain = ctx.createGain();
      this.gain.gain.value = 0.7;
      this.samples = [];
      this.reverse = false; // global reverse-playback toggle
    }
    setReverse(on) { this.reverse = !!on; }
    // Build (and cache) a time-reversed copy of a slot's buffer.
    _reversedBuffer(buf) {
      const rev = this.ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const src = buf.getChannelData(ch), dst = rev.getChannelData(ch), n = src.length;
        for (let i = 0; i < n; i++) dst[i] = src[n - 1 - i];
      }
      return rev;
    }
    async build() {
      // Generate 12 distinct one-shot samples synthetically
      // Sound-system staples for modern reggae/dub (all synthesised).
      const defs = [
        { name: "Air Horn.wav", fn: this.makeAirHorn },
        { name: "Siren.wav", fn: this.makeSiren },
        { name: "Gun Fingers.wav", fn: this.makeGunFingers },
        { name: "Wheel Up.wav", fn: this.makeWheelUp },
        { name: "Laser.wav", fn: this.makeLaser },
        { name: "Zap.wav", fn: this.makeZap },
        { name: "Horn Stab.wav", fn: this.makeHornStab },
        { name: "Sub Drop.wav", fn: this.makeSubDrop },
        { name: "Explosion.wav", fn: this.makeExplosion },
        { name: "Whistle.wav", fn: this.makeWhistle },
        { name: "Bell.wav", fn: this.makeBell },
        { name: "Riser.wav", fn: this.makeRiser },
      ];
      this.samples = defs.map((d, i) => ({
        name: d.name,
        index: i + 1,
        buffer: d.fn.call(this),
      }));
    }
    makeBuf(durSec) {
      return this.ctx.createBuffer(1, this.ctx.sampleRate * durSec, this.ctx.sampleRate);
    }
    // The MC air horn / "pull up" blast: a detuned brass power-chord stack with a
    // quick honk on the attack and a touch of vibrato.
    makeAirHorn() {
      const dur=1.3, b=this.makeBuf(dur), d=b.getChannelData(0), sr=this.ctx.sampleRate, n=d.length;
      const chord=[185, 277.5, 370]; // F#3 root + fifth + octave
      for (let i=0;i<n;i++){
        const t=i/sr;
        const bend=1+0.045*Math.exp(-t*16), vib=1+0.012*Math.sin(2*Math.PI*6*t);
        let s=0; for (const f0 of chord){ const f=f0*bend*vib; for (let h=1;h<=10;h++) s+=Math.sin(2*Math.PI*f*h*t)/h; }
        const env=Math.max(0, Math.min(t/0.02, (dur-t)/0.12, 1));
        d[i]=s*0.09*env;
      }
      return b;
    }
    // Rising/falling dub siren sweep (phase integration for clean pitch).
    makeSiren() {
      const dur=1.6, b=this.makeBuf(dur), d=b.getChannelData(0), sr=this.ctx.sampleRate, n=d.length;
      let ph=0;
      for (let i=0;i<n;i++){
        const t=i/sr, f=900+500*Math.sin(2*Math.PI*1.6*t);
        ph+=2*Math.PI*f/sr;
        const env=Math.min(t/0.03,(dur-t)/0.1,1);
        d[i]=(Math.sin(ph)+0.3*Math.sin(2*ph))*0.4*Math.max(0,env);
      }
      return b;
    }
    // Dancehall "gun fingers" / bap: a sharp crack, a low thump body and a noise tail.
    makeGunFingers() {
      const dur=0.35, b=this.makeBuf(dur), d=b.getChannelData(0), sr=this.ctx.sampleRate, n=d.length;
      for (let i=0;i<n;i++){
        const t=i/sr;
        const click=(Math.random()-0.5)*Math.exp(-t*120);
        const body=Math.sin(2*Math.PI*75*t)*Math.exp(-t*22);
        const tail=(Math.random()-0.5)*Math.exp(-t*18)*0.4;
        d[i]=(click*0.9+body*0.9+tail)*0.68;
      }
      return b;
    }
    // "Wheel up" rewind whoosh: noise + tone swelling up in brightness and pitch.
    makeWheelUp() {
      const dur=0.85, b=this.makeBuf(dur), d=b.getChannelData(0), sr=this.ctx.sampleRate, n=d.length;
      let lp=0, ph=0;
      for (let i=0;i<n;i++){
        const t=i/sr, p=t/dur, cut=0.02+p*p*0.5;
        lp=lp*(1-cut)+(Math.random()-0.5)*cut;
        const f=200+1400*p*p; ph+=2*Math.PI*f/sr;
        d[i]=(lp*3.0+Math.sin(ph)*0.25*p)*Math.sin(Math.PI*p)*0.6;
      }
      return b;
    }
    // Classic "pew" laser: fast exponential pitch drop with a square edge.
    makeLaser() {
      const dur=0.4, b=this.makeBuf(dur), d=b.getChannelData(0), sr=this.ctx.sampleRate, n=d.length;
      let ph=0;
      for (let i=0;i<n;i++){
        const t=i/sr, f=1800*Math.exp(-t*9)+180; ph+=2*Math.PI*f/sr;
        d[i]=(Math.sin(ph)+0.25*Math.sign(Math.sin(ph)))*0.38*Math.min(1,(dur-t)/0.05);
      }
      return b;
    }
    // Short buzzy FM electric zap.
    makeZap() {
      const dur=0.25, b=this.makeBuf(dur), d=b.getChannelData(0), sr=this.ctx.sampleRate, n=d.length;
      let ph=0;
      for (let i=0;i<n;i++){
        const t=i/sr, mod=Math.sin(2*Math.PI*90*t)*300*Math.exp(-t*10);
        const f=Math.max(20, 600*Math.exp(-t*6)+120+mod); ph+=2*Math.PI*f/sr;
        d[i]=Math.sin(ph)*Math.exp(-t*12)*0.6;
      }
      return b;
    }
    // One-hit minor horn stab (A minor brass chord, fast decay).
    makeHornStab() {
      const dur=0.5, b=this.makeBuf(dur), d=b.getChannelData(0), sr=this.ctx.sampleRate, n=d.length;
      const chord=[220, 261.63, 329.63]; // A C E
      for (let i=0;i<n;i++){
        const t=i/sr; let s=0;
        for (const f0 of chord){ for (let h=1;h<=8;h++) s+=Math.sin(2*Math.PI*f0*h*t)/h; }
        d[i]=s*0.10*Math.min(1,t/0.008)*Math.exp(-t*6);
      }
      return b;
    }
    // 808-style sub drop: punchy sine pitched down from ~150 to ~38 Hz.
    makeSubDrop() {
      const dur=0.95, b=this.makeBuf(dur), d=b.getChannelData(0), sr=this.ctx.sampleRate, n=d.length;
      let ph=0;
      for (let i=0;i<n;i++){
        const t=i/sr, f=38+110*Math.exp(-t*9); ph+=2*Math.PI*f/sr;
        const click=(Math.random()-0.5)*Math.exp(-t*200)*0.5;
        d[i]=(Math.sin(ph)*Math.exp(-t*2.2)+click)*0.7;
      }
      return b;
    }
    // Dub explosion: brown-noise rumble + sub boom with a blast transient.
    makeExplosion() {
      const dur=1.7, b=this.makeBuf(dur), d=b.getChannelData(0), sr=this.ctx.sampleRate, n=d.length;
      let lp=0, ph=0;
      for (let i=0;i<n;i++){
        const t=i/sr;
        lp=lp*0.92+(Math.random()-0.5)*0.08;
        const f=50+40*Math.exp(-t*3); ph+=2*Math.PI*f/sr;
        const boom=Math.sin(ph)*Math.exp(-t*1.6), env=Math.exp(-t*1.1);
        const crack=(Math.random()-0.5)*Math.exp(-t*40)*0.6;
        d[i]=(lp*4.0*env+boom*0.8+crack)*0.55;
      }
      return b;
    }
    // Sound-system whistle: high sine that glides up into pitch with vibrato.
    makeWhistle() {
      const dur=0.8, b=this.makeBuf(dur), d=b.getChannelData(0), sr=this.ctx.sampleRate, n=d.length;
      let ph=0;
      for (let i=0;i<n;i++){
        const t=i/sr, glide=1-0.25*Math.exp(-t*25), vib=1+0.02*Math.sin(2*Math.PI*5.5*t);
        const f=2100*glide*vib; ph+=2*Math.PI*f/sr;
        const env=Math.min(t/0.04,(dur-t)/0.12,1);
        d[i]=(Math.sin(ph)+0.06*Math.sin(2*ph))*0.32*Math.max(0,env);
      }
      return b;
    }
    // Selecta bell / ding: a few inharmonic partials decaying.
    makeBell() {
      const dur=1.2, b=this.makeBuf(dur), d=b.getChannelData(0), sr=this.ctx.sampleRate, n=d.length;
      const parts=[[784,1,3.0],[784*1.5,0.4,3.5],[784*2.76,0.6,4.5],[784*5.4,0.3,6.0]]; // f, amp, decay
      for (let i=0;i<n;i++){
        const t=i/sr; let s=0;
        for (const p of parts) s+=p[1]*Math.sin(2*Math.PI*p[0]*t)*Math.exp(-t*p[2]);
        d[i]=s*0.4*Math.min(1,t/0.003);
      }
      return b;
    }
    // Tension riser: noise + tone building in brightness/pitch, cut off at the top.
    makeRiser() {
      const dur=1.4, b=this.makeBuf(dur), d=b.getChannelData(0), sr=this.ctx.sampleRate, n=d.length;
      let lp=0, ph=0;
      for (let i=0;i<n;i++){
        const t=i/sr, p=t/dur, cut=0.01+p*p*0.4;
        lp=lp*(1-cut)+(Math.random()-0.5)*cut;
        const f=150+900*p*p; ph+=2*Math.PI*f/sr;
        d[i]=(lp*3.0+Math.sin(ph)*0.2*p)*(p*p)*0.7;
      }
      return b;
    }
    // loop=true → momentary "hold" mode: the slot sustains (loops) until stop()
    // is called on release. loop=false → one-shot "toggle" mode (plays through).
    play(idx, loop = false) {
      const s = this.samples[idx]; if (!s) return;
      this.stop(idx);
      const src = this.ctx.createBufferSource();
      if (this.reverse && s.buffer) { s._rev = s._rev || this._reversedBuffer(s.buffer); src.buffer = s._rev; }
      else src.buffer = s.buffer;
      src.loop = loop;
      src.connect(this.gain);
      src.start();
      if (!this.active) this.active = {};
      this.active[idx] = src;
      src.onended = () => { if (this.active[idx] === src) this.active[idx] = null; };
      this.lastIdx = idx;
    }
    stop(idx) {
      if (this.active && this.active[idx]) {
        try { this.active[idx].stop(); } catch (e) {}
        this.active[idx] = null;
      }
    }
    setSlotName(idx, name) { if (this.samples[idx]) this.samples[idx].name = name; }
    // Replace a slot's audio with a user file (decoded with the same AIFF
    // fallback as the decks). Throws if the file can't be decoded.
    async loadSlot(idx, file) {
      if (idx < 0 || idx >= this.samples.length) return;
      const arr = await file.arrayBuffer();
      let buffer;
      try {
        buffer = await this.ctx.decodeAudioData(arr.slice(0));
      } catch (err) {
        buffer = decodeAiff(this.ctx, arr);
        if (!buffer) throw new Error(`Could not decode "${file.name}": ${err && err.message || err}`);
      }
      this.stop(idx);
      this.samples[idx].buffer = buffer;
      this.samples[idx]._rev = null; // invalidate cached reverse for the new audio
      this.samples[idx].name = file.name;
      this.samples[idx].custom = true;
      return this.samples[idx];
    }
  }

  class Engine {
    constructor() {
      this.ctx = null;
      this.ready = false;
      this._initPromise = null;
      this.echoType = 1;
      this.dubFilterRoute = "music"; // music | master | samples | off
    }

    async init() {
      if (this.ready) return;
      if (this._initPromise) return this._initPromise;
      this._initPromise = this._initialize();
      try {
        return await this._initPromise;
      } catch (error) {
        const failedContext = this.ctx;
        this.ctx = null;
        this.ready = false;
        this._initPromise = null;
        try { await failedContext?.close(); } catch (_) {}
        throw error;
      }
    }

    async _initialize() {
      // latencyHint "interactive" = lowest output latency (snappier key-to-sound,
      // matters most in the Tauri/WKWebView build whose Core Audio buffer is larger).
      const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
      this.ctx = ctx;

      this.deckA = new Deck(ctx, "A");
      this.deckB = new Deck(ctx, "B");

      // crossfader: equal-power
      this.xfadeA = ctx.createGain();
      this.xfadeB = ctx.createGain();
      this.deckA.output.connect(this.xfadeA);
      this.deckB.output.connect(this.xfadeB);
      this.setCrossfade(0.5);

      // music bus (decks only) -> dubFilter -> masterSum
      this.musicBus = ctx.createGain();
      this.xfadeA.connect(this.musicBus);
      this.xfadeB.connect(this.musicBus);

      // IN 1 / IN 2 stereo music inputs: fed by a multichannel capture device
      // (e.g. a 4-in USB mixer) split into ch1-2 -> IN1 and ch3-4 -> IN2.
      this.in1Gain = ctx.createGain(); this.in1Gain.gain.value = 0;
      this.in2Gain = ctx.createGain(); this.in2Gain.gain.value = 0;
      // Post-fader VU taps for the IN1/IN2 channel meters (mirror the deck
      // analysers). Analyser nodes act as sinks, so no further wiring is needed.
      this.in1Meter = ctx.createAnalyser(); this.in1Meter.fftSize = 512; this.in1Meter.smoothingTimeConstant = 0.3;
      this.in2Meter = ctx.createAnalyser(); this.in2Meter.fftSize = 512; this.in2Meter.smoothingTimeConstant = 0.3;
      this.in1Gain.connect(this.in1Meter);
      this.in2Gain.connect(this.in2Meter);
      this._multiChannels = 0;
      // Both inputs share one 4-way isolator chain (same filter shapes + flat
      // gain as a deck) so the kill buttons / advanced kill freqs apply to the
      // external inputs too. applyKills()/setKillFreqs() treat _inKill like a
      // third "deck". Chain: in1Gain+in2Gain -> kills -> flat -> music bus.
      const mkKill = (type, freq, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = freq; if (q != null) b.Q.value = q; b.gain.value = 0; return b; };
      this._inKill = {
        killSub: mkKill("lowshelf", 80),
        killBass: mkKill("peaking", 300, 1.0),
        killMid: mkKill("peaking", 1000, 0.9),
        killHigh: mkKill("peaking", 3000, 0.9),
        killTop: mkKill("highshelf", 8000),
        flat: ctx.createGain(),
      };
      this._inKill.flat.gain.value = 1;
      this.in1Gain.connect(this._inKill.killSub);
      this.in2Gain.connect(this._inKill.killSub);
      this._inKill.killSub.connect(this._inKill.killBass).connect(this._inKill.killMid)
        .connect(this._inKill.killHigh).connect(this._inKill.killTop).connect(this._inKill.flat).connect(this.musicBus);

      // Per-band VU taps — analyser-only branches off the music bus (post-kill,
      // post-EQ), one per isolator band. These do NOT touch the audio path; they
      // just let the UI show how much of each frequency band is reaching master,
      // so killing a band visibly drops its meter. Shaped to roughly match the
      // kill bands (sub lowpass, bass/mid bandpass, top highpass).
      const mkMeter = (shape) => {
        const f = ctx.createBiquadFilter();
        f.type = shape.type; f.frequency.value = shape.freq; f.Q.value = shape.q || 0.7;
        const an = ctx.createAnalyser(); an.fftSize = 512; an.smoothingTimeConstant = 0.3;
        this.musicBus.connect(f); f.connect(an);
        return an;
      };
      this.bandMeters = {
        sub: mkMeter({ type: "lowpass", freq: 80 }),
        bass: mkMeter({ type: "bandpass", freq: 300, q: 0.8 }),
        mid: mkMeter({ type: "bandpass", freq: 1000, q: 0.7 }),
        high: mkMeter({ type: "bandpass", freq: 3000, q: 0.7 }),
        top: mkMeter({ type: "highpass", freq: 6000 }),
      };

      // DubFilter
      this.dubFilter = ctx.createBiquadFilter();
      this.dubFilter.type = "lowpass";
      this.dubFilter.frequency.value = 20000;
      this.dubFilter.Q.value = 1;
      // Auto-sweep LFO ("dub-wah"): a sine LFO can sweep the cutoff hands-free,
      // summing into dubFilter.frequency around whatever the manual cutoff is.
      // Depth 0 = off (manual cutoff only).
      this.dubSweepRate = 0.5; this.dubSweepDepth = 0;
      this.dubFilterLfo = ctx.createOscillator();
      this.dubFilterLfo.type = "sine";
      this.dubFilterLfo.frequency.value = 0.5;
      this.dubFilterLfoDepth = ctx.createGain();
      this.dubFilterLfoDepth.gain.value = 0;
      this.dubFilterLfo.connect(this.dubFilterLfoDepth).connect(this.dubFilter.frequency);
      try { this.dubFilterLfo.start(); } catch (e) {}
      this.dubFilterBypass = ctx.createGain();
      this.dubFilterMix = ctx.createGain();
      // route music through dubFilter by default
      this.musicBus.connect(this.dubFilter);
      this.dubFilter.connect(this.dubFilterMix);

      // Pure Sub-Bass: a steep low-pass on the whole music path (dry + music FX
      // sends), transparent when off (cutoff parked at 20 kHz). Engaging it
      // isolates a clean sub by removing mid/high artifacts.
      // Inserted once here on dubFilterMix's output — independent of the dynamic
      // dub-filter input routing, so it never interferes with it.
      this.pureSubLP = ctx.createBiquadFilter();
      this.pureSubLP.type = "lowpass";
      this.pureSubLP.frequency.value = 20000;
      this.pureSubLP.Q.value = 0.9;
      this.dubFilterMix.connect(this.pureSubLP);

      // master sum (dry path only)
      this.masterSum = ctx.createGain();
      this.pureSubLP.connect(this.masterSum);

      // siren
      this.siren = new DubSiren(ctx);
      this.siren.output.connect(this.masterSum);
      this.sirenMeter = ctx.createAnalyser();
      this.sirenMeter.fftSize = 512;
      this.sirenMeter.smoothingTimeConstant = 0.3;
      this.sirenReverbSend = ctx.createGain(); this.sirenReverbSend.gain.value = 0;
      this.sirenEchoSend = ctx.createGain(); this.sirenEchoSend.gain.value = 0;
      this.siren.output.connect(this.sirenReverbSend);
      this.siren.output.connect(this.sirenEchoSend);

      // samples (with own HP filter + echo send)
      this.samples = new SamplePlayer(ctx);
      await this.samples.build();
      this.samplesHP = ctx.createBiquadFilter();
      this.samplesHP.type = "highpass";
      this.samplesHP.frequency.value = 20;
      this.samples.gain.connect(this.samplesHP);
      this.samplesHP.connect(this.masterSum);
      this.samplesMeter = ctx.createAnalyser();
      this.samplesMeter.fftSize = 512;
      this.samplesMeter.smoothingTimeConstant = 0.3;
      this.samplesHP.connect(this.samplesMeter);
      this.samplesReverbSend = ctx.createGain(); this.samplesReverbSend.gain.value = 0;
      this.samplesEchoSend = ctx.createGain(); this.samplesEchoSend.gain.value = 0;
      this.samplesHP.connect(this.samplesReverbSend);
      this.samplesHP.connect(this.samplesEchoSend);

      // Per-source MUSIC sends (taps PRE-masterSum so kill/dubfilter still apply,
      // but independent of samples/siren bleed)
      this.musicReverbSend = ctx.createGain(); this.musicReverbSend.gain.value = 0.3;
      this.musicEchoSend = ctx.createGain(); this.musicEchoSend.gain.value = 0.3;
      this.pureSubLP.connect(this.musicReverbSend);
      this.pureSubLP.connect(this.musicEchoSend);

      // FX bus inputs — sum all per-source sends
      this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 1.0;
      this.echoSend = ctx.createGain(); this.echoSend.gain.value = 1.0;
      this.musicReverbSend.connect(this.reverbSend);
      this.musicEchoSend.connect(this.echoSend);
      this.samplesReverbSend.connect(this.reverbSend);
      this.samplesEchoSend.connect(this.echoSend);
      this.sirenReverbSend.connect(this.reverbSend);
      this.sirenEchoSend.connect(this.echoSend);

      // Aux / mic input bus (IN 3-4): live input → HP → level → master, plus
      // independent reverb/echo sends. Bypasses the isolator/kills (like the
      // siren + samples). Silent until a mic/line source is connected and the
      // channel is unmuted, so it never affects the existing path by default.
      this.auxInput = ctx.createGain(); this.auxInput.gain.value = 1;
      this.auxHP = ctx.createBiquadFilter();
      this.auxHP.type = "highpass"; this.auxHP.frequency.value = 80;
      this.auxGain = ctx.createGain(); this.auxGain.gain.value = 0; // muted by default
      this.auxInput.connect(this.auxHP); this.auxHP.connect(this.auxGain);
      this.auxMeter = ctx.createAnalyser(); this.auxMeter.fftSize = 512; this.auxMeter.smoothingTimeConstant = 0.3;
      this.auxGain.connect(this.auxMeter); // post-fader VU tap for the IN 3-4 meter
      this.auxGain.connect(this.masterSum);
      this.auxReverbSend = ctx.createGain(); this.auxReverbSend.gain.value = 0;
      this.auxEchoSend = ctx.createGain(); this.auxEchoSend.gain.value = 0;
      this.auxGain.connect(this.auxReverbSend); this.auxGain.connect(this.auxEchoSend);
      this.auxReverbSend.connect(this.reverbSend);
      this.auxEchoSend.connect(this.echoSend);

      // reverb (convolver with synth IR) + high-frequency damping (HFD)
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.makeIR(2.5, 2);
      // Pre-delay before the reverb (gap between dry and the tail) — 0..200 ms.
      this.reverbPreDelay = ctx.createDelay(0.25);
      this.reverbPreDelay.delayTime.value = 0;
      // Modulated reverb: a slow sine LFO wobbles the pre-delay so the tail
      // shimmers/choruses (lush dub spring-ish movement). Depth 0 = static.
      this.reverbMod = 0;
      this.reverbModLfo = ctx.createOscillator();
      this.reverbModLfo.type = "sine";
      this.reverbModLfo.frequency.value = 0.6;
      this.reverbModDepth = ctx.createGain();
      this.reverbModDepth.gain.value = 0;
      this.reverbModLfo.connect(this.reverbModDepth).connect(this.reverbPreDelay.delayTime);
      try { this.reverbModLfo.start(); } catch (e) {}
      this.reverbHFD = ctx.createBiquadFilter();
      this.reverbHFD.type = "highshelf";
      this.reverbHFD.frequency.value = 4000;
      this.reverbHFD.gain.value = -6; // matches default hfd 0.5 → -12*(1-0.5)
      this.reverbReturn = ctx.createGain(); this.reverbReturn.gain.value = 0.6;
      // Band-pass on the reverb tail, with a "direct" bypass (skip the BP and
      // send the tail straight to the return). reverbHFD feeds either the BP
      // (engaged) or the return (bypassed); the BP's output is always wired to
      // the return, so it just goes silent when bypassed.
      this.reverbBP = ctx.createBiquadFilter();
      this.reverbBP.type = "bandpass";
      this.reverbBP.frequency.value = 1200;
      this.reverbBP.Q.value = 0.7;
      this.reverbBPBypass = true; // default: no BP colouring
      this.reverbSend.connect(this.reverbPreDelay).connect(this.reverb).connect(this.reverbHFD);
      this.reverbBP.connect(this.reverbReturn);
      this.reverbHFD.connect(this.reverbReturn); // start bypassed

      // tape echo
      this.echoDelay = ctx.createDelay(2.0);
      this.echoDelay.delayTime.value = 0.29;
      this.echoFB = ctx.createGain(); this.echoFB.gain.value = 0.4;
      this.echoFilter = ctx.createBiquadFilter();
      this.echoFilter.type = "lowpass";
      this.echoFilter.frequency.value = 2760;
      this.echoFilter.Q.value = 1.0;
      // Dedicated sub high-pass inside the echo loop:
      // keeps low end out of the repeats so the echo doesn't muddy the bass.
      // Parked at 20 Hz = transparent when off.
      this.echoHP = ctx.createBiquadFilter();
      this.echoHP.type = "highpass";
      this.echoHP.frequency.value = 20;
      this.echoHP.Q.value = 0.7;
      this.echoSat = ctx.createWaveShaper();
      this.echoSat.curve = this.makeSatCurve(1.4);
      // attenuator after saturator to keep loop gain in check
      this.echoLoopTrim = ctx.createGain(); this.echoLoopTrim.gain.value = 0.7;
      this.echoReturn = ctx.createGain(); this.echoReturn.gain.value = 0.6;
      this.echoSend.connect(this.echoDelay);
      this.echoDelay.connect(this.echoFilter).connect(this.echoHP).connect(this.echoSat).connect(this.echoLoopTrim).connect(this.echoFB).connect(this.echoDelay);
      this.echoLoopTrim.connect(this.echoReturn);

      // Tape wow & flutter: two sine LFOs gently modulate the delay time to
      // emulate the slow pitch drift ("wow") and fast shimmer ("flutter") of a
      // tape echo. Depth 0 by default = clean digital delay; setEchoWow scales
      // both. They sum into echoDelay.delayTime around whatever the base time is.
      this.echoWow = 0;
      this.echoWowLfo = ctx.createOscillator();
      this.echoWowLfo.type = "sine";
      this.echoWowLfo.frequency.value = 0.8;
      this.echoWowDepth = ctx.createGain();
      this.echoWowDepth.gain.value = 0;
      this.echoWowLfo.connect(this.echoWowDepth).connect(this.echoDelay.delayTime);
      this.echoFlutterLfo = ctx.createOscillator();
      this.echoFlutterLfo.type = "sine";
      this.echoFlutterLfo.frequency.value = 7.5;
      this.echoFlutterDepth = ctx.createGain();
      this.echoFlutterDepth.gain.value = 0;
      this.echoFlutterLfo.connect(this.echoFlutterDepth).connect(this.echoDelay.delayTime);
      try { this.echoWowLfo.start(); this.echoFlutterLfo.start(); } catch (e) {}

      // master bus
      this.masterBus = ctx.createGain();
      this.masterSum.connect(this.masterBus); // dry
      // FX limiters (post-FX, pre-master sum)
      this.reverbLim = ctx.createDynamicsCompressor();
      this.reverbLim.threshold.value = -5; this.reverbLim.knee.value = 0;
      this.reverbLim.ratio.value = 12; this.reverbLim.attack.value = 0.003; this.reverbLim.release.value = 0.1;
      this.reverbLimEnabled = true;
      this.echoLim = ctx.createDynamicsCompressor();
      this.echoLim.threshold.value = -9; this.echoLim.knee.value = 0;
      this.echoLim.ratio.value = 12; this.echoLim.attack.value = 0.003; this.echoLim.release.value = 0.1;
      this.echoLimEnabled = true;
      this.reverbReturn.connect(this.reverbLim).connect(this.masterBus);
      this.echoReturn.connect(this.echoLim).connect(this.masterBus);

      this.reverbMeter = ctx.createAnalyser();
      this.reverbMeter.fftSize = 512;
      this.reverbMeter.smoothingTimeConstant = 0.3;
      this.echoMeter = ctx.createAnalyser();
      this.echoMeter.fftSize = 512;
      this.echoMeter.smoothingTimeConstant = 0.3;
      this.reverbLim.connect(this.reverbMeter);
      this.echoLim.connect(this.echoMeter);

      // FX-only analyser: sums the post-limiter reverb + echo returns, so the
      // display can show just the wet FX signal.
      this.fxAnalyser = ctx.createAnalyser();
      this.fxAnalyser.fftSize = 2048;
      this.reverbLim.connect(this.fxAnalyser);
      this.echoLim.connect(this.fxAnalyser);

      // master HP filter
      this.masterHP = ctx.createBiquadFilter();
      this.masterHP.type = "highpass";
      this.masterHP.frequency.value = 20;
      this.masterBus.connect(this.masterHP);

      // limiter (compressor)
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -3;
      this.limiter.knee.value = 0;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.1;
      this.masterHP.connect(this.limiter);

      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = 0.85;
      // Mono-sum path: a 1-channel explicit gain downmixes L+R to mono, then
      // upmixes back to stereo into masterGain — a sound-system mono-compat /
      // mono-bass check. Off by default (limiter → masterGain directly).
      this.monoSum = ctx.createGain();
      this.monoSum.channelCount = 1;
      this.monoSum.channelCountMode = "explicit";
      this.monoSum.channelInterpretation = "speakers";
      this.monoSum.connect(this.masterGain);
      this.masterMono = false;
      this.limiter.connect(this.masterGain);

      this.masterAnalyser = ctx.createAnalyser();
      this.masterAnalyser.fftSize = 1024;
      this.masterGain.connect(this.masterAnalyser);

      // recorder — PCM capture tap (script processor created lazily on record)
      this.recordFormat = "wav"; // wav | aiff
      this.recProc = null;
      this.recL = [];
      this.recR = [];
      this.recording = false;

      // out
      this.masterGain.connect(ctx.destination);

      // load synth loops
      await this.deckA.loadSynthetic(1);
      await this.deckB.loadSynthetic(2);

      this.ready = true;
    }

    makeIR(duration, decay) {
      const sr = this.ctx.sampleRate;
      const len = sr * duration;
      const buf = this.ctx.createBuffer(2, len, sr);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        // Build a more dub-like IR: a small early burst + dense diffuse late tail
        // so cutting the send leaves an audible 1-2s decay
        for (let i = 0; i < len; i++) {
          const t = i / len; // 0..1
          // Decaying noise — Gaussian-like envelope so the late field is fuller
          const env = Math.pow(1 - t, decay * 0.6);
          // Add some sparse diffuse echoes (modulated noise)
          const mod = 0.6 + 0.4 * Math.sin(2 * Math.PI * 7 * t);
          d[i] = (Math.random() * 2 - 1) * env * mod;
        }
        // Light low-pass smoothing to simulate room absorption of HF
        let prev = 0;
        for (let i = 0; i < len; i++) {
          prev = prev * 0.7 + d[i] * 0.3;
          d[i] = prev * 1.5;
        }
      }
      return buf;
    }

    makeSatCurve(amount = 2) {
      const n = 256;
      const c = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        c[i] = Math.tanh(x * amount);
      }
      return c;
    }

    setCrossfade(v) {
      // v: 0 = full A, 1 = full B
      this._xfadeV = v;
      let a, b;
      const c = this.xfadeCurve || "power";
      if (c === "linear") {
        a = 1 - v; b = v;                                   // gentle, dips in the middle
      } else if (c === "sharp") {
        a = Math.min(1, (1 - v) * 2); b = Math.min(1, v * 2); // fast cut — both full mid-travel
      } else {
        a = Math.cos((v * Math.PI) / 2); b = Math.sin((v * Math.PI) / 2); // equal power (default)
      }
      this.xfadeA.gain.value = a;
      this.xfadeB.gain.value = b;
    }
    // Crossfader response: 'power' (equal-power, default) | 'linear' | 'sharp' (cut).
    setCrossfadeCurve(curve) {
      this.xfadeCurve = curve === "linear" || curve === "sharp" ? curve : "power";
      this.setCrossfade(this._xfadeV == null ? 0.5 : this._xfadeV);
    }

    // Apply the 4-way isolator kills to both decks, with Flat Mode:
    // when all four kills are engaged, the isolator is bypassed so the signal
    // passes through flat (input = output) at the flat-mode gain, instead of
    // summing four cuts to near-silence. Any kill released exits flat mode.
    // Flat gain range: −24→0 dB (Normal), −24→+12 dB (Advanced). Returns the
    // active flat-mode flag so the UI can indicate it.
    applyKills(kills, flatGainDb = 0, advanced = false, trims = null, qs = null) {
      const flat = !!(kills.sub && kills.bass && kills.mid && kills.high && kills.top);
      const clamped = Math.max(-24, Math.min(advanced ? 12 : 0, flatGainDb));
      const lin = flat ? Math.pow(10, clamped / 20) : 1;
      // Per-band gain trim (dB): −70→0 (Normal), −70→+12 (Advanced). When a band
      // is killed it cuts to −36; in flat mode all bands bypass (0). Otherwise
      // the band carries its trim, so each isolator band doubles as a level trim.
      const trim = (band) => {
        if (!trims || typeof trims[band] !== "number") return 0;
        return Math.max(-70, Math.min(advanced ? 12 : 0, trims[band]));
      };
      // Q is adjustable on Bass/Mid in Advanced only; Normal pins
      // the default Qs. Clamp to a sane peaking range.
      const qOf = (band, def) => {
        if (!advanced || !qs || typeof qs[band] !== "number") return def;
        return Math.max(0.3, Math.min(10, qs[band]));
      };
      for (const d of [this.deckA, this.deckB, this._inKill]) {
        if (!d) continue;
        d.killSub.gain.value = flat ? 0 : (kills.sub ? -36 : trim("sub"));
        d.killBass.gain.value = flat ? 0 : (kills.bass ? -36 : trim("bass"));
        d.killMid.gain.value = flat ? 0 : (kills.mid ? -36 : trim("mid"));
        d.killHigh.gain.value = flat ? 0 : (kills.high ? -36 : trim("high"));
        d.killTop.gain.value = flat ? 0 : (kills.top ? -36 : trim("top"));
        d.killBass.Q.value = qOf("bass", 1.0);
        d.killMid.Q.value = qOf("mid", 0.9);
        d.killHigh.Q.value = qOf("high", 0.9);
        d.flat.gain.value = lin;
      }
      return flat;
    }

    setReverbBP(freq, q) {
      this.reverbBP.frequency.value = Math.max(80, Math.min(18000, freq));
      this.reverbBP.Q.value = Math.max(0.3, Math.min(12, q));
    }
    // Bypass = "FX direct": reverb tail skips the band-pass straight to return.
    setReverbBPBypass(bypass) {
      if (bypass === this.reverbBPBypass) return;
      this.reverbBPBypass = bypass;
      try { this.reverbHFD.disconnect(); } catch (e) {}
      this.reverbHFD.connect(bypass ? this.reverbReturn : this.reverbBP);
    }
    setReverbSend(v) { this.musicReverbSend.gain.value = v; }
    setReverbReturn(v) { this.reverbReturn.gain.value = v; }
    // Reverb tail modulation depth (0..1): 0 = static, 1 = lush shimmer
    // (LFO swings the pre-delay up to ~5 ms).
    setReverbMod(amount) {
      const a = Math.max(0, Math.min(1, amount || 0));
      this.reverbMod = a;
      if (this.reverbModDepth) this.reverbModDepth.gain.setTargetAtTime(a * 0.005, this.ctx.currentTime, 0.05);
    }
    // High-frequency damping: v 0..1, 1 = no damping, 0 = -12 dB highshelf.
    // Matches the reverb panel's HFD curve so audio tracks the on-screen graph.
    setReverbHFD(v) { this.reverbHFD.gain.value = -12 * (1 - v); }
    setReverbSize(v) {
      if (this._reverbFrozen) { this._reverbRoom = v; return; } // freeze owns the IR; remember room for thaw
      this._reverbRoom = v;
      const dur = 0.4 + v * 5;
      this.reverb.buffer = this.makeIR(dur, 2 + v * 3);
    }
    setReverbPreDelay(ms) { this.reverbPreDelay.delayTime.value = Math.max(0, Math.min(0.2, (ms || 0) / 1000)); }
    // Freeze: swap to a long, slowly-decaying IR for near-infinite drones/sweeps
    //. Thaw restores the room-size IR.
    setReverbFreeze(on) {
      on = !!on;
      if (on === this._reverbFrozen) return;
      this._reverbFrozen = on;
      if (on) this.reverb.buffer = this.makeIR(15, 0.5);
      else this.setReverbSize(this._reverbRoom != null ? this._reverbRoom : 0.5);
    }

    setEchoSend(v) { this.musicEchoSend.gain.value = v; }
    _glideEchoTime(ms, duration = this._echoSlide || 0.05) {
      const param = this.echoDelay.delayTime;
      const now = this.ctx.currentTime;
      const target = Math.max(0.005, Math.min(2, ms / 1000));
      const seconds = Math.max(0.005, Math.min(0.6, Number(duration) || 0.05));
      // A linear delay-time ramp makes the repeats bend in pitch as a physical
      // tape/BBD delay does while its time pot is moving. Anchor the current
      // value before replacing an in-flight ramp so continuous pointer/MIDI
      // movement follows the performer without zippering or stale automation.
      if (typeof param.cancelAndHoldAtTime === "function") {
        param.cancelAndHoldAtTime(now);
      } else {
        const current = param.value;
        param.cancelScheduledValues(now);
        param.setValueAtTime(current, now);
      }
      param.linearRampToValueAtTime(target, now + seconds);
      this._echoTimeTransition = seconds;
    }
    setEchoTime(ms) {
      const next = Math.max(20, Math.min(2000, Number(ms) || 290));
      const changed = this._echoTimeMs == null || Math.abs(next - this._echoTimeMs) >= 0.1;
      this._echoTimeMs = next;
      if (this._echoRobotic) return; // robotic mode owns the delay time
      // The React effect also runs for feedback/filter changes. Do not restart
      // the time ramp unless its actual target changed.
      if (changed) this._glideEchoTime(next);
    }
    // Tempo-synced echo: set the delay to a musical division of the beat.
    // division is a fraction of a quarter note (1/8 = 0.5, dotted/triplet via
    // the table). Routes through setEchoTime so robotic mode still overrides.
    // Returns the applied ms.
    setEchoSync(bpm, division) {
      const DIV = { "1/4": 1, "1/4.": 1.5, "1/4t": 2 / 3, "1/8": 0.5, "1/8.": 0.75, "1/8t": 1 / 3, "1/16": 0.25, "1/16t": 1 / 6 };
      const f = DIV[division] != null ? DIV[division] : 0.5;
      const beatMs = 60000 / Math.max(20, Math.min(400, bpm || 120));
      const ms = Math.max(20, Math.min(2000, beatMs * f));
      this.setEchoTime(ms);
      return ms;
    }
    // "Full-speed"/robotic echo: snap the delay to an ultra-short fixed time so
    // the feedback rings as a metallic comb. While engaged, setEchoTime is held
    // off; disengaging restores the last requested time.
    setEchoRobotic(on) {
      const next = !!on;
      if (next === !!this._echoRobotic) return;
      this._echoRobotic = next;
      if (next) {
        this._glideEchoTime(14, 0.008);
      } else {
        const ms = this._echoTimeMs == null ? 290 : this._echoTimeMs;
        this._glideEchoTime(ms);
      }
      this._applyEchoWow(); // robotic holds the wow/flutter LFOs off so the comb stays fixed
    }
    // Direct transition duration, rather than an asymptotic time constant:
    // low values feel immediate, while high values deliberately drag the tape.
    setEchoSlide(v) {
      const unit = Math.max(0, Math.min(1, Number(v) || 0));
      this._echoSlide = 0.015 + Math.pow(unit, 1.5) * 0.485;
    }
    setEchoFeedback(v) { this.echoFB.gain.value = Math.min(0.85, v); }
    // Tape wow/flutter depth (0..1): 0 = clean delay, 1 = heavy warble.
    // Scales both LFOs (wow up to ±4 ms, flutter up to ±1.2 ms of delay time).
    setEchoWow(amount) {
      this.echoWow = Math.max(0, Math.min(1, amount || 0));
      this._applyEchoWow();
    }
    // Apply the wow/flutter LFO depths — but force them to 0 while robotic mode
    // is engaged, so the modulation can't wobble the fixed metallic-comb delay.
    _applyEchoWow() {
      const a = this._echoRobotic ? 0 : (this.echoWow || 0);
      if (this.echoWowDepth) this.echoWowDepth.gain.setTargetAtTime(a * 0.004, this.ctx.currentTime, 0.05);
      if (this.echoFlutterDepth) this.echoFlutterDepth.gain.setTargetAtTime(a * 0.0012, this.ctx.currentTime, 0.05);
    }
    setEchoFilter(hz) { this.echoFilter.frequency.value = hz; }
    setEchoFilterQ(q) { this.echoFilter.Q.value = Math.max(0.3, Math.min(12, q)); }
    // Sub HP in the echo loop: on → cut below `hz` (20-400), off → 20 Hz (flat).
    setEchoHP(on, hz = 150) { this.echoHP.frequency.value = on ? Math.max(20, Math.min(400, hz)) : 20; }
    setEchoSat(v) { this.echoSat.curve = this.makeSatCurve(0.5 + v * 2.5); }
    setEchoReturn(v) { this.echoReturn.gain.value = v; }
    flushEcho() {
      // Kill the ringing tail by zeroing feedback briefly + muting return
      const t = this.ctx.currentTime;
      const fbWas = this.echoFB.gain.value;
      const retWas = this.echoReturn.gain.value;
      this.echoFB.gain.cancelScheduledValues(t);
      this.echoReturn.gain.cancelScheduledValues(t);
      this.echoFB.gain.setValueAtTime(0, t);
      this.echoReturn.gain.setValueAtTime(0, t);
      // Restore after the buffer has time to clear
      this.echoFB.gain.setValueAtTime(fbWas, t + 0.5);
      this.echoReturn.gain.setValueAtTime(retWas, t + 0.5);
    }
    flushReverb() {
      // Cycle the IR to clear the convolver's internal state
      const buf = this.reverb.buffer;
      this.reverb.buffer = null;
      this.reverb.buffer = buf;
    }
    panicFX() {
      this.flushEcho();
      this.flushReverb();
    }
    setEchoType(t) {
      // 1 = lowpass, 2 = highpass with high feedback ceiling
      this.echoType = t;
      this.echoFilter.type = t === 2 ? "highpass" : "lowpass";
    }

    // DubFilter
    setDubFilter(mode, cutoff, q) {
      this.dubFilter.type = mode === "hp" ? "highpass" : "lowpass";
      this.dubFilter.frequency.setTargetAtTime(cutoff, this.ctx.currentTime, 0.02);
      this.dubFilter.Q.setTargetAtTime(q, this.ctx.currentTime, 0.02);
    }
    // Hands-free auto-sweep of the dub filter cutoff. rate Hz (0.05..8),
    // depth 0..1 → up to ±3000 Hz cutoff swing around the manual cutoff.
    setDubSweep(rate, depth) {
      this.dubSweepRate = Math.max(0.05, Math.min(8, rate == null ? this.dubSweepRate : rate));
      const d = Math.max(0, Math.min(1, depth || 0));
      this.dubSweepDepth = d;
      if (this.dubFilterLfo) this.dubFilterLfo.frequency.setTargetAtTime(this.dubSweepRate, this.ctx.currentTime, 0.02);
      if (this.dubFilterLfoDepth) this.dubFilterLfoDepth.gain.setTargetAtTime(d * 3000, this.ctx.currentTime, 0.05);
    }
    setDubFilterRoute(route) {
      // music | master | samples | off.
      // IMPORTANT: disconnect only the *routing* edges, never the whole node —
      // musicBus also feeds the per-band VU taps, and samplesHP also feeds the
      // sample reverb/echo sends. A blanket disconnect() would silently kill
      // those. dubFilter -> dubFilterMix is wired once in init and left intact.
      try { this.musicBus.disconnect(this.dubFilter); } catch (e) {}
      try { this.musicBus.disconnect(this.dubFilterMix); } catch (e) {}
      try { this.samplesHP.disconnect(this.dubFilter); } catch (e) {}
      try { this.samplesHP.disconnect(this.masterSum); } catch (e) {}
      if (route === "off") {
        this.musicBus.connect(this.dubFilterMix);
        this.samplesHP.connect(this.masterSum);
      } else if (route === "music") {
        this.musicBus.connect(this.dubFilter);
        this.samplesHP.connect(this.masterSum);
      } else if (route === "samples") {
        this.musicBus.connect(this.dubFilterMix);
        this.samplesHP.connect(this.dubFilter);
      } else if (route === "master") {
        // Closest feasible "master" filter without rewiring the master sum:
        // run BOTH music and samples through the dub filter (everything but the
        // siren). Was previously identical to "off" (filtered nothing).
        this.musicBus.connect(this.dubFilter);
        this.samplesHP.connect(this.dubFilter);
      }
    }
    // --- Aux / mic input (IN 3-4) ---
    setAuxGain(v) { this.auxGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02); }
    setAuxHP(hz) { this.auxHP.frequency.value = hz; }
    setAuxReverbSend(v) { this.auxReverbSend.gain.value = v; }
    setAuxEchoSend(v) { this.auxEchoSend.gain.value = v; }
    hasMic() { return !!this._micStream; }
    micDeviceId() { return this._micDeviceId || ""; }
    // Build clean line/mic constraints (browser DSP off), optionally pinned to a device.
    _micConstraints(deviceId) {
      const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
      if (deviceId) audio.deviceId = { exact: deviceId };
      return { audio };
    }
    async enableMicInput(deviceId) {
      if (this._micStream) return true;
      const md = (typeof navigator !== "undefined") && navigator.mediaDevices;
      if (!md || !md.getUserMedia) throw new Error("Microphone input not supported here");
      const stream = await md.getUserMedia(this._micConstraints(deviceId));
      this._micStream = stream;
      this._micDeviceId = deviceId || (stream.getAudioTracks()[0] && stream.getAudioTracks()[0].getSettings().deviceId) || "";
      this._micSource = this.ctx.createMediaStreamSource(stream);
      this._micSource.connect(this.auxInput);
      return true;
    }
    disableMicInput() {
      if (this._micSource) { try { this._micSource.disconnect(); } catch (e) {} this._micSource = null; }
      if (this._micStream) { this._micStream.getTracks().forEach((t) => t.stop()); this._micStream = null; }
      this._micDeviceId = "";
    }
    // Web In1: route a live input device through a DECK's full music chain
    // (kills → EQ → dub filter → crossfader), i.e. external music processed by
    // the rack — unlike the mic which feeds the aux bus and bypasses the kills.
    // Stops the deck's file playback while live so they don't stack.
    hasLineInput() { return !!this._lineStream; }
    lineDeviceId() { return this._lineDeviceId || ""; }
    lineDeckKey() { return this._lineDeckKey || null; }
    async enableLineInput(deviceId, deckKey) {
      if (this._lineStream) return true;
      const md = (typeof navigator !== "undefined") && navigator.mediaDevices;
      if (!md || !md.getUserMedia) throw new Error("Line input not supported here");
      const key = deckKey === "B" ? "B" : "A";
      const deck = key === "B" ? this.deckB : this.deckA;
      const stream = await md.getUserMedia(this._micConstraints(deviceId));
      this._lineStream = stream;
      this._lineDeviceId = deviceId || "";
      this._lineDeckKey = key;
      this._lineSource = this.ctx.createMediaStreamSource(stream);
      deck.stop();
      this._linePrevName = deck.name; // restore on disable
      deck.name = "● LINE IN";        // the RAF deck sync reads deck.name, so set it here
      this._lineSource.connect(deck.input);
      return true;
    }
    disableLineInput() {
      const deck = this._lineDeckKey === "B" ? this.deckB : this.deckA;
      if (this._lineSource) { try { this._lineSource.disconnect(); } catch (e) {} this._lineSource = null; }
      if (this._lineStream) { this._lineStream.getTracks().forEach((t) => t.stop()); this._lineStream = null; }
      if (deck && deck.name === "● LINE IN") deck.name = this._linePrevName || (deck.buffer ? deck.name : "—");
      this._lineDeviceId = ""; this._lineDeckKey = null; this._linePrevName = null;
    }
    // Guard: is a buffer source allowed to start on this deck? No while it's the
    // live line-input deck (otherwise file playback stacks onto the live input).
    canDeckPlay(deckKey) { return this._lineDeckKey !== (deckKey === "B" ? "B" : "A") || !this._lineStream; }

    // === Multichannel music input (IN 1 = ch 1-2, IN 2 = ch 3-4) ===
    setIn1Gain(v) { this.in1Gain.gain.setTargetAtTime(Math.max(0, v), this.ctx.currentTime, 0.02); }
    setIn2Gain(v) { this.in2Gain.gain.setTargetAtTime(Math.max(0, v), this.ctx.currentTime, 0.02); }
    multiInputChannels() { return this._multiChannels || 0; }
    hasMultiInput() { return !!this._multiStream; }
    multiDeviceId() { return this._multiDeviceId || ""; }
    multiMaxChannels() { return this._multiMaxCh || 0; } // channels the device claims to support
    // Route an already-captured multichannel source into IN 1 / IN 2. Factored
    // out of enableMultiInput so the splitter/merger graph is unit-testable
    // without getUserMedia. ch 0,1 -> IN1 (stereo); ch 2,3 -> IN2 (stereo). Mono
    // or 2-channel sources still feed IN1 (IN2 stays silent if < 3 channels).
    _routeMultiStream(source, channels) {
      this._teardownMulti();
      const ch = Math.max(1, channels | 0);
      this._multiChannels = ch;
      const splitter = this.ctx.createChannelSplitter(ch);
      source.connect(splitter);
      const m1 = this.ctx.createChannelMerger(2);
      splitter.connect(m1, 0, 0);
      splitter.connect(m1, Math.min(1, ch - 1), 1); // mono → both sides
      m1.connect(this.in1Gain);
      this._multiSplitter = splitter; this._multiM1 = m1; this._multiSource = source;
      if (ch >= 3) {
        const m2 = this.ctx.createChannelMerger(2);
        splitter.connect(m2, 2, 0);
        splitter.connect(m2, Math.min(3, ch - 1), 1);
        m2.connect(this.in2Gain);
        this._multiM2 = m2;
      }
    }
    _teardownMulti() {
      for (const n of ["_multiSource", "_multiSplitter", "_multiM1", "_multiM2"]) {
        if (this[n]) { try { this[n].disconnect(); } catch (e) {} this[n] = null; }
      }
      this._multiChannels = 0;
    }
    // Capture a (multichannel) input device and split it across IN 1 / IN 2.
    // Requests as many channels as the device offers (processing disabled);
    // returns the channel count actually granted so the UI can report it.
    async enableMultiInput(deviceId) {
      const md = (typeof navigator !== "undefined") && navigator.mediaDevices;
      if (!md || !md.getUserMedia) throw new Error("Multichannel input not supported here");
      const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 8 } };
      if (deviceId) audio.deviceId = { exact: deviceId };
      const stream = await md.getUserMedia({ audio });
      this.disableMultiInput();
      this._multiStream = stream;
      this._multiDeviceId = deviceId || "";
      const track = stream.getAudioTracks()[0];
      // Chrome usually negotiates only 2ch from a multichannel interface even
      // with channelCount:{ideal:8}. Read the device's real capability and, if
      // it can do more, force the max via applyConstraints so ch3-4 (→ IN2)
      // actually arrive. _multiMaxCh records what the device claims to support
      // (so the UI can tell "device is 2-ch" apart from "browser capped it").
      let negotiated = (track && track.getSettings) ? (track.getSettings().channelCount || 0) : 0;
      let maxCh = negotiated;
      try {
        const caps = track && track.getCapabilities ? track.getCapabilities() : null;
        if (caps && caps.channelCount && caps.channelCount.max) maxCh = caps.channelCount.max;
      } catch (e) {}
      if (maxCh > negotiated && track && track.applyConstraints) {
        try { await track.applyConstraints({ channelCount: { exact: maxCh } }); negotiated = (track.getSettings().channelCount || negotiated); } catch (e) {}
      }
      this._multiMaxCh = maxCh || negotiated || 0;
      const source = this.ctx.createMediaStreamSource(stream);
      // the source node's .channelCount defaults to 2 regardless of the stream;
      // force explicit mode so all negotiated channels pass through.
      const ch = negotiated || source.channelCount || 2;
      try { source.channelCountMode = "explicit"; source.channelCount = ch; } catch (e) {}
      this._routeMultiStream(source, ch);
      return this._multiChannels;
    }
    disableMultiInput() {
      this._teardownMulti();
      if (this._multiStream) { this._multiStream.getTracks().forEach((t) => t.stop()); this._multiStream = null; }
      this._multiDeviceId = "";
    }
    // Swap the live input to another device, preserving the aux routing.
    async switchMicDevice(deviceId) {
      const wasOn = !!this._micStream;
      this.disableMicInput();
      if (wasOn) await this.enableMicInput(deviceId);
      return this._micDeviceId;
    }
    // List audio input devices. Labels are only populated after mic permission
    // has been granted (browser privacy), so call this once the mic is enabled.
    async listInputDevices() {
      const md = (typeof navigator !== "undefined") && navigator.mediaDevices;
      if (!md || !md.enumerateDevices) return [];
      const devices = await md.enumerateDevices();
      return devices.filter((d) => d.kind === "audioinput")
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Input ${i + 1}` }));
    }
    // List audio OUTPUT devices (§19 output selection). Empty if unsupported.
    async listOutputDevices() {
      const md = (typeof navigator !== "undefined") && navigator.mediaDevices;
      if (!md || !md.enumerateDevices) return [];
      const devices = await md.enumerateDevices();
      return devices.filter((d) => d.kind === "audiooutput")
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Output ${i + 1}` }));
    }
    canSetOutput() {
      // Chromium: AudioContext.setSinkId routes the whole graph directly.
      if (this.ctx && typeof this.ctx.setSinkId === "function") return true;
      // WebKit (Tauri/macOS, no AudioContext.setSinkId): route the graph through a
      // MediaStreamDestination -> <audio> element and use HTMLMediaElement.setSinkId
      // (supported since Safari 18.4 / macOS 15.4).
      return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
    }
    // WebKit only exposes audiooutput device IDs/labels after a getUserMedia grant.
    // Request it once (then stop the tracks — we only need the permission).
    async ensureOutputPermission() {
      if (this._micStream || this._devicePermGranted) return true;
      const md = (typeof navigator !== "undefined") && navigator.mediaDevices;
      if (!md || !md.getUserMedia) return false;
      try {
        const s = await md.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
        this._devicePermGranted = true;
        return true;
      } catch (_) { return false; }
    }
    // Open the browser's dedicated speaker picker when available. Unlike
    // enumerateDevices(), selectAudioOutput() can grant one output without
    // borrowing microphone permission. Call this directly from a user click.
    async requestOutputDevice(previousDeviceId) {
      const md = (typeof navigator !== "undefined") && navigator.mediaDevices;
      if (!md) throw new Error("Audio output selection is not available here");
      if (typeof md.selectAudioOutput === "function") {
        const options = previousDeviceId ? { deviceId: previousDeviceId } : undefined;
        const selected = await md.selectAudioOutput(options);
        return {
          deviceId: selected.deviceId,
          label: selected.label || "Selected output",
        };
      }
      const granted = await this.ensureOutputPermission();
      if (!granted) {
        throw new Error("Audio-device permission is blocked. Reset this site's microphone permission, then try again.");
      }
      return null;
    }
    // Route the master output to a chosen device. Chromium uses AudioContext.setSinkId;
    // WebKit falls back to a MediaStreamDestination -> <audio>.setSinkId branch, engaged
    // only for a non-default device (the default path stays a direct, low-latency
    // masterGain -> ctx.destination connection).
    async setOutputDevice(deviceId) {
      const id = deviceId || "";
      if (this.ctx && typeof this.ctx.setSinkId === "function") {
        await this.ctx.setSinkId(id);
        this._outputDeviceId = id;
        return id;
      }
      if (!(typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype)) {
        throw new Error("Output device selection not supported here");
      }
      if (!id) { this._teardownElementOutput(); this._outputDeviceId = ""; return ""; }
      this._setupElementOutput();
      try { await this.ctx.resume(); } catch (_) {}   // CRITICAL on WebKit, else the stream is silent
      try { await this._outEl.play(); } catch (_) {}
      await this._outEl.setSinkId(id);
      this._outputDeviceId = id;
      return id;
    }
    _setupElementOutput() {
      if (this._outStreamDest) return;
      this._outStreamDest = this.ctx.createMediaStreamDestination();
      try { this.masterGain.disconnect(this.ctx.destination); } catch (_) {}
      this.masterGain.connect(this._outStreamDest);
      const el = new Audio();
      el.srcObject = this._outStreamDest.stream;
      el.style.display = "none";
      // Attach to the DOM + keep a reference so WebKit doesn't GC / silence it.
      if (typeof document !== "undefined" && document.body) document.body.appendChild(el);
      this._outEl = el;
    }
    _teardownElementOutput() {
      if (!this._outStreamDest) return;
      try { this._outEl && this._outEl.pause(); } catch (_) {}
      try { this.masterGain.disconnect(this._outStreamDest); } catch (_) {}
      try { this.masterGain.connect(this.ctx.destination); } catch (_) {} // restore low-latency direct out
      if (this._outEl && this._outEl.parentNode) this._outEl.parentNode.removeChild(this._outEl);
      this._outEl = null;
      this._outStreamDest = null;
    }
    outputDeviceId() { return this._outputDeviceId || ""; }
    // Pure Sub-Bass: on → steep LP at `hz` (default 110); off → transparent.
    setPureSub(on, hz = 110) {
      const t = this.ctx.currentTime;
      this.pureSubLP.frequency.setTargetAtTime(on ? hz : 20000, t, 0.02);
      this.pureSubLP.Q.setTargetAtTime(on ? 1.4 : 0.9, t, 0.02);
    }
    // Adjustable isolator band frequencies.
    // Each band clamped to a sensible range so bands stay ordered.
    setKillFreqs(f) {
      if (!f) return;
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      for (const d of [this.deckA, this.deckB, this._inKill]) {
        if (!d) continue;
        if (typeof f.sub === "number") d.killSub.frequency.value = clamp(f.sub, 20, 300);
        if (typeof f.bass === "number") d.killBass.frequency.value = clamp(f.bass, 80, 800);
        if (typeof f.mid === "number") d.killMid.frequency.value = clamp(f.mid, 300, 5000);
        if (typeof f.high === "number") d.killHigh.frequency.value = clamp(f.high, 1000, 8000);
        if (typeof f.top === "number") d.killTop.frequency.value = clamp(f.top, 2000, 18000);
      }
    }
    setSamplesHP(hz) { this.samplesHP.frequency.value = hz; }
    setSamplesReverse(on) { if (this.samples && this.samples.setReverse) this.samples.setReverse(on); }
    setSamplesEchoSend(v) { this.samplesEchoSend.gain.value = v; }
    setSamplesReverbSend(v) { this.samplesReverbSend.gain.value = v; }
    setSamplesGain(v) { this.samples.gain.gain.value = v; }
    setSirenEchoSend(v) { this.sirenEchoSend.gain.value = v; }
    setSirenReverbSend(v) { this.sirenReverbSend.gain.value = v; }
    setSirenAutoPan(v) { if (this.siren && this.siren.setAutoPan) this.siren.setAutoPan(v); }
    setSirenGain(v) {
      // Master siren level — override the trigger envelope by multiplying it via a post gain.
      // We expose this via a separate post-trim gain.
      if (!this._sirenTrim) {
        const t = this.ctx.createGain();
        t.gain.value = 1;
        try { this.siren.output.disconnect(this.masterSum); } catch(e){}
        try { this.siren.output.disconnect(this.sirenReverbSend); } catch(e){}
        try { this.siren.output.disconnect(this.sirenEchoSend); } catch(e){}
        this.siren.output.connect(t);
        t.connect(this.masterSum);
        t.connect(this.sirenReverbSend);
        t.connect(this.sirenEchoSend);
        t.connect(this.sirenMeter);
        this._sirenTrim = t;
      }
      this._sirenTrim.gain.value = v;
    }
    // Spectrum data for analyser
    getSpectrumData(source = "master") {
      const an = source === "fx" && this.fxAnalyser ? this.fxAnalyser : this.masterAnalyser;
      if (!this._specBuf) {
        this.masterAnalyser.fftSize = 2048;
        this._specBuf = new Uint8Array(this.masterAnalyser.frequencyBinCount);
      }
      an.getByteFrequencyData(this._specBuf);
      return this._specBuf;
    }

    // RMS level (0..1) per isolator band, read from the analyser taps.
    getBandLevels() {
      const out = { sub: 0, bass: 0, mid: 0, high: 0, top: 0 };
      if (!this.bandMeters) return out;
      if (!this._bandBuf) this._bandBuf = new Uint8Array(512);
      for (const k in this.bandMeters) {
        const an = this.bandMeters[k];
        const buf = this._bandBuf;
        an.getByteTimeDomainData(buf);
        let s = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; }
        out[k] = Math.sqrt(s / buf.length);
      }
      return out;
    }

    // RMS level (0..1) for the IN1 / IN2 / aux channel meters (post-fader taps).
    getInputLevels() {
      if (!this._inLvlBuf) this._inLvlBuf = new Uint8Array(512);
      const buf = this._inLvlBuf;
      const rms = (an) => {
        if (!an) return 0;
        an.getByteTimeDomainData(buf);
        let s = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; }
        return Math.sqrt(s / buf.length);
      };
      return { in1: rms(this.in1Meter), in2: rms(this.in2Meter), aux: rms(this.auxMeter) };
    }

    // Post-fader/source VU taps used by external control surfaces. The
    // analysers are sinks and do not alter or duplicate the audible signal.
    getSourceLevels() {
      if (!this._sourceLvlBuf) this._sourceLvlBuf = new Uint8Array(512);
      const buf = this._sourceLvlBuf;
      const rms = (an) => {
        if (!an) return 0;
        an.getByteTimeDomainData(buf);
        let s = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          s += v * v;
        }
        return Math.sqrt(s / buf.length);
      };
      return {
        samples: rms(this.samplesMeter),
        siren: rms(this.sirenMeter),
        reverb: rms(this.reverbMeter),
        echo: rms(this.echoMeter),
      };
    }

    // Live gain reduction (dB, <= 0) for each limiter — drives the "limiting"
    // indicators. DynamicsCompressorNode.reduction is the current GR in dB.
    getLimiterReduction() {
      return {
        master: this.limiter ? this.limiter.reduction : 0,
        reverb: this.reverbLim ? this.reverbLim.reduction : 0,
        echo: this.echoLim ? this.echoLim.reduction : 0,
      };
    }

    setMasterGain(v) { this.masterGain.gain.value = v; }
    setMasterHP(hz) { this.masterHP.frequency.value = hz; }
    // Route the limiter to masterGain directly (stereo) or through monoSum (mono).
    setMasterMono(on) {
      on = !!on;
      if (on === this.masterMono) return;
      this.masterMono = on;
      try { this.limiter.disconnect(); } catch (e) {}
      this.limiter.connect(on ? this.monoSum : this.masterGain);
    }
    setLimiterThreshold(db) { this.limiter.threshold.value = db; }
    setMasterLimEnabled(on) {
      // Effectively bypass: ratio 1 + threshold 0 = passthrough
      this.limiter.ratio.value = on ? 20 : 1;
      this.limiter.threshold.value = on ? this.limiter.threshold.value : 0;
    }
    setReverbLim(threshold, on) {
      this.reverbLim.threshold.value = threshold;
      this.reverbLim.ratio.value = on ? 12 : 1;
    }
    setEchoLim(threshold, on) {
      this.echoLim.threshold.value = threshold;
      this.echoLim.ratio.value = on ? 12 : 1;
    }

    // recording — capture master output as raw PCM, export WAV/AIFF on stop.
    setRecordFormat(fmt) { this.recordFormat = fmt === "aiff" ? "aiff" : "wav"; }
    // Export the 12 sample slots as a .zip (16-bit WAV per slot + manifest).
    async exportSampleSet() {
      const JZ = (typeof JSZip !== "undefined") ? JSZip : (typeof window !== "undefined" && window.JSZip);
      if (!JZ) throw new Error("JSZip unavailable");
      const enc = (typeof window !== "undefined" && window.DubnatorEncodeWav) || encodeWavPCM16;
      const zip = new JZ();
      const slots = [];
      this.samples.samples.forEach((s, i) => {
        const buf = s.buffer;
        const chans = [];
        for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
        const wav = enc(chans, buf.sampleRate);
        const file = `${String(i + 1).padStart(2, "0")}_${(s.name || "slot").replace(/[^a-z0-9._-]+/gi, "_")}.wav`;
        zip.file(file, wav);
        slots.push({ slot: i, name: s.name, file, custom: !!s.custom });
      });
      zip.file("manifest.json", JSON.stringify({ kind: "dubnator.sampleset", version: 1, slots }, null, 2));
      return await zip.generateAsync({ type: "blob" });
    }
    // Restore slots from a .zip produced by exportSampleSet. Returns slot count.
    async importSampleSet(file) {
      const JZ = (typeof JSZip !== "undefined") ? JSZip : (typeof window !== "undefined" && window.JSZip);
      if (!JZ) throw new Error("JSZip unavailable");
      const zip = await JZ.loadAsync(file);
      const mf = zip.file("manifest.json");
      if (!mf) throw new Error("Not a Dubnator sample set");
      const manifest = JSON.parse(await mf.async("string"));
      let n = 0;
      for (const slot of (manifest.slots || [])) {
        const zf = zip.file(slot.file);
        if (!zf || slot.slot < 0 || slot.slot >= this.samples.samples.length) continue;
        const arr = await zf.async("arraybuffer");
        let buffer;
        try { buffer = await this.ctx.decodeAudioData(arr.slice(0)); }
        catch (e) { buffer = decodeAiff(this.ctx, arr); }
        if (buffer) {
          this.samples.stop(slot.slot);
          this.samples.samples[slot.slot].buffer = buffer;
          this.samples.samples[slot.slot].name = slot.name || this.samples.samples[slot.slot].name;
          this.samples.samples[slot.slot].custom = !!slot.custom;
          n++;
        }
      }
      return n;
    }
    startRecord() {
      if (this.recording) return;
      this.recL = [];
      this.recR = [];
      // ScriptProcessorNode is deprecated but universally available and simple
      // for a recorder. masterGain -> proc -> destination passes silence through
      // (we never write the output buffer), so it doesn't double the audio.
      const proc = this.ctx.createScriptProcessor(4096, 2, 2);
      proc.onaudioprocess = (e) => {
        const inL = e.inputBuffer.getChannelData(0);
        const inR = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : inL;
        this.recL.push(new Float32Array(inL));
        this.recR.push(new Float32Array(inR));
      };
      this.masterGain.connect(proc);
      proc.connect(this.ctx.destination);
      this.recProc = proc;
      this.recording = true;
    }
    stopRecord() {
      if (!this.recording) return null;
      this.recording = false;
      try { this.masterGain.disconnect(this.recProc); } catch (e) {}
      try { this.recProc.disconnect(); } catch (e) {}
      this.recProc.onaudioprocess = null;
      this.recProc = null;
      const left = flattenChunks(this.recL);
      const right = flattenChunks(this.recR);
      this.recL = [];
      this.recR = [];
      const data = this.recordFormat === "aiff"
        ? encodeAiffPCM16([left, right], this.ctx.sampleRate)
        : encodeWavPCM16([left, right], this.ctx.sampleRate);
      const mime = this.recordFormat === "aiff" ? "audio/aiff" : "audio/wav";
      return new Blob([data], { type: mime });
    }
  }

  function flattenChunks(chunks) {
    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Float32Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  window.DubnatorEngine = new Engine();
  window.DubnatorFreqs = FREQS_10;
  window.DubnatorEncodeWav = encodeWavPCM16;
  window.DubnatorEncodeAiff = encodeAiffPCM16;
  window.DubnatorAiffDuration = aiffDuration;
  window.DubnatorAnalyzeTrack = analyzeTrackBuffer;
})();
