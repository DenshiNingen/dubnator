// Engine logic tests run under the Web Audio mock (see webaudio-mock.mjs).
// Run: node tests/engine.test.mjs
import { loadEngine, loadMidi } from "./webaudio-mock.mjs";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + msg); } };
const section = (s) => console.log("\n• " + s);

const { win } = await loadEngine();
const eng = win.DubnatorEngine;

section("engine constructs and exposes API");
ok(!!eng, "window.DubnatorEngine exists");
ok(typeof eng.init === "function", "init() exists");
ok(Array.isArray(win.DubnatorFreqs) && win.DubnatorFreqs.length === 10, "DubnatorFreqs is 10 bands");

section("init() builds the graph");
const firstInit = eng.init();
const concurrentInit = eng.init();
await concurrentInit;
ok(eng.ready === true, "concurrent init callers wait for the complete graph");
await firstInit;
ok(eng.ready === true, "ready === true after init");
ok(!!eng.deckA && !!eng.deckB, "two decks created");
ok(!!eng.reverb && !!eng.echoDelay && !!eng.siren && !!eng.samples, "reverb/echo/siren/samples present");
ok(!!eng.limiter && !!eng.masterGain, "master chain present");
ok(eng.deckA.geq.length === 10, "deck A has 10-band GEQ");
ok(eng.deckA.params.length === 4, "deck A has 4-band parametric");

section("kill chain nodes");
ok(["killSub", "killBass", "killMid", "killHigh", "killTop"].every((k) => !!eng.deckA[k]), "5 kill bands on deck A");
ok(eng.deckA.killHigh.type === "peaking" && eng.deckA.killHigh.frequency.value === 3000, "HIGH kill band = peaking @ 3000 Hz");

section("synthetic loops loaded");
ok(eng.deckA.buffer && eng.deckA.buffer.duration > 0, "deck A synthetic buffer loaded");
ok(eng.deckB.buffer && eng.deckB.buffer.duration > 0, "deck B synthetic buffer loaded");

section("sample player built 12 slots");
ok(eng.samples.samples.length === 12, "12 samples generated");

section("parameter setters don't throw");
try {
  eng.setCrossfade(0.3); eng.setMasterGain(0.7); eng.setReverbSend(0.5);
  eng.setEchoFeedback(0.6); eng.setEchoTime(300); eng.setDubFilter("lp", 800, 2);
  eng.setDubFilterRoute("samples"); eng.setDubFilterRoute("music");
  eng.setSamplesHP(120); eng.setSirenGain(0.8);
  ok(true, "core setters executed");
} catch (e) { ok(false, "setters threw: " + e.message); }

section("multichannel music input — IN1 = ch1-2, IN2 = ch3-4 (§4)");
ok(!!eng.in1Gain && !!eng.in2Gain, "IN1/IN2 gain nodes present");
ok(eng.in1Gain._conns.includes(eng._inKill.killSub) && eng.in2Gain._conns.includes(eng._inKill.killSub), "IN1/IN2 feed the shared input isolator");
ok(eng._inKill.flat._conns.includes(eng.musicBus), "input isolator -> music bus (so dub filter + master apply)");
ok(eng.in1Gain.gain.value === 0 && eng.in2Gain.gain.value === 0, "IN1/IN2 silent until enabled");
// the kill buttons drive the input isolator just like the decks
eng.applyKills({ sub: false, bass: true, mid: false, top: false }, 0, false);
ok(eng._inKill.killBass.gain.value === -36 && eng._inKill.killSub.gain.value === 0, "killing BASS cuts it on IN1/IN2 too");
eng.setKillFreqs({ bass: 300 });
ok(eng._inKill.killBass.frequency.value === 300, "advanced kill freq applies to the input isolator");
eng.applyKills({ sub: false, bass: false, mid: false, top: false }, 0, false);
ok(eng._inKill.killBass.gain.value === 0, "releasing the kill restores the input band");
eng.setIn1Gain(0.8); eng.setIn2Gain(0.5);
ok(Math.abs(eng.in1Gain.gain.value - 0.8) < 1e-9 && Math.abs(eng.in2Gain.gain.value - 0.5) < 1e-9, "setIn1/2Gain set the levels");
{
  // route a fake 4-channel source: ch0,1 -> IN1 merger; ch2,3 -> IN2 merger
  const src4 = eng.ctx.createGain();
  eng._routeMultiStream(src4, 4);
  ok(eng.multiInputChannels() === 4, "reports 4 captured channels");
  ok(!!eng._multiSplitter && !!eng._multiM1 && !!eng._multiM2, "splitter + both stereo mergers built for 4ch");
  ok(eng._multiM1._conns.includes(eng.in1Gain) && eng._multiM2._conns.includes(eng.in2Gain), "IN1 merger -> in1Gain, IN2 merger -> in2Gain");
  ok(src4._conns.includes(eng._multiSplitter), "source feeds the splitter");
  // a 2-channel source: IN1 gets ch1-2, IN2 stays silent (no ch3-4)
  const src2 = eng.ctx.createGain();
  eng._routeMultiStream(src2, 2);
  ok(eng.multiInputChannels() === 2 && !!eng._multiM1 && !eng._multiM2, "2ch: IN1 built, IN2 absent");
  eng._teardownMulti();
  ok(eng.multiInputChannels() === 0 && !eng._multiSplitter, "teardown clears the multichannel graph");
  eng.setIn1Gain(0); eng.setIn2Gain(0);
}

section("output device picker (§19)");
ok(typeof eng.listOutputDevices === "function", "listOutputDevices exists");
ok(typeof eng.setOutputDevice === "function" && typeof eng.canSetOutput === "function", "output setters exist");
ok(eng.outputDeviceId() === "", "no output device selected by default");
{ const list = await eng.listOutputDevices(); ok(Array.isArray(list), "listOutputDevices returns an array"); }

section("web line input (In1 → deck chain)");
ok(typeof eng.enableLineInput === "function", "enableLineInput exists");
ok(typeof eng.disableLineInput === "function", "disableLineInput exists");
ok(typeof eng.hasLineInput === "function" && eng.hasLineInput() === false, "no line input active");
ok(eng.lineDeviceId() === "", "no line device selected");
{
  // No navigator.mediaDevices in node → enableLineInput should reject cleanly.
  let threw = false;
  try { await eng.enableLineInput(); } catch (e) { threw = true; }
  ok(threw, "enableLineInput rejects gracefully without mediaDevices");
  eng.disableLineInput(); ok(!eng.hasLineInput(), "disableLineInput safe when not active");
  ok(eng.lineDeckKey() === null, "no line deck key when inactive");
  ok(eng.canDeckPlay("A") === true && eng.canDeckPlay("B") === true, "both decks can play when no line input");
}

section("master mono sum");
ok(!!eng.monoSum && eng.monoSum.channelCount === 1, "monoSum node is 1-channel (explicit)");
ok(typeof eng.setMasterMono === "function", "setMasterMono exists");
ok(eng.masterMono === false, "stereo by default");
eng.setMasterMono(true); ok(eng.masterMono === true, "mono engaged");
eng.setMasterMono(true); ok(eng.masterMono === true, "engaging twice is idempotent");
eng.setMasterMono(false); ok(eng.masterMono === false, "back to stereo");

section("echo sub high-pass (§8)");
ok(!!eng.echoHP && eng.echoHP.type === "highpass", "echoHP highpass node in the echo loop");
ok(typeof eng.setEchoHP === "function", "setEchoHP exists");
ok(eng.echoHP.frequency.value === 20, "echo HP flat (20 Hz) by default");
eng.setEchoHP(true, 150); ok(eng.echoHP.frequency.value === 150, "echo HP engaged at 150 Hz");
eng.setEchoHP(true, 9999); ok(eng.echoHP.frequency.value === 400, "echo HP clamped to 400 Hz ceiling");
eng.setEchoHP(false); ok(eng.echoHP.frequency.value === 20, "echo HP off → flat again");

section("reverb freeze");
ok(typeof eng.setReverbFreeze === "function", "setReverbFreeze exists");
eng.setReverbSize(0.5);
eng.setReverbFreeze(true); ok(eng._reverbFrozen === true, "freeze engaged");
eng.setReverbSize(0.8); ok(eng._reverbFrozen === true && eng._reverbRoom === 0.8, "size change while frozen remembers room + keeps freeze");
eng.setReverbFreeze(true); ok(eng._reverbFrozen === true, "freezing twice is idempotent");
eng.setReverbFreeze(false); ok(eng._reverbFrozen === false, "thawed");

section("reverb pre-delay");
ok(!!eng.reverbPreDelay && typeof eng.setReverbPreDelay === "function", "reverbPreDelay node + setter");
ok(eng.reverbPreDelay.delayTime.value === 0, "pre-delay 0 by default");
eng.setReverbPreDelay(80); ok(Math.abs(eng.reverbPreDelay.delayTime.value - 0.08) < 1e-6, "80ms → 0.08s");
eng.setReverbPreDelay(9999); ok(eng.reverbPreDelay.delayTime.value === 0.2, "clamped to 200ms ceiling");
eng.setReverbPreDelay(0);

