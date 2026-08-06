import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const sandbox = { window: {}, module: { exports: {} }, console };
vm.createContext(sandbox);
vm.runInContext(await readFile(join(ROOT, "midi-controls.js"), "utf8"), sandbox, {
  filename: "midi-controls.js",
});
vm.runInContext(await readFile(join(ROOT, "launchpad.js"), "utf8"), sandbox, {
  filename: "launchpad.js",
});

const catalog = sandbox.window.DubnatorMidiControls;
const echoTiming = sandbox.window.DubnatorEchoTiming;
const {
  LaunchpadMiniMk3Manager,
  BRIGHTNESS_LEVELS,
  PALETTES,
  PROGRAMMER_MODE,
  brightnessMessage,
  controlTone,
  decodeControl,
  gridNote,
  orientControl,
  orientedGridNote,
  orientedSideNote,
  orientedTopNote,
  sideNote,
} = sandbox.window.DubnatorLaunchpad;

function ports() {
  return {
    inputs: [
      { id: "daw-a", name: "LPMiniMK3 DAW In" },
      { id: "in-a", name: "LPMiniMK3 MIDI A" },
      { id: "in-b", name: "LPMiniMK3 MIDI B" },
      { id: "keyboard", name: "Other Keyboard" },
    ],
    outputs: [
      { id: "daw-out", name: "LPMiniMK3 DAW Out" },
      { id: "out-a", name: "LPMiniMK3 MIDI A" },
      { id: "out-b", name: "LPMiniMK3 MIDI B" },
    ],
  };
}

function singlePorts() {
  return {
    inputs: [{ id: "in-a", name: "LPMiniMK3 MIDI A" }],
    outputs: [{ id: "out-a", name: "LPMiniMK3 MIDI A" }],
  };
}

function fakeScheduler() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    schedule(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    cancelSchedule(id) {
      callbacks.delete(id);
    },
    fire() {
      const entry = [...callbacks.entries()].at(-1);
      assert.ok(entry, "a role-switch hold timer is pending");
      callbacks.delete(entry[0]);
      entry[1]();
    },
    get size() {
      return callbacks.size;
    },
  };
}

function frameColour(message, led) {
  for (let index = 7; index < message.length - 1; index += 3) {
    if (message[index + 1] === led) return message[index + 2];
  }
  return null;
}

function setup() {
  const sent = [];
  const fired = [];
  const statuses = [];
  const manager = new LaunchpadMiniMk3Manager({
    catalog,
    send: (outputId, message) => sent.push({ outputId, message: [...message] }),
    onControl: (id, value, event) => fired.push({ id, value, event }),
    onStatus: (status) => statuses.push(status),
  });
  manager.setPorts(ports());
  return { manager, sent, fired, statuses };
}

test("dual layout covers the complete performance catalog", () => {
  const manager = new LaunchpadMiniMk3Manager({ catalog });
  const mapped = new Set(manager.allMappedIds());
  assert.equal(catalog.length, 202);
  assert.equal(catalog.filter((control) => !mapped.has(control.id)).length, 0);
  assert.equal(manager.pages.length, 2);
  assert.ok(manager.pages.every((role) => role.length === 8));
});

test("LED colours communicate function and distinguish bank slots", () => {
  assert.equal(controlTone("deckA.play"), "green");
  assert.equal(controlTone("deckB.stop"), "red");
  assert.equal(controlTone("deckA.cue"), "yellow");
  assert.equal(controlTone("echo.send"), "orange");
  assert.equal(controlTone("reverb.send"), "violet");
  assert.equal(controlTone("dubfilter.cutoff"), "cyan");
  assert.equal(controlTone("xfade.a"), "green");
  assert.equal(controlTone("xfade.center"), "neutral");
  assert.equal(controlTone("xfade.b"), "blue");
  assert.notEqual(controlTone("samples.trigger.0"), controlTone("samples.trigger.1"));
  assert.equal(controlTone("siren.preset"), "pink");
  for (const [band, tone] of Object.entries({
    sub: "red",
    bass: "orange",
    mid: "yellow",
    high: "cyan",
    top: "green",
  })) {
    assert.equal(controlTone(`kill.${band}.trim`), tone);
    assert.equal(controlTone(`kill.${band}`), tone);
    assert.equal(controlTone(`kill.${band}.solo`), tone);
  }
});

test("echo and reverb LED palettes are varied but visually related", () => {
  const tones = {
    "echo.send": "orange",
    "echo.sat": "red",
    "echo.fb": "yellow",
    "echo.dw": "orange",
    "echo.slide": "yellow",
    "echo.wow": "magenta",
    "echo.time": "yellow",
    "echo.filterfreq": "cyan",
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
    "reverb.freeze": "magenta",
    "reverb.bp": "cyan",
  };
  for (const [id, tone] of Object.entries(tones)) {
    assert.equal(controlTone(id), tone, `${id} uses ${tone}`);
  }
});

