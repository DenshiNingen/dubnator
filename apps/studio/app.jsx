/* global React, ReactDOM, Knob, VSlider, Meter, EQCurve, LED, Crossfader, DeckWaveform */
const { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore } = React;

const FREQS_10 = [32, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const ECHO_DIVS = ["1/4", "1/4.", "1/4t", "1/8", "1/8.", "1/8t", "1/16", "1/16t"];
const DECK_END_MODES = ["stop", "loop", "next"];
const LAUNCHPAD_BRIGHTNESS_LEVELS = [0, 18, 36, 54, 73, 91, 109, 127];
const LAUNCHPAD_BRIGHTNESS_KEY = "dubnator.launchpad.brightness.v1";
const PLAYLIST_LINK_KEY = "dubnator.playlists.linked.v1";
const METER_FRAME_MS = 1000 / 30;
const METER_UI_FRAME_MS = 1000 / 20;
const deckEndModeFromValue = (value) => value < 0.25 ? "stop" : value < 0.75 ? "loop" : "next";
const deckEndModeValue = (mode) => mode === "next" ? 1 : mode === "loop" ? 0.5 : 0;

// High-frequency deck transport data has its own tiny external store. Keeping
// playhead updates out of the main App state prevents the whole rack from
// reconciling 30 times per second; only the expanded deck view subscribes.
const deckTelemetrySnapshots = {
  A: Object.freeze({ time: 0, dur: 0, playing: false, cued: false }),
  B: Object.freeze({ time: 0, dur: 0, playing: false, cued: false }),
};
const deckTelemetryListeners = { A: new Set(), B: new Set() };
function publishDeckTelemetry(deckKey, next) {
  const previous = deckTelemetrySnapshots[deckKey];
  if (previous && previous.time === next.time && previous.dur === next.dur
    && previous.playing === next.playing && previous.cued === next.cued) return;
  deckTelemetrySnapshots[deckKey] = Object.freeze(next);
  deckTelemetryListeners[deckKey].forEach((listener) => listener());
}
function useDeckTelemetry(deckKey) {
  return useSyncExternalStore(
    (listener) => { deckTelemetryListeners[deckKey].add(listener); return () => deckTelemetryListeners[deckKey].delete(listener); },
    () => deckTelemetrySnapshots[deckKey],
    () => deckTelemetrySnapshots[deckKey],
  );
}
// A restrained performance starting point: tempo-related repeats, less low-end
// build-up and a dark enough loop to sit behind the source instead of masking it.
const DUB_ECHO_START = Object.freeze({
  send: 0.32,
  time: 375,
  fb: 0.48,
  sat: 0.28,
  slide: 0.14,
  dw: 0.38,
  filter: 3200,
  filterQ: 0.7,
  hp: 150,
  hpOn: true,
  direct: false,
  type: 1,
  wow: 0.08,
  robotic: false,
  sync: true,
  syncDiv: "1/8.",
});
// Quick 10-band graphic-EQ preset shapes (dB per band, all within the ±12 slider
// range). Applied to Deck A's GEQ; copy to B with the →B button.
const EQ_SHAPES = {
  FLAT:  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  SMILE: [4, 4, 2, 0, -2, -3, -2, 0, 3, 4],
  BASS:  [6, 5, 3, 1, 0, 0, 0, 0, 0, 0],
  AIR:   [0, 0, 0, 0, 0, 1, 2, 3, 4, 5],
  PHONE: [-12, -10, -4, 2, 4, 3, 1, -4, -10, -12],
  SCOOP: [2, 2, 0, -2, -4, -4, -2, 0, 2, 2],
};
const KILL_FREQ_RANGE = { sub: [20, 300], bass: [80, 800], mid: [300, 5000], high: [1000, 8000], top: [2000, 18000] };
const eng = window.DubnatorEngine;
const { FloatingWindow, useFloatingBox } = window.DubnatorFloating;
const { KeyboardMap } = window.DubnatorKeyboardMap;
const { LaunchpadLayoutHelp } = window.DubnatorLaunchpadHelp;
const PlaylistModal = window.DubnatorPlaylistModal;
const MIDI_CONTROLS = window.DubnatorMidiControls;
const ECHO_TIMING = window.DubnatorEchoTiming;
const { TapTempoTracker } = window.DubnatorTapTempo;

// EQ routing selector → which EQ units are engaged. "KILLS ONLY" bypasses
// both; "10B EQ"/"4B EQ" engage one; "ALL EQS" engages both. Bypassed EQs are
// flattened (gains forced to 0) rather than rerouted, which is equivalent here.
function eqRouting(sel) {
  return {
    geqOn: sel === "10B EQ" || sel === "ALL EQS",
    paramOn: sel === "4B EQ" || sel === "ALL EQS",
  };
}

// Move the siren selection by `dir` slots (wrapping over the full preset bank)
// and apply that preset's oscillator/LFO params. Shared by keyboard + UI pills.
function stepSirenPreset(s, dir) {
  const list = eng.siren ? eng.siren.presets() : [];
  const n = list.length || 1;
  const next = ((s.preset + dir) % n + n) % n;
  const p = list[next];
  if (!p) return { ...s, preset: next };
  return { ...s, preset: next, pitch: p.pitch, lfo1Rate: p.lfo1Rate, lfo1Depth: p.lfo1Depth, lfo2Rate: p.lfo2Rate, lfo2Depth: p.lfo2Depth };
}

function fmtDb(v) { return (v >= 0 ? "+" : "") + v.toFixed(1) + " dB"; }
function fmtHz(v) { return v >= 1000 ? (v / 1000).toFixed(2) + " kHz" : v.toFixed(0) + " Hz"; }
function fmtMs(v) { return v.toFixed(0) + " ms"; }
function fmtTime(s) {
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}m ${String(ss).padStart(2, "0")}s`;
}

const COMPACT_RACK_SECTIONS = [
  ["rack-inputs", "Inputs"],
  ["rack-eq", "EQ"],
  ["rack-decks", "Decks"],
  ["rack-fx", "FX"],
  ["rack-kills", "Kills"],
  ["rack-pads", "Pads"],
  ["rack-output", "Output"],
];

function CompactRackNav() {
  const [active, setActive] = useState(COMPACT_RACK_SECTIONS[0][0]);
  const trackRef = useRef(null);

  useEffect(() => {
    let frame = 0;
    const updateActiveSection = () => {
      frame = 0;
      // Targets keep 50px of breathing room below the sticky navigator.
      // Include that gap when deciding which section is currently "at" it.
      const anchor = 96;
      let current = COMPACT_RACK_SECTIONS[0][0];
      for (const [id] of COMPACT_RACK_SECTIONS) {
        const section = document.getElementById(id);
        if (section && section.getBoundingClientRect().top <= anchor) current = id;
      }
      setActive(current);
    };
    const scheduleUpdate = () => {
      if (!frame) frame = requestAnimationFrame(updateActiveSection);
    };

    updateActiveSection();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    const button = track?.querySelector(`[data-rack-target="${active}"]`);
    if (!track || !button) return;
    const left = button.offsetLeft - (track.clientWidth - button.offsetWidth) / 2;
    track.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [active]);

  const jumpTo = (id) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav className="compact-rack-nav" aria-label="Rack sections">
      <span className="compact-rack-nav-label mono">RACK</span>
      <div className="compact-rack-nav-track" ref={trackRef}>
        {COMPACT_RACK_SECTIONS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            data-rack-target={id}
            className={active === id ? "active" : ""}
            aria-current={active === id ? "location" : undefined}
            onClick={() => jumpTo(id)}>
            {label}
          </button>
        ))}
      </div>
    </nav>
  );
}

function TrackArtwork({ metadata, className = "", label = "Track artwork" }) {
  const src = metadata?.artworkUrl;
  return (
    <span className={`track-artwork ${src ? "has-artwork" : "is-empty"} ${className}`.trim()}>
      {src
        ? <img src={src} alt={label} draggable="false" />
        : <span aria-hidden="true">♪</span>}
    </span>
  );
}

function deckDisplayName(state, emptyLabel) {
  return state.metadata?.title || (state.name && state.name !== "—" ? state.name : emptyLabel);
}


function DeckStrip({ label, state, set, meter, play, stop, onFile, deck, onPrev, onNext, onRewind, onSetCue, onJumpCue, bpm = 120, onOpenPlaylist, dropProps, dropActive, midiPrefix }) {
  const [more, setMore] = useState(false); // collapse RWD/PAN · A-G · loop controls
  const [analyzing, setAnalyzing] = useState(false);
  const telemetry = useDeckTelemetry(label.endsWith("A") ? "A" : "B");
  const liveState = { ...state, ...telemetry };
  const deckBpm = liveState.analysis?.bpm || bpm;
  const analyzeTrack = async () => {
    const currentDeck = deck();
    if (!currentDeck?.buffer || !currentDeck.analyze || analyzing) return;
    setAnalyzing(true);
    try {
      const analysis = await currentDeck.analyze();
      set((s) => ({ ...s, analysis }));
    } finally {
      setAnalyzing(false);
    }
  };
  const dbReadout = state.gain > 0.001
    ? (20 * Math.log10(state.gain)).toFixed(1) + " dB"
    : "−∞ dB";
  return (
    <div className={`input-strip wide${dropActive ? " drop-active" : ""}`} {...(dropProps || {})}>
      {dropActive && <div className="drop-overlay mono">DROP TO LOAD {label}</div>}
      {/* top: playlist button + mute + dB readout */}
      <div className="strip-top" style={{ justifyContent: "space-between", width: "100%", gap: 4 }}>
        <button
          className="load-btn"
          title={`Open Playlist · ${state.playlist.length} track${state.playlist.length === 1 ? "" : "s"}`}
          onClick={onOpenPlaylist}>
          ☰ {state.playlist.length}
        </button>
        <button className={`mute-btn ${state.mute ? "muted" : ""}`}
          title={state.mute ? "Unmute deck" : "Mute deck"}
          onClick={() => set((s) => ({ ...s, mute: !s.mute }))}>M</button>
        <span className="strip-db dim" style={{ width: "auto", flex: 1, textAlign: "right", color: state.mute ? "var(--accent)" : undefined }}>{state.mute ? "MUTED" : dbReadout}</span>
      </div>
      {/* fader + tall meter */}
      <div className="fader-meter-row">
        <Fader value={state.gain} min={0} max={1.0} height={90} midiId={`${midiPrefix}.gain`}
          onChange={(v) => set((s) => ({ ...s, gain: v }))} />
        <div className="meter-stereo">
          {[1, 0.93].map((mult, m) => (
            <div key={m} className="meter-tall">
              {Array.from({ length: 14 }, (_, i) => {
                const idx = 13 - i;
                const pct = idx / 13;
                const on = meter * mult > pct;
                let color = "green";
                if (pct > 0.85) color = "red";
                else if (pct > 0.6) color = "amber";
                return <div key={idx} className={`meter-cell ${on ? "on " + color : ""}`} />;
              })}
            </div>
          ))}
        </div>
      </div>
      {/* channel identity */}
      <div className="deck-strip-identity">
        <TrackArtwork metadata={state.metadata} className="deck-strip-art"
          label={`Artwork for ${deckDisplayName(state, label)}`} />
        <div>
          <div className="strip-name">{label}</div>
          <span className="deck-strip-title" title={deckDisplayName(state, label)}>
            {deckDisplayName(state, "NO TRACK")}
          </span>
        </div>
      </div>
      {/* eject + load */}
      <label className="load-btn" style={{ width: "100%", height: 18 }} title="Load audio file(s) — multi-select for playlist">
        ▲
        <input type="file" className="hidden" accept="audio/*" multiple onChange={onFile} />
      </label>
      {/* transport row 1: prev / play / next */}
      <div className="deck-transport-block">
        <div className="row">
          <button className="transport-btn" onClick={onPrev} title="Previous track">⏮</button>
          <button className={`transport-btn ${liveState.playing ? "lit" : ""}`} onClick={play} title="Play / Pause">{liveState.playing ? "❚❚" : "▶"}</button>
          <button className="transport-btn" onClick={onNext} title="Next track">⏭</button>
        </div>
        <div className="row">
          <button className="transport-btn wide" onClick={stop} title="Stop">■</button>
          <button className="transport-btn wide" onClick={onRewind} title={`Rewind ${state.rewindLen.toFixed(1)}s`}>◀◀</button>
        </div>
        <div className="row">
          <button className={`transport-btn wide ${liveState.cued ? "lit" : ""}`} onClick={onSetCue} title="Set hot-cue at the playhead">CUE</button>
          <button className="transport-btn wide" onClick={onJumpCue} title="Jump to the hot-cue">→CUE</button>
        </div>
      </div>
      {/* secondary controls — collapsed by default to keep the rack scroll-free */}
      <button className="deck-more-btn" onClick={() => setMore((m) => !m)}
        title={more ? "Hide rewind / pan / loop controls" : "Show rewind / pan / loop controls"}>
        {more ? "▴ LESS" : "⋯ MORE"}
      </button>
      {more && (<>
      {/* rewind length + pan knobs */}
      <div className="row gap-2" style={{ justifyContent: "center", marginTop: 4 }}>
        <Knob size="sm" label="RWD" value={state.rewindLen} min={0.5} max={20}
          onChange={(v) => set((s) => ({ ...s, rewindLen: v }))}
          format={(v) => v.toFixed(1) + "s"} />
        <Knob size="sm" midiId={`${midiPrefix}.pan`} label="PAN" value={state.pan} min={-1} max={1}
          onChange={(v) => set((s) => ({ ...s, pan: v }))}
          format={(v) => Math.abs(v) < 0.02 ? "C" : (v < 0 ? "L" : "R") + Math.round(Math.abs(v) * 100)} />
      </div>
      {/* A-G toggle */}
      <button
        className={`btn-xs btn ${state.autoGain ? "active" : ""}`}
        style={{ width: "100%", marginTop: 4 }}
        onClick={() => set((s) => ({ ...s, autoGain: !s.autoGain }))}
        title="Auto-gain — boosts low-level tracks">
        A-G {state.autoGain ? "ON" : ""}
      </button>
      <div className="deck-analysis-row">
        <button className="btn-xs btn" onClick={analyzeTrack}
          disabled={analyzing || !deck()?.buffer}
          title="Estimate this track's tempo and musical key">
          {analyzing ? "ANALYZING…" : "ANALYZE"}
        </button>
        <span className="deck-analysis-readout mono">
          {state.analysis?.bpm
            ? `${state.analysis.tempoSource === "audio" ? "≈" : ""}${state.analysis.bpm} BPM`
            : "— BPM"}
          <i>{state.analysis?.key ? `~${state.analysis.key}` : "—"}</i>
        </span>
      </div>
      {/* section loop in / out / clear */}
      <div className="row gap-1" style={{ justifyContent: "center", marginTop: 4 }}>
        <button className="btn-xs btn" style={{ flex: 1 }} title="Set loop start at the playhead"
          onClick={() => set((s) => ({ ...s, loopIn: deck().getCurrentTime() }))}>IN</button>
        <button className="btn-xs btn" style={{ flex: 1 }} title="Set loop end at the playhead + engage"
          onClick={() => {
            const d = deck(); const a = state.loopIn || 0; const b = d.getCurrentTime();
            if (b > a + 0.05) { d.setLoopRegion(a, b); set((s) => ({ ...s, loopOn: true })); }
          }}>OUT</button>
        <button className={`btn-xs btn ${state.loopOn ? "active" : ""}`} title="Clear loop"
          onClick={() => { deck().clearLoopRegion(); set((s) => ({ ...s, loopOn: false })); }}>⟳</button>
      </div>
      {/* beat-loops from the tapped BPM + loop-roll halve/double */}
      <div className="row gap-1" style={{ justifyContent: "center", marginTop: 2 }}>
        {[1, 2, 4].map((n) => (
          <button key={n} className="btn-xs btn" style={{ flex: 1 }}
            title={`Loop ${n} beat${n > 1 ? "s" : ""} at ${deckBpm} BPM`}
            onClick={() => { deck().setBeatLoop(deckBpm, n); set((s) => ({ ...s, loopOn: true })); }}>{n}♪</button>
        ))}
        <button className="btn-xs btn" style={{ flex: 1 }} title="Halve the loop length"
          onClick={() => deck().halveLoop()}>÷2</button>
        <button className="btn-xs btn" style={{ flex: 1 }} title="Double the loop length"
          onClick={() => deck().doubleLoop()}>×2</button>
      </div>
      </>)}
    </div>
  );
}

function DeckFocusCard({
  label,
  state,
  setState,
  engineDeck,
  bpm,
  onPlay,
  onStop,
  onPrev,
  onNext,
  onRewind,
  onSetCue,
  onJumpCue,
}) {
  const [analyzing, setAnalyzing] = useState(false);
  const telemetry = useDeckTelemetry(label);
  const liveState = { ...state, ...telemetry };
  const minZoomSeconds = 2;
  const maxZoomSeconds = 120;
  const [zoomSeconds, setZoomSeconds] = useState(16);
  const trackBpm = state.analysis?.bpm || bpm;
  const clampZoom = (seconds) => Math.max(minZoomSeconds, Math.min(maxZoomSeconds, seconds));
  const changeZoom = (input) => {
    setZoomSeconds((current) => {
      // Buttons move by a deliberately small 8%; wheel/trackpad deltas remain
      // proportional so a gentle gesture makes a fine adjustment.
      const factor = typeof input === "number"
        ? Math.exp(Math.max(-120, Math.min(120, input)) * 0.0015)
        : input === "out" ? 1.08 : 1 / 1.08;
      return clampZoom(current * factor);
    });
  };
  const zoomPosition = Math.log(maxZoomSeconds / zoomSeconds)
    / Math.log(maxZoomSeconds / minZoomSeconds);
  const setZoomPosition = (position) => {
    const ratio = Math.max(0, Math.min(1, Number(position)));
    setZoomSeconds(clampZoom(
      maxZoomSeconds * Math.pow(minZoomSeconds / maxZoomSeconds, ratio),
    ));
  };
  const zoomLabel = zoomSeconds < 10
    ? `${zoomSeconds.toFixed(1)}s`
    : `${Math.round(zoomSeconds)}s`;
  const hasTrack = !!engineDeck?.buffer;
  const hasPlaylistNavigation = (liveState.playlist?.length || 0) > 1;
  const runAnalysis = async () => {
    if (!engineDeck?.buffer || !engineDeck.analyze || analyzing) return;
    setAnalyzing(true);
    try {
      const analysis = await engineDeck.analyze();
      setState((current) => ({ ...current, analysis }));
    } finally {
      setAnalyzing(false);
    }
  };
  const setLoopIn = () => {
    const loopIn = engineDeck?.getCurrentTime?.() || 0;
    setState((current) => ({
      ...current,
      loopIn,
      loopInArmed: true,
      loopBeats: null,
    }));
  };
  const setLoopOut = () => {
    const loopOut = engineDeck?.getCurrentTime?.() || 0;
    if (loopOut <= state.loopIn + 0.05) return;
    engineDeck?.setLoopRegion?.(state.loopIn, loopOut);
    setState((current) => ({
      ...current,
      loopOn: true,
      loopInArmed: false,
      loopBeats: null,
    }));
  };
  const clearLoop = () => {
    engineDeck?.clearLoopRegion?.();
    setState((current) => ({
      ...current,
      loopOn: false,
      loopIn: 0,
      loopInArmed: false,
      loopBeats: null,
    }));
  };
  const setBeatLoop = (beats) => {
    engineDeck?.setBeatLoop?.(trackBpm, beats);
    setState((current) => ({
      ...current,
      loopOn: true,
      loopInArmed: false,
      loopBeats: beats,
    }));
  };
  const resizeLoop = (direction) => {
    if (direction === "half") engineDeck?.halveLoop?.();
    else engineDeck?.doubleLoop?.();
    setState((current) => ({
      ...current,
      loopBeats: current.loopBeats
        ? direction === "half" ? current.loopBeats / 2 : current.loopBeats * 2
        : null,
    }));
  };

  return (
    <section className={`deck-focus-card deck-focus-${label.toLowerCase()}`} aria-label={`Deck ${label}`}>
      <header className="deck-focus-card-header">
        <span className="deck-focus-letter mono">{label}</span>
        <TrackArtwork metadata={state.metadata} className="deck-focus-header-art"
          label={`Artwork for ${deckDisplayName(state, `Deck ${label}`)}`} />
        <div className="deck-focus-track">
          <strong>{deckDisplayName(state, `Deck ${label} empty`)}</strong>
          <span className="mono">
            {liveState.metadata?.artist ? `${liveState.metadata.artist} · ` : ""}
            {liveState.analysis?.bpm
              ? `${liveState.analysis.tempoSource === "audio" ? "≈" : ""}${liveState.analysis.bpm} BPM`
              : `GRID ${Math.round(bpm)} BPM`}
            {liveState.analysis?.key ? ` · ~${liveState.analysis.key}` : ""}
          </span>
        </div>
        <button className="btn-xs btn" onClick={runAnalysis}
          disabled={!engineDeck?.buffer || analyzing}
          title={`Analyze Deck ${label} tempo and musical key`}>
          {analyzing ? "ANALYZING…" : "ANALYZE"}
        </button>
      </header>

      <div className="deck-focus-clock mono">
        <strong>{fmtTime(liveState.time)}</strong>
        <span>{fmtTime(liveState.dur)}</span>
      </div>
      <div className="deck-focus-overview-stage">
        <TrackArtwork metadata={state.metadata} className="deck-focus-cover"
          label={`Artwork for ${deckDisplayName(state, `Deck ${label}`)}`} />
        <div className="deck-focus-overview">
          <span className="deck-focus-wave-label mono">OVERVIEW</span>
          <DeckWaveform engineDeck={engineDeck} state={liveState} bpm={bpm} label={label} showTempo={false} />
        </div>
      </div>
      <div className="deck-focus-wave deck-focus-detail">
        <div className="deck-focus-zoom">
          <span className="mono">DETAIL</span>
          <button type="button" onClick={() => changeZoom("out")}
            disabled={zoomSeconds >= maxZoomSeconds}
            aria-label={`Zoom out Deck ${label} waveform`} title="Zoom out waveform">−</button>
          <input
            className="deck-focus-zoom-range"
            type="range"
            min="0"
            max="1"
            step="0.001"
            value={zoomPosition}
            onChange={(event) => setZoomPosition(event.target.value)}
            aria-label={`Deck ${label} waveform zoom`}
            title="Fine waveform zoom"
          />
          <output className="mono">{zoomLabel}</output>
          <button type="button" onClick={() => changeZoom("in")}
            disabled={zoomSeconds <= minZoomSeconds}
            aria-label={`Zoom in Deck ${label} waveform`} title="Zoom in waveform">+</button>
        </div>
          <DeckWaveform
          engineDeck={engineDeck}
          state={liveState}
          bpm={bpm}
          label={label}
          windowSeconds={zoomSeconds}
          onZoom={changeZoom}
        />
      </div>

      <div className="deck-focus-controls">
        <div className="deck-focus-control-group deck-focus-transport" aria-label={`Deck ${label} transport`}>
          <button className="btn" onClick={onPrev} disabled={!hasPlaylistNavigation}
            aria-label={`Previous track on Deck ${label}`} title="Previous playlist track">
            <b>│◀</b><small>PREV</small>
          </button>
          <button className={`btn deck-focus-play ${liveState.playing ? "active" : ""}`}
            onClick={onPlay} disabled={!hasTrack}
            aria-label={`${liveState.playing ? "Pause" : "Play"} Deck ${label}`} title="Play or pause">
            <b>{liveState.playing ? "Ⅱ" : "▶"}</b><small>{liveState.playing ? "PAUSE" : "PLAY"}</small>
          </button>
          <button className="btn" onClick={onNext} disabled={!hasPlaylistNavigation}
            aria-label={`Next track on Deck ${label}`} title="Next playlist track">
            <b>▶│</b><small>NEXT</small>
          </button>
          <button className="btn deck-focus-stop" onClick={onStop} disabled={!hasTrack}
            aria-label={`Stop Deck ${label}`} title="Stop and return to the start">
            <b>■</b><small>STOP</small>
          </button>
          <button className="btn" onClick={onRewind} disabled={!hasTrack}
            aria-label={`Rewind Deck ${label}`} title={`Rewind ${state.rewindLen.toFixed(1)} seconds`}>
            <b>◀◀</b><small>−{state.rewindLen.toFixed(0)}s</small>
          </button>
        </div>
        <div className="deck-focus-control-group" aria-label={`Deck ${label} cue controls`}>
          <button className={`btn deck-focus-cue ${liveState.cued ? "active" : ""}`}
            onClick={onSetCue} disabled={!hasTrack}
            aria-label={`Set cue on Deck ${label}`} aria-pressed={liveState.cued}>
            <b>●</b><small>SET CUE</small>
          </button>
          <button className="btn deck-focus-cue" onClick={onJumpCue} disabled={!liveState.cued}
            aria-label={`Jump to cue on Deck ${label}`}>
            <b>CUE ▶</b><small>RETURN</small>
          </button>
        </div>
        <div className="deck-focus-control-group" aria-label={`Deck ${label} loop controls`}>
          <button className={`btn ${state.loopInArmed ? "armed" : ""}`} onClick={setLoopIn}
            disabled={!hasTrack} aria-label={`Set loop in on Deck ${label}`}
            aria-pressed={!!state.loopInArmed}>IN</button>
          <button className="btn" onClick={setLoopOut}
            disabled={!hasTrack || !state.loopInArmed}
            aria-label={`Set loop out on Deck ${label}`}>OUT</button>
          <button className={`btn ${state.loopOn ? "active" : ""}`} onClick={clearLoop}
            disabled={!state.loopOn && !state.loopInArmed}
            aria-label={`Clear loop on Deck ${label}`}>CLEAR</button>
          {[1, 2, 4].map((beats) => (
            <button key={beats}
              className={`btn ${state.loopOn && state.loopBeats === beats ? "active" : ""}`}
              onClick={() => setBeatLoop(beats)} disabled={!hasTrack}
              aria-label={`${beats}-beat loop on Deck ${label}`}
              aria-pressed={state.loopOn && state.loopBeats === beats}
              title={`${beats}-beat loop at ${trackBpm} BPM`}>{beats}<small>BEAT</small></button>
          ))}
          <button className="btn" onClick={() => resizeLoop("half")} disabled={!state.loopOn}
            aria-label={`Halve loop on Deck ${label}`} title="Halve the active loop">
            <b>÷2</b><small>HALF</small>
          </button>
          <button className="btn" onClick={() => resizeLoop("double")} disabled={!state.loopOn}
            aria-label={`Double loop on Deck ${label}`} title="Double the active loop">
            <b>×2</b><small>DOUBLE</small>
          </button>
        </div>
      </div>
    </section>
  );
}

function DeckFocusView({
  mode,
  setMode,
  selected,
  setSelected,
  decks,
  onClose,
}) {
  const visibleDecks = mode === "double"
    ? decks
    : decks.filter((deck) => deck.label === selected);
  return ReactDOM.createPortal(
    <div className="modal-overlay deck-focus-overlay" onClick={onClose}>
      <div className="modal-window panel with-screws deck-focus-modal" role="dialog"
        aria-modal="true" aria-labelledby="deck-focus-title" onClick={(event) => event.stopPropagation()}>
        <div className="screw-bl"></div><div className="screw-br"></div>
        <div className="modal-titlebar deck-focus-titlebar">
          <span id="deck-focus-title" className="panel-title">Deck performance</span>
          <div className="deck-focus-mode" aria-label="Deck view mode">
            <button className={mode === "single" ? "active" : ""}
              aria-pressed={mode === "single"} onClick={() => setMode("single")}>SINGLE</button>
            <button className={mode === "double" ? "active" : ""}
              aria-pressed={mode === "double"} onClick={() => setMode("double")}>DOUBLE</button>
          </div>
          {mode === "single" && (
            <div className="deck-focus-selector" aria-label="Select deck">
              {decks.map((deck) => (
                <button key={deck.label} className={selected === deck.label ? "active" : ""}
                  aria-pressed={selected === deck.label}
                  onClick={() => setSelected(deck.label)}>DECK {deck.label}</button>
              ))}
            </div>
          )}
          <button className="btn-xs btn" onClick={onClose} aria-label="Close deck performance view">ESC</button>
        </div>
        <div className={`deck-focus-grid deck-focus-grid-${mode}`}>
          {visibleDecks.map((deck) => <DeckFocusCard key={deck.label} {...deck} />)}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function DeckTransportRow({ label, state, engineDeck, bpm }) {
  const telemetry = useDeckTelemetry(label);
  const liveState = { ...state, ...telemetry };
  return (
    <div className="transport-deck-row">
      <TrackArtwork metadata={liveState.metadata} className="td-art"
        label={`Artwork for ${deckDisplayName(liveState, `Deck ${label}`)}`} />
      <div className="td-time mono">{fmtTime(liveState.time)}</div>
      <div className="td-time-sub mono">{fmtTime(liveState.dur)}</div>
      <div className="td-track">
        <span className="td-track-name">
          {deckDisplayName(liveState, `${label === "A" ? "1" : "2"} Empty`)}
        </span>
        <DeckWaveform engineDeck={engineDeck} state={liveState} bpm={bpm} label={label} />
      </div>
    </div>
  );
}


function InputStrip({ label, state, setState, hp, meter = 0, gainMidiId }) {
  const dbReadout = state.gain > 0.001
    ? (20 * Math.log10(state.gain)).toFixed(0) + " dB"
    : "−70 dB";
  return (
    <div className="input-strip">
      {/* top: dB readout + mute LED button */}
      <div className="strip-top" style={{ justifyContent: "space-between" }}>
        <span className="strip-db" style={{ width: "auto", flex: 1, textAlign: "left" }}>{dbReadout}</span>
        <div
          className={`mute-btn ${state.mute ? "muted" : ""}`}
          onClick={() => setState({ mute: !state.mute })}
          title={state.mute ? "Muted" : "Click to mute"}
        >
          <span className="led" />
        </div>
      </div>
      {/* fader + tall meter (post-fader level from the input analyser tap) */}
      <div className="fader-meter-row">
        <Fader value={state.gain} min={0} max={1.5} height={90} midiId={gainMidiId}
          onChange={(v) => setState({ gain: v })} />
        <div className="meter-stereo">
          {[1, 0.92].map((mult, m) => (
            <div key={m} className="meter-tall">
              {Array.from({ length: 14 }, (_, i) => {
                const idx = 13 - i;
                const pct = idx / 13;
                const on = meter * mult > pct;
                let color = "green";
                if (pct > 0.85) color = "red";
                else if (pct > 0.6) color = "amber";
                return <div key={idx} className={`meter-cell ${on ? "on " + color : ""}`} />;
              })}
            </div>
          ))}
        </div>
      </div>
      {/* channel name */}
      <div className="strip-name">{label}</div>
      {!hp ? (
        <div className="pan-row-mini">
          <span>L</span>
          <Knob size="sm" value={state.pan} min={-1} max={1}
            onChange={(v) => setState({ pan: v })} />
          <span>R</span>
        </div>
      ) : null}
    </div>
  );
}

function Kbd({ children }) {
  return <span className="kbd">{children}</span>;
}
function Shortcut({ keys, desc, mom }) {
  return (
    <div className="help-row">
      <span className="hr-desc">{desc}{mom && <span className="kbd-mom-dot" title="momentary"></span>}</span>
      <span className="kbd-row">
        {keys.map((k, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="kbd-plus">+</span>}
            <Kbd>{k}</Kbd>
          </React.Fragment>
        ))}
      </span>
    </div>
  );
}
function HelpSection({ title, children }) {
  return (
    <div className="help-section">
      <div className="help-section-title">{title}</div>
      <div className="help-section-rows">{children}</div>
    </div>
  );
}

function App() {
  // engine init on first interaction
  const [ready, setReady] = useState(false);
  const init = async () => { await eng.init(); setReady(true); };
  // Browser/WebView autoplay policy forbids starting audio without a user gesture,
  // so engage the engine on the very first interaction anywhere (pointer or key) —
  // the user no longer has to think about "click to engage".
  useEffect(() => {
    if (ready) return;
    const engage = () => { init(); };
    window.addEventListener("pointerdown", engage, { once: true });
    window.addEventListener("keydown", engage, { once: true });
    return () => {
      window.removeEventListener("pointerdown", engage);
      window.removeEventListener("keydown", engage);
    };
  }, [ready]);

  // === decks ===
  const [deckA, setDeckA] = useState({ name: "—", time: 0, dur: 0, playing: false, gain: 0.85, pan: 0, mute: false, autoGain: false, rewindLen: 4, playlist: [], playlistIdx: 0, cued: false, loopOn: false, loopIn: 0, loopInArmed: false, loopBeats: null, analysis: null, metadata: {} });
  const [deckB, setDeckB] = useState({ name: "—", time: 0, dur: 0, playing: false, gain: 0.85, pan: 0, mute: false, autoGain: false, rewindLen: 4, playlist: [], playlistIdx: 0, cued: false, loopOn: false, loopIn: 0, loopInArmed: false, loopBeats: null, analysis: null, metadata: {} });
  const [crossfade, setCrossfade] = useState(0.5);
  const [crossfadeCurve, setCrossfadeCurve] = useState("power"); // power | linear | sharp
  const [playlistOpen, setPlaylistOpen] = useState(null); // null | "A" | "B"
  const [playlistsLinked, setPlaylistsLinked] = useState(() => {
    try { return localStorage.getItem(PLAYLIST_LINK_KEY) !== "0"; } catch (_) { return true; }
  });
  const [deckLoadWarning, setDeckLoadWarning] = useState(null);
  const deckLoadWarningTimerRef = useRef(null);
  const [playlistImportProgress, setPlaylistImportProgress] = useState(null);

  // === aux/mic inputs (visual; mic permission could wire IN3-4) ===
  const [inputs, setInputs] = useState({
    in1: { gain: 0, mute: true, rev: false, echo: false, pan: 0 },
    in2: { gain: 0, mute: true, rev: false, echo: false, pan: 0 },
    aux: { gain: 0, mute: true, rev: false, echo: false, hp: 80 },
  });

  // section-level sends — each input section has its own REV/ECHO
  const [musicSends, setMusicSends] = useState({ rev: true, echo: false });
  const [auxSends, setAuxSends] = useState({ rev: false, echo: false });
  const [auxLevels, setAuxLevels] = useState({ rev: 0.4, echo: 0.4 }); // continuous send levels (gated by auxSends)

  // === geq ===
  const [geqA, setGeqA] = useState(Array(10).fill(0));
  const [geqB, setGeqB] = useState(Array(10).fill(0));

  // === parametric ===
  const [paramA, setParamA] = useState([
    { freq: 80, q: 0.7, gain: 0 },
    { freq: 240, q: 1.0, gain: 0 },
    { freq: 2400, q: 1.0, gain: 0 },
    { freq: 12000, q: 0.7, gain: 0 },
  ]);

  // === kills ===
  const [kills, setKills] = useState({ sub: false, bass: false, mid: false, high: false, top: false });
  const [flatGain, setFlatGain] = useState(0); // dB, Flat Mode trim (−24→0, +12 in Advanced)
  const [killTrims, setKillTrims] = useState({ sub: 0, bass: 0, mid: 0, high: 0, top: 0 }); // per-band gain trim dB
  const [killQ, setKillQ] = useState({ bass: 1.0, mid: 0.9, high: 0.9 }); // Low/Mid/High Q (Advanced only)
  const [killFreqs, setKillFreqs] = useState({ sub: 80, bass: 300, mid: 1000, high: 3000, top: 8000 }); // band freqs (Advanced)
  const [pureSub, setPureSub] = useState(false); // Pure Sub-Bass clean-isolation mode
  const flatMode = kills.sub && kills.bass && kills.mid && kills.high && kills.top;

  // === reverb ===
  const [reverb, setReverb] = useState({ send: 0.3, ret: 0.6, room: 0.5, hfd: 0.5, dw: 0.5, preDelay: 0, mod: 0, freeze: false, direct: false, bpFreq: 1200, bpQ: 0.7, bpBypass: true });

  // === echo ===
  const [echo, setEcho] = useState({ send: 0.3, time: 290, fb: 0.35, sat: 0.4, slide: 0.5, dw: 0.5, filter: 2760, filterQ: 1.0, hp: 150, hpOn: false, direct: false, type: 1, wow: 0, robotic: false, sync: false, syncDiv: "1/8", bpm: 120 });
  const audibleEchoTime = ECHO_TIMING.resolved(echo);
  const tapTrackerRef = useRef(new TapTempoTracker());
  const [echoThrowHeld, setEchoThrowHeld] = useState(false);
  const echoThrowRestoreRef = useRef(null);

  // === dub filter ===
  const [dubFilter, setDubFilter] = useState({ mode: "lp", cutoff: 1000, q: 1.0, route: "music", on: false, sweep: 0, sweepRate: 0.5 });

  // === samples extras ===
  const [sampleFx, setSampleFx] = useState({ hp: 20, echoSend: 0.0, reverbSend: 0.0, gain: 0.7, hold: false, reverse: false });
  // per-slot bypass-kills (route direct to master) — visual only since samples already bypass kills
  const [sampleSlotBypass, setSampleSlotBypass] = useState(Array(12).fill(true));

  // === master ===
  const [master, setMaster] = useState({ gain: 0.85, hp: 20, limThresh: -3, limOn: false, mono: false, dim: false });
  const [advanced, setAdvanced] = useState(false);
  const [sirenSetupOpen, setSirenSetupOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [deckFocusOpen, setDeckFocusOpen] = useState(false);
  const [deckFocusMode, setDeckFocusMode] = useState("double");
  const [deckFocusDeck, setDeckFocusDeck] = useState("A");
  const [helpView, setHelpView] = useState("launchpads");
  const [activeDeck, setActiveDeck] = useState("A"); // for shift-modified deck cycling

  // === FX limiters ===
  const [revLim, setRevLim] = useState({ thresh: -5, on: true });
  const [echoLim, setEchoLim] = useState({ thresh: -9, on: true });

  // === siren ===
  const [siren, setSiren] = useState({
    preset: 0,
    pitch: 220,
    lfo1Rate: 6, lfo1Depth: 40,
    lfo2Rate: 12, lfo2Depth: 0,
    bits: 16,
    sr: 1.0,
    gain: 0.7,
    echoSend: 0.0,
    reverbSend: 0.0,
    autoPan: 0.0,
  });
  const [sirenHeld, setSirenHeld] = useState(false);

  // === spectrum display ===
  const [displayMode, setDisplayMode] = useState("spectrum"); // spectrum | eq | image
  // SETUP/AUDIO/PANEL tabs swap the shared screen region: "panel" shows the
  // graphic+parametric EQs; "display" shows the spectrum/EQ-curve/image screen.
  const [mainView, setMainView] = useState("panel"); // panel | display
  const [specMode, setSpecMode] = useState("log"); // log | linear
  const [specSource, setSpecSource] = useState("master"); // master | fx
  const [logoImg, setLogoImg] = useState(null);    // object URL for custom overlay PNG
  const [logoAlpha, setLogoAlpha] = useState(1);    // overlay transparency 0..1
  const [logoDragOver, setLogoDragOver] = useState(false);
  const setLogoFromFile = (f) => {
    if (!f || !/^image\//.test(f.type || "")) return false;
    setLogoImg((prev) => { try { if (prev) URL.revokeObjectURL(prev); } catch (_) {} return URL.createObjectURL(f); });
    setDisplayMode("image");
    return true;
  };
  const onLogoFile = (e) => { setLogoFromFile(e.target.files && e.target.files[0]); e.target.value = ""; };
  const onLogoDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    setLogoDragOver(false);
    setLogoFromFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
  };
  // Combined response of deck A's 10-band GEQ + 4-band parametric for the "Full EQ" display.
  const fullEqBands = useMemo(() => [
    ...geqA.map((g, i) => ({ type: i === 0 ? "lowshelf" : i === 9 ? "highshelf" : "peaking", freq: FREQS_10[i], q: 1.0, gain: g })),
    ...paramA.map((p, i) => ({ type: i === 0 ? "lowshelf" : i === 3 ? "highshelf" : "peaking", freq: p.freq, q: p.q, gain: p.gain })),
  ], [geqA, paramA]);
  const [rewindStop, setRewindStop] = useState(false); // false = rewind&replay, true = rewind&stop
  const [micOn, setMicOn] = useState(false);
  const [micErr, setMicErr] = useState("");
  const [micDevices, setMicDevices] = useState([]); // [{deviceId,label}]
  const [micDeviceId, setMicDeviceId] = useState("");
  const [sampleTick, setSampleTick] = useState(0);   // bump to re-render slot names after a drop
  const [sampleDropIdx, setSampleDropIdx] = useState(null); // pad highlighted during drag-over
  const onSampleDrop = (i) => async (e) => {
    e.preventDefault(); e.stopPropagation();
    setSampleDropIdx(null);
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    await init();
    try { await eng.samples.loadSlot(i, f); setSampleTick((t) => t + 1); }
    catch (err) { console.error("Sample slot load failed", err); }
  };
  const saveSampleSet = async () => {
    try {
      await init();
      const blob = await eng.exportSampleSet();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "dubnator-samples.zip"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { console.error("Sample set export failed", e); }
  };
  const loadSampleSet = async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = "";
    if (!f) return;
    try { await init(); await eng.importSampleSet(f); setSampleTick((t) => t + 1); }
    catch (err) { console.error("Sample set import failed", err); }
  };
  const saveSirenPatch = () => {
    const blob = new Blob([JSON.stringify({ kind: "dubnator.siren", version: 1, siren }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "dubnator-siren.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };
  const loadSirenPatch = async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = "";
    if (!f) return;
    try { const data = JSON.parse(await f.text()); if (data && data.siren) setSiren((s) => ({ ...s, ...data.siren })); }
    catch (err) { console.error("Siren patch load failed", err); }
  };
  const [deckEndMode, setDeckEndMode] = useState("stop"); // stop, repeat current track, or play the next playlist item

  // === MIDI mapping ===
  const mapperRef = useRef(null);
  const midiConnectedRef = useRef(false); // Web MIDI inputs hooked up at least once
  const midiConnectingRef = useRef(false);
  const [midiOpen, setMidiOpen] = useState(false);
  const [midiInputs, setMidiInputs] = useState([]);
  const [midiLearnId, setMidiLearnId] = useState(null);
  const [midiBindings, setMidiBindings] = useState({});
  const [midiErr, setMidiErr] = useState("");
  const [midiPermission, setMidiPermission] = useState("unknown");
  const [midiPickup, setMidiPickup] = useState(false);
  const [midiModes, setMidiModes] = useState({}); // controlId -> momentary?
  const launchpadRef = useRef(null);
  const launchpadMeterFrameRef = useRef(0);
  const midiTransportRef = useRef({ send: null });
  const actionsRef = useRef({});
  const liveStateRef = useRef({});
  const [launchpads, setLaunchpads] = useState([]);
  const [launchpadBrightness, setLaunchpadBrightness] = useState(() => {
    try {
      const stored = localStorage.getItem(LAUNCHPAD_BRIGHTNESS_KEY);
      if (stored === null) return null;
      const value = Math.round(Number(stored));
      return Number.isFinite(value) ? Math.max(0, Math.min(127, value)) : null;
    } catch (_) {
      return null;
    }
  });
  const launchpadHelpAvailable = launchpads.some((device) => device.connected);
  const activeHelpView = launchpadHelpAvailable ? helpView : "keyboard";
  const [launchpadReversed, setLaunchpadReversed] = useState(false);
  const singleLaunchpad = launchpads.length === 1;
  const singleLaunchpadOnFx = singleLaunchpad && launchpads[0]?.roleIndex === 1;

  // === samples ===
  const [flashIdx, setFlashIdx] = useState(-1); // transient: pad lit *right now* by a trigger (auto-clears ~180ms)
  // The persistent sample SELECTION (drives the SELECTOR knob, the R key and what
  // '4' fires) is kept separate from the flash, which used to double as both and
  // reset to -1 after every hit — so the selection appeared to jump back to 0.
  const [selectedSample, setSelectedSample] = useState(0);
  const selectedSampleRef = useRef(0);
  selectedSampleRef.current = selectedSample; // latest value for the stale-closure keydown handler
  const sampleHeld4Ref = useRef(0);           // slot the held '4' fired, so keyup releases the same one

  // === recorder ===
  const [recording, setRecording] = useState(false);
  const [recUrl, setRecUrl] = useState(null);
  const [recFormat, setRecFormat] = useState("wav"); // wav | aiff
  const [recExt, setRecExt] = useState("wav");

  // === meters ===
  const [meterA, setMeterA] = useState(0);
  const [meterB, setMeterB] = useState(0);
  const [meterMaster, setMeterMaster] = useState(0);
  const [masterPeakDb, setMasterPeakDb] = useState(-Infinity);
  const [bandLevels, setBandLevels] = useState({ sub: 0, bass: 0, mid: 0, high: 0, top: 0 });
  const [inLevels, setInLevels] = useState({ in1: 0, in2: 0, aux: 0 }); // IN1/IN2/aux VU levels
  const [sourceLevels, setSourceLevels] = useState({ samples: 0, siren: 0, reverb: 0, echo: 0 });
  const [gr, setGr] = useState({ master: 0, reverb: 0, echo: 0 });

  // EQ select pane
  const [eqSelect, setEqSelect] = useState("ALL EQS");

  // Purpose-built MIDI surfaces use this ref so their handlers never retain a
  // stale render of toggle/selector state.
  liveStateRef.current = {
    deckA, deckB, inputs, crossfade, crossfadeCurve, musicSends, auxSends,
    auxLevels, geqA, paramA, kills, flatGain, killTrims, killQ, killFreqs,
    pureSub, reverb, echo, dubFilter, sampleFx, master, revLim, echoLim,
    siren, sirenHeld, selectedSample, flashIdx, recording, recFormat,
    advanced, deckEndMode, rewindStop, micOn,
  };

  // === setup deck callbacks ===
  // updates audio engine when state changes
  useEffect(() => {
    if (!ready) return;
    const { geqOn } = eqRouting(eqSelect);
    geqA.forEach((g, i) => eng.deckA.geq[i].gain.value = geqOn ? g : 0);
  }, [geqA, eqSelect, ready]);
  useEffect(() => {
    if (!ready) return;
    const { geqOn } = eqRouting(eqSelect);
    geqB.forEach((g, i) => eng.deckB.geq[i].gain.value = geqOn ? g : 0);
  }, [geqB, eqSelect, ready]);
  useEffect(() => {
    if (!ready) return;
    const { paramOn } = eqRouting(eqSelect);
    paramA.forEach((p, i) => {
      const g = paramOn ? p.gain : 0;
      eng.deckA.params[i].frequency.value = p.freq;
      eng.deckA.params[i].Q.value = p.q;
      eng.deckA.params[i].gain.value = g;
      eng.deckB.params[i].frequency.value = p.freq;
      eng.deckB.params[i].Q.value = p.q;
      eng.deckB.params[i].gain.value = g;
    });
  }, [paramA, eqSelect, ready]);
  useEffect(() => {
    if (!ready) return;
    eng.applyKills(kills, flatGain, advanced, killTrims, killQ);
    if (eng.setKillFreqs) eng.setKillFreqs(advanced ? killFreqs : { sub: 80, bass: 300, mid: 1000, high: 3000, top: 8000 });
  }, [kills, flatGain, advanced, killTrims, killQ, killFreqs, ready]);
  useEffect(() => {
    if (ready && eng.setPureSub) eng.setPureSub(pureSub);
  }, [pureSub, ready]);

  useEffect(() => {
    if (!ready) return;
    // Section-level music sends gate the music's contribution to FX
    // direct = bypass: when true, force send + return to 0
    const musicRevOn = musicSends.rev && !reverb.direct;
    eng.setReverbSend(musicRevOn ? reverb.send : 0);
    eng.setReverbReturn(reverb.direct ? 0 : reverb.ret * reverb.dw);
    if (eng.setReverbFreeze) eng.setReverbFreeze(reverb.freeze);
    if (!reverb.freeze) eng.setReverbSize(reverb.room); // freeze owns the IR while on
    eng.setReverbHFD(reverb.hfd);
    if (eng.setReverbPreDelay) eng.setReverbPreDelay(reverb.preDelay);
    if (eng.setReverbMod) eng.setReverbMod(reverb.mod);
    if (eng.setReverbBP) { eng.setReverbBP(reverb.bpFreq, reverb.bpQ); eng.setReverbBPBypass(reverb.bpBypass); }
  }, [reverb, musicSends, ready]);

  // IN 1 / IN 2 music-input levels (muted → 0). Fed by the multichannel capture.
  useEffect(() => {
    if (!ready || !eng.setIn1Gain) return;
    eng.setIn1Gain(inputs.in1.mute ? 0 : inputs.in1.gain);
    eng.setIn2Gain(inputs.in2.mute ? 0 : inputs.in2.gain);
  }, [inputs.in1, inputs.in2, ready]);

  // Aux / mic input (IN 3-4): level (muted → 0), HP, and FX sends.
  useEffect(() => {
    if (!ready || !eng.setAuxGain) return;
    eng.setAuxGain(inputs.aux.mute ? 0 : inputs.aux.gain);
    eng.setAuxHP(inputs.aux.hp);
    eng.setAuxReverbSend(auxSends.rev ? auxLevels.rev : 0);
    eng.setAuxEchoSend(auxSends.echo ? auxLevels.echo : 0);
  }, [inputs.aux, auxSends, auxLevels, ready]);

  useEffect(() => {
    if (!ready) return;
    const musicEchoOn = musicSends.echo && !echo.direct;
    eng.setEchoSend(musicEchoOn ? echo.send : 0);
    // Every source (UI, Launchpad/MIDI and TAP) resolves to one target and one
    // tape-style transition. Set glide first so a simultaneous time change
    // cannot accidentally use the previous SLIDE value.
    eng.setEchoSlide(echo.slide);
    eng.setEchoTime(audibleEchoTime);
    eng.setEchoFeedback(echo.fb);
    eng.setEchoSat(echo.sat);
    eng.setEchoFilter(echo.filter);
    eng.setEchoFilterQ(echo.filterQ);
    if (eng.setEchoHP) eng.setEchoHP(echo.hpOn, echo.hp);
    // Return stays open even when send is cut, so the tail rings out naturally
    eng.setEchoReturn(echo.direct ? 0 : echo.dw);
    eng.setEchoType(echo.type);
    if (eng.setEchoWow) eng.setEchoWow(echo.wow);
    if (eng.setEchoRobotic) eng.setEchoRobotic(echo.robotic);
  }, [echo, audibleEchoTime, musicSends, ready]);

  useEffect(() => {
    if (!ready) return;
    if (dubFilter.on) {
      eng.setDubFilter(dubFilter.mode, dubFilter.cutoff, dubFilter.q);
      eng.setDubFilterRoute(dubFilter.route);
    } else {
      eng.setDubFilterRoute("off");
    }
    if (eng.setDubSweep) eng.setDubSweep(dubFilter.sweepRate, dubFilter.on ? dubFilter.sweep : 0);
  }, [dubFilter, ready]);

  useEffect(() => {
    if (!ready) return;
    eng.setSamplesHP(sampleFx.hp);
    eng.setSamplesEchoSend(sampleFx.echoSend);
    eng.setSamplesReverbSend(sampleFx.reverbSend);
    eng.setSamplesGain(sampleFx.gain);
    if (eng.setSamplesReverse) eng.setSamplesReverse(sampleFx.reverse);
  }, [sampleFx, ready]);

  useEffect(() => {
    if (!ready) return;
    eng.setMasterGain(master.dim ? master.gain * 0.1 : master.gain); // DIM = −20 dB
    eng.setMasterHP(master.hp);
    eng.setLimiterThreshold(master.limThresh);
    eng.setMasterLimEnabled(master.limOn);
    if (eng.setMasterMono) eng.setMasterMono(master.mono);
  }, [master, ready]);

  useEffect(() => {
    if (!ready) return;
    eng.setReverbLim(revLim.thresh, revLim.on);
  }, [revLim, ready]);

  useEffect(() => {
    if (!ready) return;
    eng.setEchoLim(echoLim.thresh, echoLim.on);
  }, [echoLim, ready]);

  useEffect(() => {
    if (!ready) return;
    if (eng.setCrossfadeCurve) eng.setCrossfadeCurve(crossfadeCurve);
    eng.setCrossfade(crossfade);
  }, [crossfade, crossfadeCurve, ready]);

  useEffect(() => {
    if (!ready) return;
    eng.deckA.gain.gain.setTargetAtTime(deckA.mute ? 0 : deckA.gain, eng.deckA.ctx.currentTime, 0.01);
    eng.deckA.setPan(deckA.pan);
    eng.deckA.setAutoGain(deckA.autoGain);
  }, [deckA.gain, deckA.pan, deckA.mute, deckA.autoGain, ready]);
  useEffect(() => {
    if (!ready) return;
    eng.deckB.gain.gain.setTargetAtTime(deckB.mute ? 0 : deckB.gain, eng.deckB.ctx.currentTime, 0.01);
    eng.deckB.setPan(deckB.pan);
    eng.deckB.setAutoGain(deckB.autoGain);
  }, [deckB.gain, deckB.pan, deckB.mute, deckB.autoGain, ready]);

  useEffect(() => {
    if (!ready) return;
    eng.siren.setPreset(siren.preset);
    eng.siren.setPitch(siren.pitch);
    eng.siren.setLfo1(siren.lfo1Rate, siren.lfo1Depth);
    eng.siren.setLfo2(siren.lfo2Rate, siren.lfo2Depth);
    eng.siren.setBits(siren.bits);
    eng.siren.setSR(siren.sr);
    eng.setSirenGain(siren.gain);
    eng.setSirenEchoSend(siren.echoSend);
    eng.setSirenReverbSend(siren.reverbSend);
    if (eng.setSirenAutoPan) eng.setSirenAutoPan(siren.autoPan);
  }, [siren, ready]);

  // meter loop
  useEffect(() => {
    if (!ready) return;
    let raf;
    let lastFrame = 0;
    let lastUiFrame = 0;
    const dataA = new Uint8Array(eng.deckA.analyser.fftSize);
    const dataB = new Uint8Array(eng.deckB.analyser.fftSize);
    const dataM = new Uint8Array(eng.masterAnalyser.fftSize);
    const lastTransport = { A: null, B: null };
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || now - lastFrame < METER_FRAME_MS) return;
      lastFrame = now;
      eng.deckA.analyser.getByteTimeDomainData(dataA);
      eng.deckB.analyser.getByteTimeDomainData(dataB);
      eng.masterAnalyser.getByteTimeDomainData(dataM);
      const rms = (data) => {
        let s = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          s += v * v;
        }
        return Math.sqrt(s / data.length);
      };
      if (now - lastUiFrame >= METER_UI_FRAME_MS) {
        lastUiFrame = now;
        const updateMeter = (setter, next, epsilon = 0.012) => {
          setter((previous) => Math.abs(previous - next) < epsilon ? previous : next);
        };
        updateMeter(setMeterA, Math.min(1, rms(dataA) * 3));
        updateMeter(setMeterB, Math.min(1, rms(dataB) * 3));
        updateMeter(setMeterMaster, Math.min(1, rms(dataM) * 3));
        // master peak (dBFS) with a slow decay for a readable peak-hold number
        let mpk = 0;
        for (let i = 0; i < dataM.length; i++) { const a = Math.abs((dataM[i] - 128) / 128); if (a > mpk) mpk = a; }
        const mpkDb = mpk > 0.0001 ? 20 * Math.log10(mpk) : -Infinity;
        setMasterPeakDb((prev) => {
          const decayed = (isFinite(prev) ? prev : -120) - 0.6;
          const next = mpkDb > decayed ? mpkDb : decayed;
          return Math.abs(next - prev) < 0.35 ? prev : next;
        });
        if (eng.getBandLevels) {
          const bl = eng.getBandLevels();
          const next = { sub: Math.min(1, bl.sub * 4), bass: Math.min(1, bl.bass * 4), mid: Math.min(1, bl.mid * 4), high: Math.min(1, bl.high * 4), top: Math.min(1, bl.top * 4) };
          setBandLevels((previous) => Object.keys(next).some((key) => Math.abs(previous[key] - next[key]) >= 0.012) ? next : previous);
        }
        if (eng.getInputLevels) {
          const il = eng.getInputLevels();
          const next = { in1: Math.min(1, il.in1 * 3), in2: Math.min(1, il.in2 * 3), aux: Math.min(1, il.aux * 3) };
          setInLevels((previous) => Object.keys(next).some((key) => Math.abs(previous[key] - next[key]) >= 0.012) ? next : previous);
        }
        if (eng.getSourceLevels) {
          const sl = eng.getSourceLevels();
          const next = {
            samples: Math.min(1, sl.samples * 3),
            siren: Math.min(1, sl.siren * 3),
            reverb: Math.min(1, sl.reverb * 3),
            echo: Math.min(1, sl.echo * 3),
          };
          setSourceLevels((previous) => Object.keys(next).some((key) => Math.abs(previous[key] - next[key]) >= 0.012) ? next : previous);
        }
        if (eng.getLimiterReduction) updateMeter(setGr, eng.getLimiterReduction(), 0.02);
      }
      // High-frequency transport data bypasses App state; the expanded deck
      // view subscribes to this small store while the rest of the rack stays
      // out of the reconciliation path.
      publishDeckTelemetry("A", {
        time: eng.deckA.getCurrentTime(), dur: eng.deckA.getDuration(),
        playing: eng.deckA.playing, cued: eng.deckA.hasCue(),
      });
      publishDeckTelemetry("B", {
        time: eng.deckB.getCurrentTime(), dur: eng.deckB.getDuration(),
        playing: eng.deckB.playing, cued: eng.deckB.hasCue(),
      });
      // Keep the non-expanded rack and playlist modal in sync with the engine
      // too. Transport actions are intentionally imperative, so relying only
      // on their click handlers left UI state stale after seek/auto-advance.
      for (const [key, deck, setter] of [["A", eng.deckA, setDeckA], ["B", eng.deckB, setDeckB]]) {
        const next = `${deck.playing ? 1 : 0}:${deck.hasCue() ? 1 : 0}:${deck.playlistIdx}:${deck.name}`;
        if (lastTransport[key] !== next) {
          lastTransport[key] = next;
          setter((state) => ({
            ...state,
            playing: deck.playing,
            cued: deck.hasCue(),
            playlistIdx: deck.playlistIdx,
            name: deck.name || state.name,
          }));
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready]);

  // Don't start file playback on a deck that's the live line-input source (it
  // would stack the buffer onto the live input at deck.input and mix).
  const playA = async () => { await init(); if (eng.canDeckPlay && !eng.canDeckPlay("A")) return; eng.deckA.playing ? eng.deckA.pause() : eng.deckA.play(); setDeckA((s) => ({ ...s, playing: eng.deckA.playing })); };
  const playB = async () => { await init(); if (eng.canDeckPlay && !eng.canDeckPlay("B")) return; eng.deckB.playing ? eng.deckB.pause() : eng.deckB.play(); setDeckB((s) => ({ ...s, playing: eng.deckB.playing })); };
  const stopA = () => { if (!eng.deckA) return; eng.deckA.stop(); setDeckA((s) => ({ ...s, playing: false, time: 0 })); };
  const stopB = () => { if (!eng.deckB) return; eng.deckB.stop(); setDeckB((s) => ({ ...s, playing: false, time: 0 })); };

  const triggerSample = (i) => {
    // Fire the sound synchronously inside the key/pointer handler when the engine
    // is already engaged (no await → no microtask delay). Only the very first
    // gesture pays the init() cost and plays once it resolves.
    if (eng.ctx && eng.samples) eng.samples.play(i, sampleFx.hold); // hold mode → momentary loop until release
    else init().then(() => { if (eng.samples) eng.samples.play(i, sampleFx.hold); });
    setSelectedSample(i); // the fired slot becomes the selection (kept after the flash clears)
    setFlashIdx(i);
    if (!sampleFx.hold) setTimeout(() => setFlashIdx((cur) => (cur === i ? -1 : cur)), 180);
  };
  const releaseSample = (i) => {
    if (!sampleFx.hold || !eng.samples) return;
    eng.samples.stop(i);
    setFlashIdx((cur) => (cur === i ? -1 : cur));
  };

  const triggerSirenDown = () => {
    if (eng.ctx && eng.siren) eng.siren.triggerOn();
    else init().then(() => { if (eng.siren) eng.siren.triggerOn(); });
    setSirenHeld(true);
  };
  const triggerSirenUp = () => {
    if (!eng.siren) return;
    eng.siren.triggerOff();
    setSirenHeld(false);
  };
  // legacy short pulse for keyboard
  const triggerSiren = () => {
    if (eng.ctx && eng.siren) eng.siren.trigger(800);
    else init().then(() => { if (eng.siren) eng.siren.trigger(800); });
  };

  const setManualEchoTime = (ms) => {
    // Turning a physical time control takes ownership from tempo sync. This
    // prevents the UI/MIDI/Launchpad position changing while the sound remains
    // locked to an unrelated synced value.
    setEcho((state) => ({
      ...state,
      time: ECHO_TIMING.clampMs(ms),
      sync: false,
    }));
  };
  const nudgeManualEchoTime = (factor) => {
    setEcho((state) => ({
      ...state,
      time: ECHO_TIMING.clampMs(ECHO_TIMING.resolved(state) * factor),
      sync: false,
    }));
  };
  const setEchoSyncMode = (enabled) => {
    setEcho((state) => {
      const sync = !!enabled;
      const time = sync
        ? ECHO_TIMING.synced(state.bpm, state.syncDiv)
        : ECHO_TIMING.resolved(state);
      return { ...state, sync, time };
    });
  };
  const setEchoSyncDivision = (syncDiv) => {
    setEcho((state) => ({
      ...state,
      syncDiv,
      time: state.sync ? ECHO_TIMING.synced(state.bpm, syncDiv) : state.time,
    }));
  };

  // tap tempo for echo
  const tapTempo = () => {
    const result = tapTrackerRef.current.tap(performance.now());
    if (!result.ready) return;
    const ms = Math.max(30, Math.min(1500, result.intervalMs));
    // A tap is one beat. The raw beat drives BPM while the manual delay stays
    // inside the echo's supported 30–1500 ms range.
    const bpm = Math.max(20, Math.min(400, Math.round(result.bpm)));
    setEcho((state) => ({
      ...state,
      bpm,
      time: state.sync ? ECHO_TIMING.synced(bpm, state.syncDiv) : ms,
    }));
  };

  const applyDubEchoPreset = () => {
    // Keep the performer's tapped tempo; only the musical division and sound
    // of the repeats are part of this quick starting point.
    setEcho((state) => {
      const next = { ...state, ...DUB_ECHO_START, bpm: state.bpm };
      return { ...next, time: ECHO_TIMING.synced(next.bpm, next.syncDiv) };
    });
  };

  const echoThrowDown = () => {
    if (echoThrowRestoreRef.current) return;
    echoThrowRestoreRef.current = {
      musicEcho: musicSends.echo,
      direct: echo.direct,
    };
    setEchoThrowHeld(true);
    setMusicSends(s => ({ ...s, echo: true }));
    if (echo.direct) setEcho(s => ({ ...s, direct: false }));
  };

  const echoThrowUp = () => {
    const previous = echoThrowRestoreRef.current;
    if (!previous) return;
    echoThrowRestoreRef.current = null;
    setEchoThrowHeld(false);
    setMusicSends(s => ({ ...s, echo: previous.musicEcho }));
    setEcho(s => ({ ...s, direct: previous.direct }));
  };

  const setEchoThrow = (pressed) => {
    if (pressed) echoThrowDown();
    else echoThrowUp();
  };

  // === Global presets — capture/restore the full console state ===
  const PRESET_KEY = "dubnator.preset.autoload.v1";
  const buildPreset = () => ({
    version: 3,
    geqA, geqB, paramA, kills, reverb, echo, master, dubFilter, sampleFx,
    sampleSlotBypass, siren, crossfade, crossfadeCurve, musicSends, auxSends, auxLevels, revLim, echoLim,
    advanced, eqSelect, rewindStop, deckEndMode, displayMode, specMode, specSource, logoAlpha, flatGain, killTrims, killQ, killFreqs, pureSub, view,
    deckA: { gain: deckA.gain, pan: deckA.pan, mute: deckA.mute, autoGain: deckA.autoGain, rewindLen: deckA.rewindLen },
    deckB: { gain: deckB.gain, pan: deckB.pan, mute: deckB.mute, autoGain: deckB.autoGain, rewindLen: deckB.rewindLen },
  });
  const applyPreset = (p) => {
    if (!p || typeof p !== "object") return;
    if (p.geqA) setGeqA(p.geqA);
    if (p.geqB) setGeqB(p.geqB);
    if (p.paramA) setParamA(p.paramA);
    if (p.kills) setKills(p.kills);
    // Merge onto current state so presets saved before a field existed (e.g.
    // echo.filterQ, reverb.bpFreq/bpQ/bpBypass) keep their defaults instead of
    // becoming undefined → NaN.
    if (p.reverb) setReverb((s) => ({ ...s, ...p.reverb }));
    if (p.echo) setEcho((s) => ({ ...s, ...p.echo }));
    // Merge onto current state (not wholesale replace) so a preset saved before
    // a field existed (master.hp, dubFilter.sweep, siren.autoPan, …) keeps its
    // default instead of becoming undefined → NaN/broken knob.
    if (p.master) setMaster((s) => ({ ...s, ...p.master }));
    if (p.dubFilter) setDubFilter((s) => ({ ...s, ...p.dubFilter }));
    if (p.sampleFx) setSampleFx((s) => ({ ...s, ...p.sampleFx }));
    if (Array.isArray(p.sampleSlotBypass)) setSampleSlotBypass(p.sampleSlotBypass);
    if (p.siren) setSiren((s) => ({ ...s, ...p.siren }));
    if (typeof p.crossfade === "number") setCrossfade(p.crossfade);
    if (typeof p.crossfadeCurve === "string") setCrossfadeCurve(p.crossfadeCurve);
    if (p.musicSends) setMusicSends(p.musicSends);
    if (p.auxSends) setAuxSends(p.auxSends);
    if (p.auxLevels) setAuxLevels((s) => ({ ...s, ...p.auxLevels }));
    if (p.revLim) setRevLim(p.revLim);
    if (p.echoLim) setEchoLim(p.echoLim);
    if (typeof p.advanced === "boolean") setAdvanced(p.advanced);
    if (typeof p.eqSelect === "string") setEqSelect(p.eqSelect);
    if (typeof p.rewindStop === "boolean") setRewindStop(p.rewindStop);
    if (DECK_END_MODES.includes(p.deckEndMode)) setDeckEndMode(p.deckEndMode);
    // Presets from the old AUTO:ON/OFF model migrate naturally: ON becomes
    // NEXT, while OFF becomes the new non-repeating STOP default.
    else if (typeof p.autoAdvance === "boolean") setDeckEndMode(p.autoAdvance ? "next" : "stop");
    if (typeof p.displayMode === "string") setDisplayMode(p.displayMode);
    if (typeof p.specMode === "string") setSpecMode(p.specMode);
    if (typeof p.specSource === "string") setSpecSource(p.specSource);
    if (typeof p.logoAlpha === "number") setLogoAlpha(p.logoAlpha);
    if (typeof p.flatGain === "number") setFlatGain(p.flatGain);
    if (p.killTrims && typeof p.killTrims === "object") setKillTrims({ sub: p.killTrims.sub || 0, bass: p.killTrims.bass || 0, mid: p.killTrims.mid || 0, high: p.killTrims.high || 0, top: p.killTrims.top || 0 });
    if (p.killQ && typeof p.killQ === "object") setKillQ({ bass: p.killQ.bass || 1.0, mid: p.killQ.mid || 0.9, high: p.killQ.high || 0.9 });
    if (p.killFreqs && typeof p.killFreqs === "object") setKillFreqs({ sub: p.killFreqs.sub || 80, bass: p.killFreqs.bass || 300, mid: p.killFreqs.mid || 1000, high: p.killFreqs.high || 3000, top: p.killFreqs.top || 8000 });
    if (typeof p.pureSub === "boolean") setPureSub(p.pureSub);
    if (p.view && typeof p.view === "object") setView({ hue: p.view.hue || 0, darkness: p.view.darkness || 0 });
    if (p.deckA) setDeckA((s) => ({ ...s, gain: p.deckA.gain ?? s.gain, pan: p.deckA.pan ?? s.pan, mute: p.deckA.mute ?? s.mute, autoGain: p.deckA.autoGain ?? s.autoGain, rewindLen: p.deckA.rewindLen ?? s.rewindLen }));
    if (p.deckB) setDeckB((s) => ({ ...s, gain: p.deckB.gain ?? s.gain, pan: p.deckB.pan ?? s.pan, mute: p.deckB.mute ?? s.mute, autoGain: p.deckB.autoGain ?? s.autoGain, rewindLen: p.deckB.rewindLen ?? s.rewindLen }));
  };
  const savePreset = () => {
    const preset = buildPreset();
    const json = JSON.stringify(preset, null, 2);
    // Persist so the console recalls this state on next launch (load-on-startup).
    try { localStorage.setItem(PRESET_KEY, json); } catch (_) {}
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "dubnator-preset.json"; a.click();
    URL.revokeObjectURL(url);
  };
  const loadPreset = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const p = JSON.parse(r.result);
        applyPreset(p);
        try { localStorage.setItem(PRESET_KEY, JSON.stringify(p)); } catch (_) {}
      } catch (err) { console.error("Bad preset", err); }
    };
    r.readAsText(f);
  };
  const factoryReset = () => {
    // Irreversible: clear the persisted preset and reload to factory defaults.
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Restore factory defaults? This cannot be undone.")) return;
    try { localStorage.removeItem(PRESET_KEY); } catch (_) {}
    window.location.reload();
  };
  // Load-on-startup: apply the last saved preset once the engine is ready.
  // Continuous auto-save of the full console state so the rack recalls the last
  // session on reload (not only explicitly-saved presets). A ref tracks the
  // latest buildPreset so the interval always serialises current state (a
  // closure set up once would capture stale state); only writes on change.
  const buildPresetRef = useRef(null);
  buildPresetRef.current = buildPreset;
  const lastSavedRef = useRef("");
  const autoloadedRef = useRef(false);
  // Auto-save only after a CLEAN restore (or when there's nothing saved). If the
  // saved preset is corrupt/unreadable we leave this false so the interval never
  // overwrites that (recoverable) data with current defaults.
  const autosaveOkRef = useRef(false);
  useEffect(() => {
    if (!ready || autoloadedRef.current) return;
    autoloadedRef.current = true;
    let saved = null;
    try { saved = localStorage.getItem(PRESET_KEY); } catch (_) {}
    if (!saved) { autosaveOkRef.current = true; return; } // nothing saved → safe to start saving
    try {
      applyPreset(JSON.parse(saved));
      lastSavedRef.current = saved;   // seed dedupe so we don't immediately rewrite the same state
      autosaveOkRef.current = true;   // clean restore → safe to auto-save
    } catch (_) {
      autosaveOkRef.current = false;  // corrupt → preserve it, don't clobber with defaults
    }
  }, [ready]);
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      if (!autosaveOkRef.current || !buildPresetRef.current) return;
      let json;
      try { json = JSON.stringify(buildPresetRef.current()); } catch (_) { return; }
      if (json === lastSavedRef.current) return;
      // setItem first, then update the dedupe ref — so a failed write (quota /
      // private mode) leaves lastSavedRef stale and is retried next tick.
      try { localStorage.setItem(PRESET_KEY, json); lastSavedRef.current = json; } catch (_) {}
    }, 2500);
    return () => clearInterval(id);
  }, [ready]);

  // === MIDI: register controls against the mapper once on mount ===
  const MIDI_KEY = "dubnator.midi.v1";
  useEffect(() => {
    const M = typeof window !== "undefined" && window.DubnatorMidi;
    if (!M) return;
    if (!mapperRef.current) mapperRef.current = new M.MidiMapper();
    const m = mapperRef.current;
    const LP = typeof window !== "undefined" && window.DubnatorLaunchpad;
    if (LP && !launchpadRef.current) {
      let launchpadOrientations = {};
      try {
        const stored = JSON.parse(localStorage.getItem("dubnator.launchpad.orientations.v1") || "{}");
        if (stored && typeof stored === "object" && !Array.isArray(stored)) launchpadOrientations = stored;
      } catch (_) {}
      launchpadRef.current = new LP.LaunchpadMiniMk3Manager({
        catalog: MIDI_CONTROLS,
        brightness: launchpadBrightness,
        orientations: launchpadOrientations,
        onControl: (id, value, event) => {
          const mapper = mapperRef.current;
          if (mapper) mapper.dispatch(id, value, event);
        },
        send: (outputId, message) => {
          const send = midiTransportRef.current.send;
          if (send) send(outputId, message);
        },
        onStatus: setLaunchpads,
        onRoleChange: ({ reversed }) => {
          setLaunchpadReversed(reversed);
          try { localStorage.setItem("dubnator.launchpad.reverse.v1", reversed ? "1" : "0"); } catch (_) {}
        },
        onOrientationChange: ({ orientations }) => {
          try { localStorage.setItem("dubnator.launchpad.orientations.v1", JSON.stringify(orientations)); } catch (_) {}
        },
      });
      try {
        const reversed = localStorage.getItem("dubnator.launchpad.reverse.v1") === "1";
        launchpadRef.current.setReverse(reversed);
        setLaunchpadReversed(reversed);
      } catch (_) {}
    }
    // All handlers use stable setters + functional updates → closure-safe.
    const H = {
      "master.gain": (v) => setMaster((s) => ({ ...s, gain: +(v * 1.5).toFixed(3) })),
      "master.lim": (v) => setMaster((s) => ({ ...s, limThresh: Math.round(-24 + v * 24) })),
      "xfade": (v) => setCrossfade(v),
      "kill.sub": (v) => setKills((s) => ({ ...s, sub: v > 0.5 })),
      "kill.bass": (v) => setKills((s) => ({ ...s, bass: v > 0.5 })),
      "kill.mid": (v) => setKills((s) => ({ ...s, mid: v > 0.5 })),
      "kill.high": (v) => setKills((s) => ({ ...s, high: v > 0.5 })),
      "kill.top": (v) => setKills((s) => ({ ...s, top: v > 0.5 })),
      "reverb.send": (v) => setReverb((s) => ({ ...s, send: v })),
      "reverb.ret": (v) => setReverb((s) => ({ ...s, ret: +(v * 1.5).toFixed(3) })),
      "echo.send": (v) => setEcho((s) => ({ ...s, send: v })),
      "echo.fb": (v) => setEcho((s) => ({ ...s, fb: +(v * 0.95).toFixed(3) })),
      "echo.time": (v) => setManualEchoTime(ECHO_TIMING.fromUnit(v)),
      "music.rev": (v) => setMusicSends((s) => ({ ...s, rev: v > 0.5 })),
      "music.echo": (v) => setMusicSends((s) => ({ ...s, echo: v > 0.5 })),
      "dubfilter.cutoff": (v) => setDubFilter((s) => ({ ...s, cutoff: Math.round(20 * Math.pow(1000, v)) })),
      "siren.gain": (v) => setSiren((s) => ({ ...s, gain: +(v * 1.2).toFixed(3) })),
      "samples.gain": (v) => setSampleFx((s) => ({ ...s, gain: v })),
      "echo.sat": (v) => setEcho((s) => ({ ...s, sat: v })),
      "echo.dw": (v) => setEcho((s) => ({ ...s, dw: v })),
      "echo.filterfreq": (v) => setEcho((s) => ({ ...s, filter: Math.round(120 * Math.pow(20000 / 120, v)) })),
      "echo.wow": (v) => setEcho((s) => ({ ...s, wow: v })),
      "echo.robotic": (v) => setEcho((s) => ({ ...s, robotic: v > 0.5 })),
      "reverb.room": (v) => setReverb((s) => ({ ...s, room: v })),
      "reverb.hfd": (v) => setReverb((s) => ({ ...s, hfd: v })),
      "reverb.predelay": (v) => setReverb((s) => ({ ...s, preDelay: Math.round(v * 200) })),
      "reverb.mod": (v) => setReverb((s) => ({ ...s, mod: v })),
      "reverb.freeze": (v) => setReverb((s) => ({ ...s, freeze: v > 0.5 })),
      "dubfilter.reso": (v) => setDubFilter((s) => ({ ...s, q: +(0.5 + v * 11.5).toFixed(2) })),
      "dubfilter.sweep": (v) => setDubFilter((s) => ({ ...s, sweep: v })),
      "dubfilter.on": (v) => setDubFilter((s) => ({ ...s, on: v > 0.5 })),
      "siren.pitch": (v) => setSiren((s) => ({ ...s, pitch: Math.round(50 * Math.pow(2000 / 50, v)) })),
      "siren.pan": (v) => setSiren((s) => ({ ...s, autoPan: v })),
      "samples.rev": (v) => setSampleFx((s) => ({ ...s, reverbSend: v })),
      "samples.echo": (v) => setSampleFx((s) => ({ ...s, echoSend: v })),
      "deckA.play": (v) => { if (v > 0.5) playA(); },
      "deckB.play": (v) => { if (v > 0.5) playB(); },
      "deckA.stop": (v) => { if (v > 0.5) stopA(); },
      "deckB.stop": (v) => { if (v > 0.5) stopB(); },
      "deckA.next": (v) => { if (v > 0.5) nextTrackA(); },
      "deckA.prev": (v) => { if (v > 0.5) prevTrackA(); },
      "deckB.next": (v) => { if (v > 0.5) nextTrackB(); },
      "deckB.prev": (v) => { if (v > 0.5) prevTrackB(); },
      "deckA.rewind": (v) => { if (v > 0.5) rewindA(); },
      "deckB.rewind": (v) => { if (v > 0.5) rewindB(); },
      "master.mono": (v) => setMaster((s) => ({ ...s, mono: v > 0.5 })),
      "master.dim": (v) => setMaster((s) => ({ ...s, dim: v > 0.5 })),
      "pure.sub": (v) => setPureSub(v > 0.5),
      "echo.sync": (v) => setEchoSyncMode(v > 0.5),
      "reverb.dw": (v) => setReverb((s) => ({ ...s, dw: v })),
      "siren.lfo1rate": (v) => setSiren((s) => ({ ...s, lfo1Rate: +(v * 15).toFixed(2) })),
      "siren.lfo1depth": (v) => setSiren((s) => ({ ...s, lfo1Depth: Math.round(v * 400) })),
      "siren.lfo2rate": (v) => setSiren((s) => ({ ...s, lfo2Rate: +(v * 15).toFixed(2) })),
      "siren.lfo2depth": (v) => setSiren((s) => ({ ...s, lfo2Depth: Math.round(v * 400) })),
      "siren.bits": (v) => setSiren((s) => ({ ...s, bits: Math.round(2 + v * 14) })),
      "siren.sr": (v) => setSiren((s) => ({ ...s, sr: v })),
      "aux.revlevel": (v) => setAuxLevels((s) => ({ ...s, rev: v })),
      "aux.echolevel": (v) => setAuxLevels((s) => ({ ...s, echo: v })),
      "deckA.cue": (v) => { if (v > 0.5) { eng.deckA.setCue(); setDeckA((s) => ({ ...s, cued: true })); } },
      "deckA.jumpcue": (v) => { if (v > 0.5) eng.deckA.jumpToCue(); },
      "deckB.cue": (v) => { if (v > 0.5) { eng.deckB.setCue(); setDeckB((s) => ({ ...s, cued: true })); } },
      "deckB.jumpcue": (v) => { if (v > 0.5) eng.deckB.jumpToCue(); },
      // round 3 — deck/input levels, EQ bands, FX trims
      "deckA.gain": (v) => setDeckA((s) => ({ ...s, gain: +(v * 1.5).toFixed(3) })),
      "deckA.pan": (v) => setDeckA((s) => ({ ...s, pan: +((v - 0.5) * 2).toFixed(2) })),
      "deckB.gain": (v) => setDeckB((s) => ({ ...s, gain: +(v * 1.5).toFixed(3) })),
      "deckB.pan": (v) => setDeckB((s) => ({ ...s, pan: +((v - 0.5) * 2).toFixed(2) })),
      "in1.gain": (v) => setInputs((s) => ({ ...s, in1: { ...s.in1, gain: +(v * 1.5).toFixed(3) } })),
      "in2.gain": (v) => setInputs((s) => ({ ...s, in2: { ...s.in2, gain: +(v * 1.5).toFixed(3) } })),
      "aux.gain": (v) => setInputs((s) => ({ ...s, aux: { ...s.aux, gain: +(v * 1.5).toFixed(3) } })),
      "aux.hp": (v) => setInputs((s) => ({ ...s, aux: { ...s.aux, hp: Math.round(20 * Math.pow(100, v)) } })),
      "echo.filterq": (v) => setEcho((s) => ({ ...s, filterQ: +(0.3 + v * 11.7).toFixed(2) })),
      "echo.slide": (v) => setEcho((s) => ({ ...s, slide: v })),
      "reverb.bpfreq": (v) => setReverb((s) => ({ ...s, bpFreq: Math.round(80 * Math.pow(225, v)) })),
      "reverb.bpq": (v) => setReverb((s) => ({ ...s, bpQ: +(0.3 + v * 11.7).toFixed(2) })),
      "dubfilter.sweeprate": (v) => setDubFilter((s) => ({ ...s, sweepRate: +(0.05 + v * 7.95).toFixed(2) })),
      "master.hp": (v) => setMaster((s) => ({ ...s, hp: Math.round(20 + v * 380) })),
      "samples.hp": (v) => setSampleFx((s) => ({ ...s, hp: Math.round(20 + v * 1980) })),
      "siren.revsend": (v) => setSiren((s) => ({ ...s, reverbSend: v })),
      "siren.echosend": (v) => setSiren((s) => ({ ...s, echoSend: v })),
      "deckA.mute": (v) => setDeckA((s) => ({ ...s, mute: v > 0.5 })),
      "deckA.rewindlen": (v) => setDeckA((s) => ({ ...s, rewindLen: +(0.5 + v * 19.5).toFixed(1) })),
      "deckA.autogain": (v) => setDeckA((s) => ({ ...s, autoGain: v > 0.5 })),
      "deckA.loop.in": (v) => { if (v > 0.5) actionsRef.current.deckLoop?.("A", "in"); },
      "deckA.loop.out": (v) => { if (v > 0.5) actionsRef.current.deckLoop?.("A", "out"); },
      "deckA.loop.clear": (v) => { if (v > 0.5) actionsRef.current.deckLoop?.("A", "clear"); },
      "deckA.loop.beat1": (v) => { if (v > 0.5) actionsRef.current.deckLoop?.("A", "beat", 1); },
      "deckA.loop.beat2": (v) => { if (v > 0.5) actionsRef.current.deckLoop?.("A", "beat", 2); },
      "deckA.loop.beat4": (v) => { if (v > 0.5) actionsRef.current.deckLoop?.("A", "beat", 4); },
      "deckA.loop.half": (v) => { if (v > 0.5) actionsRef.current.deckLoop?.("A", "half"); },
      "deckA.loop.double": (v) => { if (v > 0.5) actionsRef.current.deckLoop?.("A", "double"); },
      "deckB.mute": (v) => setDeckB((s) => ({ ...s, mute: v > 0.5 })),
      "deckB.rewindlen": (v) => setDeckB((s) => ({ ...s, rewindLen: +(0.5 + v * 19.5).toFixed(1) })),
      "deckB.autogain": (v) => setDeckB((s) => ({ ...s, autoGain: v > 0.5 })),
      "deckB.loop.in": (v) => { if (v > 0.5) actionsRef.current.deckLoop?.("B", "in"); },
      "deckB.loop.out": (v) => { if (v > 0.5) actionsRef.current.deckLoop?.("B", "out"); },
      "deckB.loop.clear": (v) => { if (v > 0.5) actionsRef.current.deckLoop?.("B", "clear"); },
      "deckB.loop.beat1": (v) => { if (v > 0.5) actionsRef.current.deckLoop?.("B", "beat", 1); },
      "deckB.loop.beat2": (v) => { if (v > 0.5) actionsRef.current.deckLoop?.("B", "beat", 2); },
      "deckB.loop.beat4": (v) => { if (v > 0.5) actionsRef.current.deckLoop?.("B", "beat", 4); },
      "deckB.loop.half": (v) => { if (v > 0.5) actionsRef.current.deckLoop?.("B", "half"); },
      "deckB.loop.double": (v) => { if (v > 0.5) actionsRef.current.deckLoop?.("B", "double"); },
      "in1.mute": (v) => setInputs((s) => ({ ...s, in1: { ...s.in1, mute: v > 0.5 } })),
      "in1.pan": (v) => setInputs((s) => ({ ...s, in1: { ...s.in1, pan: +((v - 0.5) * 2).toFixed(2) } })),
      "in2.mute": (v) => setInputs((s) => ({ ...s, in2: { ...s.in2, mute: v > 0.5 } })),
      "in2.pan": (v) => setInputs((s) => ({ ...s, in2: { ...s.in2, pan: +((v - 0.5) * 2).toFixed(2) } })),
      "aux.mute": (v) => setInputs((s) => ({ ...s, aux: { ...s.aux, mute: v > 0.5 } })),
      "aux.rev": (v) => setAuxSends((s) => ({ ...s, rev: v > 0.5 })),
      "aux.echo": (v) => setAuxSends((s) => ({ ...s, echo: v > 0.5 })),
      "xfade.a": (v) => { if (v > 0.5) setCrossfade(0); },
      "xfade.center": (v) => { if (v > 0.5) setCrossfade(0.5); },
      "xfade.b": (v) => { if (v > 0.5) setCrossfade(1); },
      "xfade.curve.power": (v) => { if (v > 0.5) setCrossfadeCurve("power"); },
      "xfade.curve.linear": (v) => { if (v > 0.5) setCrossfadeCurve("linear"); },
      "xfade.curve.sharp": (v) => { if (v > 0.5) setCrossfadeCurve("sharp"); },
      "flat.gain": (v) => {
        const db = +(-24 + v * 36).toFixed(1);
        setFlatGain(Math.min(liveStateRef.current.advanced ? 12 : 0, db));
      },
      "reverb.bp": (v) => setReverb((s) => ({ ...s, bpBypass: !(v > 0.5) })),
      "echo.type1": (v) => { if (v > 0.5) setEcho((s) => ({ ...s, type: 1 })); },
      "echo.type2": (v) => { if (v > 0.5) setEcho((s) => ({ ...s, type: 2 })); },
      "echo.tap": (v) => { if (v > 0.5) actionsRef.current.tapTempo?.(); },
      "echo.dub": (v) => { if (v > 0.5) actionsRef.current.echoDub?.(); },
      "echo.throw": (v) => actionsRef.current.echoThrow?.(v > 0.5),
      "echo.div": (v) => setEchoSyncDivision(["1/4", "1/4.", "1/4t", "1/8", "1/8.", "1/8t", "1/16", "1/16t"][Math.min(7, Math.round(v * 7))]),
      "echo.hp": (v) => setEcho((s) => ({ ...s, hpOn: v > 0.5 })),
      "echo.panic": (v) => { if (v > 0.5 && eng.panicFX) eng.panicFX(); },
      "dubfilter.hp": (v) => { if (v > 0.5) setDubFilter((s) => ({ ...s, on: true, mode: "hp" })); },
      "dubfilter.lp": (v) => { if (v > 0.5) setDubFilter((s) => ({ ...s, on: true, mode: "lp" })); },
      "dubfilter.route.music": (v) => { if (v > 0.5) setDubFilter((s) => ({ ...s, route: "music", on: true })); },
      "dubfilter.route.master": (v) => { if (v > 0.5) setDubFilter((s) => ({ ...s, route: "master", on: true })); },
      "dubfilter.route.samples": (v) => { if (v > 0.5) setDubFilter((s) => ({ ...s, route: "samples", on: true })); },
      "dubfilter.route.off": (v) => { if (v > 0.5) setDubFilter((s) => ({ ...s, route: "off", on: false })); },
      "siren.trigger": (v) => actionsRef.current.sirenTrigger?.(v > 0.5),
      "siren.preset": (v) => actionsRef.current.sirenPreset?.(Math.round(v * 11)),
      "siren.prev": (v) => { if (v > 0.5) setSiren((s) => stepSirenPreset(s, -1)); },
      "siren.next": (v) => { if (v > 0.5) setSiren((s) => stepSirenPreset(s, 1)); },
      "samples.select": (v) => setSelectedSample(Math.round(v * 11)),
      "samples.hold": (v) => setSampleFx((s) => ({ ...s, hold: v > 0.5 })),
      "samples.reverse": (v) => setSampleFx((s) => ({ ...s, reverse: v > 0.5 })),
      "limiter.master.on": (v) => setMaster((s) => ({ ...s, limOn: v > 0.5 })),
      "limiter.reverb.thresh": (v) => setRevLim((s) => ({ ...s, thresh: Math.round(-24 + v * 24) })),
      "limiter.reverb.on": (v) => setRevLim((s) => ({ ...s, on: v > 0.5 })),
      "limiter.echo.thresh": (v) => setEchoLim((s) => ({ ...s, thresh: Math.round(-24 + v * 24) })),
      "limiter.echo.on": (v) => setEchoLim((s) => ({ ...s, on: v > 0.5 })),
      "recorder.toggle": (v) => { if (v > 0.5) actionsRef.current.toggleRecord?.(); },
      "recorder.format": (v) => { if (v > 0.5) setRecFormat((format) => format === "wav" ? "aiff" : "wav"); },
      "system.advanced": (v) => setAdvanced(v > 0.5),
      // Keep the historical control id so existing MIDI bindings continue to
      // work; it is now a three-zone STOP / LOOP / NEXT selector.
      "system.autoadvance": (v) => setDeckEndMode(deckEndModeFromValue(v)),
      "system.rewindstop": (v) => setRewindStop(v > 0.5),
      "system.mic": (v) => { if (v > 0.5) actionsRef.current.toggleMic?.(); },
      "system.line": (v) => { if (v > 0.5) actionsRef.current.toggleLine?.(); },
      "system.multi": (v) => { if (v > 0.5) actionsRef.current.toggleMulti?.(); },
      ...Object.fromEntries(FREQS_10.map((f, i) => [`geqA.${i}`, (v) => setGeqA((a) => a.map((x, j) => j === i ? +((v - 0.5) * 24).toFixed(1) : x))])),
      ...Object.fromEntries([0, 1, 2, 3].flatMap((i) => [
        [`paramA${i}.freq`, (v) => setParamA((a) => a.map((b, j) => j === i ? { ...b, freq: Math.round(20 * Math.pow(1000, v)) } : b))],
        [`paramA${i}.q`, (v) => setParamA((a) => a.map((b, j) => j === i ? { ...b, q: +(0.1 + v * 9.9).toFixed(2) } : b))],
        [`paramA${i}.gain`, (v) => setParamA((a) => a.map((b, j) => j === i ? { ...b, gain: +((v - 0.5) * 36).toFixed(1) } : b))],
      ])),
      ...Object.fromEntries(["sub", "bass", "mid", "high", "top"].flatMap((band) => [
        [`kill.${band}.solo`, (v) => {
          if (v <= 0.5) return;
          setKills((current) => {
            const bands = ["sub", "bass", "mid", "high", "top"];
            const soloed = !current[band] && bands.filter((item) => item !== band).every((item) => current[item]);
            return Object.fromEntries(bands.map((item) => [item, soloed ? false : item !== band]));
          });
        }],
        [`kill.${band}.trim`, (v) => setKillTrims((current) => ({
          ...current,
          [band]: Math.min(liveStateRef.current.advanced ? 12 : 0, +(-70 + v * 82).toFixed(1)),
        }))],
        [`kill.${band}.freq`, (v) => {
          const [min, max] = KILL_FREQ_RANGE[band];
          setKillFreqs((current) => ({ ...current, [band]: Math.round(min + v * (max - min)) }));
        }],
      ])),
      ...Object.fromEntries(["bass", "mid", "high"].map((band) => [
        `kill.${band}.q`,
        (v) => setKillQ((current) => ({ ...current, [band]: +(0.3 + v * 9.7).toFixed(2) })),
      ])),
      ...Object.fromEntries(Array.from({ length: 12 }, (_, index) => [
        `samples.trigger.${index}`,
        (v) => actionsRef.current.sampleTrigger?.(index, v > 0.5),
      ])),
    };
    // skip any control without a handler (defensive — keeps a typo from passing
    // an undefined handler to register, which would crash when that key fires)
    MIDI_CONTROLS.forEach((c) => { const h = H[c.id]; if (h) m.register(c.id, h, { type: c.type, momentary: c.momentary === true }); });
    try { const saved = localStorage.getItem(MIDI_KEY); if (saved) m.load(JSON.parse(saved)); } catch (_) {}
    m.onChange = () => {
      const ser = m.serialize();
      setMidiBindings(ser.bindings);
      setMidiModes(ser.modes || {});
      setMidiLearnId(null);
      try { localStorage.setItem(MIDI_KEY, JSON.stringify(ser)); } catch (_) {}
    };
    const ser0 = m.serialize();
    setMidiBindings(ser0.bindings);
    setMidiModes(ser0.modes || {});
  }, []);

  const refreshMidiPermission = async () => {
    if (typeof window !== "undefined" && window.__TAURI__) {
      setMidiPermission("native");
      return "native";
    }
    if (typeof navigator === "undefined" || !navigator.requestMIDIAccess) {
      setMidiPermission("unsupported");
      return "unsupported";
    }
    if (!navigator.permissions?.query) {
      setMidiPermission("unknown");
      return "unknown";
    }
    try {
      const permission = await navigator.permissions.query({ name: "midi", sysex: true });
      setMidiPermission(permission.state);
      permission.onchange = () => setMidiPermission(permission.state);
      return permission.state;
    } catch (_) {
      // Older Chromium builds expose Web MIDI but not its Permissions API
      // descriptor. ENABLE MIDI still performs the authoritative request.
      setMidiPermission("unknown");
      return "unknown";
    }
  };

  useEffect(() => {
    if (midiOpen) refreshMidiPermission();
  }, [midiOpen]);

  const connectMidi = async () => {
    const m = mapperRef.current; if (!m) return;
    if (midiConnectingRef.current) return;
    midiConnectingRef.current = true;
    setMidiErr("");
    setMidiPermission(window.__TAURI__ ? "native" : "requesting");
    try {
      const routeMessage = (payload) => {
        const surface = launchpadRef.current;
        if (surface && surface.handleMidi(payload)) return true;
        const mapper = mapperRef.current;
        if (mapper) mapper.handleMessage(payload && payload.data ? payload.data : payload);
        return false;
      };
      const attachPorts = (ports) => {
        const surface = launchpadRef.current;
        if (surface) {
          surface.setPorts(ports);
          if (surface.lastPortsChanged) surface.animateConnect();
        }
      };

      // Desktop (Tauri): WKWebView/WebKitGTK have no Web MIDI, so controllers
      // and LED output use the native Rust bridge.
      const tauri = typeof window !== "undefined" && window.__TAURI__;
      if (tauri) {
        if (!window.__dubMidiBridge) {
          window.__dubMidiBridge = await tauri.event.listen("midi", (e) => routeMessage(e.payload));
        }
        const queues = new Map();
        midiTransportRef.current.send = (outputId, message) => {
          const previous = queues.get(outputId) || Promise.resolve();
          const next = previous
            .catch(() => {})
            .then(() => tauri.core.invoke("send_midi", { outputId, message: Array.from(message) }))
            .catch((error) => console.error("MIDI output failed", error));
          queues.set(outputId, next);
        };
        const ports = await tauri.core.invoke("connect_midi");
        attachPorts(ports);
        const names = (ports.inputs || []).map((port) => port.name);
        setMidiInputs(names);
        midiConnectedRef.current = true;
        setMidiPermission("native");
        if (!names.length) setMidiErr("No MIDI inputs detected. Connect a controller and retry.");
        return;
      }
      midiTransportRef.current.send = (outputId, message) => {
        try { m.sendWebMidi(outputId, message); }
        catch (error) { console.error("MIDI output failed", error); }
      };
      const names = await m.connectWebMidi(undefined, {
        sysex: true,
        onMessage: routeMessage,
        onPorts: attachPorts,
      });
      setMidiInputs(names);
      midiConnectedRef.current = true;
      setMidiPermission("granted");
      if (!names.length) setMidiErr("No MIDI inputs detected. Connect a controller and retry.");
    } catch (e) {
      const denied = e?.name === "NotAllowedError" || e?.name === "SecurityError";
      const unsupported = e?.name === "NotSupportedError";
      setMidiPermission(denied ? "denied" : unsupported ? "unsupported" : "unknown");
      setMidiErr(denied
        ? "MIDI is blocked for this site. In Arc: Site Controls → Site settings → MIDI devices → Allow, then reload."
        : (e && e.message ? e.message : "MIDI unavailable"));
    } finally {
      midiConnectingRef.current = false;
    }
  };
  const swapLaunchpads = () => {
    const reversed = !launchpadReversed;
    setLaunchpadReversed(reversed);
    if (launchpadRef.current) launchpadRef.current.setReverse(reversed);
    try { localStorage.setItem("dubnator.launchpad.reverse.v1", reversed ? "1" : "0"); } catch (_) {}
  };
  const changeLaunchpadBrightness = (value) => {
    const next = Math.max(0, Math.min(127, Math.round(Number(value))));
    setLaunchpadBrightness(next);
    if (launchpadRef.current) launchpadRef.current.setBrightness(next);
    try { localStorage.setItem(LAUNCHPAD_BRIGHTNESS_KEY, String(next)); } catch (_) {}
  };
  const selectLaunchpadHelpPage = (role, page) => {
    if (launchpadRef.current) launchpadRef.current.selectPage(role, page, "help");
  };
  const selectLaunchpadHelpRole = (role) => {
    if (launchpadRef.current) launchpadRef.current.setSingleRole(role, "help");
  };
  const toggleLaunchpadOrientation = (inputId) => {
    const manager = launchpadRef.current;
    const device = manager?.getStatus().find((candidate) => candidate.inputId === inputId);
    if (!device) return;
    manager.setOrientation(inputId, device.rotated ? "straight" : "ccw", "ui");
  };
  // Current 0..1 value of each MIDI control (inverse of the H setters), used to
  // seed pickup so a physical knob doesn't jump the software value on first move.
  const midiValues01 = () => {
    const clamp = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
    return {
      "master.gain": clamp(master.gain / 1.5),
      "master.lim": clamp((master.limThresh + 24) / 24),
      "xfade": clamp(crossfade),
      "kill.sub": kills.sub ? 1 : 0, "kill.bass": kills.bass ? 1 : 0,
      "kill.mid": kills.mid ? 1 : 0, "kill.high": kills.high ? 1 : 0, "kill.top": kills.top ? 1 : 0,
      "reverb.send": clamp(reverb.send), "reverb.ret": clamp(reverb.ret / 1.5),
      "echo.send": clamp(echo.send), "echo.fb": clamp(echo.fb / 0.95),
      "echo.time": clamp(ECHO_TIMING.toUnit(audibleEchoTime)),
      "music.rev": musicSends.rev ? 1 : 0, "music.echo": musicSends.echo ? 1 : 0,
      "dubfilter.cutoff": clamp(Math.log(dubFilter.cutoff / 20) / Math.log(1000)),
      "siren.gain": clamp(siren.gain / 1.2), "samples.gain": clamp(sampleFx.gain),
      "echo.sat": clamp(echo.sat), "echo.dw": clamp(echo.dw),
      "echo.filterfreq": clamp(Math.log(echo.filter / 120) / Math.log(20000 / 120)),
      "echo.wow": clamp(echo.wow), "echo.robotic": echo.robotic ? 1 : 0,
      "reverb.room": clamp(reverb.room), "reverb.hfd": clamp(reverb.hfd),
      "reverb.predelay": clamp(reverb.preDelay / 200), "reverb.mod": clamp(reverb.mod),
      "reverb.freeze": reverb.freeze ? 1 : 0,
      "dubfilter.reso": clamp((dubFilter.q - 0.5) / 11.5), "dubfilter.sweep": clamp(dubFilter.sweep),
      "dubfilter.on": dubFilter.on ? 1 : 0,
      "siren.pitch": clamp(Math.log(siren.pitch / 50) / Math.log(2000 / 50)),
      "siren.pan": clamp(siren.autoPan),
      "samples.rev": clamp(sampleFx.reverbSend), "samples.echo": clamp(sampleFx.echoSend),
      // Transport triggers seed their useful feedback state; one-shot actions
      // remain zero while Play and Cue mirror the deck.
      "deckA.play": deckA.playing ? 1 : 0, "deckB.play": deckB.playing ? 1 : 0,
      "deckA.stop": 0, "deckB.stop": 0,
      "deckA.next": 0, "deckA.prev": 0, "deckB.next": 0, "deckB.prev": 0,
      "deckA.rewind": 0, "deckB.rewind": 0,
      "master.mono": master.mono ? 1 : 0, "master.dim": master.dim ? 1 : 0,
      "pure.sub": pureSub ? 1 : 0, "echo.sync": echo.sync ? 1 : 0,
      "reverb.dw": clamp(reverb.dw),
      "siren.lfo1rate": clamp(siren.lfo1Rate / 15), "siren.lfo1depth": clamp(siren.lfo1Depth / 400),
      "siren.lfo2rate": clamp(siren.lfo2Rate / 15), "siren.lfo2depth": clamp(siren.lfo2Depth / 400),
      "siren.bits": clamp((siren.bits - 2) / 14), "siren.sr": clamp(siren.sr),
      "aux.revlevel": clamp(auxLevels.rev), "aux.echolevel": clamp(auxLevels.echo),
      "deckA.cue": deckA.cued ? 1 : 0, "deckA.jumpcue": 0,
      "deckB.cue": deckB.cued ? 1 : 0, "deckB.jumpcue": 0,
      "deckA.gain": clamp(deckA.gain / 1.5), "deckA.pan": clamp(deckA.pan / 2 + 0.5),
      "deckB.gain": clamp(deckB.gain / 1.5), "deckB.pan": clamp(deckB.pan / 2 + 0.5),
      "in1.gain": clamp(inputs.in1.gain / 1.5), "in2.gain": clamp(inputs.in2.gain / 1.5),
      "aux.gain": clamp(inputs.aux.gain / 1.5),
      "aux.hp": clamp(Math.log(inputs.aux.hp / 20) / Math.log(100)),
      "echo.filterq": clamp((echo.filterQ - 0.3) / 11.7), "echo.slide": clamp(echo.slide),
      "reverb.bpfreq": clamp(Math.log(reverb.bpFreq / 80) / Math.log(225)),
      "reverb.bpq": clamp((reverb.bpQ - 0.3) / 11.7),
      "dubfilter.sweeprate": clamp((dubFilter.sweepRate - 0.05) / 7.95),
      "master.hp": clamp((master.hp - 20) / 380), "samples.hp": clamp((sampleFx.hp - 20) / 1980),
      "siren.revsend": clamp(siren.reverbSend), "siren.echosend": clamp(siren.echoSend),
      "deckA.mute": deckA.mute ? 1 : 0,
      "deckA.rewindlen": clamp((deckA.rewindLen - 0.5) / 19.5),
      "deckA.autogain": deckA.autoGain ? 1 : 0,
      "deckA.loop.in": 0, "deckA.loop.out": 0,
      "deckA.loop.clear": deckA.loopOn ? 1 : 0,
      "deckA.loop.beat1": 0, "deckA.loop.beat2": 0, "deckA.loop.beat4": 0,
      "deckA.loop.half": 0, "deckA.loop.double": 0,
      "deckB.mute": deckB.mute ? 1 : 0,
      "deckB.rewindlen": clamp((deckB.rewindLen - 0.5) / 19.5),
      "deckB.autogain": deckB.autoGain ? 1 : 0,
      "deckB.loop.in": 0, "deckB.loop.out": 0,
      "deckB.loop.clear": deckB.loopOn ? 1 : 0,
      "deckB.loop.beat1": 0, "deckB.loop.beat2": 0, "deckB.loop.beat4": 0,
      "deckB.loop.half": 0, "deckB.loop.double": 0,
      "in1.mute": inputs.in1.mute ? 1 : 0, "in1.pan": clamp(inputs.in1.pan / 2 + 0.5),
      "in2.mute": inputs.in2.mute ? 1 : 0, "in2.pan": clamp(inputs.in2.pan / 2 + 0.5),
      "aux.mute": inputs.aux.mute ? 1 : 0,
      "aux.rev": auxSends.rev ? 1 : 0, "aux.echo": auxSends.echo ? 1 : 0,
      "xfade.a": crossfade <= 0.01 ? 1 : 0,
      "xfade.center": Math.abs(crossfade - 0.5) <= 0.01 ? 1 : 0,
      "xfade.b": crossfade >= 0.99 ? 1 : 0,
      "xfade.curve.power": crossfadeCurve === "power" ? 1 : 0,
      "xfade.curve.linear": crossfadeCurve === "linear" ? 1 : 0,
      "xfade.curve.sharp": crossfadeCurve === "sharp" ? 1 : 0,
      "flat.gain": clamp((flatGain + 24) / 36),
      "reverb.bp": reverb.bpBypass ? 0 : 1,
      "echo.type1": echo.type === 1 ? 1 : 0, "echo.type2": echo.type === 2 ? 1 : 0,
      "echo.tap": 0, "echo.dub": 0, "echo.throw": echoThrowHeld ? 1 : 0,
      "echo.div": clamp((echo.syncDiv === "1/4" ? 0 : echo.syncDiv === "1/4." ? 1 : echo.syncDiv === "1/4t" ? 2 : echo.syncDiv === "1/8" ? 3 : echo.syncDiv === "1/8." ? 4 : echo.syncDiv === "1/8t" ? 5 : echo.syncDiv === "1/16" ? 6 : 7) / 7),
      "echo.hp": echo.hpOn ? 1 : 0, "echo.panic": 0,
      "dubfilter.hp": dubFilter.on && dubFilter.mode === "hp" ? 1 : 0,
      "dubfilter.lp": dubFilter.on && dubFilter.mode === "lp" ? 1 : 0,
      "dubfilter.route.music": dubFilter.route === "music" ? 1 : 0,
      "dubfilter.route.master": dubFilter.route === "master" ? 1 : 0,
      "dubfilter.route.samples": dubFilter.route === "samples" ? 1 : 0,
      "dubfilter.route.off": !dubFilter.on || dubFilter.route === "off" ? 1 : 0,
      "siren.trigger": sirenHeld ? 1 : 0,
      "siren.preset": clamp(siren.preset / 11),
      "siren.prev": 0, "siren.next": 0,
      "samples.select": clamp(selectedSample / 11),
      "samples.hold": sampleFx.hold ? 1 : 0,
      "samples.reverse": sampleFx.reverse ? 1 : 0,
      "limiter.master.on": master.limOn ? 1 : 0,
      "limiter.reverb.thresh": clamp((revLim.thresh + 24) / 24),
      "limiter.reverb.on": revLim.on ? 1 : 0,
      "limiter.echo.thresh": clamp((echoLim.thresh + 24) / 24),
      "limiter.echo.on": echoLim.on ? 1 : 0,
      "recorder.toggle": recording ? 1 : 0,
      "recorder.format": recFormat === "aiff" ? 1 : 0,
      "system.advanced": advanced ? 1 : 0,
      "system.autoadvance": deckEndModeValue(deckEndMode),
      "system.rewindstop": rewindStop ? 1 : 0,
      "system.mic": micOn ? 1 : 0,
      "system.line": lineOn ? 1 : 0,
      "system.multi": multiOn ? 1 : 0,
      ...Object.fromEntries(FREQS_10.map((f, i) => [`geqA.${i}`, clamp(geqA[i] / 24 + 0.5)])),
      ...Object.fromEntries([0, 1, 2, 3].flatMap((i) => [
        [`paramA${i}.freq`, clamp(Math.log(paramA[i].freq / 20) / Math.log(1000))],
        [`paramA${i}.q`, clamp((paramA[i].q - 0.1) / 9.9)],
        [`paramA${i}.gain`, clamp(paramA[i].gain / 36 + 0.5)],
      ])),
      ...Object.fromEntries(["sub", "bass", "mid", "high", "top"].flatMap((band) => [
        [`kill.${band}.solo`, isSoloed(band) ? 1 : 0],
        // Preserve the stored trim, but make the hardware fader mirror the
        // effective cut while KILL is engaged. Releasing KILL restores it.
        [`kill.${band}.trim`, kills[band] ? 0 : clamp((killTrims[band] + 70) / 82)],
        [`kill.${band}.freq`, clamp((killFreqs[band] - KILL_FREQ_RANGE[band][0]) / (KILL_FREQ_RANGE[band][1] - KILL_FREQ_RANGE[band][0]))],
      ])),
      ...Object.fromEntries(["bass", "mid", "high"].map((band) => [
        `kill.${band}.q`,
        clamp((killQ[band] - 0.3) / 9.7),
      ])),
      ...Object.fromEntries(Array.from({ length: 12 }, (_, index) => [
        `samples.trigger.${index}`,
        flashIdx === index ? 1 : 0,
      ])),
    };
  };
  const toggleMidiPickup = () => {
    const m = mapperRef.current; if (!m) return;
    const on = !midiPickup;
    m.setPickup(on);
    if (on) { const vals = midiValues01(); for (const id in vals) m.notifyExternal(id, vals[id]); }
    setMidiPickup(on);
  };
  // Keep the mapper's pickup "soft" targets in sync with the UI: any non-MIDI
  // change (slider drag, preset load, keyboard) re-seeds the soft values so a
  // physical knob can't later jump a value the user set in the UI. The mapper
  // ignores echoes of its own MIDI-driven changes (notifyExternal + _lastSent),
  // so this does not defeat pickup for the controller's own moves.
  useEffect(() => {
    const m = mapperRef.current;
    if (!m || !midiPickup) return;
    const vals = midiValues01();
    for (const id in vals) m.notifyExternal(id, vals[id]);
  }, [
    midiPickup, ready, master, echo, reverb, dubFilter, siren, sampleFx,
    crossfade, crossfadeCurve, kills, killTrims, killFreqs, killQ, flatGain,
    musicSends, auxSends, auxLevels, pureSub, deckA, deckB, inputs, geqA,
    paramA, revLim, echoLim, selectedSample, flashIdx, recording, recFormat,
    advanced, deckEndMode, rewindStop, micOn,
  ]);
  const midiToggleMomentary = (id) => {
    const m = mapperRef.current; if (!m) return;
    m.setMomentary(id, !m.isMomentary(id));
    setMidiModes((s) => ({ ...s, [id]: m.isMomentary(id) }));
  };
  const midiLearn = (id) => { const m = mapperRef.current; if (!m) return; m.armLearn(id); setMidiLearnId(id); };
  // Ctrl+Shift+click on any control: bring audio + Web MIDI up if needed, then
  // arm learn for that control id. The mapper's onChange clears the state once a
  // controller message binds (or Esc cancels it).
  const midiLearnFromUi = async (id) => {
    try { await init(); } catch (_) {}
    let m = mapperRef.current, tries = 0;
    while (!m && tries++ < 24) { await new Promise((r) => setTimeout(r, 25)); m = mapperRef.current; }
    if (!m) return;
    if (!midiConnectedRef.current) { try { await connectMidi(); } catch (_) {} }
    m.armLearn(id);
    setMidiLearnId(id);
  };
  const MidiLearnContext = window.MidiLearnContext; // shared context object (defined in controls.jsx)
  const midiLearnCtx = React.useMemo(() => ({ learn: midiLearnFromUi, learningId: midiLearnId }), [midiLearnId]);
  const midiClear = (id) => { const m = mapperRef.current; if (m) m.unbind(id); };
  const midiKeysFor = (id) => Object.entries(midiBindings).filter(([, ids]) => ids.includes(id)).map(([k]) => k);
  const midiSaveMapping = () => {
    const m = mapperRef.current; if (!m) return;
    const blob = new Blob([JSON.stringify(m.serialize(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "dubnator-midi-map.json"; a.click();
    URL.revokeObjectURL(url);
  };
  const midiResetMap = () => {
    const m = mapperRef.current; if (!m) return;
    m.clear(); // drops all bindings (+ toggle state); onChange persists + refreshes UI
  };
  const midiLoadMapping = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { try { mapperRef.current && mapperRef.current.load(JSON.parse(r.result)); } catch (err) { console.error("Bad MIDI map", err); } };
    r.readAsText(f);
  };

  // === Keyboard shortcuts — modeled on the Dub FX Live manual ===
  // Refs avoid stale closures inside the listener
  const echoFbRef = useRef(0.35);
  useEffect(() => { echoFbRef.current = echo.fb; }, [echo.fb]);
  const heldRef = useRef(new Set());
  // remembers each band's kill state at punch-in press time so a momentary
  // cut restores whatever was there before (works over a latched toggle too)
  const punchPrevRef = useRef({ sub: false, bass: false, mid: false, high: false, top: false });

  useEffect(() => {
    const interactive = (el, event) => !!el && (
      el.isContentEditable
      || !!el.closest?.("input, textarea, select, [role='slider'], [role='radio'], [role='tab']")
      || (!!el.closest?.("button") && (event.key === " " || event.key === "Enter"))
    );

    const down = (e) => {
      const k = e.key;
      const kl = k.toLowerCase();
      const shift = e.shiftKey;

      // ---- Help & window dismiss ----
      if (k === "Escape") {
        e.preventDefault();
        if (mapperRef.current && mapperRef.current.isLearning()) { mapperRef.current.cancelLearn(); setMidiLearnId(null); return; }
        if (deckFocusOpen) { setDeckFocusOpen(false); return; }
        if (helpOpen) { setHelpOpen(false); return; }
        if (sirenSetupOpen) { setSirenSetupOpen(false); return; }
        if (playlistOpen) { setPlaylistOpen(null); return; }
        if (midiOpen) { setMidiOpen(false); return; }
        return;
      }
      if (interactive(e.target, e)) return;
      if (e.ctrlKey || e.metaKey) return;
      if (k === "?" || (shift && k === "/")) { e.preventDefault(); setHelpOpen(v => !v); return; }
      // Performance shortcuts remain live while siren, playlist and expanded
      // deck tools are open. Their text/select/slider controls are still
      // protected by interactive(), while Help and MIDI mapping stay modal.
      if (helpOpen || midiOpen) return;

      // ---- Screen views (mirror the SETUP / AUDIO / PANEL display tabs) ----
      if (shift && kl === "a") { e.preventDefault(); setMainView("display"); setDisplayMode(m => m === "image" ? "spectrum" : m); return; } // Audio
      if (shift && kl === "s") { e.preventDefault(); setMainView("display"); setDisplayMode("image"); return; } // Setup
      if (shift && kl === "p") { e.preventDefault(); setMainView("panel"); return; } // Panel

      // ---- Kills: Z=Sub  X=Low  C=Mid  V=High  B=Top (mirrors the panel order) ----
      if (!shift && kl === "z") { e.preventDefault(); setKills(s => ({ ...s, sub: !s.sub })); return; }
      if (!shift && kl === "x") { e.preventDefault(); setKills(s => ({ ...s, bass: !s.bass })); return; }
      if (!shift && kl === "c") { e.preventDefault(); setKills(s => ({ ...s, mid: !s.mid })); return; }
      if (!shift && kl === "v") { e.preventDefault(); setKills(s => ({ ...s, high: !s.high })); return; }
      if (!shift && kl === "b") { e.preventDefault(); setKills(s => ({ ...s, top: !s.top })); return; }

      // ---- Momentary punch-in kills: Shift+Z/X/C/V/B (hold to cut, release restores) ----
      const punchBand = (band, key) => {
        if (!heldRef.current.has(key)) {
          heldRef.current.add(key);
          setKills(s => { punchPrevRef.current[band] = s[band]; return { ...s, [band]: true }; });
        }
      };
      if (shift && kl === "z") { e.preventDefault(); punchBand("sub", "mk_sub"); return; }
      if (shift && kl === "x") { e.preventDefault(); punchBand("bass", "mk_bass"); return; }
      if (shift && kl === "c") { e.preventDefault(); punchBand("mid", "mk_mid"); return; }
      if (shift && kl === "v") { e.preventDefault(); punchBand("high", "mk_high"); return; }
      if (shift && kl === "b") { e.preventDefault(); punchBand("top", "mk_top"); return; }

      // ---- DECK A: T load · G play · Shift+G rewind · M stop · . load+play ----
      // ---- DECK B: Y load · H play · Shift+H rewind · , stop · / load+play ----
      // (B/N freed for the kill row, so rewind moves onto Shift+play)
      if (!shift && kl === "t") { e.preventDefault(); document.getElementById("deckA-file")?.click(); return; }
      if (shift && kl === "g") { e.preventDefault(); rewindA(); return; }
      if (!shift && kl === "g") { e.preventDefault(); playA(); return; }
      if (!shift && kl === "m") { e.preventDefault(); stopA(); return; }
      if (k === ".") { e.preventDefault(); loadAndPlayA(); return; }
      if (!shift && kl === "y") { e.preventDefault(); document.getElementById("deckB-file")?.click(); return; }
      if (shift && kl === "h") { e.preventDefault(); rewindB(); return; }
      if (!shift && kl === "h") { e.preventDefault(); playB(); return; }
      if (k === ",") { e.preventDefault(); stopB(); return; }
      if (!shift && k === "/") { e.preventDefault(); loadAndPlayB(); return; }

      // ---- Playlist scroll: [ ] = deck A, ; ' = deck B; Shift = load prev/next ----
      if (shift && k === "{") { e.preventDefault(); prevTrackA(); return; } // Shift+[
      if (shift && k === "}") { e.preventDefault(); nextTrackA(); return; } // Shift+]
      if (k === "[") { e.preventDefault(); setDeckA(s => ({ ...s, playlistIdx: Math.min(Math.max(0, s.playlist.length - 1), s.playlistIdx + 1) })); return; }
      if (k === "]") { e.preventDefault(); setDeckA(s => ({ ...s, playlistIdx: Math.max(0, s.playlistIdx - 1) })); return; }
      if (shift && k === ":") { e.preventDefault(); prevTrackB(); return; } // Shift+;
      if (shift && k === "\"") { e.preventDefault(); nextTrackB(); return; } // Shift+'
      if (k === ";") { e.preventDefault(); setDeckB(s => ({ ...s, playlistIdx: Math.min(Math.max(0, s.playlist.length - 1), s.playlistIdx + 1) })); return; }
      if (k === "'") { e.preventDefault(); setDeckB(s => ({ ...s, playlistIdx: Math.max(0, s.playlistIdx - 1) })); return; }
      if (k === " ") { e.preventDefault(); setPlaylistOpen(p => p ? null : (activeDeck || "A")); return; }

      // ---- Music inputs ----
      if (!shift && kl === "j") { e.preventDefault(); setInputs(s => ({ ...s, in1: { ...s.in1, mute: !s.in1.mute } })); return; }
      if (!shift && kl === "k") { e.preventDefault(); setInputs(s => ({ ...s, in2: { ...s.in2, mute: !s.in2.mute } })); return; }
      if (shift && kl === "q") { e.preventDefault(); setMusicSends(s => ({ ...s, rev: !s.rev })); return; }
      if (shift && kl === "w") { e.preventDefault(); setMusicSends(s => ({ ...s, echo: !s.echo })); return; }
      if (!shift && kl === "q") {
        if (!heldRef.current.has("q")) { heldRef.current.add("q"); setMusicSends(s => ({ ...s, rev: true })); }
        e.preventDefault(); return;
      }
      if (!shift && kl === "w") {
        if (!heldRef.current.has("w")) { heldRef.current.add("w"); setMusicSends(s => ({ ...s, echo: true })); }
        e.preventDefault(); return;
      }

      // ---- Mic / Aux ----
      if (!shift && kl === "l") { e.preventDefault(); setInputs(s => ({ ...s, aux: { ...s.aux, mute: !s.aux.mute } })); return; }
      // bare 'p' = mic/aux echo momentary (Shift+P = Panel view, handled above)
      if (!shift && kl === "p") {
        if (!heldRef.current.has("p")) { heldRef.current.add("p"); setAuxSends(s => ({ ...s, echo: true })); }
        e.preventDefault(); return;
      }
      // bare 'o' = mic/aux reverb momentary
      if (!shift && kl === "o") {
        if (!heldRef.current.has("o")) { heldRef.current.add("o"); setAuxSends(s => ({ ...s, rev: true })); }
        e.preventDefault(); return;
      }

      // ---- Samples ----
      if (k === "4") {
        if (!heldRef.current.has("4")) {
          heldRef.current.add("4");
          sampleHeld4Ref.current = selectedSampleRef.current; // remember which slot, so keyup releases it
          triggerSample(selectedSampleRef.current);           // fire the SELECTOR/R-chosen slot, not always 0
        }
        e.preventDefault(); return;
      }
      if (!shift && kl === "r") { e.preventDefault(); setSelectedSample(i => (i + 1) % 12); return; }
      if (!shift && kl === "u") {
        if (!heldRef.current.has("u")) { heldRef.current.add("u"); setSampleFx(s => ({ ...s, reverbSend: 0.6 })); }
        e.preventDefault(); return;
      }
      if (!shift && kl === "i") {
        if (!heldRef.current.has("i")) { heldRef.current.add("i"); setSampleFx(s => ({ ...s, echoSend: 0.6 })); }
        e.preventDefault(); return;
      }

      // ---- Dub Siren: 1 trigger · 2/3 preset down/up · Shift+1 default ----
      if (k === "1") {
        if (!heldRef.current.has("1")) { heldRef.current.add("1"); triggerSirenDown(); }
        e.preventDefault(); return;
      }
      if (k === "2") { e.preventDefault(); setSiren(s => stepSirenPreset(s, -1)); return; }
      if (k === "3") { e.preventDefault(); setSiren(s => stepSirenPreset(s, +1)); return; }
      if (k === "!") { e.preventDefault(); setSiren(s => ({ ...s, preset: 0, pitch: 220, lfo1Rate: 5, lfo1Depth: 0.4, lfo2Rate: 0.3, lfo2Depth: 0.2, bits: 16, sr: 1, gain: 0.7, echoSend: 0, reverbSend: 0 })); return; }

      // ---- Reverb filterband ----
      if (k === "5") { e.preventDefault(); setReverb(s => ({ ...s, hfd: Math.max(0, s.hfd - 0.05) })); return; }
      if (k === "6") { e.preventDefault(); setReverb(s => ({ ...s, hfd: Math.min(1, s.hfd + 0.05) })); return; }

      // ---- Echo / Tape ----
      if (k === "7") { e.preventDefault(); setEcho(s => ({ ...s, filter: Math.max(120, s.filter * 0.85) })); return; }
      if (k === "8") { e.preventDefault(); setEcho(s => ({ ...s, filter: Math.min(20000, s.filter * 1.15) })); return; }
      if (k === "9") { e.preventDefault(); tapTempo(); return; }
      if (!shift && kl === "a") { e.preventDefault(); nudgeManualEchoTime(0.9); return; } // time fast (shorter)
      if (!shift && kl === "s") { e.preventDefault(); nudgeManualEchoTime(1.1); return; } // time slow (longer)
      if (shift && kl === "d") { e.preventDefault(); setEcho(s => ({ ...s, type: s.type === 1 ? 2 : 1 })); return; } // echo type
      if (!shift && kl === "d") {
        if (!heldRef.current.has("d")) { heldRef.current.add("d"); setEcho(s => ({ ...s, fb: 0.7 })); }
        e.preventDefault(); return;
      }
      if (!shift && kl === "f") {
        if (!heldRef.current.has("f")) { heldRef.current.add("f"); setEcho(s => ({ ...s, fb: 0.9 })); }
        e.preventDefault(); return;
      }
      if (!shift && kl === "e") {
        if (!heldRef.current.has("e")) { heldRef.current.add("e"); setEcho(s => ({ ...s, fb: 1.0 })); }
        e.preventDefault(); return;
      }

      // ---- Dub filter (minus = LP, plus = HP; arrows sweep cutoff) ----
      if (k === "-" || k === "_") { e.preventDefault(); setDubFilter(s => ({ ...s, on: true, mode: "lp" })); return; }
      if (k === "=" || k === "+") { e.preventDefault(); setDubFilter(s => ({ ...s, on: true, mode: "hp" })); return; }
      if (k === "ArrowRight") { e.preventDefault(); setDubFilter(s => ({ ...s, cutoff: Math.min(20000, s.cutoff * 1.15) })); return; }
      if (k === "ArrowLeft")  { e.preventDefault(); setDubFilter(s => ({ ...s, cutoff: Math.max(20, s.cutoff * 0.85) })); return; }

      // ---- Screen / FX ----
      if (k === "0") { e.preventDefault(); toggleFullscreen(); return; } // full screen
      if (k === "\\" || k === "|") { e.preventDefault(); setReverb(s => ({ ...s, direct: !s.direct })); setEcho(s => ({ ...s, direct: !s.direct })); return; } // FX direct (dry)
    };

    const up = (e) => {
      const k = e.key;
      const kl = k.toLowerCase();
      const release = (key, fn) => { if (heldRef.current.has(key)) { heldRef.current.delete(key); fn(); } };

      release("q", () => setMusicSends(s => ({ ...s, rev: false })));
      release("w", () => setMusicSends(s => ({ ...s, echo: false })));
      release("p", () => setAuxSends(s => ({ ...s, echo: false })));
      release("o", () => setAuxSends(s => ({ ...s, rev: false })));
      release("4", () => releaseSample(sampleHeld4Ref.current));
      release("u", () => setSampleFx(s => ({ ...s, reverbSend: 0 })));
      release("i", () => setSampleFx(s => ({ ...s, echoSend: 0 })));
      release("1", () => { try { eng.siren && eng.siren.triggerOff(); } catch (_) {} setSirenHeld(false); });
      release("d", () => setEcho(s => ({ ...s, fb: 0.35 })));
      release("f", () => setEcho(s => ({ ...s, fb: 0.35 })));
      release("e", () => setEcho(s => ({ ...s, fb: 0.35 })));
      release("mk_sub", () => setKills(s => ({ ...s, sub: punchPrevRef.current.sub })));
      release("mk_bass", () => setKills(s => ({ ...s, bass: punchPrevRef.current.bass })));
      release("mk_mid", () => setKills(s => ({ ...s, mid: punchPrevRef.current.mid })));
      release("mk_high", () => setKills(s => ({ ...s, high: punchPrevRef.current.high })));
      release("mk_top", () => setKills(s => ({ ...s, top: punchPrevRef.current.top })));
      // touch kl/k to satisfy linter
      void k; void kl;
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [helpOpen, midiOpen, sirenSetupOpen, playlistOpen, deckFocusOpen]);

  const toggleRecord = async () => {
    await init();
    if (!recording) {
      eng.setRecordFormat(recFormat);
      eng.startRecord();
      setRecording(true);
    } else {
      const blob = eng.stopRecord();
      setRecording(false);
      if (blob) {
        if (recUrl) { try { URL.revokeObjectURL(recUrl); } catch (_) {} }
        setRecExt(recFormat);
        setRecUrl(URL.createObjectURL(blob));
      }
    }
  };

  // tweaks
  const [tweaks, setTweaks] = window.useTweaks ? window.useTweaks(/*EDITMODE-BEGIN*/{
    "accent": "#ff3b00",
    "showGrid": true,
    "knobStyle": "machined"
  }/*EDITMODE-END*/) : [{ accent: "#ff3b00", showGrid: true, knobStyle: "machined" }, () => {}];

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", tweaks.accent || "#ff3b00");
  }, [tweaks.accent]);

  // === view: hue tint + darkness ===
  const [view, setView] = useState({ hue: 0, darkness: 0 }); // hue 0..360°, darkness 0..1
  const [viewOpen, setViewOpen] = useState(false); // collapse the VIEW tint controls to save column height
  useEffect(() => {
    const c = document.querySelector(".chassis");
    if (!c) return;
    const brightness = 1 - view.darkness * 0.6; // darkness 1 → 0.4 brightness
    c.style.filter = (view.hue || view.darkness)
      ? `hue-rotate(${view.hue}deg) brightness(${brightness.toFixed(3)})`
      : "";
  }, [view]);

  // file load
  // Performance safety: never replace the buffer of a deck that is currently
  // on air. The operator must stop it first; adding files to its playlist is
  // still safe because that does not touch the playing buffer.
  const canReplaceDeckTrack = (deckKey) => {
    const deck = deckKey === "B" ? eng.deckB : eng.deckA;
    if (!deck?.playing) return true;
    setDeckLoadWarning({
      deckKey,
      message: `DECK-${deckKey} IS PLAYING · STOP IT BEFORE LOADING ANOTHER TRACK`,
    });
    if (deckLoadWarningTimerRef.current) clearTimeout(deckLoadWarningTimerRef.current);
    deckLoadWarningTimerRef.current = setTimeout(() => setDeckLoadWarning(null), 3200);
    return false;
  };
  useEffect(() => () => {
    if (deckLoadWarningTimerRef.current) clearTimeout(deckLoadWarningTimerRef.current);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(PLAYLIST_LINK_KEY, playlistsLinked ? "1" : "0"); } catch (_) {}
  }, [playlistsLinked]);

  const clearSavedSession = () => {
    const store = window.DubnatorPlaylistStore;
    if (!store?.clearAll) return;
    if (window.confirm && !window.confirm("Clear the locally saved deck session? Active decks will not change.")) return;
    store.clearAll();
  };

  const samePlaylistFile = (a, b) => a === b || !!(a && b
    && a.name === b.name
    && a.size === b.size
    && a.lastModified === b.lastModified);

  // Both decks share collection order while keeping independent loaded tracks,
  // playheads and playlist indices. A mirror uses cloned arrays so unlinking is
  // immediate and later mutations cannot leak across decks.
  const syncLinkedPlaylist = (sourceKey, force = false) => {
    const source = sourceKey === "B" ? eng.deckB : eng.deckA;
    const target = sourceKey === "B" ? eng.deckA : eng.deckB;
    if (!source || !target) return;
    const store = window.DubnatorPlaylistStore;
    // Persist the source even when the two decks are intentionally separate.
    // IndexedDB is best-effort and never blocks a live playlist operation.
    // A linked pair has one collection, so persist it once under a shared key
    // instead of cloning hundreds of audio files into IndexedDB twice.
    store?.save(playlistsLinked ? "shared" : sourceKey, source.playlist || []);
    if (!force && !playlistsLinked) return;
    const targetCurrent = target.file || target.playlist?.[target.playlistIdx];
    target.playlist = [...(source.playlist || [])];
    const preservedIndex = targetCurrent
      ? target.playlist.findIndex((file) => samePlaylistFile(file, targetCurrent))
      : -1;
    target.playlistIdx = preservedIndex >= 0
      ? preservedIndex
      : Math.min(target.playlistIdx || 0, Math.max(0, target.playlist.length - 1));
    const sourceState = sourceKey === "B" ? setDeckB : setDeckA;
    const targetState = sourceKey === "B" ? setDeckA : setDeckB;
    sourceState((state) => ({
      ...state,
      playlist: source.playlist.map((file) => file.name),
      playlistIdx: source.playlistIdx,
    }));
    targetState((state) => ({
      ...state,
      playlist: target.playlist.map((file) => file.name),
      playlistIdx: target.playlistIdx,
    }));
    if (!playlistsLinked) store?.save(sourceKey === "B" ? "A" : "B", target.playlist || []);
  };

  // Restore the last local session once after the engine is ready. Existing
  // user-loaded playlists always win, so a quick drag/drop immediately after
  // launch cannot be overwritten by an asynchronous IndexedDB read.
  const sessionRestoredRef = useRef(false);
  useEffect(() => {
    if (!ready || sessionRestoredRef.current) return;
    sessionRestoredRef.current = true;
    const store = window.DubnatorPlaylistStore;
    if (!store) return;
    const restoreDeck = async (deckKey, filesOverride = null) => {
      const target = deckKey === "B" ? eng.deckB : eng.deckA;
      const setDeck = deckKey === "B" ? setDeckB : setDeckA;
      if (!target || target.playlist?.length) return false;
      const files = filesOverride || await store.load(deckKey);
      if (!files.length || target.playlist?.length) return false;
      files.forEach((file) => target.addToPlaylist(file));
      if (!target.buffer) {
        try { await target.loadPlaylistIndex(0); } catch (_) {}
      }
      setDeck((state) => ({
        ...state,
        playlist: target.playlist.map((file) => file.name),
        playlistIdx: target.playlistIdx || 0,
        name: target.name || target.playlist[0]?.name || "—",
        playing: false,
      }));
      return true;
    };
    (async () => {
      const shared = playlistsLinked ? await store.load("shared") : [];
      const restoredA = await restoreDeck("A", shared.length ? shared : null);
      await restoreDeck("B", shared.length ? shared : null);
      if (restoredA && playlistsLinked) syncLinkedPlaylist("A", true);
    })();
  }, [ready]);

  const togglePlaylistLink = (next, preferredSource = activeDeck) => {
    const enabled = typeof next === "boolean" ? next : !playlistsLinked;
    setPlaylistsLinked(enabled);
    if (!enabled) {
      if (eng.deckA) eng.deckA.playlist = [...eng.deckA.playlist];
      if (eng.deckB) eng.deckB.playlist = [...eng.deckB.playlist];
      return;
    }
    const preferred = preferredSource === "B" ? "B" : "A";
    const preferredDeck = preferred === "B" ? eng.deckB : eng.deckA;
    const otherDeck = preferred === "B" ? eng.deckA : eng.deckB;
    const source = preferredDeck?.playlist?.length || !otherDeck?.playlist?.length
      ? preferred
      : preferred === "B" ? "A" : "B";
    syncLinkedPlaylist(source, true);
  };

  // Shared deck loader for both the hidden file inputs and drag-and-drop.
  // Adds files to the deck playlist; if the deck has no buffer yet, cues the
  // first one (decoding via the engine's AIFF fallback when needed).
  const loadFilesToDeck = async (deckKey, fileList, opts = {}) => {
    const files = Array.from(fileList || []).filter(f => !f.type || f.type.startsWith("audio/") || /\.(mp3|wav|aiff?|flac|m4a|ogg|opus)$/i.test(f.name));
    if (!files.length) return;
    await init();
    const engDeck = deckKey === "A" ? eng.deckA : eng.deckB;
    const setDeck = deckKey === "A" ? setDeckA : setDeckB;
    const shouldLoad = opts.load || !engDeck.buffer;
    if (shouldLoad && !canReplaceDeckTrack(deckKey)) return false;
    const startIdx = engDeck.playlist.length; // index of the first newly-added file
    setPlaylistImportProgress({ deckKey, done: 0, total: files.length });
    for (let i = 0; i < files.length; i += 32) {
      files.slice(i, i + 32).forEach((file) => engDeck.addToPlaylist(file));
      setPlaylistImportProgress({ deckKey, done: Math.min(i + 32, files.length), total: files.length });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    syncLinkedPlaylist(deckKey);
    // Cue the dropped/loaded track when the deck is empty, or when the caller
    // forces it (an explicit drop onto a deck loads that track immediately).
    if (shouldLoad) {
      try {
        await engDeck.loadPlaylistIndex(startIdx);
        setDeck((s) => ({ ...s, name: files[0].name, playlist: engDeck.playlist.map((file) => file.name), playlistIdx: startIdx, playing: false }));
      } catch (err) {
        console.error(`Deck ${deckKey} load failed`, err);
        setDeck((s) => ({ ...s, name: "⚠ CAN'T DECODE — " + files[0].name, playlist: engDeck.playlist.map((file) => file.name), playlistIdx: startIdx }));
      }
    } else {
      setDeck((s) => ({ ...s, playlist: engDeck.playlist.map((file) => file.name) }));
    }
    setPlaylistImportProgress(null);
    return true;
  };
  const onFileA = (e) => {
    loadFilesToDeck("A", Array.from(e.target.files || []));
    e.target.value = "";
  };
  const onFileB = (e) => {
    loadFilesToDeck("B", Array.from(e.target.files || []));
    e.target.value = "";
  };
  const [deckDropTarget, setDeckDropTarget] = useState(null); // "A" | "B" | null — drag highlight
  const onDeckDrop = (deckKey) => (e) => {
    e.preventDefault();
    setDeckDropTarget(null);
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      loadFilesToDeck(deckKey, e.dataTransfer.files, { load: true });
    }
  };
  // A loaded track clears the engine's section loop; mirror that in the strip's
  // loop UI so the ⟳ indicator / IN point don't carry over to the new track.
  const LOOP_RESET = {
    loopOn: false,
    loopIn: 0,
    loopInArmed: false,
    loopBeats: null,
  };
  const nextTrackA = async () => { await init(); if (!canReplaceDeckTrack("A")) return; await eng.deckA.nextTrack(); setDeckA(s => ({ ...s, ...LOOP_RESET, playlistIdx: eng.deckA.playlistIdx, name: eng.deckA.name, playing: eng.deckA.playing, time: 0, dur: eng.deckA.getDuration() })); };
  const prevTrackA = async () => { await init(); if (!canReplaceDeckTrack("A")) return; await eng.deckA.prevTrack(); setDeckA(s => ({ ...s, ...LOOP_RESET, playlistIdx: eng.deckA.playlistIdx, name: eng.deckA.name, playing: eng.deckA.playing, time: 0, dur: eng.deckA.getDuration() })); };
  const nextTrackB = async () => { await init(); if (!canReplaceDeckTrack("B")) return; await eng.deckB.nextTrack(); setDeckB(s => ({ ...s, ...LOOP_RESET, playlistIdx: eng.deckB.playlistIdx, name: eng.deckB.name, playing: eng.deckB.playing, time: 0, dur: eng.deckB.getDuration() })); };
  const prevTrackB = async () => { await init(); if (!canReplaceDeckTrack("B")) return; await eng.deckB.prevTrack(); setDeckB(s => ({ ...s, ...LOOP_RESET, playlistIdx: eng.deckB.playlistIdx, name: eng.deckB.name, playing: eng.deckB.playing, time: 0, dur: eng.deckB.getDuration() })); };
  // Load the currently-highlighted playlist track into a deck and start it (the
  // keyboard "Load & Play" shortcut). Falls back to the file picker when empty.
  const loadAndPlay = (which) => async () => {
    await init();
    const d = which === "A" ? eng.deckA : eng.deckB;
    const setD = which === "A" ? setDeckA : setDeckB;
    if (!d.playlist || !d.playlist.length) { document.getElementById(`deck${which}-file`)?.click(); return; }
    if (!canReplaceDeckTrack(which)) return;
    try { await d.loadPlaylistIndex(d.playlistIdx); } catch (_) {}
    if (eng.canDeckPlay && !eng.canDeckPlay(which)) return;
    if (!d.playing) d.play();
    setD((s) => ({ ...s, ...LOOP_RESET, name: d.name, playlistIdx: d.playlistIdx, playing: true }));
  };
  const loadAndPlayA = loadAndPlay("A");
  const loadAndPlayB = loadAndPlay("B");
  // NEXT plays forward through the playlist without wrapping at its end.
  const advanceDeckAtEnd = (which) => {
    const d = which === "A" ? eng.deckA : eng.deckB;
    const setD = which === "A" ? setDeckA : setDeckB;
    Promise.resolve(d.nextTrack({ wrap: false })).then((advanced) => {
      if (!advanced) return;
      d.play();
      setD((s) => ({ ...s, ...LOOP_RESET, name: d.name, playlistIdx: d.playlistIdx, playing: true, time: 0, dur: d.getDuration() }));
    });
  };
  useEffect(() => {
    if (!ready) return;
    const setup = (d, which) => {
      d.setLoopSingle(deckEndMode === "loop");
      d.onTrackEnd = deckEndMode === "next" ? () => advanceDeckAtEnd(which) : null;
    };
    setup(eng.deckA, "A");
    setup(eng.deckB, "B");
  }, [deckEndMode, deckA.playlist.length, deckB.playlist.length, ready]);

  const refreshMicDevices = async () => {
    if (!eng.listInputDevices) return;
    try {
      const list = await eng.listInputDevices();
      setMicDevices(list);
      // Reflect whichever device is actually live: the multichannel capture
      // takes precedence over the line/mic input, so the picker shows the right
      // device after a multichannel pick (was always showing the mic).
      setMicDeviceId((eng.multiDeviceId && eng.multiDeviceId()) || (eng.micDeviceId && eng.micDeviceId()) || "");
      // Mic permission also unlocks output-device labels — refresh them now.
      if (eng.canSetOutput && eng.canSetOutput()) eng.listOutputDevices().then(setOutDevices).catch(() => {});
    } catch (_) {}
  };
  const toggleMic = async () => {
    if (!eng.enableMicInput) return;
    if (eng.hasMic && eng.hasMic()) { eng.disableMicInput(); setMicOn(false); setMicDevices([]); return; }
    try {
      await init();
      await eng.enableMicInput(micDeviceId || undefined);
      setMicOn(true); setMicErr("");
      // Unmute the aux channel so the live input is audible.
      setInputs((s) => ({ ...s, aux: { ...s.aux, mute: false, gain: s.aux.gain || 0.8 } }));
      // Now that permission is granted, device labels are available.
      refreshMicDevices();
    } catch (e) { setMicErr(e && e.message ? e.message : "Mic unavailable"); setMicOn(false); }
  };
  const onPickMicDevice = async (id) => {
    setMicDeviceId(id);
    if (eng.hasMic && eng.hasMic()) {
      try { await eng.switchMicDevice(id || undefined); refreshMicDevices(); }
      catch (e) { setMicErr(e && e.message ? e.message : "Could not switch device"); }
    }
  };
  const [outDevices, setOutDevices] = useState([]);
  const [outDeviceId, setOutDeviceId] = useState("");
  const [outErr, setOutErr] = useState("");
  useEffect(() => {
    if (!ready || !eng.canSetOutput || !eng.canSetOutput()) return;
    eng.listOutputDevices().then(setOutDevices).catch(() => {});
  }, [ready]);
  const onPickOutput = async (id) => {
    // Only commit the selection if the actual switch succeeds, so the dropdown
    // can't show a device the audio isn't routed to.
    try {
      await eng.setOutputDevice(id || undefined);
      setOutDeviceId(id);
      setOutErr("");
    } catch (error) {
      setOutErr(error?.message || "Could not switch audio output.");
    }
  };
  const scanOutputs = async () => {
    // Keep the picker call in this click handler: selectAudioOutput requires
    // transient user activation in supporting browsers.
    try {
      const selected = eng.requestOutputDevice
        ? await eng.requestOutputDevice(outDeviceId || undefined)
        : null;
      const list = await eng.listOutputDevices();
      const merged = selected && !list.some((device) => device.deviceId === selected.deviceId)
        ? [selected, ...list]
        : list;
      setOutDevices(merged);
      if (selected?.deviceId) {
        await eng.setOutputDevice(selected.deviceId);
        setOutDeviceId(selected.deviceId);
      }
      setOutErr(merged.length
        ? ""
        : "No selectable outputs were exposed. The system default remains active.");
    } catch (error) {
      const message = error?.name === "NotAllowedError"
        ? "Output selection was denied. Reset this site's audio permissions and try again."
        : error?.message || "Could not detect audio outputs.";
      setOutErr(message);
    }
  };
  const [lineOn, setLineOn] = useState(false);
  const [lineErr, setLineErr] = useState("");
  const toggleLine = async () => {
    if (!eng.enableLineInput) return;
    if (eng.hasLineInput && eng.hasLineInput()) { eng.disableLineInput(); setLineOn(false); return; }
    try {
      await init();
      await eng.enableLineInput(micDeviceId || undefined, "A"); // live music → deck A's chain
      setLineOn(true); setLineErr("");
      setDeckA((s) => ({ ...s, name: "● LINE IN", playing: false }));
      refreshMicDevices();
    } catch (e) { setLineErr(e && e.message ? e.message : "Line input unavailable"); setLineOn(false); }
  };
  // Multichannel music input: capture a >2ch interface (e.g. a 4-in USB mixer)
  // and split ch 1-2 → IN 1, ch 3-4 → IN 2.
  const [multiOn, setMultiOn] = useState(false);
  const [multiCh, setMultiCh] = useState(0);
  const [multiMax, setMultiMax] = useState(0); // channels the captured device claims to support
  const [multiErr, setMultiErr] = useState("");
  const toggleMulti = async () => {
    if (!eng.enableMultiInput) return;
    if (eng.hasMultiInput && eng.hasMultiInput()) { eng.disableMultiInput(); setMultiOn(false); setMultiCh(0); setMultiMax(0); return; }
    try {
      await init();
      const ch = await eng.enableMultiInput(micDeviceId || undefined);
      setMultiOn(true); setMultiCh(ch || 0); setMultiMax(eng.multiMaxChannels ? eng.multiMaxChannels() : 0); setMultiErr("");
      // unmute IN 1 (and IN 2 if the device actually delivered ch 3-4) so it's audible
      setInputs((s) => ({ ...s, in1: { ...s.in1, mute: false, gain: s.in1.gain || 0.8 }, in2: { ...s.in2, mute: ch >= 3 ? false : s.in2.mute, gain: s.in2.gain || 0.8 } }));
      refreshMicDevices();
    } catch (e) { setMultiErr(e && e.message ? e.message : "Multichannel input unavailable"); setMultiOn(false); }
  };
  // Picking a device (re)starts the multichannel capture with it — works whether
  // a capture is already running or not, so the dropdown doubles as "choose input".
  const onPickMultiDevice = async (id) => {
    setMicDeviceId(id);
    if (!eng.enableMultiInput) return;
    try {
      await init();
      const ch = await eng.enableMultiInput(id || undefined);
      setMultiOn(true); setMultiCh(ch || 0); setMultiMax(eng.multiMaxChannels ? eng.multiMaxChannels() : 0); setMultiErr("");
      setInputs((s) => ({ ...s, in1: { ...s.in1, mute: false, gain: s.in1.gain || 0.8 }, in2: { ...s.in2, mute: ch >= 3 ? false : s.in2.mute, gain: s.in2.gain || 0.8 } }));
      refreshMicDevices();
    } catch (e) { setMultiErr(e && e.message ? e.message : "Could not switch device"); }
  };
  // Enumerate input devices once audio is ready, so the picker is populated up
  // front (labels are present when the browser already has mic permission).
  useEffect(() => { if (ready) refreshMicDevices(); }, [ready]);
  const toggleFullscreen = () => {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
    } catch (_) {}
  };
  const rewindA = () => eng.deckA && eng.deckA.rewind(deckA.rewindLen, rewindStop);
  const rewindB = () => eng.deckB && eng.deckB.rewind(deckB.rewindLen, rewindStop);

  // bands for kill canvas display
  // SOLO a band = cut the other four (isolate it); SOLO again clears all kills.
  const KILL_BANDS = ["sub", "bass", "mid", "high", "top"];
  const isSoloed = (key) => !kills[key] && KILL_BANDS.filter((b) => b !== key).every((b) => kills[b]);
  const soloKill = (key) => setKills(() => isSoloed(key)
    ? Object.fromEntries(KILL_BANDS.map((b) => [b, false]))
    : Object.fromEntries(KILL_BANDS.map((b) => [b, b !== key])));

  const deckLoopFromSurface = (label, operation, beats = 0) => {
    const deck = label === "A" ? eng.deckA : eng.deckB;
    const setDeck = label === "A" ? setDeckA : setDeckB;
    const state = label === "A" ? liveStateRef.current.deckA : liveStateRef.current.deckB;
    if (!deck || !state) return;
    if (operation === "in") {
      const loopIn = deck.getCurrentTime();
      setDeck((current) => ({ ...current, loopIn }));
    } else if (operation === "out") {
      const start = state.loopIn || 0;
      const end = deck.getCurrentTime();
      if (end > start + 0.05) {
        deck.setLoopRegion(start, end);
        setDeck((current) => ({ ...current, loopOn: true }));
      }
    } else if (operation === "clear") {
      deck.clearLoopRegion();
      setDeck((current) => ({ ...current, loopOn: false }));
    } else if (operation === "beat") {
      deck.setBeatLoop(liveStateRef.current.echo.bpm, beats);
      setDeck((current) => ({ ...current, loopOn: true }));
    } else if (operation === "half") {
      deck.halveLoop();
    } else if (operation === "double") {
      deck.doubleLoop();
    }
  };

  const selectSirenPreset = (index) => {
    setSiren((current) => {
      const presets = eng.siren ? eng.siren.presets() : [];
      const selected = Math.max(0, Math.min(11, index));
      const preset = presets[selected];
      return preset ? {
        ...current,
        preset: selected,
        pitch: preset.pitch,
        lfo1Rate: preset.lfo1Rate,
        lfo1Depth: preset.lfo1Depth,
        lfo2Rate: preset.lfo2Rate,
        lfo2Depth: preset.lfo2Depth,
      } : { ...current, preset: selected };
    });
  };

  liveStateRef.current.lineOn = lineOn;
  liveStateRef.current.multiOn = multiOn;
  actionsRef.current = {
    deckLoop: deckLoopFromSurface,
    tapTempo,
    echoDub: applyDubEchoPreset,
    echoThrow: setEchoThrow,
    toggleRecord,
    toggleMic,
    toggleLine,
    toggleMulti,
    sirenPreset: selectSirenPreset,
    sirenTrigger: (pressed) => pressed ? triggerSirenDown() : triggerSirenUp(),
    sampleTrigger: (index, pressed) => pressed ? triggerSample(index) : releaseSample(index),
  };

  // Bidirectional Launchpad feedback follows every performance state change.
  // The manager de-duplicates identical LED frames, so this remains cheap even
  // while deck time/meters are updating elsewhere.
  useEffect(() => {
    if (!launchpadRef.current) return;
    launchpadRef.current.sync(midiValues01());
  }, [
    ready, master, echo, reverb, dubFilter, siren, sampleFx, crossfade,
    crossfadeCurve, kills, killTrims, killFreqs, killQ, flatGain, musicSends,
    auxSends, auxLevels, pureSub, deckA, deckB, inputs, geqA, paramA, revLim,
    echoLim, selectedSample, flashIdx, recording, recFormat, advanced,
    deckEndMode, rewindStop, micOn, lineOn, multiOn, echoThrowHeld,
  ]);

  // Hardware VU feedback is quantized to the Launchpad's eight rows and capped
  // at 25 fps. These are real analyser values: post-fader decks/inputs, master,
  // and the five post-kill isolator bands.
  useEffect(() => {
    if (!launchpadRef.current) return;
    const now = Date.now();
    // Keep hardware VU feedback fluid while the Launchpad manager de-duplicates
    // unchanged frames. 40 Hz is responsive without flooding Web MIDI SysEx.
    if (now - launchpadMeterFrameRef.current < 24) return;
    launchpadMeterFrameRef.current = now;
    const musicLevel = Math.max(
      bandLevels.sub,
      bandLevels.bass,
      bandLevels.mid,
      bandLevels.high,
      bandLevels.top,
    );
    launchpadRef.current.syncMeters({
      "deckA.gain": meterA,
      "deckB.gain": meterB,
      "in1.gain": inLevels.in1,
      "in2.gain": inLevels.in2,
      "aux.gain": inLevels.aux,
      "samples.gain": sourceLevels.samples,
      "siren.gain": sourceLevels.siren,
      "reverb.ret": sourceLevels.reverb,
      "echo.send": sourceLevels.echo,
      "master.gain": meterMaster,
      "flat.gain": musicLevel,
      "kill.sub.trim": bandLevels.sub,
      "kill.bass.trim": bandLevels.bass,
      "kill.mid.trim": bandLevels.mid,
      "kill.high.trim": bandLevels.high,
      "kill.top.trim": bandLevels.top,
    });
  }, [meterA, meterB, meterMaster, inLevels, sourceLevels, bandLevels]);

  // Native desktop has no permission prompt, so plugging the controllers in and
  // opening Dubnator is enough. Browser/PWA builds still use ENABLE MIDI because
  // Web MIDI + SysEx permission requires a user gesture.
  useEffect(() => {
    if (window.__TAURI__ && !midiConnectedRef.current) connectMidi();
  }, [ready]);
  useEffect(() => () => {
    if (launchpadRef.current) launchpadRef.current.restoreLiveMode();
  }, []);

  const killBands = (key) => {
    const f = advanced ? killFreqs : { sub: 80, bass: 300, mid: 1000, high: 3000, top: 8000 };
    const cfg = {
      sub: { type: "lowshelf", freq: f.sub, gain: kills.sub ? -36 : 6 },
      bass: { type: "peaking", freq: f.bass, q: advanced ? killQ.bass : 1.2, gain: kills.bass ? -36 : 6 },
      mid: { type: "peaking", freq: f.mid, q: advanced ? killQ.mid : 1.0, gain: kills.mid ? -36 : 6 },
      high: { type: "peaking", freq: f.high, q: advanced ? killQ.high : 1.0, gain: kills.high ? -36 : 6 },
      top: { type: "highshelf", freq: f.top, gain: kills.top ? -36 : 6 },
    }[key];
    return [cfg];
  };

  // The big screen — shown in the shared region when SETUP/AUDIO is selected
  // (spans the two EQ grid columns). PANEL shows the EQ panels instead.
  const displayPanel = (
    <div className="panel with-screws display-panel rack-display" style={{ gridColumn: "span 2" }}>
      <div className="screw-bl"></div><div className="screw-br"></div>
      <div className="panel-header">
        <span className="panel-title">Display</span>
        <div className="row gap-2 aic" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button className={`btn-xs btn ${displayMode === "spectrum" ? "active" : ""}`}
            onClick={() => setDisplayMode("spectrum")}>SPECTRUM</button>
          <button className={`btn-xs btn ${displayMode === "eq" ? "active" : ""}`}
            onClick={() => setDisplayMode("eq")}>FULL EQ</button>
          <button className={`btn-xs btn ${displayMode === "image" ? "active" : ""}`}
            onClick={() => setDisplayMode("image")}>IMAGE</button>
          {displayMode === "spectrum" && (
            <span className="row gap-1 aic" style={{ marginLeft: 6 }}>
              <button className={`btn-xs btn ${specSource === "master" ? "active" : ""}`}
                onClick={() => setSpecSource("master")} title="Full master output">MASTER</button>
              <button className={`btn-xs btn ${specSource === "fx" ? "active" : ""}`}
                onClick={() => setSpecSource("fx")} title="Reverb + echo returns only">FX</button>
              <span style={{ width: 6 }}></span>
              <button className={`btn-xs btn ${specMode === "log" ? "active" : ""}`}
                onClick={() => setSpecMode("log")}>LOG</button>
              <button className={`btn-xs btn ${specMode === "linear" ? "active" : ""}`}
                onClick={() => setSpecMode("linear")}>LIN</button>
            </span>
          )}
          {displayMode === "image" && (
            <span className="row gap-2 aic" style={{ marginLeft: 6 }}>
              <label className="btn-xs btn" style={{ cursor: "pointer" }}>
                LOAD PNG
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={onLogoFile} />
              </label>
              <span className="panel-sub">OPACITY</span>
              <input type="range" min="0" max="1" step="0.01" value={logoAlpha}
                onChange={(e) => setLogoAlpha(+e.target.value)} style={{ width: 90 }} />
            </span>
          )}
        </div>
      </div>
      <div className="panel-body" style={{ flex: 1, display: "flex" }}>
        <div className={`scope display-scope ${logoDragOver ? "logo-dragover" : ""}`} style={{ flex: 1, minHeight: 140 }}
          onDragOver={(e) => { e.preventDefault(); setLogoDragOver(true); }}
          onDragLeave={(e) => { if (e.currentTarget === e.target) setLogoDragOver(false); }}
          onDrop={onLogoDrop}
          title="Drop a PNG here to use it as the display overlay">
          <div className="scope-grid"></div>
          {logoDragOver && <div className="display-placeholder mono" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3, background: "rgba(10,22,34,0.6)" }}>DROP PNG OVERLAY</div>}
          {displayMode === "spectrum" && (
            <SpectrumAnalyser engine={eng} mode={specMode} source={specSource} height={300} running={ready} />
          )}
          {displayMode === "eq" && (
            <EQCurve height={300} color="var(--accent)" fillColor="rgba(255,90,40,0.10)" bands={fullEqBands} />
          )}
          {displayMode === "image" && (
            logoImg
              ? <img src={logoImg} alt="overlay" style={{ width: "100%", height: "100%", objectFit: "contain", opacity: logoAlpha }} />
              : <div className="display-placeholder mono">LOAD A PNG (700×200, transparent)</div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <MidiLearnContext.Provider value={midiLearnCtx}>
    <div className="chassis">
      <div className="chassis-screw bl"></div>
      <div className="chassis-screw br"></div>

      {/* BRAND */}
      <div className="brand-strip">
        <div className="brand-mark">
          <span className="word">DUBNATOR</span>
          <span className="ver mono">MK-1 / v1.0</span>
          <span className="tag">DUB FX RACK · CHANNEL STRIP · LIVE</span>
        </div>
        <div className="brand-meta">
          <span>SR 48 KHZ</span>
          <span>BUF 256</span>
          <span style={{ color: ready ? "var(--green)" : "var(--text-dim)", cursor: ready ? "default" : "pointer" }}
            onClick={() => { if (!ready) init(); }}
            title={ready ? "Audio engine running" : "Click to start the audio engine"}>
            {ready ? "● ENGINE ONLINE" : "○ CLICK TO ENGAGE"}
          </span>
          <button className="btn-xs btn help-btn" onClick={toggleFullscreen} title="Toggle full screen">
            ⛶
          </button>
          <button className="btn-xs btn help-btn" onClick={() => setHelpOpen(true)} title="Keyboard shortcuts (?)">
            ? KEYS
          </button>
        </div>
      </div>
      {/* hidden file inputs for keyboard-driven Load (T / Y) */}
      <input id="deckA-file" type="file" accept="audio/*" multiple style={{ display: "none" }} onChange={onFileA} />
      <input id="deckB-file" type="file" accept="audio/*" multiple style={{ display: "none" }} onChange={onFileB} />

      <CompactRackNav />

      <div className="grid-app">
        <div className="main-col">
      {/* ============ TOP ROW ============ */}
      <div className="grid-top">
        {/* MUSIC INPUTS */}
        <div id="rack-inputs" className="panel with-screws rack-music" style={{ position: "relative" }}>
          <div className="screw-bl"></div><div className="screw-br"></div>
          <div className="panel-body" style={{ paddingTop: 6 }}>
            <div className="col" style={{ gap: 0 }}>
              <div className="input-section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
                <span>MUSIC INPUTS</span>
                <div className="row gap-1 aic">
                  <button className={`btn-xs btn ${multiOn ? "active" : ""}`} onClick={toggleMulti}
                    title="Capture a multichannel interface and split ch 1-2 → IN 1, ch 3-4 → IN 2">
                    {multiOn ? `● ${multiCh}CH` : "4-CH IN"}</button>
                  <button className={`btn-xs btn ${lineOn ? "active" : ""}`} onClick={toggleLine}
                    title="Route a live input device through Deck A's chain (kills/EQ/dub filter)">
                    {lineOn ? "● LINE A" : "LINE IN"}</button>
                </div>
              </div>
              {lineErr && <div className="warning-strip" style={{ marginBottom: 4, fontSize: 9 }}>{lineErr}</div>}
              {multiErr && <div className="warning-strip" style={{ marginBottom: 4, fontSize: 9 }}>{multiErr}</div>}
              {/* Input picker shows whenever devices are known (after permission),
                  so you can choose your interface in either state — not only while
                  a capture is already running. The channel readout stays tied to
                  the live capture. */}
              {micDevices.length > 0 && (
                <select className="mic-device-select mono" value={micDeviceId}
                  onChange={(e) => onPickMultiDevice(e.target.value)} title="Input device for IN 1 / IN 2 (multichannel)">
                  {micDevices.map((d) => (<option key={d.deviceId} value={d.deviceId}>{d.label}</option>))}
                </select>
              )}
              {multiOn && (
                <div className="mono" style={{ fontSize: 9, textAlign: "center", marginBottom: 2, color: multiCh >= 3 ? "var(--green)" : "var(--accent)" }}>
                  {multiCh >= 3 ? `${multiCh}ch captured · IN1=ch1-2 · IN2=ch3-4`
                    : multiCh === 2 ? (multiMax > 2 ? `2ch (device offers ${multiMax}ch — reconnect / pick again)` : "2ch device · IN1=ch1-2 · IN2 needs a 4-ch interface")
                    : multiCh === 1 ? "mono · IN1 only" : "no channels"}
                </div>
              )}
              <div className="strip-row">
                <DeckStrip label="DECK-A" midiPrefix="deckA" state={deckA} set={setDeckA} meter={meterA}
                  play={playA} stop={stopA} onFile={onFileA} deck={() => eng.deckA}
                  onPrev={prevTrackA} onNext={nextTrackA} onRewind={rewindA}
                  onSetCue={() => { eng.deckA.setCue(); setDeckA(s => ({ ...s, cued: true })); }}
                  onJumpCue={() => eng.deckA.jumpToCue()}
                  bpm={echo.bpm}
                  onOpenPlaylist={() => { setActiveDeck("A"); setPlaylistOpen("A"); }}
                  dropActive={deckDropTarget === "A"}
                  dropProps={{
                    onDragOver: (e) => { e.preventDefault(); setDeckDropTarget("A"); },
                    onDragLeave: (e) => { if (e.currentTarget === e.target) setDeckDropTarget(null); },
                    onDrop: onDeckDrop("A"),
                  }} />
                <DeckStrip label="DECK-B" midiPrefix="deckB" state={deckB} set={setDeckB} meter={meterB}
                  play={playB} stop={stopB} onFile={onFileB} deck={() => eng.deckB}
                  onPrev={prevTrackB} onNext={nextTrackB} onRewind={rewindB}
                  onSetCue={() => { eng.deckB.setCue(); setDeckB(s => ({ ...s, cued: true })); }}
                  onJumpCue={() => eng.deckB.jumpToCue()}
                  bpm={echo.bpm}
                  onOpenPlaylist={() => { setActiveDeck("B"); setPlaylistOpen("B"); }}
                  dropActive={deckDropTarget === "B"}
                  dropProps={{
                    onDragOver: (e) => { e.preventDefault(); setDeckDropTarget("B"); },
                    onDragLeave: (e) => { if (e.currentTarget === e.target) setDeckDropTarget(null); },
                    onDrop: onDeckDrop("B"),
                  }} />
                <InputStrip label="IN 1" gainMidiId="in1.gain" state={inputs.in1} meter={inLevels.in1}
                  setState={(u) => setInputs(s => ({ ...s, in1: { ...s.in1, ...u } }))} />
                <InputStrip label="IN 2" gainMidiId="in2.gain" state={inputs.in2} meter={inLevels.in2}
                  setState={(u) => setInputs(s => ({ ...s, in2: { ...s.in2, ...u } }))} />
              </div>
              <div className="section-send-row">
                <div className="send-stack">
                  <button type="button" className={`send-btn-lg accent ${musicSends.rev ? "on" : ""}`}
                    aria-label="Music reverb send" aria-pressed={musicSends.rev}
                    onClick={() => setMusicSends(s => ({ ...s, rev: !s.rev }))}></button>
                  <span className="lbl">REV</span>
                </div>
                <div className="send-stack">
                  <button type="button" className={`send-btn-lg ${musicSends.echo ? "on" : ""}`}
                    aria-label="Music echo send" aria-pressed={musicSends.echo}
                    onClick={() => setMusicSends(s => ({ ...s, echo: !s.echo }))}></button>
                  <span className="lbl">ECHO</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* MIC / AUX */}
        <div className="panel with-screws rack-mic">
          <div className="screw-bl"></div><div className="screw-br"></div>
          <div className="panel-body" style={{ paddingTop: 6 }}>
            <div className="col" style={{ gap: 0 }}>
              <div className="input-section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>MIC / AUX</span>
                <button className={`btn-xs btn ${micOn ? "active" : ""}`} onClick={toggleMic}
                  title="Capture a live mic/line input into IN 3-4">{micOn ? "● LIVE" : "MIC"}</button>
              </div>
              {micErr && <div className="warning-strip" style={{ marginBottom: 4, fontSize: 9 }}>{micErr}</div>}
              {micOn && micDevices.length > 0 && (
                <select className="mic-device-select mono" value={micDeviceId}
                  onChange={(e) => onPickMicDevice(e.target.value)} title="Input device">
                  {micDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                  ))}
                </select>
              )}
              <div className="strip-row" style={{ justifyContent: "center" }}>
                <InputStrip label="IN 3-4" gainMidiId="aux.gain" state={inputs.aux} meter={inLevels.aux}
                  setState={(u) => setInputs(s => ({ ...s, aux: { ...s.aux, ...u } }))} hp />
              </div>
              <div className="hp-section">
                <span className="hp-section-label">HP FILTER</span>
                <Knob size="sm" midiId="aux.hp" value={inputs.aux.hp} min={20} max={2000}
                  onChange={(v) => setInputs(s => ({ ...s, aux: { ...s.aux, hp: v } }))}
                  format={(v) => v >= 1000 ? (v/1000).toFixed(1) + "k" : v.toFixed(0) + "Hz"} />
              </div>
              <div className="section-send-row">
                <div className="send-stack">
                  <button type="button" className={`send-btn-lg ${auxSends.rev ? "on" : ""}`}
                    aria-label="Aux reverb send" aria-pressed={auxSends.rev}
                    onClick={() => setAuxSends(s => ({ ...s, rev: !s.rev }))}></button>
                  <span className="lbl">REV</span>
                  <Knob size="sm" midiId="aux.revlevel" value={auxLevels.rev} min={0} max={1}
                    onChange={(v) => setAuxLevels(s => ({ ...s, rev: v }))}
                    format={(v) => (v * 100).toFixed(0) + "%"} />
                </div>
                <div className="send-stack">
                  <button type="button" className={`send-btn-lg ${auxSends.echo ? "on" : ""}`}
                    aria-label="Aux echo send" aria-pressed={auxSends.echo}
                    onClick={() => setAuxSends(s => ({ ...s, echo: !s.echo }))}></button>
                  <span className="lbl">ECHO</span>
                  <Knob size="sm" midiId="aux.echolevel" value={auxLevels.echo} min={0} max={1}
                    onChange={(v) => setAuxLevels(s => ({ ...s, echo: v }))}
                    format={(v) => (v * 100).toFixed(0) + "%"} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* SETUP / EQ SELECT / DUBFILTER COLUMN */}
        <div className="panel with-screws rack-setup">
          <div className="screw-bl"></div><div className="screw-br"></div>
          <div className="panel-body" style={{ padding: 8 }}>
            <div className="setup-col">
              <div className="setup-tabs" role="tablist" aria-label="Main display">
                <button type="button" role="tab" aria-selected={mainView === "display" && displayMode === "image"}
                  className={`setup-tab ${mainView === "display" && displayMode === "image" ? "active" : ""}`}
                  onClick={() => { setMainView("display"); setDisplayMode("image"); }}>SETUP</button>
                <button type="button" role="tab" aria-selected={mainView === "display" && displayMode !== "image"}
                  className={`setup-tab ${mainView === "display" && displayMode !== "image" ? "active" : ""}`}
                  onClick={() => { setMainView("display"); setDisplayMode(m => m === "image" ? "spectrum" : m); }}>AUDIO</button>
                <button type="button" role="tab" aria-selected={mainView === "panel"}
                  className={`setup-tab ${mainView === "panel" ? "active" : ""}`}
                  onClick={() => setMainView("panel")}>PANEL</button>
              </div>
              <div className="setup-divider"></div>
              <div className="section-label" style={{ marginTop: 4 }}>EQ SELECT</div>
              <div className="col gap-1" role="radiogroup" aria-label="EQ processing">
                {["KILLS ONLY", "10B EQ", "4B EQ", "ALL EQS"].map((o) => (
                  <button type="button" role="radio" aria-checked={eqSelect === o}
                    key={o} className="radio-row" onClick={() => setEqSelect(o)}>
                    <span className={`radio-dot ${eqSelect === o ? "on" : ""}`}></span>
                    <span className="radio-label" style={{ fontSize: 8 }}>{o}</span>
                  </button>
                ))}
              </div>
              <div className="setup-divider" style={{ marginTop: 4 }}></div>
              <div className="section-label">DUBFILTER</div>
              <div className="col gap-1" role="radiogroup" aria-label="Dub filter route">
                {[
                  { v: "music", lbl: "A · MUSIC" },
                  { v: "master", lbl: "B · MASTER" },
                  { v: "samples", lbl: "C · SAMPLES" },
                  { v: "off", lbl: "D · OFF" },
                ].map(o => (
                  <button type="button" role="radio" aria-checked={dubFilter.route === o.v}
                    key={o.v} className="radio-row"
                    onClick={() => setDubFilter(s => ({ ...s, route: o.v, on: o.v !== "off" }))}>
                    <span className={`radio-dot ${dubFilter.route === o.v ? "on" : ""}`}></span>
                    <span className="radio-label" style={{ fontSize: 8 }}>{o.lbl}</span>
                  </button>
                ))}
              </div>
              <div className="row gap-1" style={{ marginTop: 6 }}>
                <button className={`btn-xs btn ${dubFilter.on && dubFilter.mode === "hp" ? "active" : ""}`}
                  style={{ flex: 1 }}
                  onClick={() => setDubFilter(s => ({ ...s, on: true, mode: "hp" }))}>HP</button>
                <button className={`btn-xs btn ${dubFilter.on && dubFilter.mode === "lp" ? "active" : ""}`}
                  style={{ flex: 1 }}
                  onClick={() => setDubFilter(s => ({ ...s, on: true, mode: "lp" }))}>LP</button>
              </div>
              <div className="row gap-2" style={{ justifyContent: "center", marginTop: 6 }}>
                <Knob size="sm" midiId="dubfilter.cutoff" label="CUTOFF" value={dubFilter.cutoff} min={20} max={20000}
                  onChange={(v) => setDubFilter(s => ({ ...s, cutoff: v }))}
                  format={fmtHz} />
                <Knob size="sm" midiId="dubfilter.reso" label="RESO" value={dubFilter.q} min={0.5} max={12}
                  onChange={(v) => setDubFilter(s => ({ ...s, q: +v.toFixed(2) }))}
                  format={(v) => v.toFixed(1) + "Q"} />
              </div>
              <div className="row gap-2" style={{ justifyContent: "center", marginTop: 6 }}>
                <Knob size="sm" midiId="dubfilter.sweep" label="SWEEP" value={dubFilter.sweep} min={0} max={1}
                  onChange={(v) => setDubFilter(s => ({ ...s, sweep: v }))}
                  format={(v) => v < 0.005 ? "—" : (v * 100).toFixed(0) + "%"} />
                <Knob size="sm" midiId="dubfilter.sweeprate" label="RATE" value={dubFilter.sweepRate} min={0.05} max={8}
                  onChange={(v) => setDubFilter(s => ({ ...s, sweepRate: +v.toFixed(2) }))}
                  format={(v) => v.toFixed(2) + "Hz"} />
              </div>
              <div className="setup-divider" style={{ marginTop: 4 }}></div>
              <button type="button" className="section-label section-label-toggle"
                aria-expanded={viewOpen} onClick={() => setViewOpen(o => !o)}
                title="Display tint controls">
                VIEW <span className="sl-chevron">{viewOpen ? "▴" : "▾"}</span>
                {!viewOpen && (view.hue || view.darkness) ? <span className="sl-dot"></span> : null}
              </button>
              {viewOpen && (<>
              <div className="view-row">
                <span className="view-lbl mono">HUE</span>
                <input type="range" min={0} max={360} step={1} value={view.hue}
                  onChange={(e) => setView(s => ({ ...s, hue: +e.target.value }))} />
                <span className="view-val mono">{view.hue}°</span>
              </div>
              <div className="view-row">
                <span className="view-lbl mono">DARK</span>
                <input type="range" min={0} max={1} step={0.02} value={view.darkness}
                  onChange={(e) => setView(s => ({ ...s, darkness: +e.target.value }))} />
                <span className="view-val mono">{Math.round(view.darkness * 100)}%</span>
              </div>
              {(view.hue || view.darkness) ? (
                <button className="btn-xs btn" style={{ marginTop: 4 }}
                  onClick={() => setView({ hue: 0, darkness: 0 })}>RESET VIEW</button>
              ) : null}
              </>)}
              {ready && eng.canSetOutput && eng.canSetOutput() && (
                <>
                  <div className="setup-divider" style={{ marginTop: 4 }}></div>
                  <div className="section-label">OUTPUT</div>
                  {outErr && (
                    <div className="warning-strip" style={{ marginBottom: 4, fontSize: 8 }}>
                      {outErr}
                    </div>
                  )}
                  {outDevices.length === 1 && (
                    <div className="mono" style={{ marginBottom: 4, color: "var(--text-dim)", fontSize: 8 }}>
                      SYSTEM DEFAULT · {outDevices[0].label || "system output"}
                    </div>
                  )}
                  {outDevices.filter((d) => d.deviceId && d.deviceId !== "default").length > 0 && (
                    <select className="mic-device-select mono" value={outDeviceId}
                      onChange={(e) => onPickOutput(e.target.value)} title="Master output device">
                      <option value="">System default</option>
                      {outDevices.filter((d) => d.deviceId && d.deviceId !== "default").map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                      ))}
                    </select>
                  )}
                  <button className="btn-xs btn" onClick={scanOutputs}
                    title="Open the browser output picker, or request device permission when unavailable">
                    {navigator.mediaDevices?.selectAudioOutput ? "CHOOSE OUTPUT" : "DETECT DEVICES"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* shared screen region — EQs (PANEL) or the display (SETUP/AUDIO) */}
        {mainView === "panel" ? (<>
        {/* 10 BAND GEQ */}
        <div id="rack-eq" className="panel with-screws fill-v rack-geq">
          <div className="screw-bl"></div><div className="screw-br"></div>
          <div className="panel-header">
            <span className="panel-title">10 Band Graphic Equalizer</span>
            <div className="row gap-2 aic">
              <select className="mono" style={{ fontSize: 9, background: "#111", color: "var(--accent)", border: "1px solid #333", borderRadius: 3 }}
                value="" onChange={(e) => { const sh = EQ_SHAPES[e.target.value]; if (sh) setGeqA([...sh]); }}
                title="Apply a preset EQ shape to Deck A">
                <option value="">SHAPE…</option>
                {Object.keys(EQ_SHAPES).map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <button className="btn-xs btn" title="Copy this EQ to Deck B"
                onClick={() => setGeqB([...geqA])}>→B</button>
              <button className="btn-xs btn" title="Flatten the graphic EQ"
                onClick={() => { setGeqA(Array(10).fill(0)); setGeqB(Array(10).fill(0)); }}>RST</button>
              <span className="panel-sub">{eqSelect}</span>
            </div>
          </div>
          <div className="panel-body">
            <div className="row gap-3" style={{ alignItems: "flex-end" }}>
              {FREQS_10.map((f, i) => (
                <div key={f} className="col aic gap-2" style={{ flex: 1 }}>
                  <div className="mono" style={{ fontSize: 9, color: "var(--text-dim)" }}>
                    {f >= 1000 ? `${f / 1000}k` : f}
                  </div>
                  <VSlider
                    value={geqA[i]}
                    min={-12} max={12}
                    onChange={(v) => setGeqA((g) => g.map((x, j) => j === i ? v : x))}
                    height={270}
                    midiId={`geqA.${i}`}
                  />
                  <div className="mono" style={{ fontSize: 9, color: geqA[i] !== 0 ? "var(--accent)" : "var(--text-faint)" }}>
                    {geqA[i] >= 0 ? "+" : ""}{geqA[i].toFixed(1)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 4 BAND PARAMETRIC */}
        <div className="panel with-screws fill-v rack-parametric">
          <div className="screw-bl"></div><div className="screw-br"></div>
          <div className="panel-header">
            <span className="panel-title">4 Band Parametric</span>
            <div className="row gap-2 aic">
              <button className="btn-xs btn" title="Reset parametric gains to 0 dB"
                onClick={() => setParamA((bands) => bands.map((b) => ({ ...b, gain: 0 })))}>RST</button>
              <span className="panel-sub">FREQ · Q · GAIN</span>
            </div>
          </div>
          <div className="panel-body">
            <div className="parametric-controls" style={{ display: "grid", gridTemplateColumns: "auto repeat(4, 1fr)", gap: "34px 8px", alignItems: "center" }}>
              <div className="mono" style={{ fontSize: 9, color: "var(--text-dim)", textAlign: "right" }}>FREQ</div>
              {paramA.map((p, i) => (
                <div key={`f${i}`} className="center">
                  <Knob size="md" value={p.freq} min={20} max={20000} midiId={`paramA${i}.freq`}
                    onChange={(v) => setParamA((arr) => arr.map((b, j) => j === i ? { ...b, freq: v } : b))}
                    format={(v) => fmtHz(v)} />
                </div>
              ))}
              <div className="mono" style={{ fontSize: 9, color: "var(--text-dim)", textAlign: "right" }}>Q</div>
              {paramA.map((p, i) => (
                <div key={`q${i}`} className="center">
                  <Knob size="md" value={p.q} min={0.1} max={10} midiId={`paramA${i}.q`}
                    onChange={(v) => setParamA((arr) => arr.map((b, j) => j === i ? { ...b, q: v } : b))}
                    format={(v) => v.toFixed(2)} />
                </div>
              ))}
              <div className="mono" style={{ fontSize: 9, color: "var(--text-dim)", textAlign: "right" }}>GAIN</div>
              {paramA.map((p, i) => (
                <div key={`g${i}`} className="center">
                  <Knob size="md" value={p.gain} min={-18} max={18} midiId={`paramA${i}.gain`}
                    onChange={(v) => setParamA((arr) => arr.map((b, j) => j === i ? { ...b, gain: v } : b))}
                    format={(v) => fmtDb(v)} />
                </div>
              ))}
              <div></div>
              {["SUB", "LO-MID", "HI-MID", "AIR"].map((label) => (
                <div key={label} className="mono" style={{ fontSize: 9, color: "var(--text-dim)", textAlign: "center" }}>{label}</div>
              ))}
            </div>
          </div>
        </div>
        </>) : displayPanel}
      </div>{/* /grid-top */}

      {/* TRANSPORT (decks bar) */}
      <div id="rack-decks" className="transport-row">
        <div className="panel with-screws xfade-block">
          <div className="screw-bl"></div><div className="screw-br"></div>
          <div className="xfade-cuts">
            <button className="btn-xs btn" onClick={() => setCrossfade(0)} title="Cut to Deck A">A</button>
            <span className="xfade-label mono">CROSSFADER</span>
            <button className="btn-xs btn" onClick={() => setCrossfade(1)} title="Cut to Deck B">B</button>
          </div>
          <Crossfader value={crossfade} onChange={setCrossfade} midiId="xfade" />
          <div className="row between" style={{ marginTop: 2 }}>
            <span className="mono" style={{ fontSize: 8, color: crossfade < 0.5 ? "var(--accent)" : "var(--text-dim)" }}>A</span>
            <button className="btn-xs btn" style={{ padding: "0 6px", fontSize: 8 }} onClick={() => setCrossfade(0.5)} title="Center">◆</button>
            <span className="mono" style={{ fontSize: 8, color: crossfade > 0.5 ? "var(--accent)" : "var(--text-dim)" }}>B</span>
          </div>
          <div className="row gap-1" style={{ justifyContent: "center", marginTop: 3 }}>
            {[["power", "PWR"], ["linear", "LIN"], ["sharp", "CUT"]].map(([c, lbl]) => (
              <button key={c} className={`btn-xs btn ${crossfadeCurve === c ? "active" : ""}`}
                style={{ padding: "0 5px", fontSize: 8 }}
                onClick={() => setCrossfadeCurve(c)}
                title={`Crossfader curve: ${c === "power" ? "equal-power (smooth)" : c === "linear" ? "linear" : "sharp cut"}`}>{lbl}</button>
            ))}
          </div>
        </div>
        <div className="panel with-screws transport-panel">
          <div className="screw-bl"></div><div className="screw-br"></div>
          <button
            type="button"
            className="btn-xs btn deck-focus-open"
            aria-label="Open expanded deck view"
            title="Open expanded deck view"
            onPointerDown={() => {
              // The first desktop pointer gesture also starts Web Audio. Open on
              // pointer-down so that initialization cannot replace the button
              // between down/up and swallow the first click.
              setDeckFocusDeck(activeDeck);
              setDeckFocusOpen(true);
            }}
            onClick={() => {
              setDeckFocusDeck(activeDeck);
              setDeckFocusOpen(true);
            }}>
            ⛶
          </button>
          <button
            type="button"
            className={`deck-playlist-link ${playlistsLinked ? "active" : ""}`}
            aria-pressed={playlistsLinked}
            onClick={() => togglePlaylistLink(!playlistsLinked, activeDeck)}
            title={playlistsLinked
              ? "Deck A and B share playlist order · click to separate them"
              : "Deck playlists are separate · click to share the active deck playlist"}>
            <span aria-hidden="true">{playlistsLinked ? "A ⇄ B" : "A │ B"}</span>
            <small>{playlistsLinked ? "SHARED" : "SEPARATE"}</small>
          </button>
          <div className="transport-decks">
            <DeckTransportRow label="A" state={deckA} engineDeck={ready ? eng.deckA : null} bpm={echo.bpm} />
            <DeckTransportRow label="B" state={deckB} engineDeck={ready ? eng.deckB : null} bpm={echo.bpm} />
          </div>
          <div className="transport-decks-label mono">DECKS</div>
        </div>
      </div>


      {/* ============ MID ROW ============ */}
      <div id="rack-fx" className="grid-mid">
        {/* DUB SIREN — compact */}
        <div className="panel with-screws rack-siren">
          <div className="screw-bl"></div><div className="screw-br"></div>
          <div className="panel-header">
            <span className="panel-title">Dub Siren</span>
          </div>
          <div className="panel-body col gap-2" style={{ padding: 8 }}>
            <div className="row gap-2" style={{ justifyContent: "space-between" }}>
              <div className="col aic" style={{ gap: 2 }}>
                <LED on={sirenHeld} color="green" />
                <span className="mono" style={{ fontSize: 8, color: "var(--text-dim)" }}>ECHO</span>
              </div>
              <button className="btn-xs btn" onClick={() => setSirenSetupOpen(true)}>SETUP</button>
            </div>
            <div className="section-label" style={{ marginTop: 4 }}>Preset</div>
            <div className="siren-preset-pill mono">
              {String(siren.preset + 1).padStart(2, "0")}
            </div>
            <div className="row gap-1" style={{ justifyContent: "center" }}>
              <button className="btn-xs btn" style={{ flex: 1 }}
                onClick={() => setSiren(s => stepSirenPreset(s, -1))}>◄</button>
              <button className="btn-xs btn" style={{ flex: 1 }}
                onClick={() => setSiren(s => stepSirenPreset(s, +1))}>►</button>
            </div>
            <div className="section-label" style={{ marginTop: 6 }}>Trigger</div>
            <div className="siren-trigger-wrap">
              <button
                className="siren-fire-big"
                style={{ background: sirenHeld ? "#fff" : "var(--accent)" }}
                onPointerDown={triggerSirenDown}
                onPointerUp={triggerSirenUp}
                onPointerLeave={triggerSirenUp}>
                {sirenHeld ? "● FIRING" : "FIRE"}
              </button>
            </div>
          </div>
        </div>

        {/* SIREN SETUP — floating window */}
        {sirenSetupOpen && (
          <FloatingWindow title="Dub Siren — Setup" onClose={() => setSirenSetupOpen(false)}
            initial={{ w: 360, h: 560 }} minW={300} minH={320}>
              <div className="panel-body col gap-3" style={{ padding: 14 }}>
                <div className="section-label">Preset</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
                  {(eng.siren ? eng.siren.presets() : []).map((p, i) => (
                    <button type="button" key={i} aria-pressed={siren.preset === i}
                      className={`preset-cell ${siren.preset === i ? "active" : ""}`}
                      onClick={() => {
                        setSiren(s => ({ ...s, preset: i, pitch: p.pitch, lfo1Rate: p.lfo1Rate, lfo1Depth: p.lfo1Depth, lfo2Rate: p.lfo2Rate, lfo2Depth: p.lfo2Depth }));
                      }}>{p.name || `FX ${i + 1}`}</button>
                  ))}
                </div>
                <div className="row gap-3" style={{ justifyContent: "center", marginTop: 4 }}>
                  <Knob size="sm" midiId="siren.pitch" label="PITCH" value={siren.pitch} min={40} max={2000}
                    onChange={(v) => setSiren(s => ({ ...s, pitch: v }))} format={fmtHz} />
                  <Knob size="sm" midiId="siren.gain" label="GAIN" value={siren.gain} min={0} max={1.2}
                    onChange={(v) => setSiren(s => ({ ...s, gain: v }))}
                    format={(v) => (v * 100).toFixed(0) + "%"} />
                </div>
                <div className="section-label">LFO 1 — SINE</div>
                <div className="row gap-3" style={{ justifyContent: "center" }}>
                  <Knob size="sm" midiId="siren.lfo1rate" label="RATE" value={siren.lfo1Rate} min={0} max={30}
                    onChange={(v) => setSiren(s => ({ ...s, lfo1Rate: v }))}
                    format={(v) => v.toFixed(1) + "Hz"} />
                  <Knob size="sm" midiId="siren.lfo1depth" label="DEPTH" value={siren.lfo1Depth} min={0} max={400}
                    onChange={(v) => setSiren(s => ({ ...s, lfo1Depth: v }))}
                    format={(v) => v.toFixed(0) + "Hz"} />
                </div>
                <div className="section-label">LFO 2 — SQUARE</div>
                <div className="row gap-3" style={{ justifyContent: "center" }}>
                  <Knob size="sm" midiId="siren.lfo2rate" label="RATE" value={siren.lfo2Rate} min={0} max={30}
                    onChange={(v) => setSiren(s => ({ ...s, lfo2Rate: v }))}
                    format={(v) => v.toFixed(1) + "Hz"} />
                  <Knob size="sm" midiId="siren.lfo2depth" label="DEPTH" value={siren.lfo2Depth} min={0} max={400}
                    onChange={(v) => setSiren(s => ({ ...s, lfo2Depth: v }))}
                    format={(v) => v.toFixed(0) + "Hz"} />
                </div>
                <div className="section-label">DIGITAL</div>
                <div className="row gap-3" style={{ justifyContent: "center" }}>
                  <Knob size="sm" midiId="siren.bits" label="BITS" value={siren.bits} min={2} max={16}
                    onChange={(v) => setSiren(s => ({ ...s, bits: Math.round(v) }))}
                    format={(v) => v.toFixed(0) + "b"} />
                  <Knob size="sm" midiId="siren.sr" label="SR" value={siren.sr} min={0} max={1}
                    onChange={(v) => setSiren(s => ({ ...s, sr: v }))}
                    format={(v) => (v * 100).toFixed(0) + "%"} />
                </div>
                <div className="section-label">FX SENDS</div>
                <div className="row gap-3" style={{ justifyContent: "center" }}>
                  <Knob size="sm" midiId="siren.revsend" label="REV" value={siren.reverbSend} min={0} max={1}
                    onChange={(v) => setSiren(s => ({ ...s, reverbSend: v }))}
                    format={(v) => (v * 100).toFixed(0) + "%"} />
                  <Knob size="sm" midiId="siren.echosend" label="ECHO" value={siren.echoSend} min={0} max={1}
                    onChange={(v) => setSiren(s => ({ ...s, echoSend: v }))}
                    format={(v) => (v * 100).toFixed(0) + "%"} />
                  <Knob size="sm" midiId="siren.pan" label="PAN" value={siren.autoPan} min={0} max={1}
                    onChange={(v) => setSiren(s => ({ ...s, autoPan: v }))}
                    format={(v) => v < 0.005 ? "—" : (v * 100).toFixed(0) + "%"} />
                </div>
                <div className="section-label">Patch</div>
                <div className="row gap-2" style={{ justifyContent: "center" }}>
                  <button className="btn-xs btn" onClick={saveSirenPatch} title="Save this siren patch to a .json">SAVE PATCH</button>
                  <label className="btn-xs btn" style={{ cursor: "pointer" }} title="Load a siren patch .json">
                    LOAD PATCH
                    <input type="file" className="hidden" accept="application/json,.json" onChange={loadSirenPatch} />
                  </label>
                </div>
              </div>
          </FloatingWindow>
        )}

        {/* PLAYLIST MODAL */}
        <PlaylistModal
          open={!!playlistOpen}
          deckKey={playlistOpen || "A"}
          deckA={deckA} deckB={deckB}
          setDeckA={setDeckA} setDeckB={setDeckB}
          canReplaceDeckTrack={canReplaceDeckTrack}
          playlistsLinked={playlistsLinked}
          onTogglePlaylistLink={(next) => togglePlaylistLink(next, playlistOpen || activeDeck)}
          onPlaylistChange={(deckKey) => syncLinkedPlaylist(deckKey)}
          onImportProgress={setPlaylistImportProgress}
          onClose={() => setPlaylistOpen(null)}
          onSwitchDeck={(d) => { setActiveDeck(d); setPlaylistOpen(d); }}
        />

        {deckLoadWarning && ReactDOM.createPortal(
          <div
            className={`deck-load-warning deck-${deckLoadWarning.deckKey.toLowerCase()}`}
            role="alert"
            onClick={() => setDeckLoadWarning(null)}>
            <span className="deck-load-warning-icon">!</span>
            <span>{deckLoadWarning.message}</span>
          </div>,
          document.body
        )}

        {playlistImportProgress && ReactDOM.createPortal(
          <div className={`playlist-import-progress deck-${playlistImportProgress.deckKey.toLowerCase()}`} role="status" aria-live="polite">
            <div className="playlist-import-progress-head">
              <span>LOADING {playlistImportProgress.deckKey === "A" ? "DECK-A" : "DECK-B"} PLAYLIST</span>
              <strong>{playlistImportProgress.done}/{playlistImportProgress.total}</strong>
            </div>
            <div className="playlist-import-progress-track"><i style={{ width: `${playlistImportProgress.total ? (playlistImportProgress.done / playlistImportProgress.total) * 100 : 0}%` }} /></div>
          </div>,
          document.body
        )}

        {deckFocusOpen && (
          <DeckFocusView
            mode={deckFocusMode}
            setMode={setDeckFocusMode}
            selected={deckFocusDeck}
            setSelected={(deck) => {
              setDeckFocusDeck(deck);
              setActiveDeck(deck);
            }}
            decks={[
              {
                label: "A",
                state: deckA,
                setState: setDeckA,
                engineDeck: ready ? eng.deckA : null,
                bpm: echo.bpm,
                onPlay: playA,
                onStop: stopA,
                onPrev: prevTrackA,
                onNext: nextTrackA,
                onRewind: rewindA,
                onSetCue: () => {
                  eng.deckA?.setCue();
                  setDeckA((state) => ({ ...state, cued: true }));
                },
                onJumpCue: () => eng.deckA?.jumpToCue(),
              },
              {
                label: "B",
                state: deckB,
                setState: setDeckB,
                engineDeck: ready ? eng.deckB : null,
                bpm: echo.bpm,
                onPlay: playB,
                onStop: stopB,
                onPrev: prevTrackB,
                onNext: nextTrackB,
                onRewind: rewindB,
                onSetCue: () => {
                  eng.deckB?.setCue();
                  setDeckB((state) => ({ ...state, cued: true }));
                },
                onJumpCue: () => eng.deckB?.jumpToCue(),
              },
            ]}
            onClose={() => setDeckFocusOpen(false)}
          />
        )}

        {/* HELP / KEYBOARD SHORTCUTS MODAL */}
        {helpOpen && ReactDOM.createPortal(
          <div className="modal-overlay" style={{ zIndex: 1400 }} onClick={() => setHelpOpen(false)}>
            <div className="modal-window panel with-screws help-modal" role="dialog" aria-modal="true"
              aria-labelledby="help-dialog-title" onClick={(e) => e.stopPropagation()}>
              <div className="screw-bl"></div><div className="screw-br"></div>
              <div className="modal-titlebar">
                <span className="modal-traffic">
                  <button type="button" className="dot red" aria-label="Close help" onClick={() => setHelpOpen(false)}></button>
                  <span className="dot yellow" aria-hidden="true"></span>
                  <span className="dot green" aria-hidden="true"></span>
                </span>
                <span id="help-dialog-title" className="panel-title" style={{ flex: 1, textAlign: "center" }}>Help · Keyboard & Launchpads</span>
                <button className="btn-xs btn" onClick={() => setHelpOpen(false)}>ESC</button>
              </div>
              <div className="panel-body help-body">
                <div className="help-view-tabs">
                  {launchpadHelpAvailable && (
                    <button className={activeHelpView === "launchpads" ? "active" : ""} onClick={() => setHelpView("launchpads")}>
                      LAUNCHPADS
                    </button>
                  )}
                  <button className={activeHelpView === "keyboard" ? "active" : ""} onClick={() => setHelpView("keyboard")}>
                    KEYBOARD
                  </button>
                </div>
                <div className={`help-view help-view-${activeHelpView}`}>
                  {activeHelpView === "launchpads"
                    ? (
                      <LaunchpadLayoutHelp
                        catalog={MIDI_CONTROLS}
                        devices={launchpads}
                        onSelectPage={selectLaunchpadHelpPage}
                        onSelectRole={selectLaunchpadHelpRole}
                        onToggleOrientation={toggleLaunchpadOrientation}
                      />
                    )
                    : <KeyboardMap />}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* MIDI MAPPING MODAL */}
        {midiOpen && ReactDOM.createPortal(
          <div className="modal-overlay" style={{ zIndex: 1400 }} onClick={() => { setMidiOpen(false); setMidiLearnId(null); mapperRef.current && mapperRef.current.cancelLearn(); }}>
            <div className="modal-window panel with-screws" role="dialog" aria-modal="true"
              aria-labelledby="midi-dialog-title" style={{ maxWidth: 560, width: "90%" }} onClick={(e) => e.stopPropagation()}>
              <div className="screw-bl"></div><div className="screw-br"></div>
              <div className="modal-titlebar">
                <span className="modal-traffic">
                  <button type="button" className="dot red" aria-label="Close MIDI mapping" onClick={() => setMidiOpen(false)}></button>
                  <span className="dot yellow" aria-hidden="true"></span><span className="dot green" aria-hidden="true"></span>
                </span>
                <span id="midi-dialog-title" className="panel-title" style={{ flex: 1, textAlign: "center" }}>MIDI Mapping</span>
                <button className="btn-xs btn" onClick={() => setMidiOpen(false)}>ESC</button>
              </div>
              <div className="panel-body" style={{ maxHeight: "70vh", overflowY: "auto", padding: 12 }}>
                <div className="row gap-2" style={{ marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <button className="btn-xs btn" onClick={connectMidi} disabled={midiPermission === "requesting"}>
                    {midiPermission === "requesting" ? "REQUESTING…" : midiPermission === "granted" || midiPermission === "native" ? "REFRESH MIDI" : "ENABLE MIDI"}
                  </button>
                  <button className={`btn-xs btn ${midiPickup ? "active" : ""}`} onClick={toggleMidiPickup}
                    title="Pickup mode: knobs/faders don't jump — they take over only after the physical position crosses the current value">PICKUP</button>
                  <button className="btn-xs btn" onClick={midiSaveMapping}>SAVE MAP</button>
                  <label className="btn-xs btn" style={{ cursor: "pointer" }}>LOAD MAP
                    <input type="file" className="hidden" accept="application/json" onChange={midiLoadMapping} />
                  </label>
                  <button className="btn-xs btn" onClick={midiResetMap} title="Clear all MIDI bindings">RESET</button>
                  <span className="mono" style={{ fontSize: 9, color: "var(--text-dim)" }}>
                    {midiInputs.length ? `IN: ${midiInputs.join(", ")}` : "no device"}
                  </span>
                  <span className="mono" style={{
                    fontSize: 9,
                    color: midiPermission === "granted" || midiPermission === "native"
                      ? "var(--green)"
                      : midiPermission === "denied" || midiPermission === "unsupported"
                        ? "var(--accent)"
                        : "var(--text-dim)",
                  }}>
                    PERMISSION: {midiPermission.toUpperCase()}
                  </span>
                </div>
                {midiErr && <div className="warning-strip" style={{ marginBottom: 8 }}>{midiErr}</div>}
                <div style={{ border: "1px solid rgba(255,59,0,0.35)", borderRadius: 4, padding: 8, marginBottom: 10, background: "rgba(255,59,0,0.04)" }}>
                  <div className="row between" style={{ marginBottom: 5 }}>
                    <span className="mono" style={{ fontSize: 10, color: "var(--accent)" }}>
                      {singleLaunchpad ? "SINGLE LAUNCHPAD MINI MK3" : "DUAL LAUNCHPAD MINI MK3"}
                    </span>
                    <button className="btn-xs btn" onClick={swapLaunchpads} disabled={!launchpads.length}
                      title={singleLaunchpad
                        ? "Switch this Launchpad between the MIX/SIREN and FX/EQ surfaces"
                        : "Exchange the MIX/DECKS and FX/EQ roles between the two physical units"}>
                      {singleLaunchpad
                        ? (singleLaunchpadOnFx ? "SHOW MIX" : "SHOW FX")
                        : `SWAP L/R${launchpadReversed ? " ●" : ""}`}
                    </button>
                  </div>
                  {singleLaunchpad && (
                    <div className="mono" style={{ marginBottom: 5, fontSize: 8, color: "var(--yellow)", lineHeight: 1.4 }}>
                      {launchpads[0]?.rotated
                        ? "ONE-CONTROLLER MODE · HOLD TOP BUTTON 3 FOR MIX · HOLD TOP BUTTON 4 FOR FX · SHORT PRESS SELECTS THE PAGE"
                        : "ONE-CONTROLLER MODE · HOLD TOP ← FOR MIX · HOLD TOP → FOR FX · SHORT PRESS SELECTS THE PAGE"}
                    </div>
                  )}
                  {launchpads.length ? launchpads.map((device) => (
                    <div key={device.inputId} style={{ marginTop: 5, paddingTop: 5, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                      <div className="row between">
                        <span className="mono" style={{ fontSize: 9 }}>{device.name}</span>
                        <div className="row gap-2 aic">
                          <button
                            className={`btn-xs btn ${device.rotated ? "active" : ""}`}
                            onClick={() => toggleLaunchpadOrientation(device.inputId)}
                            title="Match this physical Launchpad: straight or rotated 90° counter-clockwise"
                          >
                            {device.rotated ? "↺ 90° CCW" : "0° STRAIGHT"}
                          </button>
                          <span className="mono" style={{ fontSize: 9, color: device.connected ? "var(--green)" : "var(--accent)" }}>
                            {device.connected ? "● " : "○ "}{device.role} · {device.pageName}
                          </span>
                        </div>
                      </div>
                      <div className="mono" style={{ marginTop: 3, fontSize: 8, color: "var(--text-dim)", lineHeight: 1.4 }}>
                        FADERS: {device.ranges.map((id) => MIDI_CONTROLS.find((control) => control.id === id)?.label || id).join(" · ") || "—"}
                      </div>
                      <div className="mono" style={{ marginTop: 2, fontSize: 8, color: "var(--text-faint)", lineHeight: 1.4 }}>
                        PADS: {device.buttons.map((id) => MIDI_CONTROLS.find((control) => control.id === id)?.label || id).join(" · ") || "—"}
                      </div>
                    </div>
                  )) : (
                    <div className="mono" style={{ fontSize: 9, color: "var(--text-dim)", lineHeight: 1.45 }}>
                      Connect one or two units through their LPMiniMK3 MIDI ports, then press ENABLE MIDI.
                      With one unit, hold the top ←/→ buttons to switch surfaces. LEDs follow every fader,
                      toggle and selector.
                    </div>
                  )}
                </div>
                <div className="mono" style={{ fontSize: 9, color: "var(--text-faint)", marginBottom: 6 }}>
                  Click LEARN, then move a knob/press a button on your controller to bind it.
                </div>
                <div className="col" style={{ gap: 3 }}>
                  {MIDI_CONTROLS.map((c) => {
                    const keys = midiKeysFor(c.id);
                    const learning = midiLearnId === c.id;
                    return (
                      <div key={c.id} className="row between" style={{ padding: "3px 6px", background: "rgba(255,255,255,0.03)", borderRadius: 3 }}>
                        <span className="mono" style={{ fontSize: 10, flex: 1 }}>{c.label}</span>
                        <span className="mono" style={{ fontSize: 9, color: keys.length ? "var(--accent)" : "var(--text-faint)", minWidth: 90, textAlign: "right" }}>
                          {keys.length ? keys.join(" ") : "—"}
                        </span>
                        {c.type === "button" && (
                          <button className="btn-xs btn" style={{ marginLeft: 6, minWidth: 30 }}
                            title={midiModes[c.id] ? "Momentary: 1 on press, 0 on release (click → Toggle)" : "Toggle: flips each press (click → Momentary)"}
                            onClick={() => midiToggleMomentary(c.id)}>{midiModes[c.id] ? "MOM" : "TOG"}</button>
                        )}
                        <button className={`btn-xs btn ${learning ? "active" : ""}`} style={{ marginLeft: 6 }}
                          onClick={() => midiLearn(c.id)}>{learning ? "…" : "LEARN"}</button>
                        <button className="btn-xs btn" style={{ marginLeft: 4 }} disabled={!keys.length}
                          onClick={() => midiClear(c.id)}>✕</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* REVERB */}
        <div className="panel with-screws fill-v rack-reverb">
          <div className="screw-bl"></div><div className="screw-br"></div>
          <div className="panel-header">
            <span className="panel-title">Reverb Processor</span>
            <div className="row gap-3 aic">
              <button className={`btn-xs btn fx-action fx-freeze ${reverb.freeze ? "active" : ""}`}
                onClick={() => setReverb((s) => ({ ...s, freeze: !s.freeze }))}
                title="Freeze — near-infinite reverb tail for drones/sweeps">
                FREEZE{reverb.freeze ? " ●" : ""}
              </button>
              <button className={`btn-xs btn fx-action fx-filter ${!reverb.bpBypass ? "active" : ""}`}
                onClick={() => setReverb((s) => ({ ...s, bpBypass: !s.bpBypass }))}
                title="Band-pass filter on the reverb tail (off = FX direct, skip the BP)">
                {reverb.bpBypass ? "BP OFF" : "BP ON"}
              </button>
              <span className="panel-sub fx-status">TYPE 2</span>
            </div>
          </div>
          <div className="panel-body">
            <div className="row gap-4 fx-control-layout">
              <div className="dial-bank" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                {[
                  { k: "send", label: "SEND", tone: "violet", min: 0, max: 1, fmt: (v) => (v * 100).toFixed(0) + "%" },
                  { k: "ret", label: "RTN", tone: "violet", min: 0, max: 1.5, fmt: (v) => (v * 100).toFixed(0) + "%" },
                  { k: "hfd", label: "HFD", tone: "cyan", min: 0, max: 1, fmt: (v) => (v * 100).toFixed(0) + "%" },
                  { k: "room", label: "ROOM", tone: "blue", min: 0, max: 1, fmt: (v) => (v * 100).toFixed(0) + "%" },
                  { k: "dw", label: "D/W", tone: "violet", min: 0, max: 1, fmt: (v) => (v * 100).toFixed(0) + "%" },
                  { k: "preDelay", label: "PRE", tone: "blue", min: 0, max: 200, fmt: (v) => v.toFixed(0) + "ms" },
                  { k: "mod", label: "MOD", tone: "magenta", min: 0, max: 1, fmt: (v) => (v * 100).toFixed(0) + "%" },
                ].map((d) => (
                  <Knob key={d.k} size="md" label={d.label} tone={d.tone} midiId={`reverb.${d.k.toLowerCase()}`}
                    value={reverb[d.k]} min={d.min} max={d.max}
                    onChange={(v) => setReverb((s) => ({ ...s, [d.k]: v }))}
                    format={d.fmt} />
                ))}
              </div>
              <div className="flex-1">
                <div className="scope" style={{ height: 160, opacity: reverb.bpBypass ? 0.45 : 1 }}>
                  <div className="scope-grid"></div>
                  <InteractiveFilterGraph
                    height={160}
                    type="bandpass"
                    freq={reverb.bpFreq} q={reverb.bpQ}
                    minFreq={80} maxFreq={18000}
                    color="#a879ff"
                    fillColor="rgba(168,121,255,0.13)"
                    onChange={({ freq, q }) => setReverb((s) => ({ ...s, bpFreq: Math.round(freq), bpQ: +q.toFixed(2), bpBypass: false }))}
                  />
                </div>
                <div className="row between" style={{ marginTop: 4 }}>
                  <span className="mono" style={{ fontSize: 9, color: "var(--text-dim)" }}>{reverb.bpFreq.toFixed(0)}Hz</span>
                  <span className="mono fx-filter-q" style={{ fontSize: 9 }}>{reverb.bpQ.toFixed(2)}Q</span>
                  <span className="mono" style={{ fontSize: 9, color: "var(--text-dim)" }}>{reverb.bpBypass ? "BP BYPASSED" : "drag ↔ freq · ↕ Q"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* TAPE ECHO */}
        <div className="panel with-screws fill-v rack-echo">
          <div className="screw-bl"></div><div className="screw-br"></div>
          <div className="panel-header">
            <span className="panel-title">Tape Echo</span>
            <div className="row gap-3 aic">
              <button className={`btn-xs btn fx-action fx-type ${echo.type === 1 ? "active" : ""}`}
                onClick={() => setEcho(s => ({ ...s, type: 1 }))}>T1</button>
              <button className={`btn-xs btn fx-action fx-type ${echo.type === 2 ? "active" : ""}`}
                onClick={() => setEcho(s => ({ ...s, type: 2 }))}>T2</button>
              <button className="btn-xs btn fx-action fx-dub"
                onClick={applyDubEchoPreset}
                title="Load a filtered, tempo-synced dub echo starting point">DUB</button>
              <button className={`btn-xs btn fx-action fx-throw ${echoThrowHeld ? "active" : ""}`}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                  echoThrowDown();
                }}
                onPointerUp={(event) => {
                  event.currentTarget.releasePointerCapture?.(event.pointerId);
                  echoThrowUp();
                }}
                onPointerCancel={echoThrowUp}
                onLostPointerCapture={echoThrowUp}
                title="Hold to send music into the echo; release leaves the tail ringing">
                THROW</button>
              <button className="btn-xs btn fx-action fx-timing" onClick={tapTempo}>TAP</button>
              <button className={`btn-xs btn fx-action fx-sync ${echo.sync ? "active" : ""}`}
                onClick={() => setEchoSyncMode(!echo.sync)}
                title="Tempo-sync the echo to a musical division of the tapped BPM">SYNC</button>
              {echo.sync && (
                <select className="mono echo-sync-select"
                  value={echo.syncDiv} onChange={(e) => setEchoSyncDivision(e.target.value)}
                  title="Echo time as a fraction of the beat">
                  {ECHO_DIVS.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              )}
              <button className={`btn-xs btn fx-action fx-filter ${echo.hpOn ? "active" : ""}`}
                onClick={() => setEcho(s => ({ ...s, hpOn: !s.hpOn }))}
                title="Sub high-pass on the echo loop — keeps low end out of the repeats">
                SUB-HP</button>
              <button className={`btn-xs btn fx-action fx-robot ${echo.robotic ? "active" : ""}`}
                onClick={() => setEcho(s => ({ ...s, robotic: !s.robotic }))}
                title="Full-speed echo: snaps the delay ultra-short for a metallic/robotic comb ring">
                ROBOT</button>
              <button className="btn-xs btn fx-action fx-panic"
                onClick={() => eng.panicFX && eng.panicFX()}>PANIC</button>
              <span className="panel-sub fx-status">{echo.robotic ? "ROBOTIC" : echo.sync ? `DELAY ${audibleEchoTime.toFixed(0)} MS · ${echo.bpm} BPM · ${echo.syncDiv}` : `DELAY ${audibleEchoTime.toFixed(0)} MS · TEMPO ${(60000 / Math.max(1, audibleEchoTime)).toFixed(0)} BPM`}</span>
            </div>
          </div>
          <div className="panel-body">
            <div className="row gap-4 fx-control-layout">
              <div className="dial-bank" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                {[
                  { k: "send", label: "SEND", tone: "orange", min: 0, max: 1, fmt: (v) => (v * 100).toFixed(0) + "%" },
                  { k: "sat", label: "SAT", tone: "red", min: 0, max: 1, fmt: (v) => (v * 100).toFixed(0) + "%" },
                  { k: "fb", label: "F.B.", tone: "yellow", min: 0, max: 0.95, fmt: (v) => (v * 100).toFixed(0) + "%" },
                  { k: "dw", label: "RTN", tone: "orange", min: 0, max: 1, fmt: (v) => (v * 100).toFixed(0) + "%" },
                  { k: "slide", label: "SLIDE", tone: "yellow", min: 0, max: 1, fmt: (v) => (v * 100).toFixed(0) + "%" },
                  { k: "wow", label: "WOW", tone: "magenta", min: 0, max: 1, fmt: (v) => (v * 100).toFixed(0) + "%" },
                  { k: "time", label: "TIME", tone: "yellow", min: 30, max: 1500, fmt: fmtMs },
                ].map((d) => (
                  <Knob key={d.k} size="md" label={d.label} tone={d.tone} midiId={`echo.${d.k}`}
                    value={d.k === "time" ? audibleEchoTime : echo[d.k]} min={d.min} max={d.max}
                    scale={d.k === "time" ? "log" : "linear"}
                    onChange={(v) => d.k === "time"
                      ? setManualEchoTime(v)
                      : setEcho((s) => ({ ...s, [d.k]: v }))}
                    format={d.fmt} />
                ))}
              </div>
              <div className="flex-1">
                <div className="scope" style={{ height: 160 }}>
                  <div className="scope-grid"></div>
                  <InteractiveFilterGraph
                    height={160}
                    type={echo.type === 2 ? "highpass" : "lowpass"}
                    freq={echo.filter} q={echo.filterQ}
                    minFreq={120} maxFreq={20000}
                    color="#ff9f43"
                    fillColor="rgba(255,159,67,0.13)"
                    onChange={({ freq, q }) => setEcho((s) => ({ ...s, filter: Math.round(freq), filterQ: +q.toFixed(2) }))}
                  />
                </div>
                <div className="row between" style={{ marginTop: 4 }}>
                  <span className="mono" style={{ fontSize: 9, color: "var(--text-dim)" }}>{echo.filter.toFixed(0)}Hz</span>
                  <span className="mono fx-filter-q" style={{ fontSize: 9 }}>{echo.filterQ.toFixed(2)}Q</span>
                  <span className="mono" style={{ fontSize: 9, color: "var(--text-dim)" }}>drag ↔ freq · ↕ Q</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* SAMPLES MINI */}
        <div className="panel with-screws rack-sample-fx">
          <div className="screw-bl"></div><div className="screw-br"></div>
          <div className="panel-header">
            <span className="panel-title" style={{ fontSize: 10 }}>Samples</span>
          </div>
          <div className="panel-body col gap-2" style={{ padding: 6 }}>
            <div className="row gap-1" style={{ justifyContent: "center" }}>
              <div className="col aic" style={{ gap: 1 }}>
                <LED on={sampleFx.reverbSend > 0} color="amber" />
                <span className="mono" style={{ fontSize: 7, color: "var(--text-dim)" }}>REV</span>
              </div>
              <div className="col aic" style={{ gap: 1 }}>
                <LED on={sampleFx.echoSend > 0} color="green" />
                <span className="mono" style={{ fontSize: 7, color: "var(--text-dim)" }}>ECHO</span>
              </div>
              <div className="col aic" style={{ gap: 1 }}>
                <LED on={false} color="red" />
                <span className="mono" style={{ fontSize: 7, color: "var(--text-dim)" }}>BP</span>
              </div>
            </div>
            <div className="section-label">FX SENDS</div>
            <div className="row gap-2" style={{ justifyContent: "center" }}>
              <Knob size="sm" midiId="samples.rev" label="REV" value={sampleFx.reverbSend} min={0} max={1}
                onChange={(v) => setSampleFx(s => ({ ...s, reverbSend: v }))}
                format={(v) => (v * 100).toFixed(0) + "%"} />
              <Knob size="sm" midiId="samples.echo" label="ECHO" value={sampleFx.echoSend} min={0} max={1}
                onChange={(v) => setSampleFx(s => ({ ...s, echoSend: v }))}
                format={(v) => (v * 100).toFixed(0) + "%"} />
            </div>
            <div className="section-label">SELECTOR</div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <Knob size="sm" value={selectedSample} min={0} max={11}
                onChange={(v) => setSelectedSample(Math.round(v))}
                format={(v) => String(Math.round(v) + 1).padStart(2, "0")} />
            </div>
            <VSlider
              value={sampleFx.gain} min={0} max={1.2}
              onChange={(v) => setSampleFx(s => ({ ...s, gain: v }))}
              height={50}
            />
            <div className="section-label">TRIGGER</div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <LED on={flashIdx >= 0} color="red" />
            </div>
          </div>
        </div>

        {/* MASTER */}
        <div className="panel with-screws rack-master">
          <div className="screw-bl"></div><div className="screw-br"></div>
          <div className="panel-header">
            <span className="panel-title" style={{ fontSize: 10 }}>Master</span>
          </div>
          <div className="panel-body" style={{ padding: 6 }}>
            <div className="readout mono" style={{ textAlign: "center", color: "var(--accent)", fontSize: 11, marginBottom: 4 }}>
              {(20 * Math.log10(Math.max(0.001, master.gain))).toFixed(1)}dB
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <Meter level={meterMaster} cells={18} />
            </div>
            <div className="mono" style={{ textAlign: "center", fontSize: 9, marginTop: 3, color: masterPeakDb > -1 ? "var(--accent)" : "var(--text-dim)" }}>
              PK {masterPeakDb > -90 && isFinite(masterPeakDb) ? masterPeakDb.toFixed(1) + " dB" : "−∞"}
            </div>
            <div className="row gap-2" style={{ justifyContent: "center", marginTop: 6 }}>
              <Knob size="sm" midiId="master.gain" label="GAIN" value={master.gain} min={0} max={1.5}
                onChange={(v) => setMaster((s) => ({ ...s, gain: v }))}
                format={(v) => fmtDb(20 * Math.log10(Math.max(0.001, v)))} />
              <Knob size="sm" midiId="master.hp" label="HP" value={master.hp} min={20} max={400}
                onChange={(v) => setMaster((s) => ({ ...s, hp: Math.round(v) }))}
                title="Master high-pass — removes subsonic rumble; sweep up to thin the mix"
                format={(v) => v <= 21 ? "OFF" : v.toFixed(0) + "Hz"} />
            </div>
            <div className="row gap-1" style={{ marginTop: 6 }}>
              <button className={`btn-xs btn ${master.mono ? "active" : ""}`} style={{ flex: 1 }}
                onClick={() => setMaster((s) => ({ ...s, mono: !s.mono }))}
                title="Sum the master to mono (mono-bass / mono-compatibility check)">
                MONO{master.mono ? " ●" : ""}
              </button>
              <button className={`btn-xs btn ${master.dim ? "active" : ""}`} style={{ flex: 1 }}
                onClick={() => setMaster((s) => ({ ...s, dim: !s.dim }))}
                title="Dim the master −20 dB (talkover) without touching the gain">
                DIM{master.dim ? " ●" : ""}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* FLAT MODE bar — lights when all 4 kills are engaged (isolator bypassed,
          signal passes flat at the flat-mode gain instead of summing to silence) */}
      <div className={`flat-bar ${flatMode ? "active" : ""}`}>
        <span className={`flat-led ${flatMode ? "on" : ""}`}></span>
        <span className="flat-label mono">
          FLAT MODE{flatMode ? " — ISOLATOR BYPASS" : ""}
        </span>
        <button className={`btn-xs btn ${pureSub ? "active" : ""}`}
          style={{ marginLeft: 10 }}
          onClick={() => setPureSub((v) => !v)}
          title="Pure Sub-Bass — steep low-pass for a clean sub (removes mid/high artifacts)">
          PURE SUB{pureSub ? " ●" : ""}
        </button>
        <span className="flat-gain-wrap">
          <span className="mono" style={{ fontSize: 9, color: "var(--text-dim)" }}>GAIN</span>
          <input type="range" min={-24} max={advanced ? 12 : 0} step={0.5} value={flatGain}
            onChange={(e) => setFlatGain(+e.target.value)} style={{ width: 160 }} />
          <span className="mono" style={{ fontSize: 9, minWidth: 54, textAlign: "right", color: flatMode ? "var(--accent)" : "var(--text-dim)" }}>
            {fmtDb(flatGain)}
          </span>
        </span>
      </div>

      {/* ============ BOTTOM ROW (KILLS only) ============ */}
      <div id="rack-kills" className="grid-bottom">
        {/* KILLS */}
        {[
          { key: "sub", label: "SUB", color: "rgba(239,68,68,0.18)", lineColor: "#ef4444", freqLabels: ["20Hz", "150Hz"] },
          { key: "bass", label: "LOW", color: "rgba(245,158,11,0.18)", lineColor: "#f59e0b", freqLabels: ["150Hz", "600Hz"] },
          { key: "mid", label: "MID", color: "rgba(234,179,8,0.18)", lineColor: "#eab308", freqLabels: ["600Hz", "2kHz"] },
          { key: "high", label: "HIGH", color: "rgba(56,189,248,0.18)", lineColor: "#38bdf8", freqLabels: ["2kHz", "5kHz"] },
          { key: "top", label: "TOP", color: "rgba(34,197,94,0.18)", lineColor: "#22c55e", freqLabels: ["5kHz", "20kHz"] },
        ].map((k) => (
          <div key={k.key} className="panel with-screws rack-kill">
            <div className="screw-bl"></div><div className="screw-br"></div>
            <div className="panel-header">
              <span className="panel-title">{k.label}</span>
              <div className="row gap-1 aic">
                <button className={`btn-xs btn ${isSoloed(k.key) ? "active" : ""}`}
                  title="Solo this band (cut the other three)"
                  onClick={() => soloKill(k.key)}>SOLO</button>
                <button
                  className={`btn-xs btn ${kills[k.key] ? "active" : ""}`}
                  onClick={() => setKills((s) => ({ ...s, [k.key]: !s[k.key] }))}
                >KILL</button>
              </div>
            </div>
            <div className="panel-body">
              <div className="scope" style={{ height: 48 }}>
                <div className="scope-grid"></div>
                <EQCurve
                  height={48}
                  color={k.lineColor}
                  fillColor={k.color}
                  bands={killBands(k.key)}
                />
              </div>
              <div style={{ marginTop: 6 }}>
                <Meter level={bandLevels[k.key]} cells={14} horizontal />
              </div>
              <div className="row between" style={{ marginTop: 6 }}>
                <span className="mono" style={{ fontSize: 9, color: "var(--text-dim)" }}>{k.freqLabels[0]}</span>
                <span className="mono" style={{ fontSize: 9, color: "var(--text-dim)" }}>{k.freqLabels[1]}</span>
                <span className="mono" style={{ fontSize: 9, color: kills[k.key] ? "var(--accent)" : (killTrims[k.key] ? "var(--accent)" : "var(--text-dim)") }}>
                  {kills[k.key] ? "−36 dB" : fmtDb(killTrims[k.key])}
                </span>
              </div>
              <div className="kill-trim-row">
                <span className="mono kill-trim-lbl">GAIN</span>
                <input type="range" min={-70} max={advanced ? 12 : 0} step={0.5}
                  value={kills[k.key] ? -70 : killTrims[k.key]} disabled={kills[k.key]}
                  onChange={(e) => setKillTrims((s) => ({ ...s, [k.key]: +e.target.value }))} />
              </div>
              {advanced && (
                <div className="kill-trim-row">
                  <span className="mono kill-trim-lbl">{Math.round(killFreqs[k.key])}Hz</span>
                  <input type="range" min={KILL_FREQ_RANGE[k.key][0]} max={KILL_FREQ_RANGE[k.key][1]} step={1}
                    value={killFreqs[k.key]}
                    onChange={(e) => setKillFreqs((s) => ({ ...s, [k.key]: +e.target.value }))} />
                </div>
              )}
              {advanced && (k.key === "bass" || k.key === "mid" || k.key === "high") && (
                <div className="kill-trim-row">
                  <span className="mono kill-trim-lbl">Q {killQ[k.key].toFixed(2)}</span>
                  <input type="range" min={0.3} max={10} step={0.1}
                    value={killQ[k.key]}
                    onChange={(e) => setKillQ((s) => ({ ...s, [k.key]: +e.target.value }))} />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

        </div>{/* /main-col */}

        {/* ============ RIGHT RAIL ============ */}
        <div className="right-rail">
          <div id="rack-pads" className="panel with-screws rack-sample-triggers">
            <div className="screw-bl"></div><div className="screw-br"></div>
            <div className="panel-header">
              <span className="panel-title">Sample Triggers</span>
            </div>
            <div className="panel-body" style={{ padding: 6 }}>
              <div className="trigger-list">
                {(eng.samples?.samples || [
                  { name: "Deceleration.mp3" }, { name: "EchoChamber.mp3" }, { name: "DistantBeacon.mp3" },
                  { name: "FastLickshot.mp3" }, { name: "LongNoise.mp3" }, { name: "HighPitch.mp3" },
                  { name: "MediumRate.mp3" }, { name: "PowerUp.mp3" }, { name: "NoiseSweep.mp3" },
                  { name: "RadioSignal.mp3" }, { name: "SlowRate.mp3" }, { name: "SwitchOff.mp3" },
                ]).map((s, i) => (
                  <div key={i} role="button" tabIndex={0}
                    aria-label={`Trigger sample ${i + 1}: ${s.name || "empty"}`}
                    aria-pressed={selectedSample === i}
                    className={`trigger-row ${flashIdx === i ? "flash" : ""} ${selectedSample === i ? "selected" : ""} ${sampleDropIdx === i ? "sample-drop" : ""}`}
                    onPointerDown={async () => { await triggerSample(i); }}
                    onPointerUp={() => releaseSample(i)}
                    onPointerLeave={() => releaseSample(i)}
                    onKeyDown={(event) => {
                      if ((event.key === " " || event.key === "Enter") && !event.repeat) {
                        event.preventDefault();
                        triggerSample(i);
                      }
                    }}
                    onKeyUp={(event) => {
                      if (event.key === " " || event.key === "Enter") releaseSample(i);
                    }}
                    onDragOver={(e) => { e.preventDefault(); setSampleDropIdx(i); }}
                    onDragLeave={(e) => { if (e.currentTarget === e.target) setSampleDropIdx(null); }}
                    onDrop={onSampleDrop(i)}
                    title="Drop an audio file to replace this slot">
                    <span className="trigger-num mono">{String(i + 1).padStart(2, "0")}</span>
                    <span className="trigger-name">{(s.custom ? "● " : "") + (s.name || "—")}</span>
                    <span className={`trigger-hold mono ${sampleFx.hold ? "on" : ""}`}>HOLD</span>
                  </div>
                ))}
              </div>
              <div className="row gap-2" style={{ marginTop: 6, justifyContent: "center" }}>
                <button className={`btn-xs btn ${sampleFx.hold ? "active" : ""}`}
                  onClick={() => setSampleFx(s => ({ ...s, hold: !s.hold }))}
                  title="HOLD: loop the sample while the pad is held (vs one-shot)">HOLD</button>
                <button className={`btn-xs btn ${sampleFx.reverse ? "active" : ""}`}
                  onClick={() => setSampleFx(s => ({ ...s, reverse: !s.reverse }))}
                  title="Play samples reversed (backwards)">REV</button>
              </div>
              <div className="row gap-2" style={{ marginTop: 6, justifyContent: "center" }}>
                <button className="btn-xs btn" onClick={saveSampleSet} title="Save the 12 sample slots to a .zip">SAVE SET</button>
                <label className="btn-xs btn" style={{ cursor: "pointer" }} title="Load a sample set .zip">
                  LOAD SET
                  <input type="file" className="hidden" accept=".zip,application/zip" onChange={loadSampleSet} />
                </label>
              </div>
              <div className="row gap-1" style={{ marginTop: 6, justifyContent: "center", flexWrap: "wrap" }}>
                <button className="btn-xs btn" onClick={savePreset}>SAVE</button>
                <label className="btn-xs btn" style={{ cursor: "pointer" }}>
                  LOAD
                  <input type="file" className="hidden" accept="application/json" onChange={loadPreset} />
                </label>
                <button className="btn-xs btn" onClick={() => {
                  setGeqA(Array(10).fill(0)); setGeqB(Array(10).fill(0));
                  setKills({ sub: false, bass: false, mid: false, high: false, top: false });
                }}>CLEAR</button>
                <button className="btn-xs btn" onClick={factoryReset} title="Restore factory defaults (irreversible)">RESET</button>
                <button className={`btn-xs btn ${rewindStop ? "active" : ""}`}
                  onClick={() => setRewindStop((v) => !v)}
                  title="Rewind button: stop after rewind (cue) vs keep playing">
                  RWD:{rewindStop ? "STOP" : "PLAY"}
                </button>
                <button className={`btn-xs btn ${midiOpen ? "active" : ""}`}
                  onClick={() => setMidiOpen(true)} title="MIDI controller mapping">MIDI</button>
              </div>
              <div className="end-mode-selector" role="radiogroup" aria-label="Deck end mode">
                <span className="end-mode-label">END</span>
                {DECK_END_MODES.map((mode) => (
                  <button key={mode}
                    className={`btn-xs btn end-mode-option ${mode} ${deckEndMode === mode ? "active" : ""}`}
                    role="radio"
                    aria-checked={deckEndMode === mode}
                    onClick={() => setDeckEndMode(mode)}
                    title={mode === "stop"
                      ? "Stop when the current track ends"
                      : mode === "loop"
                        ? "Repeat the current track"
                        : "Play the next playlist track, then stop after the last"}>
                    {mode.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="strip-readout" style={{ marginTop: 4 }}>
                <span>HP FILTER</span>
                <span className="v mono">{sampleFx.hp <= 21 ? "OFF" : sampleFx.hp.toFixed(0) + " Hz"}</span>
              </div>
              <input type="range" min={20} max={2000} step={1} value={sampleFx.hp}
                className={midiLearnId === "samples.hp" ? "midi-learning" : ""}
                onPointerDownCapture={(e) => { if (e.metaKey && e.shiftKey) { e.preventDefault(); e.stopPropagation(); midiLearnFromUi("samples.hp"); } }}
                onChange={(e) => setSampleFx(s => ({ ...s, hp: +e.target.value }))}
                title="High-pass the sample player — keep stabs/FX above the bass · Cmd+Shift+click to MIDI-learn"
                style={{ width: "100%" }} />
              <div className="strip-readout" style={{ marginTop: 4 }}>
                <span>ECHO SEND LEVEL</span>
                <span className="v mono">{(sampleFx.echoSend * 100).toFixed(0)}%</span>
              </div>
              <button className={`btn sm ${advanced ? "active" : ""}`}
                style={{ width: "100%", marginTop: 8 }}
                onClick={() => setAdvanced(!advanced)}>
                ADVANCED MODE
              </button>
              {advanced && (
                <div className="launchpad-brightness-control">
                  <div className="strip-readout">
                    <span>LAUNCHPAD LED</span>
                    <span className="v mono">
                      {launchpadBrightness === null
                        ? "DEVICE"
                        : `${Math.round((launchpadBrightness / 127) * 100)}%`}
                    </span>
                  </div>
                  <select
                    className="launchpad-brightness-select mono"
                    aria-label="Launchpad LED brightness"
                    value={launchpadBrightness === null ? "" : launchpadBrightness}
                    onChange={(event) => changeLaunchpadBrightness(event.target.value)}>
                    <option value="" disabled>USE DEVICE SETTING</option>
                    {LAUNCHPAD_BRIGHTNESS_LEVELS.map((value, index) => (
                      <option key={value} value={value}>
                        {`LEVEL ${index + 1} / 8${index === 0 ? " · LOW" : index === 7 ? " · MAX" : ""}`}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-xs btn"
                    style={{ width: "100%", marginTop: 6 }}
                    onClick={clearSavedSession}
                    title="Delete locally persisted audio files for both decks">
                    CLEAR SAVED SESSION
                  </button>
                </div>
              )}
            </div>
          </div>

          <div id="rack-output" className="panel with-screws rack-limiters">
            <div className="screw-bl"></div><div className="screw-br"></div>
            <div className="panel-header">
              <span className="panel-title">Limiters</span>
            </div>
            <div className="panel-body col gap-3">
              <div className="lim-row-edit">
                <span className={`lim-tag lit ${gr.master < -0.5 ? "reducing" : ""}`} title="Gain reduction">
                  MASTER{gr.master < -0.5 ? ` ${gr.master.toFixed(0)}` : ""}
                </span>
                <Knob size="sm" midiId="master.lim" label="THRESH" value={master.limThresh} min={-24} max={0}
                  onChange={(v) => setMaster(s => ({ ...s, limThresh: v }))}
                  format={(v) => v.toFixed(0) + "dB"} />
                <button className={`btn-xs btn ${master.limOn ? "active" : ""}`}
                  onClick={() => setMaster(s => ({ ...s, limOn: !s.limOn }))}>
                  {master.limOn ? "ON" : "OFF"}
                </button>
              </div>
              <div className="lim-row-edit">
                <span className={`lim-tag lit ${gr.reverb < -0.5 ? "reducing" : ""}`} title="Gain reduction">
                  REVERB{gr.reverb < -0.5 ? ` ${gr.reverb.toFixed(0)}` : ""}
                </span>
                <Knob size="sm" label="THRESH" value={revLim.thresh} min={-24} max={0}
                  onChange={(v) => setRevLim(s => ({ ...s, thresh: v }))}
                  format={(v) => v.toFixed(0) + "dB"} />
                <button className={`btn-xs btn ${revLim.on ? "active" : ""}`}
                  onClick={() => setRevLim(s => ({ ...s, on: !s.on }))}>
                  {revLim.on ? "ON" : "OFF"}
                </button>
              </div>
              <div className="lim-row-edit">
                <span className={`lim-tag lit ${gr.echo < -0.5 ? "reducing" : ""}`} title="Gain reduction">
                  ECHO{gr.echo < -0.5 ? ` ${gr.echo.toFixed(0)}` : ""}
                </span>
                <Knob size="sm" label="THRESH" value={echoLim.thresh} min={-24} max={0}
                  onChange={(v) => setEchoLim(s => ({ ...s, thresh: v }))}
                  format={(v) => v.toFixed(0) + "dB"} />
                <button className={`btn-xs btn ${echoLim.on ? "active" : ""}`}
                  onClick={() => setEchoLim(s => ({ ...s, on: !s.on }))}>
                  {echoLim.on ? "ON" : "OFF"}
                </button>
              </div>
            </div>
          </div>

          <div className="panel with-screws rack-recorder">
            <div className="screw-bl"></div><div className="screw-br"></div>
            <div className="panel-header">
              <span className="panel-title">Recorder</span>
              <span className="panel-sub">{recording ? "● REC" : "READY"}</span>
            </div>
            <div className="panel-body">
              <div className="row gap-2">
                <button className="btn-xs btn" title="Recording format" disabled={recording}
                  onClick={() => setRecFormat((f) => (f === "wav" ? "aiff" : "wav"))}>
                  {recFormat.toUpperCase()}
                </button>
                <button className={`btn-xs btn ${recording ? "active" : ""}`} onClick={toggleRecord}>
                  {recording ? "STOP" : "START"}
                </button>
                <button className="btn-xs btn" onClick={toggleRecord} disabled={!recording}>STOP</button>
              </div>
              {recUrl && (
                <a className="btn sm" style={{ width: "100%", marginTop: 6, display: "block", textAlign: "center" }} href={recUrl} download={`dubnator-mix.${recExt}`}>DOWNLOAD MIX</a>
              )}
              {recording && <div className="warning-strip" style={{ marginTop: 6 }}>RECORDING TO MEMORY</div>}
            </div>
          </div>
        </div>{/* /right-rail */}
      </div>{/* /grid-app */}

      {/* footer */}
      <div className="row between rack-footer" style={{ marginTop: 14, padding: "0 8px", fontSize: 9, letterSpacing: "0.25em", textTransform: "uppercase", color: "var(--text-faint)" }}>
        <span>DUBNATOR MK-1 · ORIGINAL DESIGN {advanced ? "· ADV" : "· NORMAL"}</span>
        <span>SHORTCUTS: ? = ALL KEYS · ZXCVB = KILLS · G/H = PLAY · 1 = SIREN · 9 = TAP · −/+ = DUB FILTER</span>
        <span>© 2026</span>
      </div>

      {/* TWEAKS */}
      <TweaksPanelMount tweaks={tweaks} setTweaks={setTweaks} />
    </div>
    </MidiLearnContext.Provider>
  );
}

function TweaksPanelMount({ tweaks, setTweaks }) {
  if (!window.TweaksPanel) return null;
  const { TweaksPanel, TweakSection, TweakColor, TweakToggle, TweakSelect } = window;
  return (
    <TweaksPanel title="Tweaks">
      <TweakSection title="Color">
        <TweakColor label="Accent" value={tweaks.accent} onChange={(v) => setTweaks({ accent: v })} />
      </TweakSection>
      <TweakSection title="Aesthetic">
        <TweakToggle label="Show grid" value={tweaks.showGrid} onChange={(v) => setTweaks({ showGrid: v })} />
        <TweakSelect label="Knob style"
          value={tweaks.knobStyle}
          options={["machined", "matte", "ringed"]}
          onChange={(v) => setTweaks({ knobStyle: v })} />
      </TweakSection>
    </TweaksPanel>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
