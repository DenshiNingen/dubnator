// Waveform envelope generation lives in a worker so long tracks do not block
// pointer input, MIDI feedback, or the audio UI while they are analysed.
// The same pure function is exposed on window for the synchronous fallback.
(function (scope) {
  function percentile(values, ratio) {
    const sorted = Array.from(values).sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] || 0;
  }

  function computeWaveformEnvelope(channel, duration, bpm, columns) {
    const samples = channel instanceof Float32Array ? channel : new Float32Array(channel || []);
    const count = Math.max(2, columns || Math.min(6000, Math.max(720, Math.ceil((duration || 0) * 28))));
    const peaks = new Float32Array(count);
    const rmsLevels = new Float32Array(count);
    for (let column = 0; column < count; column++) {
      const start = Math.floor((column / count) * samples.length);
      const end = Math.max(start + 1, Math.floor(((column + 1) / count) * samples.length));
      const stride = Math.max(1, Math.floor((end - start) / 72));
      let peak = 0;
      let squares = 0;
      let seen = 0;
      for (let sample = start; sample < end; sample += stride) {
        const value = samples[sample] || 0;
        peak = Math.max(peak, Math.abs(value));
        squares += value * value;
        seen++;
      }
      peaks[column] = peak;
      rmsLevels[column] = seen ? Math.sqrt(squares / seen) : 0;
    }
    const peakScale = 42 / Math.max(0.0001, percentile(peaks, 0.985));
    const rmsScale = 28 / Math.max(0.0001, percentile(rmsLevels, 0.96));
    const body = new Float32Array(count);
    const core = new Float32Array(count);
    for (let column = 0; column < count; column++) {
      const previous = peaks[Math.max(0, column - 1)];
      const next = peaks[Math.min(count - 1, column + 1)];
      const localPeak = Math.max(peaks[column] * 0.88, (previous + peaks[column] * 2 + next) * 0.25);
      body[column] = Math.max(0.9, Math.min(47, localPeak * peakScale));
      core[column] = Math.max(0.55, Math.min(body[column] * 0.88, rmsLevels[column] * rmsScale));
    }
    const safeDuration = Math.max(0.001, duration || 0);
    const beatSeconds = 60 / Math.max(20, Math.min(400, bpm || 120));
    const totalBeats = Math.floor(safeDuration / beatSeconds);
    const beatStride = Math.max(1, Math.ceil(totalBeats / 480));
    const beats = [];
    const bars = [];
    for (let beat = 0; beat <= totalBeats; beat += beatStride) {
      const x = (beat * beatSeconds) / safeDuration;
      (beat % 4 === 0 ? bars : beats).push(x);
    }
    return { body, core, beats, bars };
  }

  scope.DubnatorWaveform = { computeWaveformEnvelope };
  if (typeof scope.postMessage === "function" && typeof scope.document === "undefined") {
    scope.onmessage = (event) => {
      const { channel, duration, bpm, columns } = event.data || {};
      const result = computeWaveformEnvelope(channel, duration, bpm, columns);
      scope.postMessage(result, [result.body.buffer, result.core.buffer]);
    };
  }
})(typeof window !== "undefined" ? window : self);