test("isolator VU faders use the same band colours as the UI", () => {
  const manager = new LaunchpadMiniMk3Manager({ catalog, now: () => 0 });
  const tones = {
    sub: "red",
    bass: "orange",
    mid: "yellow",
    high: "cyan",
    top: "green",
  };
  for (const [band, tone] of Object.entries(tones)) {
    const id = `kill.${band}.trim`;
    manager.values[id] = 70 / 82;
    manager.values[`kill.${band}`] = 0;
    manager.meters[id] = 0.5;
    const colours = Array.from(manager._rangeColours(id, PALETTES[tone]));
    const nonMarkerColours = new Set(colours.filter((colour) => colour !== 0 && colour !== PALETTES.neutral.bright));
    assert.deepEqual(Array.from(nonMarkerColours), [PALETTES[tone].bright], `${band} VU uses ${tone}`);
  }
});

test("echo and reverb keep analogous controls in matching positions", () => {
  const manager = new LaunchpadMiniMk3Manager({ catalog });
  const echo = manager.describePage(1, 0);
  const reverb = manager.describePage(1, 1);

  const pairs = [
    [0, "echo.send", "reverb.send"],
    [2, "echo.fb", "reverb.room"],
    [3, "echo.dw", "reverb.dw"],
    [5, "echo.wow", "reverb.mod"],
    [6, "echo.time", "reverb.predelay"],
    [7, "echo.filterfreq", "reverb.bpfreq"],
  ];
  for (const [column, echoId, reverbId] of pairs) {
    assert.equal(echo.ranges[column], echoId);
    assert.equal(reverb.ranges[column], reverbId);
  }
  assert.equal(echo.sideButtons[7], "echo.throw");
  assert.equal(reverb.sideButtons[7], "music.rev");
  assert.equal(manager.describePage(1, 2).sideButtons[7], "echo.dub");
});

test("echo time fader uses useful logarithmic hardware positions", () => {
  const control = catalog.find(({ id }) => id === "echo.time");
  assert.equal(control.surfaceLaw, "log-time");
  assert.deepEqual(
    Array.from(control.surfaceSteps, (value) => Math.round(echoTiming.fromUnit(value))),
    Array.from(echoTiming.surfaceTimes),
  );
  for (const ms of [30, 60, 120, 240, 375, 500, 750, 1500]) {
    assert.ok(Math.abs(echoTiming.fromUnit(echoTiming.toUnit(ms)) - ms) < 1e-6);
  }
  assert.equal(echoTiming.synced(120, "1/8"), 250);
  assert.equal(echoTiming.synced(120, "1/8."), 375);
});

test("siren uses previous/next navigation and exposes both FX amounts", () => {
  const { manager, fired } = setup();
  const siren = manager.pages[0][5];
  const sirenFx = manager.pages[0][6];

  assert.deepEqual(Array.from(manager.pages[0].slice(5, 7), ({ name }) => name), [
    "SIREN",
    "SIR FX",
  ]);
  assert.deepEqual(Array.from(manager.pages[1].slice(0, 2), ({ name }) => name), [
    "ECHO",
    "REVERB",
  ]);
  assert.equal(manager.pages[1].some(({ name }) => name.startsWith("SIR")), false);

  assert.deepEqual(Array.from(siren.ranges.slice(-2)), [
    "siren.revsend",
    "siren.echosend",
  ]);
  assert.deepEqual(Array.from(siren.buttons), [
    "siren.trigger",
    "siren.prev",
    "siren.next",
  ]);
  assert.equal(catalog.some(({ id }) => /^siren\.preset\.\d+$/.test(id)), false);

  assert.equal(sirenFx.name, "SIR FX");
  assert.deepEqual(Array.from(sirenFx.ranges), [
    "siren.pan",
    "siren.bits",
    "siren.sr",
    "siren.preset",
  ]);
  const sirenFxLayout = manager.describePage(0, 6);
  assert.equal(sirenFxLayout.gridButtons.length, 0);
  assert.deepEqual(Array.from(sirenFxLayout.sideButtons), [
    "siren.trigger",
    "siren.prev",
    "siren.next",
  ]);

  // Left page 6 / SIREN fills all eight grid columns, so navigation lives on
  // the right-hand CC column and can be used while the other unit stays on FX.
  manager.handleMidi({ deviceId: "in-a", data: [0xb0, 96, 127] });
  manager.handleMidi({ deviceId: "in-a", data: [0xb0, sideNote(1), 127] });
  manager.handleMidi({ deviceId: "in-a", data: [0xb0, sideNote(2), 127] });
  assert.deepEqual(fired.slice(-2).map(({ id }) => id), [
    "siren.prev",
    "siren.next",
  ]);
});

