/* global React */

const { useMemo: useLaunchpadMemo, useState: useLaunchpadState } = React;

const LAUNCHPAD_ROLES = [
  {
    status: "LEFT / MIX",
    eyebrow: "LEFT CONTROLLER",
    title: "Mix · Siren",
    summary: "Mix, decks, inputs, isolator, siren and master controls.",
  },
  {
    status: "RIGHT / FX",
    eyebrow: "RIGHT CONTROLLER",
    title: "FX · EQ",
    summary: "Echo, reverb, filter, samples, advanced isolator and EQ controls.",
  },
];

function launchpadShortLabel(label) {
  const text = String(label || "—")
    .replace(/Deck [AB]\s*/i, "")
    .replace(/Siren\s*/i, "S ")
    .replace(/Samples?\s*/i, "S ")
    .replace(/Reverb\s*/i, "R ")
    .replace(/Echo\s*/i, "E ")
    .replace(/Dub Filter\s*/i, "DF ")
    .replace(/Limiter\s*/i, "LIM ");
  const numbered = text.match(/^(.*?)\s*(\d+)$/);
  if (numbered) {
    const prefix = numbered[1].split(/\s+/).filter(Boolean).map((word) => word[0]).join("");
    return `${prefix}${numbered[2]}`.slice(0, 5).toUpperCase();
  }
  const words = text.split(/[\s/→—-]+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 5).toUpperCase();
  return words.map((word) => word[0]).join("").slice(0, 5).toUpperCase();
}

function launchpadControlDescription(id, control, metered) {
  const label = control?.label || id;
  const band = id.match(/^kill\.(sub|bass|mid|high|top)(?:\.(trim|solo|freq|q))?$/);
  if (band) {
    const names = { sub: "SUB", bass: "LOW", mid: "MID", high: "HIGH", top: "TOP" };
    if (!band[2]) return `Engages or releases the full cut for the ${names[band[1]]} band.`;
    if (band[2] === "solo") return `Keeps ${names[band[1]]} audible while temporarily cutting every other band.`;
    if (band[2] === "trim") {
      return `Adjusts ${names[band[1]]} gain. The bottom pad engages KILL; any higher pad releases it.${metered ? " LEDs also show its live level." : ""}`;
    }
    if (band[2] === "freq") return `Moves the crossover frequency for the ${names[band[1]]} band.`;
    return `Adjusts resonance/Q for the ${names[band[1]]} band.`;
  }

  const exact = {
    "siren.trigger": "Fires the siren while the button is held.",
    "siren.prev": "Loads the previous siren preset, wrapping from the first to the last.",
    "siren.next": "Loads the next siren preset, wrapping from the last to the first.",
    "siren.preset": "Moves quickly across the complete siren preset bank.",
    "music.rev": "Enables or disables the music mix send to reverb.",
    "music.echo": "Enables or disables the music mix send to echo.",
    "aux.rev": "Enables or disables the AUX send to reverb.",
    "aux.echo": "Enables or disables the AUX send to echo.",
    "xfade.a": "Lleva inmediatamente el crossfader al lado A.",
    "xfade.center": "Centra exactamente el crossfader.",
    "xfade.b": "Lleva inmediatamente el crossfader al lado B.",
    "echo.panic": "Immediately clears the active echo and reverb tails.",
    "echo.tap": "Sets echo tempo manually from repeated taps.",
    "recorder.toggle": "Starts or stops master recording.",
    "recorder.format": "Switches the recording format between WAV and AIFF.",
    "system.advanced": "Enables advanced isolator controls and positive gain ranges.",
  };
  if (exact[id]) return exact[id];

  if (/\.play$/.test(id)) return `Plays or pauses ${label.replace(" Play/Pause", "")}.`;
  if (/\.stop$/.test(id)) return `Stops ${label.replace(" Stop", "")} and returns to the start.`;
  if (/\.mute$/.test(id)) return `Mutes or restores ${label.replace(" Mute", "")}.`;
  if (/\.prev$/.test(id)) return `Selects the previous item: ${label}.`;
  if (/\.next$/.test(id)) return `Selects the next item: ${label}.`;
  if (/\.cue$/.test(id)) return `Stores the current cue point: ${label}.`;
  if (/jumpcue$/.test(id)) return `Jumps to the stored cue point: ${label}.`;
  if (/loop\.in$/.test(id)) return "Marks the loop start at the current position.";
  if (/loop\.out$/.test(id)) return "Marks the loop end and enables the loop.";
  if (/loop\.clear$/.test(id)) return "Disables and clears the loop region.";
  if (/loop\.beat/.test(id)) return `Creates an immediate ${label.replace(/^.*?(\d+).*$/, "$1")}-beat loop.`;
  if (/loop\.half$/.test(id)) return "Halves the current loop length.";
  if (/loop\.double$/.test(id)) return "Doubles the current loop length.";
  if (/samples\.trigger/.test(id)) return `Fires ${label}; release stops it unless HOLD is enabled.`;
  if (/route\./.test(id)) return `Selects this Dub Filter destination: ${label}.`;
  if (/\.freeze$/.test(id)) return "Freezes or releases the current reverb tail.";

  if (control?.type === "range") {
    return `Adjusts ${label}. Press a row in the column: bottom is minimum, top is maximum.${metered ? " The column combines a white position marker with live VU." : ""}`;
  }
  if (control?.momentary) return `Runs ${label} while the pad is held.`;
  return `Enables or disables ${label}. A bright LED means it is active.`;
}

