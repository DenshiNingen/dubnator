/* global React */
const { useState, useEffect, useRef, useCallback } = React;

// ============ MIDI LEARN ============
// Ctrl+Shift+click any control carrying a `midiId` to arm MIDI-learn for it.
// The provider (in app.jsx) supplies { learn(id), learningId }.
const MidiLearnContext = React.createContext(null);
// controls.jsx and app.jsx are loaded as separate scripts (they share via
// window globals), so the context object must live on window to be the same
// instance the provider in app.jsx uses.
if (typeof window !== "undefined") window.MidiLearnContext = MidiLearnContext;
function useMidiLearn(midiId) {
  const ml = React.useContext(MidiLearnContext);
  const mappable = !!(ml && midiId);
  const learning = !!(mappable && ml.learningId === midiId);
  // Call first in a control's pointerdown; returns true if it consumed the
  // gesture (so the caller skips its normal drag).
  const tryLearn = (e) => {
    if (mappable && e.metaKey && e.shiftKey) { // Cmd+Shift+click → MIDI-learn
      e.preventDefault(); e.stopPropagation();
      ml.learn(midiId);
      return true;
    }
    return false;
  };
  return { learning, tryLearn, mappable };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function controlLabel(label, midiId, fallback) {
  if (label) return label;
  if (midiId) return midiId.replace(/[._-]+/g, " ");
  return fallback;
}

function handleSliderKey(event, value, min, max, onChange) {
  const range = max - min;
  const fineStep = range / 100;
  const coarseStep = range / 10;
  let next;
  switch (event.key) {
    case "ArrowUp":
    case "ArrowRight":
      next = value + (event.shiftKey ? coarseStep : fineStep);
      break;
    case "ArrowDown":
    case "ArrowLeft":
      next = value - (event.shiftKey ? coarseStep : fineStep);
      break;
    case "PageUp":
      next = value + coarseStep;
      break;
    case "PageDown":
      next = value - coarseStep;
      break;
    case "Home":
      next = min;
      break;
    case "End":
      next = max;
      break;
    default:
      return;
  }
  event.preventDefault();
  event.stopPropagation();
  onChange(clamp(next, min, max));
}

function useWindowPointerDrag() {
  const cleanupRef = useRef(null);
  const stop = useCallback(() => {
    if (cleanupRef.current) cleanupRef.current();
  }, []);

  useEffect(() => stop, [stop]);

  return useCallback((onMove, onEnd) => {
    stop();
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (cleanupRef.current === cleanup) cleanupRef.current = null;
    };
    const finish = (event) => {
      cleanup();
      if (onEnd) onEnd(event);
    };
    cleanupRef.current = cleanup;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }, [stop]);
}

// ============ KNOB ============
function Knob({ value, min = 0, max = 1, onChange, label, format, size = "md", midiId, tone = "", ariaLabel }) {
  const ref = useRef(null);
  const drag = useRef(null);
  const startPointerDrag = useWindowPointerDrag();
  const { learning, tryLearn, mappable } = useMidiLearn(midiId);

  const onPointerDown = (e) => {
    if (tryLearn(e)) return;
    e.preventDefault();
    drag.current = { y: e.clientY, v: value };
    startPointerDrag(onPointerMove, () => { drag.current = null; });
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const dy = drag.current.y - e.clientY;
    const range = max - min;
    const next = clamp(drag.current.v + (dy / 150) * range, min, max);
    onChange(next);
  };

  const pct = (value - min) / (max - min);
  const angle = -135 + pct * 270; // -135 to 135 deg

  return (
    <div className={`knob-wrap${tone ? ` control-tone-${tone}` : ""}`}>
      <div
        ref={ref}
        className={`knob ${size === "sm" ? "sm" : size === "lg" ? "lg" : ""} ${learning ? "midi-learning" : ""}`}
        onPointerDown={onPointerDown}
        onKeyDown={(event) => handleSliderKey(event, value, min, max, onChange)}
        role="slider"
        tabIndex={0}
        aria-label={controlLabel(ariaLabel || label, midiId, "Rotary control")}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format ? format(value) : undefined}
        title={mappable ? "Cmd+Shift+click to MIDI-learn this control" : undefined}
      >
        <div
          className="knob-indicator"
          style={{ transform: `translateX(-50%) rotate(${angle}deg)` }}
        />
      </div>
      {label && <div className="knob-label">{label}</div>}
      {format && <div className="knob-value mono">{format(value)}</div>}
    </div>
  );
}