test("pairs two MIDI ports, ignores DAW ports and enters Programmer Mode", () => {
  const { manager, sent } = setup();
  const status = manager.getStatus();
  assert.equal(status.length, 2);
  assert.equal(status[0].role, "LEFT / MIX");
  assert.equal(status[1].role, "RIGHT / FX");
  assert.equal(sent[0].outputId, "out-a");
  assert.equal(sent[0].message.join(), PROGRAMMER_MODE.join());
  assert.ok(sent.some(({ outputId, message }) => outputId === "out-b" && message.join() === PROGRAMMER_MODE.join()));
  const ledFrames = sent.filter(({ message }) => message[6] === 3);
  assert.equal(ledFrames.length, 2);
  assert.equal(ledFrames[0].message.length, 251, "one SysEx frame contains all 81 LEDs");
});

test("sets and reapplies LED brightness to every connected Launchpad", () => {
  assert.deepEqual(Array.from(BRIGHTNESS_LEVELS), [0, 18, 36, 54, 73, 91, 109, 127]);
  assert.deepEqual(
    Array.from(brightnessMessage(64)),
    [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x08, 64, 0xf7],
  );

  const sent = [];
  const manager = new LaunchpadMiniMk3Manager({
    catalog,
    brightness: 64,
    send: (outputId, message) => sent.push({ outputId, message: [...message] }),
  });
  manager.setPorts(ports());

  const initialBrightness = sent.filter(({ message }) => message[6] === 0x08);
  assert.deepEqual(initialBrightness.map(({ outputId }) => outputId), ["out-a", "out-b"]);
  assert.ok(initialBrightness.every(({ message }) => message[7] === 64));
  assert.ok(manager.getStatus().every(({ brightness }) => brightness === 64));

  sent.length = 0;
  assert.equal(manager.setBrightness(999), 127);
  assert.deepEqual(
    sent.map(({ outputId, message }) => ({ outputId, value: message[7] })),
    [
      { outputId: "out-a", value: 127 },
      { outputId: "out-b", value: 127 },
    ],
  );
});