section("reverb band-pass + bypass (interactive graph)");
ok(!!eng.reverbBP && eng.reverbBP.type === "bandpass", "reverbBP bandpass node present");
ok(typeof eng.setReverbBP === "function" && typeof eng.setReverbBPBypass === "function", "reverb BP setters exist");
eng.setReverbBP(2000, 4);
ok(eng.reverbBP.frequency.value === 2000, "reverb BP freq set");
ok(eng.reverbBP.Q.value === 4, "reverb BP Q set");
eng.setReverbBP(99999, 99); ok(eng.reverbBP.frequency.value === 18000 && eng.reverbBP.Q.value === 12, "reverb BP freq/Q clamped to ceilings");
eng.setReverbBP(10, 0.01); ok(eng.reverbBP.frequency.value === 80 && eng.reverbBP.Q.value === 0.3, "reverb BP freq/Q clamped to floors");
ok(eng.reverbBPBypass === true, "reverb BP bypassed by default (no colour)");
eng.setReverbBPBypass(false); ok(eng.reverbBPBypass === false, "BP engaged");
eng.setReverbBPBypass(false); ok(eng.reverbBPBypass === false, "engaging twice is idempotent");
eng.setReverbBPBypass(true); ok(eng.reverbBPBypass === true, "BP bypassed again");