// ============ VERTICAL SLIDER ============
function VSlider({ value, min = -12, max = 12, onChange, label, height = 120, center = true, midiId, ariaLabel }) {
  const trackRef = useRef(null);
  const drag = useRef(null);
  const startPointerDrag = useWindowPointerDrag();
  const { learning, tryLearn, mappable } = useMidiLearn(midiId);

  const onPointerDown = (e) => {
    if (tryLearn(e)) return;
    e.preventDefault();
    const rect = trackRef.current.getBoundingClientRect();
    const setFromY = (clientY) => {
      const pct = 1 - (clientY - rect.top) / rect.height;
      onChange(clamp(min + pct * (max - min), min, max));
    };
    setFromY(e.clientY);
    drag.current = setFromY;
    startPointerDrag(onMove, () => { drag.current = null; });
  };
  const onMove = (e) => drag.current && drag.current(e.clientY);

  const pct = (value - min) / (max - min);
  const thumbBottom = pct * (height - 14);

  return (
    <div className="vslider">
      <div
        ref={trackRef}
        className={`vslider-track ${learning ? "midi-learning" : ""}`}
        style={{ height }}
        onPointerDown={onPointerDown}
        onKeyDown={(event) => handleSliderKey(event, value, min, max, onChange)}
        role="slider"
        tabIndex={0}
        aria-label={controlLabel(ariaLabel || label, midiId, "Vertical slider")}
        aria-orientation="vertical"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        title={mappable ? "Cmd+Shift+click to MIDI-learn this control" : undefined}
      >
        {center && <div className="center-line" />}
        <div
          className="vslider-thumb"
          style={{ bottom: thumbBottom }}
        />
      </div>
      {label && <div className="vslider-label mono">{label}</div>}
    </div>
  );
}

// ============ METER ============
function Meter({ level = 0, cells = 18, horizontal = false }) {
  // level 0..1. Vertical (default): loud at top. Horizontal: loud at right.
  const arr = [];
  const order = [];
  for (let i = 0; i < cells; i++) order.push(i);
  if (!horizontal) order.reverse();
  for (const i of order) {
    const pct = i / (cells - 1);
    const on = level > pct;
    let color = "green";
    if (pct > 0.85) color = "red";
    else if (pct > 0.65) color = "amber";
    arr.push(
      <div key={i} className={`meter-cell ${on ? "on " + color : ""}`} />
    );
  }
  return <div className={`meter ${horizontal ? "meter-h" : ""}`}>{arr}</div>;
}