test("one Launchpad switches between all 16 pages by holding the top arrows", () => {
  const timers = fakeScheduler();
  const sent = [];
  const fired = [];
  const roleChanges = [];
  const manager = new LaunchpadMiniMk3Manager({
    catalog,
    schedule: timers.schedule,
    cancelSchedule: timers.cancelSchedule,
    send: (outputId, message) => sent.push({ outputId, message: [...message] }),
    onControl: (id, value, event) => fired.push({ id, value, event }),
    onRoleChange: (change) => roleChanges.push(change),
  });
  manager.setPorts(singlePorts());

  assert.equal(manager.getStatus().length, 1);
  assert.equal(manager.getStatus()[0].single, true);
  assert.equal(manager.getStatus()[0].role, "LEFT / MIX");

  // A short press on the physical ← button still selects top-row page 3.
  manager.handleMidi({ deviceId: "in-a", data: [0xb0, 93, 127] });
  assert.equal(manager.getStatus()[0].pageName, "MIX", "page waits while the hold gesture is pending");
  assert.equal(
    frameColour(sent.at(-1).message, 93),
    PALETTES.neutral.bright,
    "the held arrow turns white",
  );
  manager.handleMidi({ deviceId: "in-a", data: [0xb0, 93, 0] });
  assert.equal(timers.size, 0);
  assert.equal(manager.getStatus()[0].pageName, "DECK B");

  // Holding → switches to FX without consuming any page button.
  manager.handleMidi({ deviceId: "in-a", data: [0xb0, 94, 127] });
  timers.fire();
  manager.handleMidi({ deviceId: "in-a", data: [0xb0, 94, 0] });
  assert.equal(manager.getStatus()[0].role, "RIGHT / FX");
  assert.equal(manager.getStatus()[0].pageName, "ECHO");
  assert.equal(frameColour(sent.at(-1).message, 99), PALETTES.blue.bright);

  // Short → opens right-hand page 4, then both roles remember their page.
  manager.handleMidi({ deviceId: "in-a", data: [0xb0, 94, 127] });
  manager.handleMidi({ deviceId: "in-a", data: [0xb0, 94, 0] });
  assert.equal(manager.getStatus()[0].pageName, "SAMPLES");
  manager.handleMidi({ deviceId: "in-a", data: [0x90, gridNote(4, 0), 127] });
  assert.equal(fired.at(-1).id, "samples.gain");

  // A held momentary pad still receives its release after changing surfaces.
  const sampleTrigger = gridNote(0, 5);
  manager.handleMidi({ deviceId: "in-a", data: [0x90, sampleTrigger, 127] });
  assert.deepEqual(
    { id: fired.at(-1).id, value: fired.at(-1).value },
    { id: "samples.trigger.0", value: 1 },
  );
  manager.handleMidi({ deviceId: "in-a", data: [0xb0, 93, 127] });
  timers.fire();
  manager.handleMidi({ deviceId: "in-a", data: [0xb0, 93, 0] });
  manager.handleMidi({ deviceId: "in-a", data: [0x90, sampleTrigger, 0] });
  assert.equal(manager.getStatus()[0].role, "LEFT / MIX");
  assert.equal(manager.getStatus()[0].pageName, "DECK B");
  assert.deepEqual(
    { id: fired.at(-1).id, value: fired.at(-1).value },
    { id: "samples.trigger.0", value: 0 },
  );

  manager.handleMidi({ deviceId: "in-a", data: [0xb0, 94, 127] });
  timers.fire();
  assert.equal(manager.getStatus()[0].role, "RIGHT / FX");
  assert.equal(manager.getStatus()[0].pageName, "SAMPLES");
  assert.deepEqual(Array.from(roleChanges, ({ role, source }) => ({ role, source })), [
    { role: 1, source: "hardware-hold" },
    { role: 0, source: "hardware-hold" },
    { role: 1, source: "hardware-hold" },
  ]);

  const visited = new Set();
  for (const role of [1, 0]) {
    if (manager.devices[0].role !== role) {
      const cc = role === 0 ? 93 : 94;
      manager.handleMidi({ deviceId: "in-a", data: [0xb0, cc, 127] });
      timers.fire();
      manager.handleMidi({ deviceId: "in-a", data: [0xb0, cc, 0] });
    }
    for (let pageIndex = 0; pageIndex < 8; pageIndex++) {
      const cc = 91 + pageIndex;
      manager.handleMidi({ deviceId: "in-a", data: [0xb0, cc, 127] });
      manager.handleMidi({ deviceId: "in-a", data: [0xb0, cc, 0] });
      const status = manager.getStatus()[0];
      assert.equal(status.roleIndex, role);
      assert.equal(status.page, pageIndex);
      visited.add(`${role}:${pageIndex}`);
    }
  }
  assert.equal(visited.size, 16);
});

test("Help page selection updates the physical surface and its live status", () => {
  const statuses = [];
  const sent = [];
  const roleChanges = [];
  const manager = new LaunchpadMiniMk3Manager({
    catalog,
    send: (outputId, message) => sent.push({ outputId, message: [...message] }),
    onStatus: (status) => statuses.push(status),
    onRoleChange: (change) => roleChanges.push(change),
  });
  manager.setPorts(singlePorts());
  const framesBefore = sent.filter(({ message }) => message[6] === 3).length;

  assert.equal(manager.selectPage(0, 5, "help"), true);
  assert.equal(manager.getStatus()[0].role, "LEFT / MIX");
  assert.equal(manager.getStatus()[0].pageName, "SIREN");

  assert.equal(manager.selectPage(1, 3, "help"), true);
  assert.equal(manager.getStatus()[0].role, "RIGHT / FX");
  assert.equal(manager.getStatus()[0].pageName, "SAMPLES");
  assert.deepEqual(
    { role: roleChanges.at(-1).role, source: roleChanges.at(-1).source },
    { role: 1, source: "help" },
  );
  assert.equal(statuses.at(-1)[0].page, 3);
  assert.ok(
    sent.filter(({ message }) => message[6] === 3).length > framesBefore,
    "Help selection emits refreshed physical LED frames",
  );
  assert.equal(manager.selectPage(1, 8, "help"), false);
});

test("decodes Novation's CC messages for the right-hand button column", () => {
  const top = decodeControl([0xb0, 91, 127]);
  assert.equal(top.area, "top");
  assert.equal(top.index, 0);
  assert.equal(top.pressed, true);

  const sidePress = decodeControl([0xb0, 89, 127]);
  assert.equal(sidePress.area, "side");
  assert.equal(sidePress.row, 0);
  assert.equal(sidePress.pressed, true);

  const sideRelease = decodeControl([0xb0, 89, 0]);
  assert.equal(sideRelease.area, "side");
  assert.equal(sideRelease.row, 0);
  assert.equal(sideRelease.pressed, false);
});

