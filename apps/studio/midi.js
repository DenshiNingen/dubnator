// Dubnator MIDI mapping core. Pure mapping engine (testable without a browser)
// + a thin Web MIDI adapter. Exposed as window.DubnatorMidi.
//
// The mapper holds:
//  - a registry of controls (id -> handler + behaviour),
//  - bindings from a MIDI "key" (type:channel:number) to one or more controls
//    (so a single knob can drive several controls, and one control can be bound
//     to several knobs — supporting many-to-one and one-to-many mappings),
//  - a MIDI Learn mode that binds the next incoming control to a chosen target.
//
// Values handed to control handlers are normalised to 0..1.

(function () {
  class MidiMapper {
    constructor() {
      this.controls = new Map();   // id -> { handler, type, momentary }
      this.bindings = new Map();   // key -> Set(controlId)
      this.learn = null;           // controlId currently being learned
      this._toggle = new Map();    // `${key}|${id}` -> bool (toggle state)
      this.onChange = null;        // optional callback after bindings change
      // --- Pickup ("pass-through") mode for range controls ---
      // When on, an incoming knob/fader does not jump the software value: it is
      // swallowed until the physical position passes through the current
      // software value, then it "catches" and follows directly. Prevents value
      // jumps after loading a mapping / preset or switching banks.
      this.pickupMode = false;
      this._soft = new Map();      // id -> last-known software value (0..1)
      this._caught = new Map();    // id -> bool (physical control has matched soft)
      this._lastIn = new Map();    // id -> last incoming MIDI value (0..1)
      this._pendingEcho = new Set(); // ids the mapper just drove → ignore the app's re-seed echo
    }
    _changed() { if (this.onChange) this.onChange(); }

    // type: 'range' (knob/fader) | 'button'. For buttons, momentary=true sends
    // 1 on press / 0 on release; momentary=false toggles on each press.
    register(id, handler, opts = {}) {
      this.controls.set(id, { handler, type: opts.type || "range", momentary: opts.momentary !== false });
      return this;
    }
    unregister(id) { this.controls.delete(id); }
    registeredIds() { return [...this.controls.keys()]; }

    // Drive a registered control directly from a purpose-built surface. Unlike
    // handleMessage(), this bypasses learn/binding lookup because the surface
    // already resolved the physical pad to a semantic control id.
    dispatch(controlId, value01, event = {}) {
      const control = this.controls.get(controlId);
      if (!control) return false;
      const value = Math.max(0, Math.min(1, Number(value01) || 0));
      if (control.type === "range") {
        this._soft.set(controlId, value);
        if (this.pickupMode) this._pendingEcho.add(controlId);
      }
      control.handler(value, { ...event, surface: true });
      return true;
    }

    // --- Pickup mode ---
    setPickup(on) { this.pickupMode = !!on; this._pendingEcho.clear(); if (!on) this._caught.clear(); }
    isPickup() { return this.pickupMode; }
    // Report a control's current value when it changed from a NON-MIDI source
    // (UI drag, preset load, keyboard). The physical control must then re-match
    // this value before it takes over again. Seeding values here is also what
    // makes pickup meaningful right after enabling it.
    notifyExternal(id, v01) {
      const v = v01 < 0 ? 0 : v01 > 1 ? 1 : v01;
      const prev = this._soft.has(id) ? this._soft.get(id) : null;
      this._soft.set(id, v);
      // The mapper just drove this control via MIDI → the app's re-seed is an
      // echo of that change, not a real external move. Consume it WITHOUT
      // re-arming. (A value compare can't tell the two apart: a quantized
      // handler, e.g. master.lim/siren.bits, makes the re-seeded value differ
      // from the raw MIDI value by up to half a step — far more than any safe
      // epsilon — so we track the echo explicitly instead.)
      if (this._pendingEcho.has(id)) { this._pendingEcho.delete(id); return; }
      // Re-seed of an UNTOUCHED control: identical state ⇒ identical value ⇒
      // nothing changed ⇒ don't re-arm.
      if (prev != null && Math.abs(prev - v) <= 0.0005) return;
      // Genuine external change (UI drag, preset load, keyboard) → the physical
      // control must re-catch before it takes over again.
      this._caught.set(id, false);
      this._lastIn.delete(id);
    }

    // Per-button behaviour: momentary (1 on press / 0 on release) vs toggle
    // (flip on each press). User-configurable so a pad can punch or latch.
    setMomentary(id, on) { const c = this.controls.get(id); if (c) { c.momentary = !!on; this._changed(); } }
    isMomentary(id) { const c = this.controls.get(id); return c ? !!c.momentary : false; }

    armLearn(controlId) { this.learn = controlId; }
    cancelLearn() { this.learn = null; }
    isLearning() { return this.learn != null; }
    learningId() { return this.learn; }

    // Parse a raw MIDI message [status, d1, d2] into a normalised event.
    static parse(data) {
      if (!data || data.length < 2) return null;
      const status = data[0], type = status & 0xf0, channel = status & 0x0f;
      const d1 = data[1], d2 = data.length > 2 ? data[2] : 0;
      if (type === 0xb0) return { kind: "cc", channel, num: d1, value01: d2 / 127, press: d2 > 0 };
      if (type === 0x90) return { kind: "note", channel, num: d1, value01: d2 / 127, press: d2 > 0 };
      if (type === 0x80) return { kind: "note", channel, num: d1, value01: 0, press: false };
      return null; // ignore clock, aftertouch, pitchbend, etc. for now
    }
    static keyOf(ev) { return `${ev.kind}:${ev.channel}:${ev.num}`; }

    // Feed a raw MIDI message. Returns the key it bound (in learn mode) or the
    // list of control ids it fired, or null if ignored.
    handleMessage(data) {
      const ev = MidiMapper.parse(data);
      if (!ev) return null;
      const key = MidiMapper.keyOf(ev);

      if (this.learn != null) {
        // Bind on a meaningful gesture: a CC move or a note/CC press.
        if (ev.kind === "cc" || ev.press) {
          const target = this.learn;
          this.learn = null;          // clear before bind() fires onChange
          this.bind(key, target);
          return { learned: { key, controlId: target } };
        }
        return null; // ignore the release that may follow
      }

      const ids = this.bindings.get(key);
      if (!ids || !ids.size) return null;
      const fired = [];
      for (const id of ids) {
        const c = this.controls.get(id);
        if (!c) continue;
        let v;
        const pressed = ev.kind === "cc" ? ev.value01 > 0.5 : ev.press;
        if (c.type === "button") {
          if (c.momentary) {
            v = pressed ? 1 : 0;
          } else {
            if (!pressed) continue; // toggle only acts on press
            const tk = key + "|" + id;
            const s = !this._toggle.get(tk);
            this._toggle.set(tk, s);
            v = s ? 1 : 0;
          }
        } else {
          v = ev.value01;
          // pickup: swallow range moves until the physical control crosses soft
          if (this.pickupMode && this._soft.has(id) && !this._caught.get(id)) {
            const soft = this._soft.get(id);
            const last = this._lastIn.has(id) ? this._lastIn.get(id) : v;
            this._lastIn.set(id, v);
            const crossed = (last <= soft && v >= soft) || (last >= soft && v <= soft) || Math.abs(v - soft) <= 0.02;
            if (!crossed) continue;       // not picked up yet — ignore this control
            this._caught.set(id, true);
          } else {
            this._lastIn.set(id, v);
          }
          this._soft.set(id, v);
          // expect the app to re-seed this control's soft value after the state
          // update; that echo must not re-arm pickup (see notifyExternal).
          if (this.pickupMode) this._pendingEcho.add(id);
        }
        c.handler(v, ev);
        fired.push(id);
      }
      return { fired };
    }

    bind(key, controlId) {
      if (!this.bindings.has(key)) this.bindings.set(key, new Set());
      this.bindings.get(key).add(controlId);
      this._changed();
    }
    // Remove all bindings for a control (used when re-learning / clearing).
    unbind(controlId) {
      for (const [k, set] of this.bindings) {
        set.delete(controlId);
        if (!set.size) this.bindings.delete(k);
      }
      for (const tk of [...this._toggle.keys()]) if (tk.endsWith("|" + controlId)) this._toggle.delete(tk);
      this._changed();
    }
    bindingKeysFor(controlId) {
      const out = [];
      for (const [k, set] of this.bindings) if (set.has(controlId)) out.push(k);
      return out;
    }
    clear() { this.bindings = new Map(); this._toggle = new Map(); this._changed(); }

    serialize() {
      const o = {};
      for (const [k, set] of this.bindings) o[k] = [...set];
      const modes = {};
      for (const [id, c] of this.controls) if (c.type === "button") modes[id] = !!c.momentary;
      return { version: 1, bindings: o, modes };
    }
    load(obj) {
      const src = obj && obj.bindings ? obj.bindings : obj || {};
      this.bindings = new Map();
      for (const k in src) this.bindings.set(k, new Set(src[k]));
      // restore per-button momentary modes onto already-registered controls
      // (absent in older saves → controls keep their registered default)
      if (obj && obj.modes) for (const id in obj.modes) { const c = this.controls.get(id); if (c) c.momentary = !!obj.modes[id]; }
      this._changed();
    }

    // Browser-only: hook Web MIDI inputs into handleMessage. Purpose-built
    // surfaces can inspect/consume source-aware events through options.onMessage
    // and receive input/output snapshots through options.onPorts.
    async connectWebMidi(nav, options = {}) {
      const n = nav || (typeof navigator !== "undefined" ? navigator : null);
      if (!n || !n.requestMIDIAccess) throw new Error("Web MIDI not supported in this environment");
      const access = await n.requestMIDIAccess({ sysex: options.sysex === true });
      this._access = access;
      const describe = (port) => ({
        id: port.id,
        name: port.name || "MIDI",
        manufacturer: port.manufacturer || "",
        state: port.state || "connected",
      });
      const snapshot = () => {
        const inputs = [];
        const outputs = [];
        access.inputs.forEach((port) => { if (port.state !== "disconnected") inputs.push(describe(port)); });
        if (access.outputs) access.outputs.forEach((port) => { if (port.state !== "disconnected") outputs.push(describe(port)); });
        const ports = { inputs, outputs };
        if (options.onPorts) options.onPorts(ports);
        return ports;
      };
      const attach = (input) => {
        input.onmidimessage = (e) => {
          const payload = {
            deviceId: input.id,
            name: input.name || "MIDI",
            manufacturer: input.manufacturer || "",
            data: Array.from(e.data),
          };
          const consumed = options.onMessage ? options.onMessage(payload) === true : false;
          if (!consumed) this.handleMessage(e.data);
        };
      };
      access.inputs.forEach(attach);
      const ports = snapshot();
      access.onstatechange = (e) => {
        if (e.port && e.port.type === "input" && e.port.state === "connected") attach(e.port);
        snapshot();
      };
      return ports.inputs.map((input) => input.name);
    }

    sendWebMidi(outputId, data) {
      const output = this._access && this._access.outputs && this._access.outputs.get(outputId);
      if (!output) throw new Error(`MIDI output unavailable: ${outputId}`);
      output.send(data);
    }
  }

  if (typeof window !== "undefined") window.DubnatorMidi = { MidiMapper };
  if (typeof module !== "undefined" && module.exports) module.exports = { MidiMapper };
})();