// ============ EQ CURVE SCOPE ============
function EQCurve({ bands, kind = "geq", height = 120, color = "#fff", fillColor }) {
  // Render a continuous EQ frequency response
  const canvasRef = useRef(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // grid: 0dB centerline
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
    ctx.stroke();

    // compute response across log freq
    const N = w;
    const minF = 20, maxF = 20000;
    const points = [];
    const dbRange = 18;
    for (let i = 0; i < N; i++) {
      const f = minF * Math.pow(maxF / minF, i / (N - 1));
      let db = 0;
      for (const b of bands) {
        db += bandResponse(b, f);
      }
      const y = h / 2 - (db / dbRange) * (h / 2);
      points.push([i, Math.max(2, Math.min(h - 2, y))]);
    }

    if (fillColor) {
      ctx.fillStyle = fillColor;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      for (const [x, y] of points) ctx.lineTo(x, y);
      ctx.lineTo(w, h / 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    ctx.stroke();
  }, [JSON.stringify(bands), color, fillColor]);

  return <canvas ref={canvasRef} style={{ width: "100%", height, display: "block" }} />;
}

// Interactive filter graph: renders a filter response + a draggable XY handle.
// Drag horizontal → frequency (log), vertical → Q. Calls onChange({ freq, q })
// live while dragging. type: lowpass | highpass | bandpass. A vertical guide
// ties the handle's X to the response curve so the freq position is legible.
function InteractiveFilterGraph({
  freq, q = 1, type = "lowpass", onChange,
  minFreq = 80, maxFreq = 20000, minQ = 0.3, maxQ = 12,
  height = 130, color = null, fillColor = "rgba(255,90,40,0.10)",
}) {
  const canvasRef = useRef(null);
  const draggingRef = useRef(false);

  // Shared denominator (w-1) so the curve loop (index i over 0..w-1) and the
  // handle/click round-trip agree to the pixel. Outputs are clamped on-canvas.
  const xForFreq = (f, w) => {
    const fc = Math.max(minFreq, Math.min(maxFreq, f));
    const t = (Math.log10(fc) - Math.log10(minFreq)) / (Math.log10(maxFreq) - Math.log10(minFreq));
    return Math.max(0, Math.min(1, t)) * (w - 1);
  };
  const freqForX = (x, w) => minFreq * Math.pow(maxFreq / minFreq, Math.max(0, Math.min(1, x / (w - 1))));
  const yForQ = (qq, h) => {
    const t = (Math.max(minQ, Math.min(maxQ, qq)) - minQ) / (maxQ - minQ);
    return h - Math.max(0, Math.min(1, t)) * h;
  };
  const qForY = (y, h) => minQ + (1 - Math.max(0, Math.min(1, y / h))) * (maxQ - minQ);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#ff5a28";
    const stroke = color || accent;
    const qSafe = Math.max(0.3, q || 0.3);
    const band = { type, freq, q: qSafe, gain: 0 };
    const N = Math.max(2, Math.floor(w)), dbRange = 24, pts = [];
    for (let i = 0; i < N; i++) {
      const f = minFreq * Math.pow(maxFreq / minFreq, i / (N - 1));
      let db;
      if (type === "bandpass") {
        const x = (f - freq) / (freq / qSafe / 2);
        db = 6 - 10 * Math.log10(1 + x * x); // resonant bell
      } else {
        db = bandResponse(band, f);
      }
      pts.push([i, Math.max(2, Math.min(h - 2, h / 2 - (db / dbRange) * (h / 2)))]);
    }
    ctx.fillStyle = fillColor;
    ctx.beginPath(); ctx.moveTo(0, h / 2);
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.lineTo(w, h / 2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = stroke; ctx.lineWidth = 1.5;
    ctx.beginPath(); pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)); ctx.stroke();
    // vertical guide at the cutoff/center freq, then the draggable XY handle
    const hx = xForFreq(freq, w), hy = yForQ(qSafe, h);
    ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, h); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 1; ctx.stroke();
  }, [freq, q, type, color, fillColor, minFreq, maxFreq, minQ, maxQ, height]);

  const handleAt = (clientX, clientY) => {
    const c = canvasRef.current;
    if (!c || !onChange) return;
    const r = c.getBoundingClientRect();
    if (!r.width || !r.height) return;
    onChange({ freq: freqForX(clientX - r.left, r.width), q: qForY(clientY - r.top, r.height) });
  };
  const onPointerDown = (e) => {
    draggingRef.current = true;
    // Pointer capture keeps the drag alive even if the pointer leaves the canvas
    // or the pointerup is missed (no stuck drag).
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    handleAt(e.clientX, e.clientY);
  };
  const onPointerMove = (e) => { if (draggingRef.current) handleAt(e.clientX, e.clientY); };
  const endDrag = (e) => {
    draggingRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
  };

  return (
    <div className="ifg-wrap" style={{ position: "relative", cursor: "crosshair", touchAction: "none" }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={endDrag} onPointerCancel={endDrag}>
      <canvas ref={canvasRef} style={{ width: "100%", height, display: "block" }} />
    </div>
  );
}

function bandResponse(band, f) {
  // Approximate biquad magnitude in dB. band: {type, freq, q?, gain}
  const { type, freq, q = 1, gain = 0 } = band;
  if (type === "peaking") {
    const bw = freq / q;
    const x = (f - freq) / (bw / 2);
    return gain / (1 + x * x);
  }
  if (type === "lowshelf") {
    return gain / (1 + Math.pow(f / freq, 2));
  }
  if (type === "highshelf") {
    return gain / (1 + Math.pow(freq / f, 2));
  }
  if (type === "lowpass") {
    const x = f / freq;
    return -10 * Math.log10(1 + Math.pow(x, 2 * q));
  }
  if (type === "highpass") {
    const x = freq / f;
    return -10 * Math.log10(1 + Math.pow(x, 2 * q));
  }
  return 0;
}