test("90° CCW orientation normalizes the grid, top row and outer column", () => {
  const grid = orientControl({ area: "grid", row: 1, column: 2, pressed: true }, "ccw");
  assert.deepEqual(
    { area: grid.area, row: grid.row, column: grid.column, pressed: grid.pressed },
    { area: "grid", row: 5, column: 1, pressed: true },
  );
  const physicalSide = orientControl({ area: "side", row: 4, pressed: true }, "ccw");
  assert.deepEqual(
    { area: physicalSide.area, index: physicalSide.index, pressed: physicalSide.pressed },
    { area: "top", index: 4, pressed: true },
  );
  const physicalTop = orientControl({ area: "top", index: 2, pressed: false }, "ccw");
  assert.deepEqual(
    { area: physicalTop.area, row: physicalTop.row, pressed: physicalTop.pressed },
    { area: "side", row: 5, pressed: false },
  );
  assert.equal(orientedGridNote("ccw", 5, 1), gridNote(1, 2));
  assert.equal(orientedTopNote("ccw", 4), sideNote(4));
  assert.equal(orientedSideNote("ccw", 5), 93);
});

test("a physically rotated left unit keeps controls and LED feedback upright", () => {
  const sent = [];
  const fired = [];
  const orientationChanges = [];
  const manager = new LaunchpadMiniMk3Manager({
    catalog,
    send: (outputId, message) => sent.push({ outputId, message: [...message] }),
    onControl: (id, value, event) => fired.push({ id, value, event }),
    onOrientationChange: (change) => orientationChanges.push(change),
  });
  manager.setPorts(ports());
  assert.equal(manager.setOrientation("in-a", "ccw", "help"), true);
  assert.equal(manager.getStatus()[0].orientation, "ccw");
  assert.equal(manager.getStatus()[0].rotated, true);

  // The original top-right button is now the top action in the outer-left
  // column. On MIX it remains Deck A Play/Pause.
  manager.handleMidi({ deviceId: "in-a", data: [0xb0, 98, 127] });
  assert.equal(fired.at(-1).id, "deckA.play");

  // A world-space vertical fader becomes one horizontal row in the unrotated
  // MIDI coordinate system; the transform restores its logical column/value.
  manager.handleMidi({ deviceId: "in-a", data: [0x90, gridNote(0, 7), 127] });
  assert.equal(fired.at(-1).id, "deckA.gain");
  assert.equal(fired.at(-1).value, 1);

  manager.sync({ "deckA.play": 1, "deckA.gain": 1 });
  const frame = sent.filter(({ outputId, message }) => outputId === "out-a" && message[6] === 3).at(-1).message;
  assert.equal(frame.length, 251, "rotation still renders all 81 LEDs in one frame");
  assert.equal(frameColour(frame, sideNote(0)), PALETTES.neutral.bright, "page 1 moves to the physical top row");
  assert.equal(frameColour(frame, 98), PALETTES.green.bright, "outer-left action LED follows Play");
  for (let column = 0; column < 8; column++) {
    assert.equal(
      frameColour(frame, gridNote(0, column)),
      PALETTES.green.bright,
      `rotated gain fader lights physical row column ${column + 1}`,
    );
  }

  // The original right column is physically on top after a CCW rotation.
  manager.handleMidi({ deviceId: "in-a", data: [0xb0, sideNote(1), 127] });
  assert.equal(manager.getStatus()[0].pageName, "DECK A");
  assert.deepEqual(
    {
      inputId: orientationChanges.at(-1).inputId,
      orientation: orientationChanges.at(-1).orientation,
      source: orientationChanges.at(-1).source,
    },
    { inputId: "in-a", orientation: "ccw", source: "help" },
  );

  manager.setReverse(true);
  const rotatedDevice = manager.getStatus().find(({ inputId }) => inputId === "in-a");
  assert.equal(rotatedDevice.role, "RIGHT / FX");
  assert.equal(rotatedDevice.orientation, "ccw", "orientation follows the physical device when roles swap");
  manager.setPorts(ports());
  assert.equal(
    manager.getStatus().find(({ inputId }) => inputId === "in-a").orientation,
    "ccw",
    "orientation survives a MIDI port refresh",
  );
});