section("sample slot drag-drop loadSlot");
ok(typeof eng.samples.loadSlot === "function", "samples.loadSlot exists");
{
  // Reuse a tiny valid stereo 16-bit AIFF to exercise the decode fallback.
  const frames = 4, ch = 2;
  const ssndBytes = 8 + frames * ch * 2, commBytes = 18;
  const formSize = 4 + (8 + commBytes) + (8 + ssndBytes);
  const buf = new ArrayBuffer(8 + formSize);
  const dv = new DataView(buf);
  const w4 = (o, s) => { for (let i = 0; i < 4; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w4(0, "FORM"); dv.setUint32(4, formSize); w4(8, "AIFF");
  let p = 12;
  w4(p, "COMM"); dv.setUint32(p + 4, commBytes);
  dv.setInt16(p + 8, ch); dv.setUint32(p + 10, frames); dv.setInt16(p + 14, 16);
  dv.setUint16(p + 16, 0x400e); dv.setUint16(p + 18, 0xac44); dv.setUint32(p + 20, 0); dv.setUint16(p + 24, 0);
  p += 8 + commBytes;
  w4(p, "SSND"); dv.setUint32(p + 4, ssndBytes); dv.setUint32(p + 8, 0); dv.setUint32(p + 12, 0);
  let s = p + 16;
  [2000, -2000, 8000, -8000, 16000, -16000, 1, -1].forEach((v) => { dv.setInt16(s, v, false); s += 2; });
  const fakeFile = { name: "custom-hit.aiff", arrayBuffer: async () => buf };
  const oldName = eng.samples.samples[3].name;
  await eng.samples.loadSlot(3, fakeFile);
  ok(eng.samples.samples[3].name === "custom-hit.aiff", "slot name updated to dropped file");
  ok(eng.samples.samples[3].name !== oldName, "slot name actually changed");
  ok(eng.samples.samples[3].custom === true, "slot flagged custom");
  ok(eng.samples.samples[3].buffer && eng.samples.samples[3].buffer.numberOfChannels === 2, "slot buffer replaced (2ch)");
  // other slots untouched
  ok(eng.samples.samples[0].custom !== true, "other slots not flagged custom");
}

section("mic/line input device picker");
ok(typeof eng.listInputDevices === "function", "listInputDevices exists");
ok(typeof eng.switchMicDevice === "function", "switchMicDevice exists");
ok(typeof eng.micDeviceId === "function", "micDeviceId exists");
ok(eng.micDeviceId() === "", "no device selected before enabling");
ok(!eng.hasMic(), "no mic active");
{
  const list = await eng.listInputDevices();
  ok(Array.isArray(list), "listInputDevices returns an array (empty without mediaDevices)");
}

section("echo filter Q (interactive graph)");
ok(typeof eng.setEchoFilterQ === "function", "setEchoFilterQ exists");
eng.setEchoFilterQ(6);
ok(eng.echoFilter.Q.value === 6, "echo filter Q set to 6");
eng.setEchoFilterQ(99); ok(eng.echoFilter.Q.value === 12, "echo filter Q clamped to 12");
eng.setEchoFilterQ(0.01); ok(eng.echoFilter.Q.value === 0.3, "echo filter Q clamped to 0.3 floor");
eng.setEchoFilterQ(1.0);

section("deck transport");
try { eng.deckA.play(); ok(eng.deckA.playing, "deck A plays"); eng.deckA.pause(); ok(!eng.deckA.playing, "deck A pauses"); eng.deckA.stop(); ok(true, "deck A stops"); }
catch (e) { ok(false, "transport threw: " + e.message); }

section("sample player hold (momentary loop) vs one-shot");
{
  const sp = eng.samples;
  sp.play(0, true); // hold/momentary
  ok(sp.active && sp.active[0] && sp.active[0].loop === true, "hold play stores a looping active source");
  sp.stop(0);
  ok(!sp.active[0], "stop clears the active source");
  sp.play(1, false); // one-shot
  ok(sp.active[1] && sp.active[1].loop === false, "one-shot play stores a non-looping source");
  sp.play(1, false); // retrigger same slot stops previous
  ok(sp.active[1] && sp.active[1].loop === false, "retrigger replaces the active source without throwing");
  sp.stop(1);
}

section("limiter gain-reduction metering");
{
  const r = eng.getLimiterReduction();
  ok(r && typeof r.master === "number" && typeof r.reverb === "number" && typeof r.echo === "number", "getLimiterReduction returns master/reverb/echo numbers");
  ok(r.master <= 0 && r.reverb <= 0 && r.echo <= 0, "reductions are <= 0 dB");
}

section("reverb HFD (high-frequency damping) is wired to audio");
{
  ok(!!eng.reverbHFD && eng.reverbHFD.type === "highshelf", "reverbHFD highshelf node exists in reverb path");
  eng.setReverbHFD(1); ok(Math.abs(eng.reverbHFD.gain.value - 0) < 1e-9, "hfd=1 → 0 dB (no damping)");
  eng.setReverbHFD(0); ok(Math.abs(eng.reverbHFD.gain.value - -12) < 1e-9, "hfd=0 → -12 dB");
  eng.setReverbHFD(0.5); ok(Math.abs(eng.reverbHFD.gain.value - -6) < 1e-9, "hfd=0.5 → -6 dB");
}

section("per-band VU meter taps");
{
  ok(eng.bandMeters && ["sub", "bass", "mid", "high", "top"].every((k) => eng.bandMeters[k]), "5 band-meter analysers created");
  const bl = eng.getBandLevels();
  ok(bl && ["sub", "bass", "mid", "high", "top"].every((k) => typeof bl[k] === "number"), "getBandLevels returns 5 numbers");
  ok(["sub", "bass", "mid", "high", "top"].every((k) => bl[k] >= 0 && bl[k] <= 1), "levels within 0..1");
}

section("IN1/IN2/aux channel VU meters wired (post-fader taps)");
{
  ok(eng.in1Meter && eng.in2Meter && eng.auxMeter, "in1/in2/aux meter analysers created");
  ok(eng.in1Gain._conns.includes(eng.in1Meter) && eng.in2Gain._conns.includes(eng.in2Meter), "IN1/IN2 gain feeds its meter tap");
  ok(eng.auxGain._conns.includes(eng.auxMeter), "aux gain feeds its meter tap");
  const il = eng.getInputLevels();
  ok(il && ["in1", "in2", "aux"].every((k) => typeof il[k] === "number" && il[k] >= 0 && il[k] <= 1), "getInputLevels returns in1/in2/aux in 0..1");
}

section("samples/siren/reverb/echo source VU meters wired");
{
  ok(eng.samplesMeter && eng.sirenMeter && eng.reverbMeter && eng.echoMeter, "four source meter analysers created");
  ok(eng.samplesHP._conns.includes(eng.samplesMeter), "post-gain samples path feeds its meter");
  ok(eng._sirenTrim && eng._sirenTrim._conns.includes(eng.sirenMeter), "post-gain siren path feeds its meter");
  ok(eng.reverbLim._conns.includes(eng.reverbMeter) && eng.echoLim._conns.includes(eng.echoMeter), "post-limiter FX returns feed their meters");
  const sl = eng.getSourceLevels();
  ok(sl && ["samples", "siren", "reverb", "echo"].every((k) => typeof sl[k] === "number" && sl[k] >= 0 && sl[k] <= 1), "getSourceLevels returns four levels in 0..1");
}

section("dub filter routing keeps VU taps + sample FX sends connected (regression)");
{
  const m0 = eng.musicBus._conns.length;   // 4 band meters + 1 routing node
  const s0 = eng.samplesHP._conns.length;  // 2 FX sends + 1 routing node
  ok(m0 >= 5, "musicBus has meter taps + routing after init");
  ok(s0 >= 3, "samplesHP has FX-send taps + routing after init");
  for (const r of ["off", "music", "samples", "master", "music"]) {
    eng.setDubFilterRoute(r);
    ok(eng.musicBus._conns.length === m0, `route '${r}': musicBus taps preserved (no blanket disconnect)`);
    ok(eng.samplesHP._conns.length === s0, `route '${r}': samplesHP FX sends preserved`);
  }
  // "master" must route both music + samples through the filter (was a no-op)
  eng.setDubFilterRoute("master");
  ok(eng.musicBus._conns.includes(eng.dubFilter), "master route: music goes through dub filter");
  ok(eng.samplesHP._conns.includes(eng.dubFilter), "master route: samples go through dub filter");
  eng.setDubFilterRoute("music");
}

section("dub siren has a 12-slot preset bank");
{
  const ps = eng.siren.presets();
  ok(ps.length === 12, "12 siren presets");
  const fields = ["name", "wave", "pitch", "lfo1Rate", "lfo1Depth", "lfo2Rate", "lfo2Depth"];
  ok(ps.every((p) => fields.every((f) => p[f] !== undefined)), "every preset has all fields");
  ok(new Set(ps.map((p) => p.name)).size === 12, "all preset names unique");
  ok(ps.every((p) => ["sine", "square", "sawtooth", "triangle"].includes(p.wave)), "valid waveforms");
  ok(ps.every((p) => p.pitch >= 50 && p.pitch <= 2000), "base pitch in a musical siren range (50-2000 Hz)");
  ok(ps.every((p) => p.lfo1Rate >= 0 && p.lfo1Rate <= 30 && p.lfo2Rate >= 0 && p.lfo2Rate <= 30), "LFO rates 0-30 Hz");
  ok(ps.every((p) => p.lfo1Depth >= 0 && p.lfo1Depth <= 400 && p.lfo2Depth >= 0 && p.lfo2Depth <= 400), "LFO depths 0-400 Hz");
  // setPreset applies params
  eng.siren.setPreset(7);
  ok(eng.siren.pitch === ps[7].pitch && eng.siren.wave === ps[7].wave, "setPreset(7) applies preset 8");
  eng.siren.setPreset(0);
}

section("playlist auto-advance (loop vs play-through + onTrackEnd)");
{
  await eng.deckA.loadSynthetic(1);
  // default: loops forever
  eng.deckA.stop(); eng.deckA.setLoopSingle(true); eng.deckA.play();
  ok(eng.deckA.source.loop === true, "default loopSingle → source loops");
  eng.deckA.stop();
  // advance mode: plays through, fires onTrackEnd on natural end
  let advanced = 0;
  eng.deckA.setLoopSingle(false);
  eng.deckA.onTrackEnd = () => { advanced++; };
  eng.deckA.play();
  ok(eng.deckA.source.loop === false, "loopSingle off → source does not loop");
  eng.deckA.source.onended(); // simulate natural end
  ok(advanced === 1, "onTrackEnd fires on natural end");
  // manual stop must NOT trigger auto-advance
  eng.deckA.play();
  const src = eng.deckA.source;
  eng.deckA.stop();
  src.onended(); // the stop()'s source.stop would fire this in a real ctx
  ok(advanced === 1, "manual stop suppresses auto-advance");
  eng.deckA.setLoopSingle(true);
  eng.deckA.onTrackEnd = null;

  // Manual next still wraps, but automatic NEXT can explicitly stop at the
  // final playlist item instead of cycling back to the first.
  const originalPlaylist = eng.deckA.playlist;
  const originalPlaylistIdx = eng.deckA.playlistIdx;
  const originalLoadPlaylistIndex = eng.deckA.loadPlaylistIndex;
  let loadedIndex = -1;
  eng.deckA.playlist = [{ name: "one" }, { name: "two" }];
  eng.deckA.loadPlaylistIndex = async function (index) {
    loadedIndex = index;
    this.playlistIdx = index;
  };
  eng.deckA.playlistIdx = 1;
  ok(await eng.deckA.nextTrack({ wrap: false }) === false, "NEXT stops at the final playlist item");
  ok(loadedIndex === -1, "final NEXT does not reload the first track");
  ok(await eng.deckA.nextTrack() === true, "manual next still wraps");
  ok(loadedIndex === 0, "manual next wraps to the first track");
  eng.deckA.playlist = originalPlaylist;
  eng.deckA.playlistIdx = originalPlaylistIdx;
  eng.deckA.loadPlaylistIndex = originalLoadPlaylistIndex;
}

section("aux / mic input bus (IN 3-4)");
{
  ok(eng.auxInput && eng.auxHP && eng.auxGain, "aux input chain nodes exist");
  ok(eng.auxHP.type === "highpass", "aux HP is a highpass");
  ok(eng.auxGain.gain.value === 0, "aux channel muted (gain 0) by default");
  ok(eng.auxGain._conns.includes(eng.masterSum), "aux routes to master (bypasses kills)");
  ok(eng.auxGain._conns.includes(eng.auxReverbSend) && eng.auxGain._conns.includes(eng.auxEchoSend), "aux feeds its FX sends");
  ok(eng.auxReverbSend._conns.includes(eng.reverbSend), "aux reverb send reaches the reverb bus");
  eng.setAuxGain(0.7); ok(Math.abs(eng.auxGain.gain.value - 0.7) < 1e-9, "setAuxGain works");
  eng.setAuxHP(120); ok(eng.auxHP.frequency.value === 120, "setAuxHP works");
  eng.setAuxReverbSend(0.4); ok(eng.auxReverbSend.gain.value === 0.4, "setAuxReverbSend works");
  ok(eng.hasMic() === false, "no mic connected initially");
  eng.setAuxGain(0);
}

section("deck section loop (in/out)");
{
  await eng.deckA.loadSynthetic(1);
  ok(typeof eng.deckA.setLoopRegion === "function", "setLoopRegion exists");
  ok(!eng.deckA.hasLoopRegion(), "no loop region by default");
  eng.deckA.setLoopRegion(1.0, 3.0);
  ok(eng.deckA.hasLoopRegion() && eng.deckA.loopA === 1.0 && eng.deckA.loopB === 3.0, "loop region set 1-3s");
  eng.deckA.play();
  ok(eng.deckA.source.loop === true && eng.deckA.source.loopStart === 1.0 && eng.deckA.source.loopEnd === 3.0, "playing source loops the region");
  // getCurrentTime wraps into [loopA, loopB] once the audio passes loopB (review fix)
  eng.ctx.currentTime += 5; // raw = 5s, region 1-3s
  const wrapped = eng.deckA.getCurrentTime();
  ok(wrapped >= 1.0 && wrapped < 3.0, `playhead wraps into the loop region (got ${wrapped.toFixed(2)})`);
  eng.deckA.stop();
  eng.deckA.clearLoopRegion();
  ok(!eng.deckA.hasLoopRegion(), "loop region cleared");
  // loopB clamped to buffer.duration (synthetic loop is 8s) (review fix)
  eng.deckA.setLoopRegion(1, 9999);
  ok(eng.deckA.loopB <= eng.deckA.buffer.duration, "loopB clamped to buffer duration");
  // loading a new track clears any region (review fix)
  await eng.deckA.loadSynthetic(2);
  ok(!eng.deckA.hasLoopRegion(), "loading a new track clears the loop region");
}

section("rewind stop/play mode");
{
  await eng.deckA.loadSynthetic(1);
  eng.deckA.play();
  // advance the clock so there is something to rewind from
  eng.ctx.currentTime += 5;
  eng.deckA.rewind(2, false); // rewind & replay
  ok(eng.deckA.playing, "rewind&replay keeps the deck playing");
  eng.ctx.currentTime += 2;
  eng.deckA.rewind(2, true); // rewind & stop
  ok(!eng.deckA.playing, "rewind&stop pauses the deck (cue)");
  eng.deckA.stop();
}

section("AIFF fallback decoder (regression for the Chrome-can't-decode-AIFF fix)");
{
  // Build a tiny valid 16-bit stereo AIFF: 4 frames of a ramp.
  const frames = 4, ch = 2, sr = 44100;
  const ssndBytes = 8 + frames * ch * 2; // offset(4)+blockSize(4)+samples
  const commBytes = 18;
  const formSize = 4 + (8 + commBytes) + (8 + ssndBytes);
  const buf = new ArrayBuffer(8 + formSize);
  const dv = new DataView(buf);
  const w4 = (o, s) => { for (let i = 0; i < 4; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w4(0, "FORM"); dv.setUint32(4, formSize); w4(8, "AIFF");
  let p = 12;
  w4(p, "COMM"); dv.setUint32(p + 4, commBytes);
  dv.setInt16(p + 8, ch); dv.setUint32(p + 10, frames); dv.setInt16(p + 14, 16);
  // 80-bit extended for 44100: exponent 0x400E, mantissa 0xAC44000000000000
  dv.setUint16(p + 16, 0x400e); dv.setUint16(p + 18, 0xac44); dv.setUint32(p + 20, 0); dv.setUint16(p + 24, 0);
  p += 8 + commBytes;
  w4(p, "SSND"); dv.setUint32(p + 4, ssndBytes); dv.setUint32(p + 8, 0); dv.setUint32(p + 12, 0);
  let s = p + 16;
  const samples = [1000, -1000, 16000, -16000, 32000, -32000, 100, -100]; // L,R interleaved x4
  for (let i = 0; i < samples.length; i++) { dv.setInt16(s, samples[i], false); s += 2; }
  const fakeFile = { name: "test.aiff", arrayBuffer: async () => buf };
  await eng.deckA.load(fakeFile);
  ok(eng.deckA.buffer && eng.deckA.buffer.numberOfChannels === 2, "AIFF decoded to 2 channels");
  ok(eng.deckA.buffer.length === frames, "AIFF decoded 4 frames");
  const L = eng.deckA.buffer.getChannelData(0);
  ok(Math.abs(L[0] - 1000 / 32768) < 1e-4, "first L sample correct");
  ok(Math.abs(L[2] - 32000 / 32768) < 1e-4, "third L sample correct");
  // restore synthetic loop for any later tests
  await eng.deckA.loadSynthetic(1);
}

section("applyKills + Flat Mode (§5)");
ok(typeof eng.applyKills === "function", "applyKills() exists");
ok(!!eng.deckA.flat && !!eng.deckB.flat, "flat-trim gain node on both decks");
// single kill → that band cut, flat node stays unity, not flat mode
let flatActive = eng.applyKills({ sub: true, bass: false, mid: false, high: false, top: false }, 0, false);
ok(flatActive === false, "one kill → not flat mode");
ok(eng.deckA.killSub.gain.value === -36, "sub band cut −36 dB");
ok(eng.deckA.killBass.gain.value === 0, "bass band untouched");
ok(eng.deckA.flat.gain.value === 1, "flat trim unity when not flat");
// all five kills → flat mode: every band bypassed (0), flat gain applied
flatActive = eng.applyKills({ sub: true, bass: true, mid: true, high: true, top: true }, 0, false);
ok(flatActive === true, "all five kills → flat mode active");
ok(["killSub", "killBass", "killMid", "killHigh", "killTop"].every((k) => eng.deckA[k].gain.value === 0), "all kill bands bypassed (flat) in flat mode");
ok(["killSub", "killBass", "killMid", "killHigh", "killTop"].every((k) => eng.deckB[k].gain.value === 0), "flat mode applies to deck B too");
ok(Math.abs(eng.deckA.flat.gain.value - 1) < 1e-9, "flat gain 0 dB → unity");
// flat gain in dB → linear; clamped to ≤0 in Normal, ≤+12 in Advanced
eng.applyKills({ sub: true, bass: true, mid: true, high: true, top: true }, -6, false);
ok(Math.abs(eng.deckA.flat.gain.value - Math.pow(10, -6 / 20)) < 1e-6, "−6 dB flat gain → 0.501 linear");
eng.applyKills({ sub: true, bass: true, mid: true, high: true, top: true }, 12, false);
ok(Math.abs(eng.deckA.flat.gain.value - 1) < 1e-9, "Normal mode clamps flat gain to 0 dB max");
eng.applyKills({ sub: true, bass: true, mid: true, high: true, top: true }, 12, true);
ok(Math.abs(eng.deckA.flat.gain.value - Math.pow(10, 12 / 20)) < 1e-6, "Advanced allows +12 dB flat gain");
// exiting flat mode restores unity trim
eng.applyKills({ sub: false, bass: false, mid: false, top: false }, 12, true);
ok(eng.deckA.flat.gain.value === 1, "exiting flat mode restores unity trim");

section("per-band gain trims (§5 / Phase 1.3)");
const noKills = { sub: false, bass: false, mid: false, top: false };
// unkilled band carries its trim
eng.applyKills(noKills, 0, true, { sub: -10, bass: 6, mid: 0, top: 3 });
ok(eng.deckA.killSub.gain.value === -10, "sub trim −10 applied when unkilled");
ok(eng.deckA.killBass.gain.value === 6, "bass trim +6 applied in Advanced");
ok(eng.deckA.killTop.gain.value === 3, "top trim +3 applied");
// Normal mode clamps positive trims to 0
eng.applyKills(noKills, 0, false, { sub: 0, bass: 8, mid: 0, top: 0 });
ok(eng.deckA.killBass.gain.value === 0, "Normal mode clamps +trim to 0 dB");
// trim floor at −70
eng.applyKills(noKills, 0, true, { sub: -200, bass: 0, mid: 0, top: 0 });
ok(eng.deckA.killSub.gain.value === -70, "trim clamped to −70 dB floor");
// a killed band ignores its trim (full −36 cut)
eng.applyKills({ sub: true, bass: false, mid: false, top: false }, 0, true, { sub: 6, bass: 0, mid: 0, top: 0 });
ok(eng.deckA.killSub.gain.value === -36, "killed band cuts −36 regardless of trim");
// flat mode bypasses trims entirely
eng.applyKills({ sub: true, bass: true, mid: true, high: true, top: true }, 0, true, { sub: 6, bass: 6, mid: 6, top: 6 });
ok(["killSub","killBass","killMid","killTop"].every((k) => eng.deckA[k].gain.value === 0), "flat mode bypasses trims (all 0)");
// no trims arg → all bands flat (back-compat)
eng.applyKills(noKills, 0, false);
ok(eng.deckA.killBass.gain.value === 0, "omitting trims keeps bands at 0 (back-compat)");

section("adjustable kill band frequencies (Advanced)");
ok(typeof eng.setKillFreqs === "function", "setKillFreqs exists");
eng.setKillFreqs({ sub: 120, bass: 400, mid: 2200, top: 9000 });
ok(eng.deckA.killSub.frequency.value === 120, "sub band freq set");
ok(eng.deckA.killBass.frequency.value === 400, "bass band freq set");
ok(eng.deckA.killMid.frequency.value === 2200, "mid band freq set");
ok(eng.deckB.killTop.frequency.value === 9000, "top band freq applies to deck B too");
eng.setKillFreqs({ sub: 9999, bass: 1, mid: 99999, top: 1 });
ok(eng.deckA.killSub.frequency.value === 300, "sub clamped to 300 ceiling");
ok(eng.deckA.killBass.frequency.value === 80, "bass clamped to 80 floor");
ok(eng.deckA.killTop.frequency.value === 2000, "top clamped to 2000 floor");
eng.setKillFreqs({ sub: 90, bass: 250, mid: 1500, top: 6000 }); // reset defaults

section("per-band Q on Bass/Mid (Advanced)");
// Advanced applies custom Q to bass/mid
eng.applyKills(noKills, 0, true, null, { bass: 4.5, mid: 2.0 });
ok(eng.deckA.killBass.Q.value === 4.5, "bass Q set in Advanced");
ok(eng.deckA.killMid.Q.value === 2.0, "mid Q set in Advanced");
ok(eng.deckB.killBass.Q.value === 4.5, "bass Q applies to deck B too");
// Normal mode pins defaults regardless of qs
eng.applyKills(noKills, 0, false, null, { bass: 4.5, mid: 2.0 });
ok(eng.deckA.killBass.Q.value === 1.0, "Normal mode pins bass Q to 1.0 default");
ok(eng.deckA.killMid.Q.value === 0.9, "Normal mode pins mid Q to 0.9 default");
// Q clamped to sane range
eng.applyKills(noKills, 0, true, null, { bass: 99, mid: 0.01 });
ok(eng.deckA.killBass.Q.value === 10, "bass Q clamped to 10 ceiling");
ok(eng.deckA.killMid.Q.value === 0.3, "mid Q clamped to 0.3 floor");
eng.applyKills(noKills, 0, false); // reset to defaults

section("Pure Sub-Bass (§5)");
ok(!!eng.pureSubLP, "pureSubLP node present");
ok(eng.pureSubLP.type === "lowpass", "pureSubLP is a lowpass");
ok(eng.pureSubLP.frequency.value === 20000, "transparent (20k) by default");
eng.setPureSub(true);
ok(eng.pureSubLP.frequency.value < 200, "engaged → cutoff drops to sub range");
ok(eng.pureSubLP.Q.value > 1, "engaged → tighter Q");
eng.setPureSub(false);
ok(eng.pureSubLP.frequency.value === 20000, "disengaged → transparent again");

section("spectrum source (master / FX-only)");
ok(!!eng.fxAnalyser, "fxAnalyser node present");
ok(eng.getSpectrumData("master") instanceof Uint8Array, "master spectrum returns data");
ok(eng.getSpectrumData("fx") instanceof Uint8Array, "fx spectrum returns data");
ok(eng.getSpectrumData("fx").length === eng.getSpectrumData("master").length, "fx + master buffers same length");
ok(eng.getSpectrumData() instanceof Uint8Array, "default source (no arg) works");

section("MIDI mapper — pickup / pass-through mode (§17)");
{
  const { MidiMapper } = await loadMidi();
  const m = new MidiMapper();
  let last = null;
  m.register("vol", (v) => { last = v; }, { type: "range" });
  m.bind("cc:0:7", "vol");           // CC#7 ch0 -> vol
  const cc = (val) => m.handleMessage([0xb0, 7, val]); // 0..127

  // Without pickup, every move passes straight through.
  last = null; cc(100); ok(Math.abs(last - 100 / 127) < 1e-6, "no-pickup: value passes through");

  // Enable pickup, seed software value at 0.5 (≈ CC 64). A move that stays
  // below 0.5 must be swallowed (no jump); crossing 0.5 catches and follows.
  m.setPickup(true);
  ok(m.isPickup() === true, "pickup mode reports on");
  m.notifyExternal("vol", 0.5);
  last = null; cc(10);  ok(last === null, "pickup: low move (cc10) swallowed, no jump");
  last = null; cc(20);  ok(last === null, "pickup: still below soft → swallowed");
  last = null; cc(70);  ok(last !== null && Math.abs(last - 70 / 127) < 1e-6, "pickup: crossing soft catches + follows");
  last = null; cc(90);  ok(last !== null && Math.abs(last - 90 / 127) < 1e-6, "pickup: once caught, follows directly");

  // A new external change re-arms pickup → physical control must re-catch.
  // (In the app, the cc(90) above triggers a state re-seed first; mirror that so
  //  the genuine UI change below isn't mistaken for the cc(90) echo.)
  m.notifyExternal("vol", 90 / 127); // consume the cc(90) echo
  m.notifyExternal("vol", 0.2);      // genuine UI change → re-arm
  last = null; cc(120); ok(last === null, "pickup: re-armed after external change → high move swallowed");
  last = null; cc(20);  ok(last !== null && Math.abs(last - 20 / 127) < 1e-6, "pickup: re-catches when crossing the new soft");

  // Disabling pickup clears the caught state and passes through again.
  m.setPickup(false);
  last = null; cc(5); ok(Math.abs(last - 5 / 127) < 1e-6, "pickup off: passes through again");

  // Pickup must not affect button (toggle/momentary) controls.
  let btn = null;
  m.register("kill", (v) => { btn = v; }, { type: "button", momentary: true });
  m.bind("note:0:36", "kill");
  m.setPickup(true);
  btn = null; m.handleMessage([0x90, 36, 127]); ok(btn === 1, "pickup: momentary button still fires on press");
  btn = null; m.handleMessage([0x80, 36, 0]);   ok(btn === 0, "pickup: momentary button still fires on release");
}

section("MIDI pickup — echo tracking survives coarse quantization; re-arms on real UI change");
{
  const { MidiMapper } = await loadMidi();
  const m = new MidiMapper();
  let val = null;
  m.register("vol", (v) => { val = v; }, { type: "range" });
  m.bind("cc:0:7", "vol");
  const cc = (x) => m.handleMessage([0xb0, 7, x]);
  // Mirror the app: a physical move fires the handler, then the app re-seeds the
  // soft value. `reseed` simulates a QUANTIZING handler (e.g. master.lim /
  // siren.bits) whose round-trip value differs from the raw MIDI value by far
  // more than any epsilon — the exact case that broke the old value-compare fix.
  const moveAndReseed = (x, reseed) => { cc(x); m.notifyExternal("vol", reseed); };
  m.setPickup(true);
  m.notifyExternal("vol", 0.5);
  cc(64); m.notifyExternal("vol", 64 / 127); ok(Math.abs(val - 64 / 127) < 1e-6, "physical catches at ~0.5");
  val = null; moveAndReseed(90, 0.0);  ok(val !== null && Math.abs(val - 90 / 127) < 1e-6, "follows; a wildly-different quantized echo (reseed 0.0) does NOT re-arm");
  val = null; moveAndReseed(100, 1.0); ok(val !== null && Math.abs(val - 100 / 127) < 1e-6, "still follows after an even wilder echo (reseed 1.0)");
  // A genuine UI change: notifyExternal with NO preceding MIDI move (no pending
  // echo) and a changed value → must re-arm so the knob can't jump it.
  m.notifyExternal("vol", 0.2);
  val = null; cc(120); ok(val === null, "real UI change re-arms → high move swallowed");
  val = null; cc(26);  ok(val !== null && Math.abs(val - 26 / 127) < 1e-6, "re-catches when crossing the new (UI-set) soft value");
  // An untouched control (no MIDI, no value change) must not re-arm either.
  m.notifyExternal("vol", 26 / 127);   // consume the cc(26) echo
  m.notifyExternal("vol", 26 / 127);   // no pending echo + unchanged → no re-arm
  val = null; cc(40); ok(val !== null, "unchanged re-seed of an untouched control does not re-arm");
}

section("MIDI pickup — full app re-seed loop with real quantizers (no spurious un-arm at scale)");
{
  const { MidiMapper } = await loadMidi();
  const m = new MidiMapper();
  // mirror real app handlers (fwd: 0..1 → quantized state) + midiValues01 (inv).
  const Q = {
    lim:  { fwd: (v) => Math.round(-24 + v * 24), inv: (x) => (x + 24) / 24 }, // 25 steps (master.lim)
    bits: { fwd: (v) => Math.round(2 + v * 14),   inv: (x) => (x - 2) / 14 },  // 16 steps (siren.bits)
    pre:  { fwd: (v) => Math.round(v * 200),       inv: (x) => x / 200 },       // 201 steps (reverb.predelay)
    send: { fwd: (v) => v,                          inv: (x) => x },            // continuous (echo.send)
  };
  const state = { lim: -24, bits: 2, pre: 0, send: 0 };
  const ids = Object.keys(Q);
  ids.forEach((id, i) => { m.register(id, (v) => { state[id] = Q[id].fwd(v); }, { type: "range" }); m.bind(`cc:0:${10 + i}`, id); });
  const reseedAll = () => { for (const id of ids) m.notifyExternal(id, Q[id].inv(state[id])); }; // = the app effect
  m.setPickup(true);
  reseedAll();
  const drive = (i, x) => { m.handleMessage([0xb0, 10 + i, x]); reseedAll(); };
  ids.forEach((id, i) => { drive(i, 0); drive(i, 127); }); // sweep each → catch + follow
  ids.forEach((id) => ok(m._caught.get(id) === true, `${id}: caught`));
  drive(0, 64); // move ONE quantized control; nothing should un-arm (the epsilon bug)
  ids.forEach((id) => ok(m._caught.get(id) === true, `${id}: still caught after moving an unrelated quantized control`));
  state.bits = 9; reseedAll(); // genuine UI change to bits → re-arm ONLY bits
  ok(m._caught.get("bits") === false, "UI change to bits re-arms it");
  ok(["lim", "pre", "send"].every((id) => m._caught.get(id) === true), "other controls stay caught after a UI change to one");
}

section("MIDI mapper — per-button toggle/momentary mode (§17)");
{
  const { MidiMapper } = await loadMidi();
  const m = new MidiMapper();
  let v = null;
  m.register("kill", (x) => { v = x; }, { type: "button", momentary: false }); // start as toggle
  m.bind("note:0:40", "kill");
  const press = () => m.handleMessage([0x90, 40, 127]);
  const release = () => m.handleMessage([0x80, 40, 0]);

  ok(m.isMomentary("kill") === false, "starts in toggle mode");
  v = null; press(); ok(v === 1, "toggle: first press → 1");
  v = null; release(); ok(v === null, "toggle: release does nothing");
  v = null; press(); ok(v === 0, "toggle: second press → 0");

  // switch to momentary
  m.setMomentary("kill", true);
  ok(m.isMomentary("kill") === true, "switched to momentary");
  v = null; press(); ok(v === 1, "momentary: press → 1");
  v = null; release(); ok(v === 0, "momentary: release → 0");

  // persists through serialize/load onto a fresh mapper with same controls
  const saved = m.serialize();
  ok(saved.modes && saved.modes.kill === true, "serialize captures momentary mode");
  const m2 = new MidiMapper();
  let v2 = null;
  m2.register("kill", (x) => { v2 = x; }, { type: "button", momentary: false });
  m2.load(saved);
  ok(m2.isMomentary("kill") === true, "load restores momentary mode");
  v2 = null; m2.handleMessage([0x90, 40, 127]); ok(v2 === 1, "restored: press → 1");
  v2 = null; m2.handleMessage([0x80, 40, 0]);   ok(v2 === 0, "restored: release → 0 (momentary behaviour)");
}

section("MIDI mapper — reset / clear all bindings (§17)");
{
  const { MidiMapper } = await loadMidi();
  const m = new MidiMapper();
  let changed = 0;
  m.onChange = () => { changed++; };
  m.register("g", () => {}, { type: "range" });
  m.register("k", () => {}, { type: "button", momentary: false });
  m.bind("cc:0:7", "g");
  m.bind("note:0:36", "k");
  ok(m.bindingKeysFor("g").length === 1 && m.bindingKeysFor("k").length === 1, "two bindings present");
  const c0 = changed;
  m.clear();
  ok(changed === c0 + 1, "clear() fires onChange once (persists + refreshes UI)");
  ok(Object.keys(m.serialize().bindings).length === 0, "clear() empties all bindings");
  ok(m.bindingKeysFor("g").length === 0 && m.bindingKeysFor("k").length === 0, "no control retains a binding");
  // controls themselves stay registered (only bindings are dropped)
  let fired = null; m.register("g", (x) => { fired = x; }, { type: "range" });
  m.handleMessage([0xb0, 7, 100]); ok(fired === null, "cleared binding no longer routes MIDI");
}

section("MIDI mapper — many-to-one / one-to-many routing (§17)");
{
  const { MidiMapper } = await loadMidi();
  const m = new MidiMapper();
  const hits = {};
  ["bass", "mid", "top", "gain"].forEach((id) =>
    m.register(id, (v) => { hits[id] = v; }, { type: id === "gain" ? "range" : "button", momentary: true }));

  // ONE-TO-MANY: one pad (note 36) → sub-solo = cut bass+mid+top together.
  // (Repeated Learn onto the same key accumulates into the key's control set.)
  m.bind("note:0:36", "bass"); m.bind("note:0:36", "mid"); m.bind("note:0:36", "top");
  Object.keys(hits).forEach((k) => delete hits[k]);
  const r1 = m.handleMessage([0x90, 36, 127]);
  ok(r1 && r1.fired.length === 3, "one pad fires all three bound controls");
  ok(hits.bass === 1 && hits.mid === 1 && hits.top === 1, "one-to-many: bass+mid+top all cut from one button");
  ok(hits.gain === undefined, "unbound control untouched");

  // MANY-TO-ONE: two different knobs (CC 1 and CC 2) both drive master gain.
  m.bind("cc:0:1", "gain"); m.bind("cc:0:2", "gain");
  hits.gain = -1; m.handleMessage([0xb0, 1, 127]); ok(Math.abs(hits.gain - 1) < 1e-6, "many-to-one: CC1 drives gain");
  hits.gain = -1; m.handleMessage([0xb0, 2, 0]);   ok(hits.gain === 0, "many-to-one: CC2 also drives the same gain");
  ok(m.bindingKeysFor("gain").length === 2, "gain reports two source keys");
}

section("tape wow & flutter on the echo (§8 Tape)");
ok(!!eng.echoWowLfo && !!eng.echoFlutterLfo, "two tape LFOs present");
ok(!!eng.echoWowDepth && !!eng.echoFlutterDepth, "wow + flutter depth gains present");
ok(eng.echoWowLfo.frequency.value < eng.echoFlutterLfo.frequency.value, "wow is slower than flutter");
ok(eng.echoWowDepth.gain.value === 0 && eng.echoFlutterDepth.gain.value === 0, "depth is 0 (clean) by default");
// the depth gains modulate the delay time param
ok(eng.echoWowDepth._conns.includes(eng.echoDelay.delayTime), "wow depth feeds echoDelay.delayTime");
ok(eng.echoFlutterDepth._conns.includes(eng.echoDelay.delayTime), "flutter depth feeds echoDelay.delayTime");
eng.setEchoWow(1);
ok(eng.echoWowDepth.gain.value > 0 && eng.echoFlutterDepth.gain.value > 0, "setEchoWow(1) opens both LFO depths");
ok(eng.echoWowDepth.gain.value > eng.echoFlutterDepth.gain.value, "wow swing exceeds flutter swing");
ok(eng.echoWow === 1, "echoWow amount stored");
eng.setEchoWow(0);
ok(eng.echoWowDepth.gain.value === 0 && eng.echoFlutterDepth.gain.value === 0, "setEchoWow(0) returns to clean");
eng.setEchoWow(2); // clamp
ok(eng.echoWow === 1, "amount clamped to 1");
eng.setEchoWow(0);

section("modulated (chorused) reverb tail (§7)");
ok(!!eng.reverbModLfo && !!eng.reverbModDepth, "reverb mod LFO + depth gain present");
ok(eng.reverbModLfo.frequency.value > 0 && eng.reverbModLfo.frequency.value < 3, "mod LFO is slow (<3 Hz)");
ok(eng.reverbModDepth.gain.value === 0, "mod depth 0 (static) by default");
ok(eng.reverbModDepth._conns.includes(eng.reverbPreDelay.delayTime), "mod depth feeds reverb pre-delay");
eng.setReverbMod(1);
ok(eng.reverbModDepth.gain.value > 0 && eng.reverbMod === 1, "setReverbMod(1) opens depth + stores amount");
eng.setReverbMod(0);
ok(eng.reverbModDepth.gain.value === 0, "setReverbMod(0) → static again");
eng.setReverbMod(-1);
ok(eng.reverbMod === 0, "amount clamped to >= 0");
eng.setReverbMod(0);

section("dub filter resonance (Q) is applied (§9)");
eng.setDubFilter("lp", 800, 0.5);
ok(eng.dubFilter.type === "lowpass" && eng.dubFilter.frequency.value === 800, "LP cutoff applied");
ok(eng.dubFilter.Q.value === 0.5, "low resonance applied");
eng.setDubFilter("hp", 1200, 9);
ok(eng.dubFilter.type === "highpass" && eng.dubFilter.frequency.value === 1200, "HP cutoff applied");
ok(eng.dubFilter.Q.value === 9, "high resonance (screaming) applied");
eng.setDubFilter("lp", 1000, 1);

section("MIDI mapper — multiple controllers simultaneously (§17)");
{
  const { MidiMapper } = await loadMidi();
  const m = new MidiMapper();
  const hits = {};
  m.register("g", (v) => { hits.g = v; }, { type: "range" });
  m.register("k", (v) => { hits.k = v; }, { type: "button", momentary: true });
  m.bind("cc:0:7", "g");
  m.bind("note:0:36", "k");

  // fake Web MIDI access with TWO connected input controllers
  const mkInput = (name) => ({ name, type: "input", state: "connected", onmidimessage: null });
  const ctrlA = mkInput("Controller A"), ctrlB = mkInput("Controller B");
  let stateCb = null;
  const fakeAccess = {
    inputs: { forEach: (cb) => { cb(ctrlA); cb(ctrlB); } },
    set onstatechange(fn) { stateCb = fn; }, get onstatechange() { return stateCb; },
  };
  const fakeNav = { requestMIDIAccess: async () => fakeAccess };

  const names = await m.connectWebMidi(fakeNav);
  ok(names.length === 2 && names[0] === "Controller A" && names[1] === "Controller B", "connectWebMidi returns both controller names");
  ok(typeof ctrlA.onmidimessage === "function" && typeof ctrlB.onmidimessage === "function", "both controllers got a message handler");

  // each controller drives the rig independently / at the same time
  hits.g = null; ctrlA.onmidimessage({ data: [0xb0, 7, 127] }); ok(Math.abs(hits.g - 1) < 1e-6, "Controller A moves the gain");
  hits.k = null; ctrlB.onmidimessage({ data: [0x90, 36, 127] }); ok(hits.k === 1, "Controller B fires the kill — simultaneously");

  // hot-plugging a third controller attaches it via onstatechange
  const ctrlC = mkInput("Controller C");
  ok(typeof stateCb === "function", "onstatechange handler registered for hot-plug");
  stateCb({ port: ctrlC });
  hits.g = null; ctrlC.onmidimessage({ data: [0xb0, 7, 0] }); ok(hits.g === 0, "hot-plugged Controller C also routes");
}

section("dub siren stereo auto-pan (§10)");
ok(!!eng.siren.pan && !!eng.siren.panLfo && !!eng.siren.panDepth, "siren panner + LFO + depth present");
ok(eng.siren.output === eng.siren.pan, "siren output is the panner (stereo stage at the end)");
ok(eng.siren.panLfo.frequency.value > 0 && eng.siren.panLfo.frequency.value < 2, "pan LFO is slow (<2 Hz)");
ok(eng.siren.panDepth.gain.value === 0, "auto-pan centred (depth 0) by default");
ok(eng.siren.panDepth._conns.includes(eng.siren.pan.pan), "pan depth feeds panner.pan");
ok(eng.siren.srLP._conns.includes(eng.siren.pan), "siren signal flows srLP → panner");
eng.setSirenAutoPan(1);
ok(eng.siren.panDepth.gain.value === 1 && eng.siren.autoPan === 1, "setSirenAutoPan(1) → full sweep");
eng.setSirenAutoPan(0);
ok(eng.siren.panDepth.gain.value === 0, "setSirenAutoPan(0) → centred");
eng.setSirenAutoPan(5);
ok(eng.siren.autoPan === 1, "auto-pan depth clamped to 1");
eng.setSirenAutoPan(0);

section("dub filter auto-sweep LFO (dub-wah) (§9)");
ok(!!eng.dubFilterLfo && !!eng.dubFilterLfoDepth, "dub-sweep LFO + depth present");
ok(eng.dubFilterLfoDepth.gain.value === 0, "sweep off (depth 0) by default");
ok(eng.dubFilterLfoDepth._conns.includes(eng.dubFilter.frequency), "sweep depth feeds dubFilter.frequency");
eng.setDubSweep(2, 0.5);
ok(eng.dubFilterLfo.frequency.value === 2, "sweep rate applied");
ok(eng.dubFilterLfoDepth.gain.value > 0, "sweep depth opened");
ok(eng.dubSweepDepth === 0.5, "sweep depth amount stored");
eng.setDubSweep(20, 2); // clamp both
ok(eng.dubSweepRate === 8, "rate clamped to <= 8 Hz");
ok(eng.dubSweepDepth === 1, "depth clamped to <= 1");
eng.setDubSweep(null, 0); // null rate keeps prior rate
ok(eng.dubSweepRate === 8 && eng.dubFilterLfoDepth.gain.value === 0, "null rate keeps prior; depth 0 = off");

section("GEQ preset shapes are valid 10-band curves");
{
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
  const src = await readFile(join(ROOT, "app.jsx"), "utf8");
  const block = src.slice(src.indexOf("const EQ_SHAPES = {"), src.indexOf("};", src.indexOf("const EQ_SHAPES")));
  const rows = [...block.matchAll(/(\w+):\s*\[([-0-9,\s]+)\]/g)];
  ok(rows.length >= 5, `EQ_SHAPES defines ${rows.length} shapes`);
  let allOk = true, flatOk = false;
  for (const [, name, nums] of rows) {
    const arr = nums.split(",").map((n) => parseFloat(n.trim())).filter((n) => !Number.isNaN(n));
    if (arr.length !== 10) allOk = false;
    if (arr.some((v) => v < -12 || v > 12)) allOk = false;
    if (name === "FLAT") flatOk = arr.every((v) => v === 0);
  }
  ok(allOk, "every shape is exactly 10 bands within ±12 dB");
  ok(flatOk, "FLAT shape is all zeros");
}

section("every eng.* method called in app.jsx exists in the engine");
{
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
  const app = await readFile(join(ROOT, "app.jsx"), "utf8");
  const engSrc = await readFile(join(ROOT, "audio-engine.js"), "utf8");
  const called = [...app.matchAll(/\beng\.((?:set|get|can|enable|disable|switch|list|import|export|trigger|panic)[A-Za-z0-9]*)\s*\(/g)].map((m) => m[1]);
  const uniq = [...new Set(called)].sort();
  ok(uniq.length >= 40, `app calls ${uniq.length} distinct eng.* methods`);
  const missing = uniq.filter((n) => !new RegExp(`\\b${n}\\s*\\(`).test(engSrc));
  ok(missing.length === 0, `all eng.* methods exist in the engine (missing: ${missing.join(", ") || "none"})`);
}

section("preset persistence covers new fields + merges safely");
{
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
  const src = await readFile(join(ROOT, "app.jsx"), "utf8");
  const bp = src.slice(src.indexOf("const buildPreset = () => ({"), src.indexOf("});", src.indexOf("const buildPreset")));
  // whole-object spreads carry the new sub-fields; crossfadeCurve is its own key
  ok(/\bcrossfadeCurve\b/.test(bp), "buildPreset persists crossfadeCurve");
  ["echo", "reverb", "dubFilter", "siren", "sampleFx", "master"].forEach((k) =>
    ok(new RegExp(`\\b${k}\\b`).test(bp), `buildPreset persists ${k} (carries its new sub-fields)`));
  const ap = src.slice(src.indexOf("const applyPreset"), src.indexOf("const buildPresetRef"));
  ok(/p\.crossfadeCurve/.test(ap), "applyPreset restores crossfadeCurve");
  // symmetry: every top-level key buildPreset SAVES must be RESTORED in applyPreset
  const objStart = src.indexOf("({", src.indexOf("const buildPreset")) + 2;
  const objBody = src.slice(objStart, src.indexOf("});", objStart));
  const flat = objBody.replace(/\{[^{}]*\}/g, "OBJ"); // collapse nested deckA/deckB objects
  const topKeys = [...new Set([...flat.matchAll(/(?:^|[\s,])([a-zA-Z][a-zA-Z0-9]*)\s*[,:]/g)].map((m) => m[1]))]
    .filter((k) => k !== "version" && k !== "OBJ");
  ok(topKeys.length >= 30, `buildPreset has ${topKeys.length} top-level keys`);
  const notRestored = topKeys.filter((k) => !new RegExp(`p\\.${k}\\b`).test(ap));
  ok(notRestored.length === 0, `every saved key is restored (saved-but-not-restored: ${notRestored.join(", ") || "none"})`);
  // the previously-wholesale objects now merge (…s, …p.X) so old presets keep defaults
  ["master", "dubFilter", "siren", "sampleFx", "reverb", "echo"].forEach((k) =>
    ok(new RegExp(`\\.\\.\\.s,\\s*\\.\\.\\.p\\.${k}`).test(ap), `applyPreset merges ${k} (no wholesale-replace gap)`));
}

section("deck beat-loops");
{
  const d = eng.deckB;
  const dur = d.getDuration();
  d.clearLoopRegion();
  d.seek(0.25);
  const a = d.getCurrentTime();
  d.setBeatLoop(120, 1); // 120 BPM, 1 beat = 0.5s
  ok(Math.abs(d.loopA - a) < 1e-6, "beat-loop starts at the playhead");
  ok(Math.abs((d.loopB - d.loopA) - 0.5) < 1e-6, "120 BPM 1-beat loop = 0.5s");
  d.setBeatLoop(120, 4); // 4 beats = 2s
  ok(Math.abs((d.loopB - d.loopA) - 2) < 1e-6, "4-beat loop = 2s");
  d.setBeatLoop(60, 2); // 60 BPM 2 beats = 2s
  ok(Math.abs((d.loopB - d.loopA) - 2) < 1e-6, "60 BPM 2-beat loop = 2s");
  ok(d.loopB <= dur + 1e-9, "loop end clamped within the buffer");
  // loop roll: halve / double anchored at loopA
  d.seek(0.1);
  d.setBeatLoop(120, 2); // 1.0s loop
  const la = d.loopA;
  d.halveLoop();
  ok(Math.abs((d.loopB - d.loopA) - 0.5) < 1e-6 && Math.abs(d.loopA - la) < 1e-9, "halveLoop → 0.5s, anchored at loopA");
  d.halveLoop();
  ok(Math.abs((d.loopB - d.loopA) - 0.25) < 1e-6, "halveLoop again → 0.25s");
  d.doubleLoop(); d.doubleLoop();
  ok(Math.abs((d.loopB - d.loopA) - 1) < 1e-6, "doubleLoop twice → back to 1s");
  d.clearLoopRegion();
  d.halveLoop(); // no-op when no loop
  ok(d.loopA === 0 && d.loopB === 0, "halve/double are no-ops without an active loop");
  d.clearLoopRegion();
  ok(d.loopA === 0 && d.loopB === 0, "clear removes the loop");
  d.seek(0);
}

section("deck hot-cue points");
{
  const d = eng.deckA;
  const dur = d.getDuration();
  ok(dur > 0, "deck A has a loaded buffer");
  ok(d.hasCue() === false, "no cue set initially");
  d.seek(0.4);
  ok(Math.abs(d.getCurrentTime() - 0.4 * dur) < 1e-6, "seek to 40%");
  const cue = d.setCue();
  ok(d.hasCue() === true && Math.abs(cue - 0.4 * dur) < 1e-6, "setCue stores the current playhead");
  d.seek(0.1);
  ok(Math.abs(d.getCurrentTime() - 0.1 * dur) < 1e-6, "moved away to 10%");
  d.jumpToCue();
  ok(Math.abs(d.getCurrentTime() - 0.4 * dur) < 1e-6, "jumpToCue returns to the cue");
  d.clearCue();
  ok(d.hasCue() === false, "clearCue removes it");
  d.jumpToCue(); // no-op when unset — must not throw or move
  ok(Math.abs(d.getCurrentTime() - 0.4 * dur) < 1e-6, "jumpToCue is a no-op with no cue");
  d.seek(0);
}

section("deck loop / cue / loop-roll coexist (shared loopA/loopB/offset/cue)");
{
  const d = eng.deckB;
  d.clearLoopRegion(); d.clearCue(); d.seek(0.25);
  const dur = d.getDuration();
  d.setBeatLoop(120, 2);                 // 1.0s loop from the playhead
  const la = d.loopA;
  ok(d.loopB > d.loopA, "beat-loop set");
  d.setCue();                            // cue while a loop is active
  ok(d.hasCue(), "cue set with a loop active");
  d.halveLoop();                         // loop-roll on top of the beat-loop
  ok(Math.abs((d.loopB - d.loopA) - 0.5) < 1e-6 && d.loopA === la, "loop-roll halves without moving loopA or losing the cue");
  ok(d.hasCue() && d.loopB > d.loopA, "cue + loop both still active after loop-roll");
  d.seek(0.6); d.jumpToCue();            // jumping to the cue must not disturb the loop region
  ok(Math.abs(d.getCurrentTime() - 0.25 * dur) < 1e-3, "jumpToCue returns to the cued position");
  ok(d.loopB > d.loopA, "loop region intact after a cue jump");
  d.clearLoopRegion();
  ok(d.loopA === 0 && d.loopB === 0 && d.hasCue(), "clearing the loop keeps the cue");
  await d.loadSynthetic(2);              // a fresh track clears BOTH
  ok(d.loopA === 0 && d.loopB === 0 && !d.hasCue(), "loading a track clears loop + cue");
  d.seek(0);
}

section("samples reverse playback");
{
  const sp = eng.samples;
  const orig = sp.samples[0].buffer;
  ok(!!orig && orig.length > 4, "slot 0 has a buffer");
  const rev = sp._reversedBuffer(orig);
  const a = orig.getChannelData(0), b = rev.getChannelData(0), n = a.length;
  ok(rev.length === orig.length && rev.numberOfChannels === orig.numberOfChannels, "reversed buffer matches shape");
  ok(b[0] === a[n - 1] && b[n - 1] === a[0], "reversed buffer flips first<->last sample");
  ok(b[1] === a[n - 2], "interior samples reversed too");
  ok(sp.reverse === false, "reverse off by default");
  eng.setSamplesReverse(true);
  ok(sp.reverse === true, "setSamplesReverse(true) engages");
  eng.setSamplesReverse(false);
  ok(sp.reverse === false, "setSamplesReverse(false) disengages");
}

section("samples high-pass (now adjustable)");
ok(!!eng.samplesHP && eng.samplesHP.type === "highpass", "samples HP node present");
eng.setSamplesHP(20);
ok(eng.samplesHP.frequency.value === 20, "20 Hz = transparent");
eng.setSamplesHP(450);
ok(eng.samplesHP.frequency.value === 450, "raises the samples HP cutoff (keep stabs above the bass)");
eng.setSamplesHP(20);

section("master high-pass (rumble filter)");
ok(!!eng.masterHP && eng.masterHP.type === "highpass", "master HP is a highpass in the master chain");
eng.setMasterHP(20);
ok(eng.masterHP.frequency.value === 20, "20 Hz = transparent");
eng.setMasterHP(120);
ok(eng.masterHP.frequency.value === 120, "raises the rumble cutoff");
eng.setMasterHP(20);

section("crossfader curve selector");
const near = (x, y) => Math.abs(x - y) < 1e-6;
eng.setCrossfadeCurve("power"); eng.setCrossfade(0.5);
ok(near(eng.xfadeA.gain.value, Math.SQRT1_2) && near(eng.xfadeB.gain.value, Math.SQRT1_2), "power: center ≈ 0.707/0.707 (equal power)");
eng.setCrossfadeCurve("linear"); eng.setCrossfade(0.5);
ok(near(eng.xfadeA.gain.value, 0.5) && near(eng.xfadeB.gain.value, 0.5), "linear: center = 0.5/0.5");
eng.setCrossfadeCurve("sharp"); eng.setCrossfade(0.25);
ok(near(eng.xfadeA.gain.value, 1) && near(eng.xfadeB.gain.value, 0.5), "sharp: A stays full at 1/4, B at 0.5");
eng.setCrossfade(0.5);
ok(near(eng.xfadeA.gain.value, 1) && near(eng.xfadeB.gain.value, 1), "sharp: both full mid-travel");
["power", "linear", "sharp"].forEach((c) => {
  eng.setCrossfadeCurve(c); eng.setCrossfade(0);
  ok(near(eng.xfadeA.gain.value, 1) && near(eng.xfadeB.gain.value, 0), `${c}: v=0 → full A`);
  eng.setCrossfade(1);
  ok(near(eng.xfadeA.gain.value, 0) && near(eng.xfadeB.gain.value, 1), `${c}: v=1 → full B`);
});
eng.setCrossfadeCurve("sharp"); eng.setCrossfade(0.7);
eng.setCrossfadeCurve("linear"); // changing curve re-applies the last position
ok(near(eng.xfadeA.gain.value, 0.3) && near(eng.xfadeB.gain.value, 0.7), "switching curve re-applies last fader position");
eng.setCrossfadeCurve("power"); eng.setCrossfade(0.5);

section("tempo-synced echo (§8)");
eng.setEchoRobotic(false);
ok(Math.abs(eng.setEchoSync(120, "1/4") - 500) < 1e-6, "120 BPM 1/4 → 500ms returned");
ok(Math.abs(eng.echoDelay.delayTime.value - 0.5) < 1e-9, "delay set to 0.5s");
ok(Math.abs(eng.setEchoSync(120, "1/8") - 250) < 1e-6, "120 BPM 1/8 → 250ms");
ok(Math.abs(eng.echoDelay.delayTime.value - 0.25) < 1e-9, "delay 0.25s");
ok(Math.abs(eng.setEchoSync(120, "1/8.") - 375) < 1e-6, "dotted 1/8 → 375ms");
ok(Math.abs(eng.setEchoSync(60, "1/16") - 250) < 1e-6, "60 BPM 1/16 → 250ms");
ok(Math.abs(eng.setEchoSync(120, "bogus") - 250) < 1e-6, "unknown division falls back to 1/8");
eng.setEchoSync(240, "1/16t"); // very short → clamps
ok(eng.echoDelay.delayTime.value >= 0.02, "ultra-short synced time clamped to >= 20ms");
// robotic still overrides a synced time
eng.setEchoRobotic(true);
eng.setEchoSync(120, "1/4");
ok(eng.echoDelay.delayTime.value < 0.02, "robotic overrides tempo-sync");
eng.setEchoRobotic(false);
ok(Math.abs(eng.echoDelay.delayTime.value - 0.5) < 1e-9, "disengage robotic restores the synced time");

section("full-speed / robotic echo (§8)");
eng.setEchoTime(500);
ok(Math.abs(eng.echoDelay.delayTime.value - 0.5) < 1e-9, "normal: 500ms → 0.5s delay");
eng.setEchoRobotic(true);
ok(eng.echoDelay.delayTime.value < 0.02, "robotic: delay snaps ultra-short (<20ms)");
eng.setEchoTime(800);
ok(eng.echoDelay.delayTime.value < 0.02, "robotic holds the short delay (setEchoTime ignored while engaged)");
eng.setEchoRobotic(false);
ok(Math.abs(eng.echoDelay.delayTime.value - 0.8) < 1e-9, "disengage restores the last requested time (800ms)");
// robotic must hold the wow/flutter LFOs off (else they wobble the fixed comb)
eng.setEchoWow(1);
ok(eng.echoWowDepth.gain.value > 0 && eng.echoFlutterDepth.gain.value > 0, "wow open before robotic");
eng.setEchoRobotic(true);
ok(eng.echoWowDepth.gain.value === 0 && eng.echoFlutterDepth.gain.value === 0, "robotic forces wow/flutter LFO depths to 0 (fixed comb)");
ok(eng.echoWow === 1, "wow amount remembered while robotic holds it off");
eng.setEchoWow(0.5); // changing wow while robotic stays held off
ok(eng.echoWowDepth.gain.value === 0, "setEchoWow during robotic still holds depth at 0");
eng.setEchoRobotic(false);
ok(eng.echoWowDepth.gain.value > 0, "disengaging robotic restores the wow LFO depth");
eng.setEchoWow(0); eng.setEchoRobotic(false);

section("MIDI range handlers round-trip through their midiValues01 inverse (pickup correctness)");
{
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
  const src = await readFile(join(ROOT, "app.jsx"), "utf8");
  // handlers: "id": (v) => setSetter((s) => ({ ...s, KEY: EXPR }))
  const hBlock = src.slice(src.indexOf("const H = {"), src.indexOf("\n    };", src.indexOf("const H = {")));
  const handlers = {};
  for (const m of hBlock.matchAll(/"([^"]+)":\s*\(v\)\s*=>\s*set([A-Za-z]+)\(\(s\)\s*=>\s*\(\{\s*\.\.\.s,\s*([A-Za-z0-9]+):\s*([^\n]+?)\s*\}\)\)/g))
    handlers[m[1]] = { setter: m[2], key: m[3], expr: m[4].replace(/\s*\}\)\),?\s*$/, "") };
  // inverses: "id": EXPR,  (inside midiValues01)
  const vBlock = src.slice(src.indexOf("const midiValues01"), src.indexOf("\n  };", src.indexOf("const midiValues01")));
  const inv = {};
  for (const m of vBlock.matchAll(/"([^"]+)":\s*([^\n,]+),/g)) inv[m[1]] = m[2].trim();
  const clamp = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  let checked = 0; const bad = [];
  for (const id in handlers) {
    const h = handlers[id], iv = inv[id];
    // skip button-style handlers, and nested-setState handlers (e.g. in1.gain
    // sets s.in1.gain) whose extracted expr references `s.` — the text parser
    // only round-trips simple `{ ...s, KEY: f(v) }` scalar maps.
    if (!iv || /v > 0\.5/.test(h.expr) || /\bs\./.test(h.expr) || /^\{/.test(h.expr.trim())) continue;
    const objName = h.setter[0].toLowerCase() + h.setter.slice(1); // setReverb -> reverb
    let fwd, invf;
    try { fwd = new Function("v", "return (" + h.expr + ")"); invf = new Function("clamp", objName, "return (" + iv + ")"); }
    catch (e) { bad.push(`${id}: parse ${e.message}`); continue; }
    checked++;
    for (const v of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      let back;
      try { back = invf(clamp, { [h.key]: fwd(v) }); } catch (e) { bad.push(`${id}: eval ${e.message}`); break; }
      // a true inverse round-trips to within half a quantization step (<= 0.06 covers the coarsest)
      if (typeof back !== "number" || Number.isNaN(back) || Math.abs(back - v) > 0.06)
        bad.push(`${id}: v=${v} -> ${h.key}=${fwd(v)} -> back=${typeof back === "number" ? back.toFixed(4) : back}`);
    }
  }
  ok(checked >= 30, `checked ${checked} range handler↔inverse pairs`);
  ok(bad.length === 0, `every midiValues01 entry is a true inverse of its handler (mismatches: ${bad.slice(0, 4).join("; ") || "none"})`);
}

section("MIDI control wiring is complete (every control has a handler + seed)");
{
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
  const src = await readFile(join(ROOT, "app.jsx"), "utf8");
  const catalog = await readFile(join(ROOT, "midi-controls.js"), "utf8");
  const mc = catalog.slice(catalog.indexOf("const controls = ["));
  const controlsBlock = mc.slice(0, mc.indexOf("];"));
  const ids = [...controlsBlock.matchAll(/\{\s*id:\s*"([^"]+)"/g)].map((m) => m[1]);
  const hStart = src.indexOf("const H = {");
  const hBlock = src.slice(hStart, src.indexOf("};", hStart));
  const hKeys = [...hBlock.matchAll(/"([^"]+)":\s*\(v\)/g)].map((m) => m[1]);
  const vStart = src.indexOf("const midiValues01");
  const vBlock = src.slice(vStart, src.indexOf("};", vStart));
  const vKeys = [...vBlock.matchAll(/"([^"]+)":/g)].map((m) => m[1]);
  ok(ids.length >= 60, `MIDI_CONTROLS has ${ids.length} controls`);
  ok(ids.every((id) => hKeys.includes(id)), "every control has an H handler (no undefined handler passed to register)");
  ok(ids.every((id) => vKeys.includes(id)), "every control has a midiValues01 pickup-seed value");
  ok(hKeys.every((k) => ids.includes(k)), "no orphan H handler without a control");
}

console.log(`\n${fail === 0 ? "✓ PASS" : "✗ FAIL"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