function LaunchpadBoard({ role, manager, catalogMap, devices, pageIndex, onPageChange }) {
  const [hovered, setHovered] = useLaunchpadState(null);
  const roleInfo = LAUNCHPAD_ROLES[role];
  const pages = manager.pages[role];
  const layout = manager.describePage(role, pageIndex);
  const connected = devices.find((device) => device.role === roleInfo.status);
  const gridButtons = new Map(layout.gridButtons.map((button) => [`${button.row}:${button.column}`, button.id]));
  const meterRanges = new Set(layout.meterRanges);

  const inspectControl = (id, kind, row = null, column = null) => {
    if (!id) return;
    const control = catalogMap.get(id);
    const metered = meterRanges.has(id);
    setHovered({
      id,
      kind,
      row,
      column,
      title: control?.label || id,
      tone: manager.controlTone(id, layout.colour),
      description: launchpadControlDescription(id, control, metered),
      metered,
    });
  };

  const inspectPage = (surfacePage, index) => {
    setHovered({
      kind: "page",
      page: index,
      title: surfacePage.name,
      tone: surfacePage.tone,
      description: `Top button ${index + 1}. Opens ${surfacePage.name} on this Launchpad without changing the other device.`,
    });
  };

  const inspector = hovered || {
    kind: "page",
    page: pageIndex,
    title: layout.name,
    tone: layout.tone,
    description: `${roleInfo.summary} Hover or focus any fader or button to inspect its function.`,
  };
  const inspectorTag = inspector.kind === "page"
    ? `PAGE ${Number(inspector.page) + 1}`
    : inspector.kind === "fader"
      ? `${inspector.metered ? "FADER + VU" : "FADER"} · STEP ${8 - inspector.row}/8`
      : "BUTTON";

  return (
    <article className={`lp-help-board lp-theme-${layout.tone}`}>
      <div className="lp-help-board-heading">
        <div>
          <div className="lp-help-kicker mono">{roleInfo.eyebrow}</div>
          <h4>{roleInfo.title}</h4>
        </div>
        <span className={`lp-help-connection${connected?.connected ? " is-connected" : ""}`}>
          {connected?.connected ? "● CONNECTED" : "○ PREVIEW"}
        </span>
      </div>

      <div className="lp-help-device">
        <div className="lp-help-device-top">
          <div className="lp-help-logo">DUB</div>
          <div className="lp-help-pages">
            {pages.map((surfacePage, index) => (
              <button
                key={surfacePage.name}
                className={`lp-tone-${surfacePage.tone} ${index === pageIndex ? "active" : ""}${connected && connected.page === index ? " hardware-active" : ""}${hovered?.kind === "page" && hovered.page === index ? " is-inspected" : ""}`}
                onClick={() => onPageChange(index)}
                onMouseEnter={() => inspectPage(surfacePage, index)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => inspectPage(surfacePage, index)}
                onBlur={() => setHovered(null)}
                title={`Top ${index + 1}: ${surfacePage.name}`}
              >
                <span>{index + 1}</span>
                {surfacePage.name}
              </button>
            ))}
          </div>
        </div>

        <div className="lp-help-current">
          <span className="lp-help-led"></span>
          <strong>{layout.name}</strong>
          <span>{connected ? connected.name : roleInfo.status}</span>
        </div>

        <div className={`lp-help-inspector lp-tone-${inspector.tone || layout.tone}`}>
          <span className="lp-help-inspector-led"></span>
          <div className="lp-help-inspector-copy">
            <div>
              <b>{inspector.title}</b>
              <em>{inspectorTag}</em>
            </div>
            <p>{inspector.description}</p>
          </div>
        </div>

        <div className="lp-help-column-labels">
          {Array.from({ length: 8 }, (_, column) => {
            const id = layout.ranges[column];
            const label = id ? catalogMap.get(id)?.label || id : "Button pads";
            return (
              <div
                key={column}
                className={id && hovered?.id === id ? "is-inspected" : ""}
                onMouseEnter={() => id && inspectControl(id, "fader", 3, column)}
                onMouseLeave={() => setHovered(null)}
                title={label}
              >
                <b>{column + 1}</b>
                <span>{id ? launchpadShortLabel(label) : "PADS"}</span>
                {id && meterRanges.has(id) && <em>VU</em>}
              </div>
            );
          })}
          <div><b>9</b><span>SIDE</span></div>
        </div>

        <div className="lp-help-grid">
          {Array.from({ length: 8 }, (_, row) => (
            <React.Fragment key={row}>
              {Array.from({ length: 8 }, (_, column) => {
                const range = layout.ranges[column];
                const button = gridButtons.get(`${row}:${column}`);
                const id = range || button;
                const label = id ? catalogMap.get(id)?.label || id : "";
                const tone = id ? manager.controlTone(id, layout.colour) : "";
                const metered = !!range && meterRanges.has(range);
                const inspected = !!id && hovered?.id === id;
                const hoverStep = inspected && hovered?.row === row && hovered?.column === column;
                const bandMeter = !!range && /^kill\.(sub|bass|mid|high|top)\.trim$/.test(range);
                return (
                  <div
                    key={`${row}:${column}`}
                    className={`lp-help-pad${tone ? ` lp-tone-${tone}` : ""}${range ? " is-fader" : ""}${metered ? ` is-metered vu-step-${7 - row}` : ""}${bandMeter ? " is-band-meter" : ""}${button ? " is-button" : ""}${!id ? " is-empty" : ""}${inspected ? " is-inspected" : ""}${hoverStep ? " is-hover-step" : ""}`}
                    onMouseEnter={() => id && inspectControl(id, range ? "fader" : "button", row, column)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => id && inspectControl(id, range ? "fader" : "button", row, column)}
                    onBlur={() => setHovered(null)}
                    tabIndex={id ? 0 : -1}
                    role={id ? "img" : undefined}
                    aria-label={id ? `${label}. ${launchpadControlDescription(id, catalogMap.get(id), metered)}` : undefined}
                    title={label}
                  >
                    {range ? (
                      <>
                        <span className="lp-help-fader-segment"></span>
                        {row === 3 && <b>{launchpadShortLabel(label)}</b>}
                      </>
                    ) : button ? <b>{launchpadShortLabel(label)}</b> : null}
                  </div>
                );
              })}
              {(() => {
                const id = layout.sideButtons[row];
                const label = id ? catalogMap.get(id)?.label || id : "";
                const tone = id ? manager.controlTone(id, layout.colour) : "";
                const inspected = !!id && hovered?.id === id;
                return (
                  <div
                    className={`lp-help-pad is-side${tone ? ` lp-tone-${tone}` : ""}${id ? " is-button" : " is-empty"}${inspected ? " is-inspected is-hover-step" : ""}`}
                    onMouseEnter={() => id && inspectControl(id, "button", row, 8)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => id && inspectControl(id, "button", row, 8)}
                    onBlur={() => setHovered(null)}
                    tabIndex={id ? 0 : -1}
                    role={id ? "img" : undefined}
                    aria-label={id ? `${label}. ${launchpadControlDescription(id, catalogMap.get(id), false)}` : undefined}
                    title={label}
                  >
                    {id ? <b>{launchpadShortLabel(label)}</b> : null}
                  </div>
                );
              })()}
            </React.Fragment>
          ))}
        </div>
      </div>
    </article>
  );
}