test("every button in all 16 pages dispatches from its physical pad", () => {
  const { manager, fired } = setup();
  const controls = new Map(catalog.map((control) => [control.id, control]));
  const seen = new Set();
  let placements = 0;

  const exercise = (device, id, press, release) => {
    manager.values[id] = 0;
    fired.length = 0;
    assert.equal(manager.handleMidi({ deviceId: device.inputId, data: press }), true);
    assert.equal(fired[0]?.id, id, `${id} press dispatches`);
    assert.equal(fired[0]?.value, 1, `${id} press value`);
    manager.handleMidi({ deviceId: device.inputId, data: release });
    if (controls.get(id)?.momentary) {
      assert.equal(fired[1]?.id, id, `${id} release dispatches`);
      assert.equal(fired[1]?.value, 0, `${id} release value`);
    } else {
      assert.equal(fired.length, 1, `${id} toggle ignores release`);
    }
    seen.add(id);
    placements++;
  };

  for (const device of manager.devices) {
    for (let pageIndex = 0; pageIndex < 8; pageIndex++) {
      manager.handleMidi({ deviceId: device.inputId, data: [0xb0, 91 + pageIndex, 127] });
      const layout = manager._layout(device);
      for (const [position, id] of layout.gridButtons) {
        const [row, column] = position.split(":").map(Number);
        const note = gridNote(row, column);
        exercise(device, id, [0x90, note, 127], [0x90, note, 0]);
      }
      layout.sideButtons.forEach((id, row) => {
        if (!id) return;
        const cc = sideNote(row);
        exercise(device, id, [0xb0, cc, 127], [0xb0, cc, 0]);
      });
    }
  }

  const missing = catalog
    .filter((control) => control.type === "button" && !seen.has(control.id))
    .map((control) => control.id);
  assert.equal(missing.length, 0, `unreachable buttons: ${Array.from(missing).join(", ")}`);
  assert.ok(placements >= catalog.filter((control) => control.type === "button").length);
});

test("top row selects pages independently without interrupting the LED layout", () => {
  const { manager, sent } = setup();
  sent.length = 0;
  assert.equal(manager.handleMidi({ deviceId: "in-a", data: [0xb0, 92, 127] }), true);
  assert.equal(manager.getStatus()[0].pageName, "DECK A");
  assert.equal(manager.getStatus()[1].pageName, "ECHO");
  assert.ok(sent.some(({ message }) => message[6] === 3), "page selection refreshes the LED layout");
  assert.ok(!sent.some(({ message }) => message[6] === 7), "page selection does not send scrolling text");
});

test("grid columns behave as 0..1 faders", () => {
  const { manager, fired } = setup();
  manager.handleMidi({ deviceId: "in-a", data: [0x90, 11, 127] });
  manager.handleMidi({ deviceId: "in-a", data: [0x90, 81, 127] });
  assert.deepEqual(fired.map(({ id, value }) => ({ id, value })), [
    { id: "deckA.gain", value: 0 },
    { id: "deckA.gain", value: 1 },
  ]);
});

test("gain, trim, EQ and centre faders expose an exact neutral pad", () => {
  const { manager, fired } = setup();
  const neutralControls = catalog.filter((control) => Number.isFinite(control.surfaceNeutral));
  assert.ok(neutralControls.length >= 25);
  for (const control of neutralControls) {
    const steps = manager._surfaceSteps(control.id);
    assert.ok(
      steps.some((value) => Math.abs(value - control.surfaceNeutral) < 1e-12),
      `${control.id} includes its neutral value`,
    );
  }

  // MIX / Deck A Gain: 2/3 × 1.5 = unity (0 dB).
  manager.handleMidi({ deviceId: "in-a", data: [0x90, gridNote(1, 0), 127] });
  assert.equal(fired.at(-1).id, "deckA.gain");
  assert.ok(Math.abs(fired.at(-1).value * 1.5 - 1) < 1e-12);

  // ISOLATE / Sub Gain: -70 + (70/82 × 82) = exactly 0 dB.
  manager.handleMidi({ deviceId: "in-a", data: [0xb0, 95, 127] });
  manager.handleMidi({ deviceId: "in-a", data: [0x90, gridNote(1, 1), 127] });
  assert.equal(fired.at(-1).id, "kill.sub.trim");
  assert.ok(Math.abs(-70 + fired.at(-1).value * 82) < 1e-12);

  // GEQ 1–8 / first band: 0.5 maps to exactly 0 dB.
  manager.handleMidi({ deviceId: "in-b", data: [0xb0, 96, 127] });
  manager.handleMidi({ deviceId: "in-b", data: [0x90, gridNote(3, 0), 127] });
  assert.equal(fired.at(-1).id, "geqA.0");
  assert.equal(fired.at(-1).value, 0.5);
});

