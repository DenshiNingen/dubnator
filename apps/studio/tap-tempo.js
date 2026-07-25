// Stable tap-tempo tracking shared by the UI, keyboard and MIDI surfaces.
//
// Real controllers and browser input stacks can occasionally emit a second
// activation a few milliseconds after the intended tap. Treating that bounce
// as a beat makes a human tempo look like a 60–70 ms delay. The tracker rejects
// intervals faster than the supported musical range and uses the median of the
// recent valid intervals so one stray tap cannot dominate the result.
(function () {
  const MIN_INTERVAL_MS = 120;
  const MAX_INTERVAL_MS = 3000;
  const MAX_TAPS = 5;

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  class TapTempoTracker {
    constructor(options = {}) {
      this.minIntervalMs = Number(options.minIntervalMs) || MIN_INTERVAL_MS;
      this.maxIntervalMs = Number(options.maxIntervalMs) || MAX_INTERVAL_MS;
      this.maxTaps = Math.max(2, Number(options.maxTaps) || MAX_TAPS);
      this.reset();
    }

    reset() {
      this.timestamps = [];
    }

    tap(timestamp) {
      const now = Number(timestamp);
      if (!Number.isFinite(now)) {
        return { accepted: false, ready: false, reason: "invalid" };
      }

      const previous = this.timestamps.at(-1);
      if (previous !== undefined) {
        const interval = now - previous;
        if (interval < 0 || interval > this.maxIntervalMs) {
          this.timestamps = [now];
          return { accepted: true, ready: false, reason: "restart" };
        }
        if (interval < this.minIntervalMs) {
          return { accepted: false, ready: false, reason: "duplicate" };
        }
      }

      this.timestamps.push(now);
      if (this.timestamps.length > this.maxTaps) this.timestamps.shift();
      if (this.timestamps.length < 2) {
        return { accepted: true, ready: false, reason: "first" };
      }

      const intervals = [];
      for (let index = 1; index < this.timestamps.length; index++) {
        intervals.push(this.timestamps[index] - this.timestamps[index - 1]);
      }
      const intervalMs = median(intervals);
      return {
        accepted: true,
        ready: true,
        intervalMs,
        bpm: 60000 / intervalMs,
      };
    }
  }

  const api = {
    MAX_INTERVAL_MS,
    MAX_TAPS,
    MIN_INTERVAL_MS,
    TapTempoTracker,
    median,
  };
  if (typeof window !== "undefined") window.DubnatorTapTempo = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
