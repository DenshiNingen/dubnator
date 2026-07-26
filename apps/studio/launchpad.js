// Novation Launchpad Mini MK3 dual-surface integration.
//
// The controller runs each Launchpad's MIDI port in Programmer Mode. The top
// row selects one of eight pages, each 8x8 grid mixes vertical faders and
// buttons, and the right column supplies another eight buttons. State is
// rendered back as one batched 81-LED SysEx frame.
(function () {
  const SYSEX = [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d];
  const PROGRAMMER_MODE = [...SYSEX, 0x0e, 0x01, 0xf7];
  const LIVE_MODE = [...SYSEX, 0x0e, 0x00, 0xf7];
  const FEEDBACK_EXTERNAL_ONLY = [...SYSEX, 0x0a, 0x00, 0x01, 0xf7];
  const SINGLE_ROLE_HOLD_MS = 450;
  const SINGLE_ROLE_BUTTONS = { 2: 0, 3: 1 }; // Physical top-row ← / →.

  // Launchpad palette indices. Colour now describes function, while brightness
  // describes value/state. That makes a page readable before any pad is
  // pressed: red is destructive, green performs/enables, yellow marks cues and
  // loops, cyan is filtering, orange is echo, violet is reverb, and numbered
  // banks use a stable rainbow.
  const PALETTES = {
    neutral: { dim: 1, bright: 3 },
    red: { dim: 5, bright: 7 },
    orange: { dim: 9, bright: 11 },
    yellow: { dim: 13, bright: 15 },
    lime: { dim: 17, bright: 19 },
    green: { dim: 21, bright: 23 },
    mint: { dim: 29, bright: 31 },
    cyan: { dim: 37, bright: 39 },
    blue: { dim: 45, bright: 47 },
    violet: { dim: 49, bright: 51 },
    magenta: { dim: 53, bright: 55 },
    pink: { dim: 57, bright: 59 },
  };

  const PAGE_TONES = {
    mixer: "neutral",
    deckA: "green",
    deckB: "blue",
    input: "cyan",
    iso: "yellow",
    sampler: "magenta",
    master: "red",
    echo: "orange",
    reverb: "violet",
    filter: "cyan",
    siren: "pink",
    eq: "lime",
  };

  const SLOT_TONES = [
    "red", "orange", "yellow", "lime", "green", "mint",
    "cyan", "blue", "violet", "magenta", "pink", "neutral",
  ];

  const BAND_TONES = {
    // Match the five isolator curves in the UI: SUB red, LOW orange,
    // MID yellow, HIGH cyan and TOP green.
    sub: "red",
    bass: "orange",
    mid: "yellow",
    high: "cyan",
    top: "green",
  };

  // The two FX pages use compact, related palettes instead of a single colour
  // per page. Echo stays warm (orange/red/yellow) with cyan filtering, while
  // reverb stays cool (violet/blue/cyan) with magenta modulation.
  const FX_CONTROL_TONES = {
    "echo.send": "orange",
    "echo.sat": "red",
    "echo.fb": "yellow",
    "echo.dw": "orange",
    "echo.slide": "yellow",
    "echo.wow": "magenta",
    "echo.time": "yellow",
    "echo.filterfreq": "cyan",
    "echo.filterq": "cyan",
    "echo.div": "yellow",
    "echo.type1": "orange",
    "echo.type2": "orange",
    "echo.tap": "yellow",
    "echo.dub": "orange",
    "echo.throw": "green",
    "echo.sync": "lime",
    "echo.hp": "cyan",
    "echo.robotic": "magenta",
    "echo.panic": "red",
    "reverb.send": "violet",
    "reverb.ret": "violet",
    "reverb.room": "blue",
    "reverb.dw": "violet",
    "reverb.hfd": "cyan",
    "reverb.mod": "magenta",
    "reverb.predelay": "blue",
    "reverb.bpfreq": "cyan",
    "reverb.bpq": "cyan",
    "reverb.bp": "cyan",
    "reverb.freeze": "magenta",
  };

  const METER_CONTROL_IDS = [
    "deckA.gain", "deckB.gain",
    "in1.gain", "in2.gain", "aux.gain",
    "samples.gain", "siren.gain",
    "reverb.ret", "echo.send",
    "master.gain", "flat.gain",
    "kill.sub.trim", "kill.bass.trim", "kill.mid.trim",
    "kill.high.trim", "kill.top.trim",
  ];
  const METER_CONTROLS = new Set(METER_CONTROL_IDS);

  function pageTone(colour) {
    return PAGE_TONES[colour] || "neutral";
  }

  function indexedTone(id, expression) {
    const match = id.match(expression);
    return match ? SLOT_TONES[Number(match[1]) % SLOT_TONES.length] : null;
  }

  function controlTone(id, fallback = "neutral") {
    const sampleSlot = indexedTone(id, /^samples\.trigger\.(\d+)$/);
    if (sampleSlot) return sampleSlot;
    const sirenSlot = indexedTone(id, /^siren\.preset\.(\d+)$/);
    if (sirenSlot) return sirenSlot;

    const killBand = id.match(/^kill\.(sub|bass|mid|high|top)(?:\.|$)/);
    if (killBand) return BAND_TONES[killBand[1]];
    const geqBand = id.match(/^geqA\.(\d+)$/);
    if (geqBand) return SLOT_TONES[Math.min(9, Number(geqBand[1]))];
    if (FX_CONTROL_TONES[id]) return FX_CONTROL_TONES[id];

    // Controls whose function is more useful than their source identity.
    if (/\.mute$|\.stop$|\.panic$|\.clear$|route\.off$/.test(id)) return "red";
    if (/recorder\.toggle$/.test(id)) return "red";
    if (/\.play$|\.trigger$|\.tap$/.test(id)) return "green";
    if (/\.cue$|jumpcue$|loop\.(?:in|out|beat|half|double)/.test(id)) return "yellow";
    if (/\.prev$|\.next$|\.rewind$|rewindlen$|\.reverse$/.test(id)) return "blue";
    if (/\.solo$|pure\.sub$/.test(id)) return "magenta";
    if (/autogain$|autoadvance$/.test(id)) return "green";
    if (/^xfade\.a$/.test(id)) return "green";
    if (/^xfade\.center$/.test(id)) return "neutral";
    if (/^xfade\.b$/.test(id)) return "blue";
    if (/\.pan$|xfade|recorder\.format$/.test(id)) return "yellow";
    if (/limiter\..*\.on$|limiter\.master\.on$/.test(id)) return "green";
    if (/^samples\.hold$/.test(id)) return "yellow";
    if (/^dubfilter\.hp$/.test(id)) return "cyan";
    if (/^dubfilter\.lp$/.test(id)) return "blue";
    if (/^dubfilter\.route\.music$/.test(id)) return "green";
    if (/^dubfilter\.route\.master$/.test(id)) return "neutral";
    if (/^dubfilter\.route\.samples$/.test(id)) return "magenta";

    // Explicit routes and sends keep the colour of their destination.
    if (/\.rev(?:level|send)?$|music\.rev$|aux\.rev$|^reverb\./.test(id)) {
      return /(?:bpfreq|bpq|\.bp)$/.test(id) ? "cyan" : "violet";
    }
    if (/\.echo(?:level|send)?$|music\.echo$|aux\.echo$|^echo\./.test(id)) {
      return /filter|\.hp$/.test(id) ? "cyan" : "orange";
    }
    if (/filter|\.hp$|cutoff|reso|sweep|\.freq$|\.q$/.test(id)) return "cyan";

    // Source/channel identity makes the mixed pages instantly scannable.
    if (/^deckA\./.test(id)) return "green";
    if (/^deckB\./.test(id)) return "blue";
    if (/^in1\./.test(id)) return "mint";
    if (/^in2\./.test(id)) return "cyan";
    if (/^aux\./.test(id)) return "violet";
    if (/^samples\./.test(id)) return "magenta";
    if (/^siren\./.test(id)) {
      if (/lfo/.test(id)) return "violet";
      if (/bits|\.sr$/.test(id)) return "orange";
      return "pink";
    }
    if (/^paramA\d+\.gain$/.test(id)) return "green";
    if (/^master\./.test(id)) {
      if (/\.mono$/.test(id)) return "cyan";
      if (/\.dim$/.test(id)) return "yellow";
      return "neutral";
    }
    if (/^limiter\.reverb/.test(id)) return "violet";
    if (/^limiter\.echo/.test(id)) return "orange";
    if (/^system\.mic$/.test(id)) return "pink";
    if (/^system\.line$/.test(id)) return "cyan";
    if (/^system\.multi$/.test(id)) return "violet";
    if (/^system\./.test(id)) return "yellow";
    if (/flat\.gain/.test(id)) return "neutral";
    return pageTone(fallback);
  }

  function paletteForControl(id, fallback) {
    return PALETTES[controlTone(id, fallback)] || PALETTES.neutral;
  }

  const page = (name, colour, ranges, buttons, tone = pageTone(colour), buttonsOnSide = false) => ({
    name,
    colour,
    tone,
    ranges,
    buttons,
    buttonsOnSide,
  });

  const LEFT_PAGES = [
    page("MIX", "mixer", [
      "deckA.gain", "deckB.gain", "in1.gain", "in2.gain",
      "aux.gain", "master.gain", "xfade", "master.hp",
    ], [
      "deckA.play", "deckB.play", "deckA.stop", "deckB.stop",
      "deckA.mute", "deckB.mute", "master.mono", "master.dim",
    ]),
    page("DECK A", "deckA", [
      "deckA.gain", "deckA.pan", "deckA.rewindlen",
    ], [
      "deckA.prev", "deckA.play", "deckA.next", "deckA.stop", "deckA.rewind",
      "deckA.cue", "deckA.jumpcue", "deckA.mute", "deckA.autogain",
      "deckA.loop.in", "deckA.loop.out", "deckA.loop.clear",
      "deckA.loop.beat1", "deckA.loop.beat2", "deckA.loop.beat4",
      "deckA.loop.half", "deckA.loop.double",
    ]),
    page("DECK B", "deckB", [
      "deckB.gain", "deckB.pan", "deckB.rewindlen",
    ], [
      "deckB.prev", "deckB.play", "deckB.next", "deckB.stop", "deckB.rewind",
      "deckB.cue", "deckB.jumpcue", "deckB.mute", "deckB.autogain",
      "deckB.loop.in", "deckB.loop.out", "deckB.loop.clear",
      "deckB.loop.beat1", "deckB.loop.beat2", "deckB.loop.beat4",
      "deckB.loop.half", "deckB.loop.double",
    ]),
    page("INPUTS", "input", [
      "in1.gain", "in1.pan", "in2.gain", "in2.pan",
      "aux.gain", "aux.hp", "aux.revlevel", "aux.echolevel",
    ], [
      "in1.mute", "in2.mute", "aux.mute", "music.rev",
      "music.echo", "aux.rev", "aux.echo", "system.mic",
    ]),
    page("ISOLATE", "iso", [
      "flat.gain", "kill.sub.trim", "kill.bass.trim",
      "kill.mid.trim", "kill.high.trim", "kill.top.trim",
    ], [
      "kill.sub", "kill.bass", "kill.mid", "kill.high", "kill.top",
      "kill.sub.solo", "kill.bass.solo", "kill.mid.solo",
      "kill.high.solo", "kill.top.solo", "pure.sub",
    ]),
    page("SIREN", "siren", [
      "siren.pitch", "siren.gain", "siren.lfo1rate", "siren.lfo1depth",
      "siren.lfo2rate", "siren.lfo2depth", "siren.revsend", "siren.echosend",
    ], [
      "siren.trigger", "siren.prev", "siren.next",
    ]),
    page("SIR FX", "siren", [
      "siren.pan", "siren.bits", "siren.sr", "siren.preset",
    ], [
      "siren.trigger", "siren.prev", "siren.next",
    ], "magenta", true),
    page("MASTER", "master", [
      "master.gain", "master.hp", "master.lim", "limiter.reverb.thresh",
      "limiter.echo.thresh", "xfade",
    ], [
      "master.mono", "master.dim", "limiter.master.on", "limiter.reverb.on",
      "limiter.echo.on", "xfade.a", "xfade.center", "xfade.b",
      "xfade.curve.power", "xfade.curve.linear", "xfade.curve.sharp",
      "recorder.toggle", "recorder.format", "system.autoadvance",
      "system.rewindstop", "system.line", "system.multi",
    ]),
  ];

  const RIGHT_PAGES = [
    page("ECHO", "echo", [
      "echo.send", "echo.sat", "echo.fb", "echo.dw",
      "echo.slide", "echo.wow", "echo.time", "echo.filterfreq",
    ], [
      "echo.type1", "echo.type2", "echo.tap", "echo.sync",
      "echo.hp", "echo.robotic", "echo.panic", "echo.throw",
    ]),
    page("REVERB", "reverb", [
      "reverb.send", "reverb.ret", "reverb.room", "reverb.dw",
      "reverb.hfd", "reverb.mod", "reverb.predelay", "reverb.bpfreq",
    ], [
      "reverb.freeze", "reverb.bp", null, null,
      null, null, "limiter.reverb.on", "music.rev",
    ]),
    page("FILTER", "filter", [
      "echo.filterq", "echo.div", "reverb.bpq", "dubfilter.cutoff",
      "dubfilter.reso", "dubfilter.sweep", "dubfilter.sweeprate", "samples.hp",
    ], [
      "dubfilter.on", "dubfilter.hp", "dubfilter.lp",
      "dubfilter.route.music", "dubfilter.route.master",
      "dubfilter.route.samples", "dubfilter.route.off",
      "echo.dub",
    ]),
    page("SAMPLES", "sampler", [
      "samples.gain", "samples.hp", "samples.rev", "samples.echo", "samples.select",
    ], [
      ...Array.from({ length: 12 }, (_, i) => `samples.trigger.${i}`),
      "samples.hold", "samples.reverse",
    ]),
    page("ISO ADV", "iso", [
      "kill.sub.freq", "kill.bass.freq", "kill.mid.freq", "kill.high.freq",
      "kill.top.freq", "kill.bass.q", "kill.mid.q", "kill.high.q",
    ], [
      "kill.sub.solo", "kill.bass.solo", "kill.mid.solo",
      "kill.high.solo", "kill.top.solo", "system.advanced",
    ], "lime"),
    page("GEQ 1-8", "eq", [
      ...Array.from({ length: 8 }, (_, i) => `geqA.${i}`),
    ], []),
    page("GEQ+PARA", "eq", [
      "geqA.8", "geqA.9",
      "paramA0.freq", "paramA0.q", "paramA0.gain",
      "paramA1.freq", "paramA1.q", "paramA1.gain",
    ], [], "green"),
    page("PARAM 2-4", "eq", [
      "paramA2.freq", "paramA2.q", "paramA2.gain",
      "paramA3.freq", "paramA3.q", "paramA3.gain",
    ], [], "blue"),
  ];

  function isLaunchpadMiniMk3Port(port) {
    const name = `${port && port.manufacturer ? port.manufacturer : ""} ${port && port.name ? port.name : ""}`;
    return /(launchpad\s*mini|lpminimk3)/i.test(name) && !/\bdaw\b/i.test(name);
  }

  function portSort(a, b) {
    return `${a.name || ""}\0${a.id || ""}`.localeCompare(`${b.name || ""}\0${b.id || ""}`);
  }

  function gridNote(row, column) {
    return (8 - row) * 10 + column + 1;
  }

  function sideNote(row) {
    return (8 - row) * 10 + 9;
  }

  function decodeControl(data) {
    if (!data || data.length < 3) return null;
    const status = data[0] & 0xf0;
    const number = data[1];
    const pressed = status === 0x80 ? false : data[2] > 0;
    if (status === 0xb0) {
      if (number >= 91 && number <= 98) {
        return { area: "top", index: number - 91, pressed };
      }
      // In Programmer Mode Novation sends the right-hand launch column as
      // Control Change 89…19, not Note On/Off like the central 8×8 grid.
      const tens = Math.floor(number / 10);
      if (tens >= 1 && tens <= 8 && number % 10 === 9) {
        return { area: "side", row: 8 - tens, pressed };
      }
      return null;
    }
    if (status !== 0x90 && status !== 0x80) return null;
    const tens = Math.floor(number / 10);
    const ones = number % 10;
    if (tens >= 1 && tens <= 8 && ones >= 1 && ones <= 8) {
      return { area: "grid", row: 8 - tens, column: ones - 1, pressed };
    }
    if (tens >= 1 && tens <= 8 && ones === 9) {
      return { area: "side", row: 8 - tens, pressed };
    }
    return null;
  }

  function normalizeOrientation(orientation) {
    return orientation === "ccw" ? "ccw" : "straight";
  }

  // Normalize events from a unit that is physically rotated 90° counter-
  // clockwise into the same logical surface used by a straight Launchpad.
  // The original right column becomes the top page row, the original top row
  // becomes the outer-left action column, and the 8×8 grid rotates with them.
  function orientControl(control, orientation) {
    if (!control || normalizeOrientation(orientation) !== "ccw") return control;
    if (control.area === "grid") {
      return {
        ...control,
        row: 7 - control.column,
        column: control.row,
      };
    }
    if (control.area === "side") {
      return {
        area: "top",
        index: control.row,
        pressed: control.pressed,
      };
    }
    if (control.area === "top") {
      return {
        area: "side",
        row: 7 - control.index,
        pressed: control.pressed,
      };
    }
    return control;
  }

  function orientedGridNote(orientation, row, column) {
    return normalizeOrientation(orientation) === "ccw"
      ? gridNote(column, 7 - row)
      : gridNote(row, column);
  }

  function orientedTopNote(orientation, index) {
    return normalizeOrientation(orientation) === "ccw"
      ? sideNote(index)
      : 91 + index;
  }

  function orientedSideNote(orientation, row) {
    return normalizeOrientation(orientation) === "ccw"
      ? 91 + (7 - row)
      : sideNote(row);
  }

  function controlSet(pages) {
    const ids = new Set();
    for (const p of pages) {
      for (const id of p.ranges) if (id) ids.add(id);
      for (const id of p.buttons) if (id) ids.add(id);
    }
    return ids;
  }

  // Keep future catalog additions reachable even if a page definition is not
  // updated in the same commit. Missing ranges occupy spare fader columns;
  // missing buttons occupy spare grid/side pads.
  function completePages(left, right, catalog) {
    const pages = [...left, ...right];
    const used = controlSet(pages);
    for (const control of catalog || []) {
      if (used.has(control.id)) continue;
      if (control.type === "range") {
        const target = pages.find((p) => p.ranges.length < 8);
        if (!target) throw new Error(`No Launchpad fader slot for ${control.id}`);
        target.ranges.push(control.id);
      } else {
        const target = pages.find((p) => {
          const capacity = p.buttonsOnSide ? 8 : 8 + (8 - p.ranges.length) * 8;
          return p.buttons.length < capacity;
        });
        if (!target) throw new Error(`No Launchpad button slot for ${control.id}`);
        target.buttons.push(control.id);
      }
      used.add(control.id);
    }
    return [left, right];
  }

  function clonePages(pages) {
    return pages.map((p) => ({ ...p, ranges: [...p.ranges], buttons: [...p.buttons] }));
  }

  class LaunchpadMiniMk3Manager {
    constructor(options = {}) {
      this.catalog = options.catalog || [];
      this.meta = new Map(this.catalog.map((control) => [control.id, control]));
      this.onControl = options.onControl || (() => {});
      this.send = options.send || (() => {});
      this.onStatus = options.onStatus || (() => {});
      this.onRoleChange = options.onRoleChange || (() => {});
      this.onOrientationChange = options.onOrientationChange || (() => {});
      this.now = options.now || (() => Date.now());
      this.schedule = options.schedule || ((callback, delay) => globalThis.setTimeout(callback, delay));
      this.cancelSchedule = options.cancelSchedule || ((timer) => globalThis.clearTimeout(timer));
      this.roleHoldMs = Number(options.roleHoldMs) || SINGLE_ROLE_HOLD_MS;
      this.values = {};
      this.meters = {};
      this.meterPeaks = new Map();
      this.devices = [];
      this.reverse = false;
      this.orientations = {};
      for (const [inputId, orientation] of Object.entries(options.orientations || {})) {
        this.orientations[inputId] = normalizeOrientation(orientation);
      }
      this.pages = completePages(clonePages(LEFT_PAGES), clonePages(RIGHT_PAGES), this.catalog);
    }

    setReverse(reverse) {
      this.reverse = !!reverse;
      this.devices.forEach((device, index) => {
        this._cancelRoleHold(device);
        device.role = this.reverse ? 1 - (index % 2) : index % 2;
        device.page = device.rolePages[device.role] || 0;
        device.lastFrame = "";
        this._configure(device);
      });
      this._status();
    }

    setPorts({ inputs = [], outputs = [] } = {}) {
      this.restoreLiveMode();
      this.meterPeaks.clear();
      const ins = inputs.filter(isLaunchpadMiniMk3Port).sort(portSort).slice(0, 2);
      const outs = outputs.filter(isLaunchpadMiniMk3Port).sort(portSort).slice(0, 2);
      this.devices = ins.map((input, index) => ({
        inputId: input.id,
        outputId: outs[index] ? outs[index].id : null,
        name: input.name || `Launchpad Mini MK3 ${index + 1}`,
        role: this.reverse ? 1 - (index % 2) : index % 2,
        page: 0,
        rolePages: [0, 0],
        roleHold: null,
        roleHoldTimer: null,
        activeMomentaries: new Map(),
        orientation: normalizeOrientation(this.orientations[input.id]),
        lastFrame: "",
      }));
      for (const device of this.devices) this._configure(device);
      this._status();
      return this.getStatus();
    }

    restoreLiveMode() {
      for (const device of this.devices) {
        this._cancelRoleHold(device);
        this._releaseMomentaries(device, "disconnect");
        if (device.outputId) this.send(device.outputId, LIVE_MODE);
      }
    }

    _configure(device) {
      if (!device.outputId) return;
      this.send(device.outputId, PROGRAMMER_MODE);
      this.send(device.outputId, FEEDBACK_EXTERNAL_ONLY);
      this.render(device, true);
    }

    _status() {
      this.onStatus(this.getStatus());
    }

    getStatus() {
      return this.devices.map((device, index) => {
        const p = this.pages[device.role][device.page];
        return {
          index,
          inputId: device.inputId,
          outputId: device.outputId,
          name: device.name,
          connected: !!device.outputId,
          role: device.role === 0 ? "LEFT / MIX" : "RIGHT / FX",
          roleIndex: device.role,
          single: this.devices.length === 1,
          orientation: device.orientation,
          rotated: device.orientation === "ccw",
          page: device.page,
          pageName: p.name,
          ranges: [...p.ranges],
          buttons: [...p.buttons],
        };
      });
    }

    allMappedIds() {
      return [...controlSet(this.pages.flat())];
    }

    describePage(role, pageIndex) {
      const safeRole = role === 1 ? 1 : 0;
      const safePage = Math.max(0, Math.min(7, Number(pageIndex) || 0));
      const layout = this._layout({ role: safeRole, page: safePage });
      return {
        name: layout.page.name,
        colour: layout.page.colour,
        tone: layout.page.tone,
        ranges: [...layout.ranges],
        meterRanges: layout.ranges.filter((id) => METER_CONTROLS.has(id)),
        gridButtons: [...layout.gridButtons].map(([position, id]) => {
          const [row, column] = position.split(":").map(Number);
          return { row, column, id };
        }),
        sideButtons: [...layout.sideButtons],
      };
    }

    pageTone(colour) {
      return pageTone(colour);
    }

    controlTone(id, fallback) {
      return controlTone(id, fallback);
    }

    sync(values) {
      this.values = values || {};
      for (const device of this.devices) this.render(device);
    }

    syncMeters(meters) {
      this.meters = meters || {};
      for (const device of this.devices) {
        const layout = this._layout(device);
        if (layout.ranges.some((id) => Object.prototype.hasOwnProperty.call(this.meters, id))) this.render(device);
      }
    }

    _cancelRoleHold(device) {
      if (!device) return;
      if (device.roleHoldTimer !== null && device.roleHoldTimer !== undefined) {
        this.cancelSchedule(device.roleHoldTimer);
      }
      device.roleHold = null;
      device.roleHoldTimer = null;
    }

    _releaseMomentaries(device, source) {
      if (!device?.activeMomentaries?.size) return;
      for (const id of new Set(device.activeMomentaries.values())) {
        this.values[id] = 0;
        this.onControl(id, 0, {
          type: "button",
          press: false,
          device: device.inputId,
          source,
        });
      }
      device.activeMomentaries.clear();
    }

    _selectPage(device, pageIndex) {
      if (pageIndex < 0 || pageIndex >= this.pages[device.role].length) return;
      device.page = pageIndex;
      device.rolePages[device.role] = pageIndex;
      device.lastFrame = "";
      this.render(device, true);
      this._status();
    }

    selectPage(role, pageIndex, source = "ui") {
      const nextRole = role === 1 ? 1 : 0;
      const nextPage = Number(pageIndex);
      if (!Number.isInteger(nextPage) || nextPage < 0 || nextPage >= this.pages[nextRole].length) {
        return false;
      }
      if (this.devices.length === 1 && this.devices[0].role !== nextRole) {
        this.setSingleRole(nextRole, source);
      }
      const device = this.devices.find((candidate) => candidate.role === nextRole);
      if (!device) return false;
      this._selectPage(device, nextPage);
      return true;
    }

    setOrientation(inputId, orientation, source = "ui") {
      const device = this.devices.find((candidate) => candidate.inputId === inputId);
      if (!device) return false;
      const nextOrientation = normalizeOrientation(orientation);
      const changed = device.orientation !== nextOrientation;
      if (!changed) return true;
      this._cancelRoleHold(device);
      this._releaseMomentaries(device, "orientation-change");
      device.orientation = nextOrientation;
      this.orientations[inputId] = nextOrientation;
      device.lastFrame = "";
      this.render(device, true);
      this._status();
      this.onOrientationChange({
        inputId,
        name: device.name,
        orientation: nextOrientation,
        rotated: nextOrientation === "ccw",
        orientations: { ...this.orientations },
        source,
      });
      return true;
    }

    setSingleRole(role, source = "ui") {
      if (this.devices.length !== 1) return false;
      const device = this.devices[0];
      const nextRole = role === 1 ? 1 : 0;
      const changed = device.role !== nextRole;
      this._cancelRoleHold(device);
      device.role = nextRole;
      device.page = device.rolePages[nextRole] || 0;
      device.lastFrame = "";
      this.reverse = nextRole === 1;
      this.render(device, true);
      this._status();
      if (changed) {
        this.onRoleChange({
          role: nextRole,
          roleName: nextRole === 0 ? "LEFT / MIX" : "RIGHT / FX",
          reversed: this.reverse,
          source,
        });
      }
      return true;
    }

    _handleTop(device, control) {
      const singleRole = this.devices.length === 1
        ? SINGLE_ROLE_BUTTONS[control.index]
        : undefined;
      if (singleRole === undefined) {
        if (control.pressed) this._selectPage(device, control.index);
        return;
      }

      if (control.pressed) {
        this._cancelRoleHold(device);
        const hold = { index: control.index, role: singleRole };
        device.roleHold = hold;
        device.lastFrame = "";
        this.render(device, true);
        device.roleHoldTimer = this.schedule(() => {
          if (device.roleHold !== hold) return;
          this.setSingleRole(hold.role, "hardware-hold");
        }, this.roleHoldMs);
        return;
      }

      const hold = device.roleHold;
      if (!hold || hold.index !== control.index) return;
      this._cancelRoleHold(device);
      this._selectPage(device, control.index);
    }

    handleMidi(payload) {
      const data = payload && payload.data ? payload.data : payload;
      const deviceId = payload && (payload.deviceId || payload.device_id);
      const device = this.devices.find((candidate) => candidate.inputId === deviceId);
      if (!device) return false;
      const control = orientControl(decodeControl(data), device.orientation);
      if (!control) return true;
      if (control.area === "top") {
        this._handleTop(device, control);
        return true;
      }

      const layout = this._layout(device);
      const physicalKey = control.area === "grid"
        ? `grid:${control.row}:${control.column}`
        : control.area === "side"
          ? `side:${control.row}`
          : null;
      if (!control.pressed && physicalKey && device.activeMomentaries.has(physicalKey)) {
        const heldTarget = device.activeMomentaries.get(physicalKey);
        device.activeMomentaries.delete(physicalKey);
        this.values[heldTarget] = 0;
        this.onControl(heldTarget, 0, {
          type: "button",
          press: false,
          device: device.inputId,
          source: "physical-release",
        });
        this.render(device);
        return true;
      }
      let target = null;
      if (control.area === "grid" && control.column < layout.ranges.length) {
        if (!control.pressed) return true;
        target = layout.ranges[control.column];
        const value = this._surfaceSteps(target)[7 - control.row];
        this.values[target] = value;
        const rangeMeta = this.meta.get(target) || {};
        const killTarget = rangeMeta.surfaceKill;
        if (killTarget) {
          const wasKilled = Number(this.values[killTarget]) > 0.5;
          if (value <= 0) {
            // The bottom pad is the fader equivalent of KILL. Do not overwrite
            // the stored trim: releasing the kill button can still restore it.
            if (!wasKilled) {
              this.values[killTarget] = 1;
              this.onControl(killTarget, 1, {
                type: "button",
                press: true,
                device: device.inputId,
                source: "range-min",
              });
            }
            this.render(device);
            return true;
          }
          if (wasKilled) {
            // Touching any higher segment lifts KILL before applying the newly
            // selected trim, so the same fader works in both directions.
            this.values[killTarget] = 0;
            this.onControl(killTarget, 0, {
              type: "button",
              press: true,
              device: device.inputId,
              source: "range-lift",
            });
          }
        }
        this.onControl(target, value, { type: "range", device: device.inputId });
        this.render(device);
        return true;
      }
      if (control.area === "grid") {
        target = layout.gridButtons.get(`${control.row}:${control.column}`);
      } else if (control.area === "side") {
        target = layout.sideButtons[control.row];
      }
      if (!target) return true;

      const meta = this.meta.get(target) || { type: "button", momentary: false };
      if (meta.momentary === true) {
        this.values[target] = control.pressed ? 1 : 0;
        if (control.pressed && physicalKey) device.activeMomentaries.set(physicalKey, target);
        this.onControl(target, control.pressed ? 1 : 0, {
          type: "button",
          press: control.pressed,
          device: device.inputId,
        });
      } else if (control.pressed) {
        const value = (this.values[target] || 0) > 0.5 ? 0 : 1;
        this.values[target] = value;
        this.onControl(target, value, { type: "button", press: true, device: device.inputId });
      }
      this.render(device);
      return true;
    }

    _layout(device) {
      const p = this.pages[device.role][device.page];
      if (p.buttonsOnSide) {
        return {
          page: p,
          ranges: p.ranges,
          gridButtons: new Map(),
          sideButtons: p.buttons.slice(0, 8),
        };
      }
      const openColumns = [];
      for (let column = p.ranges.length; column < 8; column++) openColumns.push(column);
      const gridButtons = new Map();
      let buttonIndex = 0;
      for (let row = 0; row < 8; row++) {
        for (const column of openColumns) {
          const id = p.buttons[buttonIndex++];
          if (id) gridButtons.set(`${row}:${column}`, id);
        }
      }
      return {
        page: p,
        ranges: p.ranges,
        gridButtons,
        sideButtons: p.buttons.slice(buttonIndex, buttonIndex + 8),
      };
    }

    _buttonColour(id, colours) {
      const value = Number(this.values[id]) || 0;
      return value > 0.5 ? colours.bright : colours.dim;
    }

    _surfaceSteps(id) {
      const meta = this.meta.get(id) || {};
      const neutral = Number(meta.surfaceNeutral);
      if (!(neutral > 0 && neutral < 1)) {
        return Array.from({ length: 8 }, (_, index) => index / 7);
      }
      const neutralIndex = Math.max(1, Math.min(6, Math.round(neutral * 7)));
      return Array.from({ length: 8 }, (_, index) => {
        if (index <= neutralIndex) return neutral * index / neutralIndex;
        return neutral + (1 - neutral) * (index - neutralIndex) / (7 - neutralIndex);
      });
    }

    _surfaceStepIndex(id, value) {
      const steps = this._surfaceSteps(id);
      let nearest = 0;
      let distance = Infinity;
      for (let index = 0; index < steps.length; index++) {
        const next = Math.abs(steps[index] - value);
        if (next < distance) {
          nearest = index;
          distance = next;
        }
      }
      return nearest;
    }

    _rangeColours(id, colours) {
      const value = Math.max(0, Math.min(1, Number(this.values[id]) || 0));
      const meta = this.meta.get(id) || {};
      if (Object.prototype.hasOwnProperty.call(this.meters, id)) {
        return this._meterColours(id, value, meta);
      }
      return Array.from({ length: 8 }, (_, row) => {
        const step = 7 - row;
        if (meta.bipolar) {
          const level = this._surfaceStepIndex(id, value);
          const centre = this._surfaceStepIndex(id, Number(meta.surfaceNeutral) || 0.5);
          const active = step >= Math.min(centre, level) && step <= Math.max(centre, level);
          return active ? colours.bright : 0;
        }
        // A fader's unfilled portion must be genuinely off. Palette "dim"
        // entries are still visibly lit on the hardware and made a zero-value
        // fader look completely filled. Use the same per-control step table as
        // input so unity/centre markers land on the pad that selected them.
        const position = this._surfaceStepIndex(id, value);
        const filled = value <= 0 ? 0 : position + 1;
        return step < filled ? colours.bright : 0;
      });
    }

    _meterColours(id, controlValue, meta) {
      const killedBand = id.match(/^kill\.(sub|bass|mid|high|top)\.trim$/);
      const bandPalette = killedBand ? paletteForControl(id, "iso") : null;
      if (killedBand && Number(this.values[`kill.${killedBand[1]}`]) > 0.5) {
        this.meterPeaks.delete(id);
        return [0, 0, 0, 0, 0, 0, 0, bandPalette.bright];
      }
      const meterValue = Math.max(0, Math.min(1, Number(this.meters[id]) || 0));
      const filled = Math.round(meterValue * 8);
      const now = this.now();
      let peak = this.meterPeaks.get(id);
      if (!peak || filled >= peak.level) {
        peak = { level: filled, holdUntil: now + 500, decayAt: now + 500 };
      } else if (now >= peak.decayAt) {
        const steps = Math.floor((now - peak.decayAt) / 120) + 1;
        peak.level = Math.max(filled, peak.level - steps);
        peak.decayAt += steps * 120;
      }
      this.meterPeaks.set(id, peak);

      const meterColour = (step) => {
        if (bandPalette) return bandPalette.bright;
        if (step >= 7) return PALETTES.red.bright;
        if (step >= 5) return PALETTES.yellow.bright;
        return PALETTES.green.bright;
      };
      const peakStep = peak.level > 0 ? peak.level - 1 : -1;
      const showPosition = meta.bipolar || controlValue > 0;
      const positionStep = showPosition ? this._surfaceStepIndex(id, controlValue) : -1;

      return Array.from({ length: 8 }, (_, row) => {
        const step = 7 - row;
        if (step === positionStep) return PALETTES.neutral.bright;
        if (step < filled || step === peakStep) return meterColour(step);
        return 0;
      });
    }

    render(device, force = false) {
      if (!device.outputId) return;
      const layout = this._layout(device);
      const leds = new Map();

      for (let i = 0; i < 8; i++) {
        const tone = this.pages[device.role][i].tone;
        const colours = PALETTES[tone] || PALETTES.neutral;
        leds.set(orientedTopNote(device.orientation, i), i === device.page ? colours.bright : colours.dim);
      }
      if (this.devices.length === 1 && device.roleHold) {
        leds.set(orientedTopNote(device.orientation, device.roleHold.index), PALETTES.neutral.bright);
      }
      leds.set(99, device.role === 0 ? PALETTES.green.bright : PALETTES.blue.bright);

      for (let column = 0; column < layout.ranges.length; column++) {
        const colours = paletteForControl(layout.ranges[column], layout.page.colour);
        const values = this._rangeColours(layout.ranges[column], colours);
        for (let row = 0; row < 8; row++) {
          leds.set(orientedGridNote(device.orientation, row, column), values[row]);
        }
      }
      for (const [position, id] of layout.gridButtons) {
        const [row, column] = position.split(":").map(Number);
        const colours = paletteForControl(id, layout.page.colour);
        leds.set(orientedGridNote(device.orientation, row, column), this._buttonColour(id, colours));
      }
      for (let row = 0; row < 8; row++) {
        const id = layout.sideButtons[row];
        const colours = id ? paletteForControl(id, layout.page.colour) : null;
        leds.set(orientedSideNote(device.orientation, row), id ? this._buttonColour(id, colours) : 0);
      }
      // Explicitly clear every unused grid cell.
      for (let row = 0; row < 8; row++) {
        for (let column = 0; column < 8; column++) {
          const note = gridNote(row, column);
          if (!leds.has(note)) leds.set(note, 0);
        }
      }

      const ordered = [...leds.entries()].sort((a, b) => a[0] - b[0]);
      const signature = ordered.map(([index, colour]) => `${index}:${colour}`).join(",");
      if (!force && signature === device.lastFrame) return;
      device.lastFrame = signature;
      const specs = ordered.flatMap(([index, colour]) => [0, index, colour]);
      this.send(device.outputId, [...SYSEX, 0x03, ...specs, 0xf7]);
    }

  }

  const api = {
    LaunchpadMiniMk3Manager,
    PROGRAMMER_MODE,
    LIVE_MODE,
    LEFT_PAGES,
    RIGHT_PAGES,
    PALETTES,
    PAGE_TONES,
    METER_CONTROL_IDS,
    SINGLE_ROLE_HOLD_MS,
    SINGLE_ROLE_BUTTONS,
    controlTone,
    pageTone,
    decodeControl,
    gridNote,
    normalizeOrientation,
    orientControl,
    orientedGridNote,
    orientedSideNote,
    orientedTopNote,
    sideNote,
    isLaunchpadMiniMk3Port,
  };
  if (typeof window !== "undefined") window.DubnatorLaunchpad = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