test("isolator faders use a tapered audio curve with finer control near unity", () => {
  const manager = new LaunchpadMiniMk3Manager({ catalog });
  const expectedDb = [-70, -36, -20, -12, -7, -3, 0, 12];
  for (const band of ["sub", "bass", "mid", "high", "top"]) {
    const steps = manager._surfaceSteps(`kill.${band}.trim`);
    const actualDb = Array.from(steps, (value) => Math.round((-70 + value * 82) * 10) / 10);
    assert.deepEqual(actualDb, expectedDb, `${band} uses the tapered fader law`);
    assert.ok(
      Math.abs(steps[6] - 70 / 82) < 1e-12,
      `${band} keeps an exact 0 dB pad`,
    );
  }
});

test("all channel, source, return and send levels use an audio-tapered surface", () => {
  const manager = new LaunchpadMiniMk3Manager({ catalog });
  const gainControls = new Map([
    ["master.gain", 1.5],
    ["deckA.gain", 1.5],
    ["deckB.gain", 1.5],
    ["in1.gain", 1.5],
    ["in2.gain", 1.5],
    ["aux.gain", 1.5],
    ["reverb.ret", 1.5],
    ["siren.gain", 1.2],
    ["samples.gain", 1],
    ["reverb.send", 1],
    ["echo.send", 1],
    ["echo.dw", 1],
    ["reverb.dw", 1],
    ["samples.rev", 1],
    ["samples.echo", 1],
    ["aux.revlevel", 1],
    ["aux.echolevel", 1],
    ["siren.revsend", 1],
    ["siren.echosend", 1],
  ]);
  for (const [id, maxGain] of gainControls) {
    const control = catalog.find((entry) => entry.id === id);
    assert.equal(control.surfaceLaw, "audio", `${id} declares an audio fader law`);
    const steps = manager._surfaceSteps(id);
    assert.equal(steps[0], 0, `${id} starts fully off`);
    assert.ok(steps.every((value, index) => index === 0 || value > steps[index - 1]), `${id} steps increase monotonically`);
    assert.ok(Math.abs(steps.at(-1) - 1) < 1e-12, `${id} reaches its full range`);

    const db = Array.from(steps.slice(1), (value) => Math.round(20 * Math.log10(value * maxGain)));
    assert.deepEqual(
      db,
      maxGain > 1 ? [-36, -20, -12, -7, -3, 0, Math.round(20 * Math.log10(maxGain))] : [-36, -20, -12, -7, -3, -1, 0],
      `${id} follows the shared audio taper`,
    );
  }

  const flat = catalog.find(({ id }) => id === "flat.gain");
  assert.equal(flat.surfaceLaw, "audio-db");
  assert.deepEqual(
    Array.from(manager._surfaceSteps("flat.gain"), (value) => Math.round(-24 + value * 36)),
    [-24, -18, -12, -7, -3, 0, 6, 12],
  );

  for (const id of ["geqA.0", "paramA0.gain", "echo.fb", "xfade"]) {
    assert.equal(catalog.find((entry) => entry.id === id).surfaceLaw, undefined, `${id} keeps its parameter-specific curve`);
  }
});

test("unipolar fader LEDs are off at zero and fill from the bottom", () => {
  const { manager } = setup();
  const colours = { dim: 5, bright: 7 };

  manager.values["echo.fb"] = 0;
  assert.deepEqual(Array.from(manager._rangeColours("echo.fb", colours)), Array(8).fill(0));

  manager.values["echo.fb"] = 0.5;
  const halfway = Array.from(manager._rangeColours("echo.fb", colours));
  assert.deepEqual(halfway, [0, 0, 0, 7, 7, 7, 7, 7]);

  manager.values["echo.fb"] = 1;
  assert.deepEqual(Array.from(manager._rangeColours("echo.fb", colours)), Array(8).fill(7));
});

test("deck end mode uses a coloured STOP / LOOP / NEXT Launchpad selector", () => {
  const manager = new LaunchpadMiniMk3Manager({ catalog });
  const master = manager.describePage(0, 7);
  assert.equal(master.ranges[5], "system.autoadvance");

  const expected = [
    [0, [0, 0, 0, 0, 0, 0, PALETTES.red.bright, PALETTES.red.bright]],
    [0.5, [0, 0, PALETTES.orange.bright, PALETTES.orange.bright, PALETTES.orange.bright, PALETTES.orange.bright, 0, 0]],
    [1, [PALETTES.green.bright, PALETTES.green.bright, 0, 0, 0, 0, 0, 0]],
  ];
  for (const [value, colours] of expected) {
    manager.values["system.autoadvance"] = value;
    assert.deepEqual(Array.from(manager._rangeColours("system.autoadvance", PALETTES.green)), colours);
  }
});