function LaunchpadLayoutHelp({ catalog, devices = [] }) {
  const [pageIndexes, setPageIndexes] = useLaunchpadState([0, 0]);
  const manager = useLaunchpadMemo(() => {
    const LP = window.DubnatorLaunchpad;
    return LP ? new LP.LaunchpadMiniMk3Manager({ catalog }) : null;
  }, [catalog]);
  const catalogMap = useLaunchpadMemo(
    () => new Map(catalog.map((control) => [control.id, control])),
    [catalog],
  );
  if (!manager) return null;

  const selectPage = (role, page) => {
    setPageIndexes((current) => current.map((value, index) => index === role ? page : value));
  };

  return (
    <section className="lp-help">
      <div className="lp-help-heading">
        <div>
          <div className="lp-help-kicker mono">DUAL CONTROL SURFACE · LIVE REFERENCE</div>
          <h3>Launchpad Mini MK3 layouts</h3>
        </div>
        <div className="lp-help-hover-hint mono">
          HOVER / FOCUS A PAD → HIGHLIGHT + DESCRIPTION
        </div>
      </div>

      <div className="lp-help-boards">
        {[0, 1].map((role) => (
          <LaunchpadBoard
            key={role}
            role={role}
            manager={manager}
            catalogMap={catalogMap}
            devices={devices}
            pageIndex={pageIndexes[role]}
            onPageChange={(page) => selectPage(role, page)}
          />
        ))}
      </div>

      <div className="lp-help-colour-key mono">
        <span className="lp-tone-red">RED · STOP / SUB</span>
        <span className="lp-tone-orange">ORANGE · ECHO / LOW</span>
        <span className="lp-tone-yellow">YELLOW · CUE / MID</span>
        <span className="lp-tone-cyan">CYAN · FILTER / HIGH</span>
        <span className="lp-tone-green">GREEN · PLAY / TOP</span>
        <span className="lp-tone-violet">VIOLET · REVERB</span>
        <span className="lp-vu-gradient">VU · LIVE LEVEL</span>
        <span className="lp-bank-rainbow">RAINBOW · BANK SLOTS</span>
      </div>

      <div className="lp-help-note mono">
        CLICK A TOP BUTTON TO PREVIEW ITS PAGE · EACH LAUNCHPAD CHANGES PAGE INDEPENDENTLY ·
        HOVER A FADER ROW TO HIGHLIGHT ITS FULL COLUMN · BRIGHT LED = ACTIVE ·
        WHITE LED = EXACT FADER POSITION
      </div>
    </section>
  );
}

window.DubnatorLaunchpadHelp = {
  LaunchpadLayoutHelp,
  launchpadControlDescription,
  launchpadShortLabel,
};
