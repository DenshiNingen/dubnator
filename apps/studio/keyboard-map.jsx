/* global React */

// Canonical visual map for the studio's keyboard shortcuts. Keeping presentation
// data outside App makes the overlay independently testable and prevents the
// main control component from carrying a large static structure.
const KEY_ROWS = [
  [
    { k: "Esc", w: 1.4, color: "screen", top: "Close Floating Window" },
    { k: "1", color: "siren", top: "Siren Trigger", topMom: true, bot: "Siren Default" },
    { k: "2", color: "siren", top: "Preset Down" },
    { k: "3", color: "siren", top: "Preset Up" },
    { k: "4", color: "sample", top: "Sample Trigger", topMom: true },
    { k: "5", color: "reverb", top: "Reverb Band Lower" },
    { k: "6", color: "reverb", top: "Reverb Band Higher" },
    { k: "7", color: "echo", top: "Echo Band Lower" },
    { k: "8", color: "echo", top: "Echo Band Higher" },
    { k: "9", color: "echo", top: "Echo Tap Tempo" },
    { k: "0", color: "screen", top: "Full Screen" },
    { k: "−", color: "filter", top: "Dub Filter LP" },
    { k: "+", color: "filter", top: "Dub Filter HP" },
    { k: "Backspace", w: 1.6, color: "blank" },
  ],
  [
    { k: "Tab", w: 1.4, color: "blank" },
    { k: "Q", color: "reverb", top: "Reverb Trigger", topMom: true, bot: "Latch" },
    { k: "W", color: "echo", top: "Echo Trigger", topMom: true, bot: "Latch" },
    { k: "E", color: "echo", top: "Echo 100% Feedback", topMom: true },
    { k: "R", color: "sample", top: "Sample Select" },
    { k: "T", color: "deck", top: "Load Track A" },
    { k: "Y", color: "deck", top: "Load Track B" },
    { k: "U", color: "sample", top: "Sample Reverb", topMom: true },
    { k: "I", color: "sample", top: "Sample Echo", topMom: true },
    { k: "O", color: "mic", top: "Mic Reverb", topMom: true },
    { k: "P", color: "mic", top: "Mic Echo", topMom: true, bot: "Panel" },
    { k: "[", color: "playlist", top: "Scroll Down A", bot: "Previous" },
    { k: "]", color: "playlist", top: "Scroll Up A", bot: "Next" },
    { k: "\\", w: 1.2, color: "fx", top: "FX Direct" },
  ],
  [
    { k: "Caps", w: 1.6, color: "blank" },
    { k: "A", color: "echo", top: "Echo Time Fast", bot: "Audio" },
    { k: "S", color: "echo", top: "Echo Time Slow", bot: "Setup" },
    { k: "D", color: "echo", top: "Echo 70% Feedback", topMom: true, bot: "Type" },
    { k: "F", color: "echo", top: "Echo 90% Feedback", topMom: true },
    { k: "G", color: "deck", top: "Play Track A", bot: "Rewind A" },
    { k: "H", color: "deck", top: "Play Track B", bot: "Rewind B" },
    { k: "J", color: "mute", top: "Mute 1" },
    { k: "K", color: "mute", top: "Mute 2" },
    { k: "L", color: "mute", top: "Mic Mute" },
    { k: ";", color: "playlist", top: "Scroll Down B", bot: "Previous" },
    { k: "'", color: "playlist", top: "Scroll Up B", bot: "Next" },
    { k: "Enter", w: 1.8, color: "blank" },
  ],
  [
    { k: "Shift", w: 1.8, color: "shift" },
    { k: "Z", color: "kill", top: "Sub Kill", bot: "punch" },
    { k: "X", color: "kill", top: "Low Kill", bot: "punch" },
    { k: "C", color: "kill", top: "Mid Kill", bot: "punch" },
    { k: "V", color: "kill", top: "High Kill", bot: "punch" },
    { k: "B", color: "kill", top: "Top Kill", bot: "punch" },
    { k: "N", color: "blank" },
    { k: "M", color: "deck", top: "Stop A" },
    { k: ",", color: "deck", top: "Stop B" },
    { k: ".", color: "deck", top: "Load & Play A" },
    { k: "/", color: "deck", top: "Load & Play B" },
    { k: "Shift", w: 2.4, color: "shift" },
  ],
  [
    { k: "Ctrl", w: 1.2, color: "blank" },
    { k: "Alt", w: 1, color: "blank" },
    { k: "Cmd", w: 1.2, color: "blank" },
    { k: "Space", w: 6, color: "playlist", top: "Playbar List View" },
    { k: "Cmd", w: 1.2, color: "blank" },
    { k: "Alt", w: 1, color: "blank" },
    { k: "←", color: "filter", top: "Dub Filter Down" },
    { k: "↓", color: "blank" },
    { k: "→", color: "filter", top: "Dub Filter Up" },
  ],
];

const COLOR_LEGEND = [
  { c: "siren", n: "Dub Siren" },
  { c: "sample", n: "Sample Player" },
  { c: "reverb", n: "Reverb" },
  { c: "echo", n: "Echo / Tape" },
  { c: "kill", n: "Kills" },
  { c: "deck", n: "Decks" },
  { c: "playlist", n: "Playlist / Scroll" },
  { c: "mic", n: "Mic / Aux" },
  { c: "mute", n: "Mute" },
  { c: "filter", n: "Dub Filter" },
  { c: "screen", n: "Screen" },
  { c: "fx", n: "FX Direct" },
];

function KeyboardMap() {
  return (
    <div className="kb-wrap">
      <div className="kb-keyboard">
        {KEY_ROWS.map((row, rowIndex) => (
          <div className="kb-row" key={rowIndex}>
            {row.map((key, keyIndex) => (
              <div
                key={keyIndex}
                className={`kb-key kb-${key.color || "blank"}${key.color === "blank" ? " is-blank" : ""}${key.k === "Shift" ? " kb-key-shift" : ""}`}
                style={{ flex: key.w || 1 }}
              >
                <div className="kb-face">{key.k}</div>
                {key.top && (
                  <div className={`kb-top ${key.topMom ? "is-mom" : ""}`}>{key.top}</div>
                )}
                {key.bot && <div className="kb-bot">⇧ {key.bot}</div>}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="kb-legend-row">
        <div className="kb-legend-title mono">LEGEND</div>
        <div className="kb-legend">
          {COLOR_LEGEND.map((item) => (
            <span key={item.c} className="kb-legend-item">
              <span className={`kb-legend-swatch kb-${item.c}`}></span>
              {item.n}
            </span>
          ))}
          <span className="kb-legend-item">
            <span className="kb-legend-swatch kb-mom-swatch"></span>
            Momentary (active while held)
          </span>
          <span className="kb-legend-item">
            <span className="kb-legend-swatch kb-shift-swatch">⇧</span>
            Action when held with Shift
          </span>
          <span className="kb-legend-item">
            <span className="kb-legend-swatch kb-midi-swatch">⌘⇧</span>
            Cmd+Shift+click any knob / fader → MIDI-learn it (then move a controller). Esc cancels.
          </span>
        </div>
      </div>
      <div className="kb-foot mono">
        English keyboard shortcuts · inspired by the Dub FX Live reference
      </div>
    </div>
  );
}

window.DubnatorKeyboardMap = { KeyboardMap, KEY_ROWS };