test("metered gains show live VU, fader position and peak hold", () => {
  let now = 0;
  const manager = new LaunchpadMiniMk3Manager({ catalog, now: () => now });
  const colours = { dim: 5, bright: 7 };

  manager.values["deckA.gain"] = 2 / 3;
  manager.meters["deckA.gain"] = 0.5;
  assert.deepEqual(
    Array.from(manager._rangeColours("deckA.gain", colours)),
    [0, 3, 0, 0, 23, 23, 23, 23],
    "green VU fills upward and white marks the fader position",
  );

  manager.values["deckB.gain"] = 0;
  manager.meters["deckB.gain"] = 1;
  assert.deepEqual(
    Array.from(manager._rangeColours("deckB.gain", colours)),
    [7, 15, 15, 23, 23, 23, 23, 23],
    "top is red, upper range yellow and lower range green",
  );

  manager.meters["deckB.gain"] = 0;
  now = 100;
  assert.equal(manager._rangeColours("deckB.gain", colours)[0], 7, "peak is held");
  now = 700;
  const decayed = Array.from(manager._rangeColours("deckB.gain", colours));
  assert.equal(decayed[0], 0);
  assert.equal(decayed[2], 15, "peak decays down the column");
});

test("killing an isolator band drops its hardware fader and clears its VU peak", () => {
  const manager = new LaunchpadMiniMk3Manager({ catalog, now: () => 0 });
  const colours = { dim: 5, bright: 7 };
  manager.values["kill.bass.trim"] = 0.85;
  manager.values["kill.bass"] = 0;
  manager.meters["kill.bass.trim"] = 0.75;
  manager._rangeColours("kill.bass.trim", colours);
  assert.ok(manager.meterPeaks.has("kill.bass.trim"));

  manager.values["kill.bass"] = 1;
  manager.values["kill.bass.trim"] = 0;
  assert.deepEqual(
    Array.from(manager._rangeColours("kill.bass.trim", colours)),
    [0, 0, 0, 0, 0, 0, 0, PALETTES.orange.bright],
  );
  assert.equal(manager.meterPeaks.has("kill.bass.trim"), false);
});

test("a kill fader activates at minimum and lifts the kill above minimum", () => {
  const { manager, fired } = setup();
  const linked = catalog.filter(({ surfaceKill }) => surfaceKill);
  assert.deepEqual(Array.from(linked, ({ surfaceKill }) => surfaceKill), [
    "kill.sub",
    "kill.bass",
    "kill.mid",
    "kill.high",
    "kill.top",
  ]);

  manager.handleMidi({ deviceId: "in-a", data: [0xb0, 95, 127] }); // ISOLATE
  manager.values["kill.sub.trim"] = 70 / 82;
  manager.values["kill.sub"] = 0;
  fired.length = 0;

  manager.handleMidi({
    deviceId: "in-a",
    data: [0x90, gridNote(7, 1), 127],
  });
  assert.deepEqual(fired.map(({ id, value }) => ({ id, value })), [
    { id: "kill.sub", value: 1 },
  ], "minimum engages KILL without overwriting the stored trim");
  assert.equal(manager.values["kill.sub"], 1);

  fired.length = 0;
  manager.handleMidi({
    deviceId: "in-a",
    data: [0x90, gridNote(6, 1), 127],
  });
  assert.equal(fired[0].id, "kill.sub");
  assert.equal(fired[0].value, 0);
  assert.equal(fired[1].id, "kill.sub.trim");
  assert.ok(fired[1].value > 0);
  assert.equal(manager.values["kill.sub"], 0);
});

test("momentary sample pads dispatch press and release", () => {
  const { manager, fired } = setup();
  manager.handleMidi({ deviceId: "in-b", data: [0xb0, 94, 127] }); // right page 4: samples
  manager.handleMidi({ deviceId: "in-b", data: [0x90, 86, 127] }); // first free grid pad
  manager.handleMidi({ deviceId: "in-b", data: [0x90, 86, 0] });
  assert.deepEqual(fired.slice(-2).map(({ id, value }) => ({ id, value })), [
    { id: "samples.trigger.0", value: 1 },
    { id: "samples.trigger.0", value: 0 },
  ]);
});

test("LED feedback is stateful, batched and de-duplicated", () => {
  const { manager, sent } = setup();
  sent.length = 0;
  manager.sync({ "deckA.gain": 1, "echo.send": 0.5 });
  assert.equal(sent.filter(({ message }) => message[6] === 3).length, 2);
  sent.length = 0;
  manager.sync({ "deckA.gain": 1, "echo.send": 0.5 });
  assert.equal(sent.length, 0);
});

test("swap exchanges the two physical roles", () => {
  const { manager } = setup();
  manager.setReverse(true);
  const status = manager.getStatus();
  assert.equal(status[0].role, "RIGHT / FX");
  assert.equal(status[1].role, "LEFT / MIX");
});
