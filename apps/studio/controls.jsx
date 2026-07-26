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

// ============ KNOB ============
function Knob({ value, min = 0, max = 1, onChange, label, format, size = "md", midiId, tone = "" }) {
  const ref = useRef(null);
  const drag = useRef(null);
  const { learning, tryLearn, mappable } = useMidiLearn(midiId);

  const onPointerDown = (e) => {
    if (tryLearn(e)) return;
    e.preventDefault();
    drag.current = { y: e.clientY, v: value };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const dy = drag.current.y - e.clientY;
    const range = max - min;
    const next = Math.max(min, Math.min(max, drag.current.v + (dy / 150) * range));
    onChange(next);
  };
  const onPointerUp = () => {
    drag.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  };

  const pct = (value - min) / (max - min);
  const angle = -135 + pct * 270; // -135 to 135 deg

  return (
    <div className={`knob-wrap${tone ? ` control-tone-${tone}` : ""}`}>
      <div
        ref={ref}
        className={`knob ${size === "sm" ? "sm" : size === "lg" ? "lg" : ""} ${learning ? "midi-learning" : ""}`}
        onPointerDown={onPointerDown}
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
function VSlider({ value, min = -12, max = 12, onChange, label, height = 120, center = true, midiId }) {
  const trackRef = useRef(null);
  const drag = useRef(null);
  const { learning, tryLearn, mappable } = useMidiLearn(midiId);

  const onPointerDown = (e) => {
    if (tryLearn(e)) return;
    e.preventDefault();
    const rect = trackRef.current.getBoundingClientRect();
    const setFromY = (clientY) => {
      const pct = 1 - (clientY - rect.top) / rect.height;
      onChange(Math.max(min, Math.min(max, min + pct * (max - min))));
    };
    setFromY(e.clientY);
    drag.current = setFromY;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const onMove = (e) => drag.current && drag.current(e.clientY);
  const onUp = () => {
    drag.current = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };

  const pct = (value - min) / (max - min);
  const thumbBottom = pct * (height - 14);

  return (
    <div className="vslider">
      <div
        ref={trackRef}
        className={`vslider-track ${learning ? "midi-learning" : ""}`}
        style={{ height }}
        onPointerDown={onPointerDown}
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
  const { learning, tryLearn, mappable } = useMidiLearn(midiId);
  const onDown = (e) => {
    if (tryLearn(e)) return;
    e.preventDefault();
    const rect = ref.current.getBoundingClientRect();
    const setFromX = (cx) => {
      const pct = (cx - rect.left) / rect.width;
      onChange(Math.max(0, Math.min(1, pct)));
    };
    setFromX(e.clientX);
    drag.current = setFromX;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const onMove = (e) => drag.current && drag.current(e.clientX);
  const onUp = () => {
    drag.current = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  return (
    <div className={`xfader ${learning ? "midi-learning" : ""}`} ref={ref} onPointerDown={onDown}
      title={mappable ? "Cmd+Shift+click to MIDI-learn this control" : undefined}>
      <div className="xfader-thumb" style={{ left: `calc(${value * 100}% - 12px)` }} />
    </div>
  );
}

// ============ TALL FADER ============
function Fader({ value, min = 0, max = 1.5, onChange, height = 200, midiId }) {
  const trackRef = useRef(null);
  const drag = useRef(null);
  const { learning, tryLearn, mappable } = useMidiLearn(midiId);

  const onPointerDown = (e) => {
    if (tryLearn(e)) return;
    e.preventDefault();
    const rect = trackRef.current.getBoundingClientRect();
    const setFromY = (clientY) => {
      const pct = 1 - (clientY - rect.top) / rect.height;
      onChange(Math.max(min, Math.min(max, min + pct * (max - min))));
    };
    setFromY(e.clientY);
    drag.current = setFromY;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const onMove = (e) => drag.current && drag.current(e.clientY);
  const onUp = () => {
    drag.current = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };

  const pct = (value - min) / (max - min);
  const thumbBottom = pct * (height - 18);

  return (
    <div className={`fader-track ${learning ? "midi-learning" : ""}`} ref={trackRef} style={{ height }} onPointerDown={onPointerDown}
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
    let raf;
    const draw = () => {
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
      raf = requestAnimationFrame(draw);
    };
    if (running) draw();
    return () => cancelAnimationFrame(raf);
  }, [engine, mode, running, height, color, source]);
  return <canvas ref={canvasRef} style={{ width: "100%", height, display: "block" }} />;
}

Object.assign(window, { Knob, VSlider, Meter, EQCurve, LED, Crossfader, Fader, SpectrumAnalyser, InteractiveFilterGraph });