// ============ LED ============
function LED({ on, color, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div className={`led ${color || ""} ${on ? "on" : ""}`} />
      {label && <span style={{ fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-dim)" }}>{label}</span>}
    </div>
  );
}

// ============ Crossfader ============
function Crossfader({ value, onChange, midiId }) {
  const ref = useRef(null);
  const drag = useRef(null);
  const startPointerDrag = useWindowPointerDrag();
  const { learning, tryLearn, mappable } = useMidiLearn(midiId);
  const onDown = (e) => {
    if (tryLearn(e)) return;
    e.preventDefault();
    const rect = ref.current.getBoundingClientRect();
    const setFromX = (cx) => {
      const pct = (cx - rect.left) / rect.width;
      onChange(clamp(pct, 0, 1));
    };
    setFromX(e.clientX);
    drag.current = setFromX;
    startPointerDrag(onMove, () => { drag.current = null; });
  };
  const onMove = (e) => drag.current && drag.current(e.clientX);
  return (
    <div className={`xfader ${learning ? "midi-learning" : ""}`} ref={ref} onPointerDown={onDown}
      onKeyDown={(event) => handleSliderKey(event, value, 0, 1, onChange)}
      role="slider" tabIndex={0} aria-label="Crossfader" aria-orientation="horizontal"
      aria-valuemin={0} aria-valuemax={1} aria-valuenow={value}
      aria-valuetext={`Deck A ${Math.round((1 - value) * 100)}%, Deck B ${Math.round(value * 100)}%`}
      title={mappable ? "Cmd+Shift+click to MIDI-learn this control" : undefined}>
      <div className="xfader-thumb" style={{ left: `calc(${value * 100}% - 12px)` }} />
    </div>
  );
}

// ============ TALL FADER ============
function Fader({ value, min = 0, max = 1.5, onChange, height = 200, midiId, ariaLabel }) {
  const trackRef = useRef(null);
  const drag = useRef(null);
  const startPointerDrag = useWindowPointerDrag();
  const { learning, tryLearn, mappable } = useMidiLearn(midiId);

  const onPointerDown = (e) => {
    if (tryLearn(e)) return;
    e.preventDefault();
    const rect = trackRef.current.getBoundingClientRect();
    const setFromY = (clientY) => {
      const pct = 1 - (clientY - rect.top) / rect.height;
      onChange(clamp(min + pct * (max - min), min, max));
    };
    setFromY(e.clientY);
    drag.current = setFromY;
    startPointerDrag(onMove, () => { drag.current = null; });
  };
  const onMove = (e) => drag.current && drag.current(e.clientY);

  const pct = (value - min) / (max - min);
  const thumbBottom = pct * (height - 18);

  return (
    <div className={`fader-track ${learning ? "midi-learning" : ""}`} ref={trackRef} style={{ height }} onPointerDown={onPointerDown}
      onKeyDown={(event) => handleSliderKey(event, value, min, max, onChange)}
      role="slider" tabIndex={0}
      aria-label={controlLabel(ariaLabel, midiId, "Channel fader")}
      aria-orientation="vertical" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
      title={mappable ? "Cmd+Shift+click to MIDI-learn this control" : undefined}>
      <div className="ticks"></div>
      <div className="fader-thumb" style={{ bottom: thumbBottom }} />
    </div>
  );
}

// ============ SPECTRUM ANALYSER ============
function SpectrumAnalyser({ engine, mode = "log", height = 130, color = "var(--accent)", running = true, source = "master" }) {
  const canvasRef = useRef(null);
  const peaksRef = useRef(null);
  useEffect(() => {
    peaksRef.current = null; // reset peak-hold when source/mode changes
    if (!engine || !engine.ready) return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    let raf = 0;
    let inViewport = true;
    let pageVisible = !document.hidden;
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const schedule = () => {
      if (running && inViewport && pageVisible && !raf) raf = requestAnimationFrame(draw);
    };
    const draw = () => {
      raf = 0;
      if (!running || !inViewport || !pageVisible) return;
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr || c.height !== h * dpr) {
        c.width = w * dpr; c.height = h * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      ctx.clearRect(0, 0, w, h);
      const data = engine.getSpectrumData(source);
      const sr = engine.ctx.sampleRate;
      const binHz = sr / 2 / data.length;
      // Get accent color
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#ff3b00";
      // Frequency mapping
      const fmin = 20, fmax = 20000;
      const xForFreq = (f) => {
        if (mode === "log") {
          return ((Math.log10(f) - Math.log10(fmin)) / (Math.log10(fmax) - Math.log10(fmin))) * w;
        }
        return ((f - fmin) / (fmax - fmin)) * w;
      };
      // Draw filled curve
      ctx.beginPath();
      ctx.moveTo(0, h);
      const N = data.length;
      // Sample evenly across the displayable range
      const cols = Math.min(N, w);
      for (let i = 0; i < cols; i++) {
        const f = fmin + (i / cols) * (fmax - fmin);
        const fLog = mode === "log"
          ? fmin * Math.pow(fmax / fmin, i / cols)
          : f;
        const bin = Math.min(N - 1, Math.max(0, Math.floor(fLog / binHz)));
        const v = data[bin] / 255; // 0..1
        const x = (i / cols) * w;
        const y = h - v * h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = `${accent}30`;
      ctx.fill();
      // Stroke
      ctx.beginPath();
      for (let i = 0; i < cols; i++) {
        const fLog = mode === "log"
          ? fmin * Math.pow(fmax / fmin, i / cols)
          : fmin + (i / cols) * (fmax - fmin);
        const bin = Math.min(N - 1, Math.max(0, Math.floor(fLog / binHz)));
        const v = data[bin] / 255;
        const x = (i / cols) * w;
        const y = h - v * h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      // Peak-hold overlay — a slowly-decaying line tracking the per-column maxima.
      if (!peaksRef.current || peaksRef.current.length !== cols) peaksRef.current = new Float32Array(cols);
      const peaks = peaksRef.current;
      ctx.beginPath();
      for (let i = 0; i < cols; i++) {
        const fLog = mode === "log" ? fmin * Math.pow(fmax / fmin, i / cols) : fmin + (i / cols) * (fmax - fmin);
        const bin = Math.min(N - 1, Math.max(0, Math.floor(fLog / binHz)));
        const v = data[bin] / 255;
        peaks[i] = Math.max(v, peaks[i] - 0.012); // decay rate
        const x = (i / cols) * w;
        const y = h - peaks[i] * h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 1;
      ctx.stroke();
      // Frequency grid
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.font = "9px JetBrains Mono, monospace";
      const ticks = mode === "log" ? [50, 100, 250, 500, 1000, 2500, 5000, 10000, 20000] : [2000, 4000, 8000, 12000, 16000, 20000];
      for (const f of ticks) {
        const x = xForFreq(f);
        ctx.fillRect(x, h - 4, 1, 4);
        const lbl = f >= 1000 ? `${f / 1000}k` : `${f}`;
        ctx.fillText(lbl, x + 2, h - 6);
      }
      schedule();
    };
    const observer = typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(([entry]) => {
          inViewport = entry.isIntersecting;
          if (inViewport) schedule();
          else stop();
        }, { rootMargin: "100px" });
    observer?.observe(c);
    const onVisibilityChange = () => {
      pageVisible = !document.hidden;
      if (pageVisible) schedule();
      else stop();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule();
    return () => {
      stop();
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [engine, mode, running, height, color, source]);
  return <canvas ref={canvasRef} style={{ width: "100%", height, display: "block" }} />;
}

// ============ DECK WAVEFORM ============
// The expensive buffer scan only reruns when a deck loads a different
// AudioBuffer. Playhead, cue and loop overlays remain cheap CSS updates.
function DeckWaveform({
  engineDeck,
  state,
  bpm = 120,
  label,
  windowSeconds = 0,
  onZoom = null,
  showTempo = true,
}) {
  const duration = state.dur || engineDeck?.getDuration?.() || 0;
  const buffer = engineDeck?.buffer || null;
  const gridBpm = state.analysis?.bpm || bpm;
  const approximateTempo = state.analysis?.tempoSource === "audio";
  const gradientId = React.useId().replace(/:/g, "");
  const paths = React.useMemo(() => {
    if (!buffer || !buffer.length) {
      return { body: "", core: "", outline: "", beats: "", bars: "" };
    }
    // Keep enough horizontal detail for a CDJ-style close zoom. A fixed
    // 360-column overview becomes a handful of crude bars when a long track is
    // viewed in a 2–4 second window; duration-scaled sampling stays detailed.
    const columns = Math.min(6000, Math.max(720, Math.ceil(buffer.duration * 28)));
    const channel = buffer.getChannelData(0);
    const peaks = new Float32Array(columns);
    const rmsLevels = new Float32Array(columns);
    for (let column = 0; column < columns; column++) {
      const start = Math.floor((column / columns) * channel.length);
      const end = Math.max(start + 1, Math.floor(((column + 1) / columns) * channel.length));
      const stride = Math.max(1, Math.floor((end - start) / 72));
      let peak = 0;
      let squares = 0;
      let samples = 0;
      for (let sample = start; sample < end; sample += stride) {
        const value = channel[sample] || 0;
        peak = Math.max(peak, Math.abs(value));
        squares += value * value;
        samples++;
      }
      peaks[column] = peak;
      rmsLevels[column] = samples ? Math.sqrt(squares / samples) : 0;
    }

    // Percentile normalization stops one rogue transient from making the rest
    // of the track look flat. The peak envelope retains transients while the
    // RMS core gives the waveform a solid, readable body.
    const percentile = (values, ratio) => {
      const sorted = Array.from(values).sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] || 0;
    };
    const peakScale = 42 / Math.max(0.0001, percentile(peaks, 0.985));
    const rmsScale = 28 / Math.max(0.0001, percentile(rmsLevels, 0.96));
    const body = new Float32Array(columns);
    const core = new Float32Array(columns);
    for (let column = 0; column < columns; column++) {
      const previous = peaks[Math.max(0, column - 1)];
      const next = peaks[Math.min(columns - 1, column + 1)];
      const localPeak = Math.max(
        peaks[column] * 0.88,
        (previous + peaks[column] * 2 + next) * 0.25,
      );
      body[column] = Math.max(0.9, Math.min(47, localPeak * peakScale));
      core[column] = Math.max(
        0.55,
        Math.min(body[column] * 0.88, rmsLevels[column] * rmsScale),
      );
    }

    const areaPath = (amplitudes) => {
      let path = "";
      for (let column = 0; column < columns; column++) {
        const x = (column / (columns - 1)) * 1000;
        const y = 50 - amplitudes[column];
        path += `${column ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
      }
      for (let column = columns - 1; column >= 0; column--) {
        const x = (column / (columns - 1)) * 1000;
        const y = 50 + amplitudes[column];
        path += `L${x.toFixed(2)} ${y.toFixed(2)}`;
      }
      return `${path}Z`;
    };
    let outline = "";
    for (let column = 0; column < columns; column++) {
      const x = (column / (columns - 1)) * 1000;
      outline += `${column ? "L" : "M"}${x.toFixed(2)} ${(50 - body[column]).toFixed(2)}`;
    }
    for (let column = columns - 1; column >= 0; column--) {
      const x = (column / (columns - 1)) * 1000;
      outline += `${column === columns - 1 ? "M" : "L"}${x.toFixed(2)} ${(50 + body[column]).toFixed(2)}`;
    }

    const beatSeconds = 60 / Math.max(20, Math.min(400, gridBpm || 120));
    const totalBeats = Math.floor(buffer.duration / beatSeconds);
    const beatStride = Math.max(1, Math.ceil(totalBeats / 480));
    let beats = "";
    let bars = "";
    for (let beat = 0; beat <= totalBeats; beat += beatStride) {
      const x = ((beat * beatSeconds) / buffer.duration) * 1000;
      const segment = `M${x.toFixed(2)} 0V100`;
      if (beat % 4 === 0) bars += segment;
      else beats += segment;
    }
    return {
      body: areaPath(body),
      core: areaPath(core),
      outline,
      beats,
      bars,
    };
  }, [buffer, gridBpm]);

  const visibleDuration = windowSeconds > 0 && duration > 0
    ? Math.min(duration, windowSeconds)
    : duration;
  const viewStart = visibleDuration > 0 && visibleDuration < duration
    ? Math.min(
      Math.max(0, (state.time || 0) - visibleDuration * 0.35),
      duration - visibleDuration,
    )
    : 0;
  const viewEnd = visibleDuration > 0 ? viewStart + visibleDuration : duration;
  const viewSpan = Math.max(0.001, viewEnd - viewStart || duration || 1);
  const seekAt = (clientX, element) => {
    if (!duration || !engineDeck?.seek) return;
    const rect = element.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    engineDeck.seek(Math.max(0, Math.min(1, (viewStart + fraction * viewSpan) / duration)));
  };
  const onPointerDown = (event) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    seekAt(event.clientX, event.currentTarget);
  };
  const onPointerMove = (event) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      seekAt(event.clientX, event.currentTarget);
    }
  };
  const onKeyDown = (event) => {
    if (!duration || !engineDeck?.seek) return;
    const step = event.shiftKey ? 30 : 5;
    let next = state.time || 0;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next += step;
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next -= step;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = duration;
    else return;
    event.preventDefault();
    event.stopPropagation();
    engineDeck.seek(Math.max(0, Math.min(duration, next)) / duration);
  };
  const onWheel = (event) => {
    if (!onZoom) return;
    event.preventDefault();
    event.stopPropagation();
    onZoom(event.deltaY);
  };

  const pct = (seconds) => duration
    ? `${Math.max(0, Math.min(100, ((seconds - viewStart) / viewSpan) * 100))}%`
    : "0%";
  const waveTime = (seconds) => {
    const safe = Math.max(0, seconds || 0);
    return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, "0")}`;
  };
  const cue = engineDeck?.cuePoint;
  const loopA = engineDeck?.loopA || 0;
  const loopB = engineDeck?.loopB || 0;
  const visibleLoopA = Math.max(loopA, viewStart);
  const visibleLoopB = Math.min(loopB, viewEnd);
  const loopActive = duration > 0 && loopB > loopA && visibleLoopB > visibleLoopA;
  const cueVisible = cue != null && cue >= viewStart && cue <= viewEnd;
  const viewBoxStart = duration > 0 ? (viewStart / duration) * 1000 : 0;
  const viewBoxWidth = duration > 0 ? Math.max(0.001, (viewSpan / duration) * 1000) : 1000;
  const tempoLabel = state.analysis?.bpm
    ? `${approximateTempo ? "≈" : ""}${Math.round(state.analysis.bpm)} BPM`
    : `GRID ${Math.round(bpm)}`;

  return (
    <div className={`td-progress deck-waveform deck-waveform-${label.toLowerCase()}`}
      role="slider"
      tabIndex={duration > 0 ? 0 : -1}
      aria-label={`Deck ${label} ${windowSeconds > 0 ? "detailed " : ""}waveform playhead`}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, duration)}
      aria-valuenow={Math.min(state.time || 0, duration)}
      aria-valuetext={`${waveTime(state.time)} of ${waveTime(duration)}`}
      title={`Seek Deck ${label} · ${approximateTempo ? "estimated " : ""}beat grid ${Math.round(gridBpm)} BPM${state.analysis?.key ? ` · estimated ${state.analysis.key}` : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onWheel={onWheel}
      onKeyDown={onKeyDown}>
      <svg className="deck-waveform-svg"
        viewBox={`${viewBoxStart} 0 ${viewBoxWidth} 100`}
        preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="white" stopOpacity="0.78" />
            <stop offset="12%" stopColor="var(--deck-wave)" stopOpacity="0.96" />
            <stop offset="50%" stopColor="var(--deck-wave)" stopOpacity="0.48" />
            <stop offset="88%" stopColor="var(--deck-wave)" stopOpacity="0.96" />
            <stop offset="100%" stopColor="white" stopOpacity="0.78" />
          </linearGradient>
        </defs>
        <path className="deck-waveform-beats" d={paths.beats} />
        <path className="deck-waveform-bars" d={paths.bars} />
        <path className="deck-waveform-body" d={paths.body} fill={`url(#${gradientId})`} />
        <path className="deck-waveform-core" d={paths.core} />
        <path className="deck-waveform-outline" d={paths.outline} />
        <path className="deck-waveform-center" d="M0 50H1000" />
      </svg>
      {loopActive && (
        <span className="deck-waveform-loop"
          style={{
            left: pct(visibleLoopA),
            width: `${Math.max(0, Math.min(100, ((visibleLoopB - visibleLoopA) / viewSpan) * 100))}%`,
          }} aria-hidden="true" />
      )}
      {cueVisible && (
        <span className="deck-waveform-marker deck-waveform-cue"
          style={{ left: pct(cue) }} aria-hidden="true"><i>C</i></span>
      )}
      <span className="deck-waveform-marker deck-waveform-playhead"
        style={{ left: pct(state.time || 0) }} aria-hidden="true" />
      {showTempo && (
        <span className="deck-waveform-tempo mono" aria-hidden="true">
          {tempoLabel}{state.analysis?.key ? ` · ~${state.analysis.key}` : ""}
        </span>
      )}
    </div>
  );
}

Object.assign(window, { Knob, VSlider, Meter, EQCurve, LED, Crossfader, Fader, SpectrumAnalyser, InteractiveFilterGraph, DeckWaveform });
