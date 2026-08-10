import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const url = process.env.DUBNATOR_E2E_URL || "http://127.0.0.1:1420";
const drive = process.env.ENGINE_DJ_DRIVE || "/Volumes/ELECTRON";
const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("console", (message) => {
  if (message.type() === "error") console.error(`browser: ${message.text()}`);
});
try {
  await page.addInitScript(({ forceFallback, forceSqlAsm }) => {
    globalThis.__DUBNATOR_FORCE_STEM_FALLBACK = forceFallback;
    globalThis.__DUBNATOR_FORCE_SQL_ASM = forceSqlAsm;
    // This integration supplies a real directory through Playwright's file
    // input. Keep exercising that compatibility path even when Chromium
    // exposes the newer directory-handle picker used by the live app.
    Object.defineProperty(globalThis, "showDirectoryPicker", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, "DubnatorLaunchpad", {
      configurable: true,
      set(api) {
        const Base = api.LaunchpadMiniMk3Manager;
        api.LaunchpadMiniMk3Manager = class TestLaunchpadManager extends Base {
          constructor(options) {
            super(options);
            globalThis.__dubLaunchpadManager = this;
          }
        };
        Object.defineProperty(globalThis, "DubnatorLaunchpad", {
          configurable: true,
          writable: true,
          value: api,
        });
      },
    });
  }, {
    forceFallback: process.env.DUBNATOR_FORCE_STEM_FALLBACK === "1",
    forceSqlAsm: process.env.DUBNATOR_FORCE_SQL_ASM === "1",
  });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.locator("body").click({ position: { x: 10, y: 10 } });
  await page.keyboard.press("Space");
  const input = page.locator("label.engine-action input[webkitdirectory]").first();
  await input.setInputFiles(drive);
  await page.getByText(/Engine DJ ready/i).waitFor({ timeout: 30_000 });
  const artistFolder = page.locator(".engine-browser-folder").filter({ hasText: "ByArtistsss" });
  await artistFolder.waitFor();
  const visiblePlaylistNames = await page.locator(".engine-browser-playlist-copy strong").allTextContents();
  assert.ok(!visiblePlaylistNames.includes("ByArtistsss"), "zero-track Engine folder must not be duplicated as a playlist");
  const artistPlaylist = page.locator(".engine-browser-playlist").filter({ hasText: "Biga*Ranx" });
  await artistPlaylist.click();
  await page.locator(".engine-browser-title").getByText("ByArtistsss / Biga*Ranx", { exact: true }).waitFor();
  const playlistRow = page.locator(".engine-browser-playlist").filter({ hasText: "S'horabaixa 2" });
  await playlistRow.click();
  await page.getByRole("button", { name: "LOAD PLAYLIST" }).click();
  await page.waitForFunction(() => /hibarnan/i.test(globalThis.window.DubnatorEngine?.deckA?.name || ""), null, { timeout: 180_000 });
  await page.waitForFunction(() => globalThis.window.DubnatorEngine?.deckA?.getStemState?.().state !== "loading", null, { timeout: 180_000 });
  const ready = await page.evaluate(() => {
    const deck = globalThis.window.DubnatorEngine.deckA;
    return {
      name: deck.name,
      analysis: deck.analysis,
      state: deck.getStemState(),
      channels: deck.stemBuffers?.map((buffer) => buffer.numberOfChannels),
      energies: deck.stemBuffers?.map((buffer) => {
        const data = buffer.getChannelData(0);
        let sum = 0;
        const stride = Math.max(1, Math.floor(data.length / 50000));
        for (let i = 0; i < data.length; i += stride) sum += data[i] * data[i];
        return sum;
      }),
    };
  });
  assert.match(ready.name, /Hibarnan/i);
  assert.equal(ready.analysis?.bpm, 148);
  assert.equal(ready.analysis?.tempoSource, "engine-dj");
  assert.equal(ready.state.state, "ready", ready.state.error || "stem decode did not finish");
  assert.deepEqual(ready.channels, [2, 2, 2, 2]);
  assert.ok(ready.energies.every((energy) => energy > 0.001), `silent stem: ${ready.energies}`);
  const hardwareMuted = await page.evaluate(async () => {
    const manager = globalThis.__dubLaunchpadManager;
    if (!manager) throw new Error("App Launchpad manager was not captured");
    manager.setPorts({
      inputs: [{ id: "engine-test-in", name: "Launchpad Mini MK3 Test" }],
      outputs: [{ id: "engine-test-out", name: "Launchpad Mini MK3 Test" }],
    });
    if (!manager.selectPage(0, 1, "e2e")) throw new Error("Could not select Deck A Launchpad page");
    for (const note of [14, 15, 16, 17]) {
      manager.handleMidi({ deviceId: "engine-test-in", data: [0x90, note, 127] });
      manager.handleMidi({ deviceId: "engine-test-in", data: [0x80, note, 0] });
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    const deck = globalThis.window.DubnatorEngine.deckA;
    return { state: deck.getStemState(), gains: deck.stemGains.map((gain) => gain.gain.value) };
  });
  assert.deepEqual(hardwareMuted.state.muted, [true, true, true, true]);
  assert.ok(hardwareMuted.gains.every((gain) => gain < 0.001), `Launchpad all-muted graph is not silent: ${hardwareMuted.gains}`);
  if (process.env.ENGINE_DJ_SCREENSHOT) {
    await page.screenshot({ path: process.env.ENGINE_DJ_SCREENSHOT });
  }
  // Closing and reopening must retain the live File objects selected from the
  // drive. The IndexedDB catalogue is metadata-only and must not overwrite it.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Space");
  await page.locator(".playlist-modal").waitFor();
  await page.locator(".pl-deck-tab").nth(1).click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator(".engine-browser-offline").count(), 0, "Engine drive session was lost after reopening the manager");
  const secondTrackLoad = page.locator(".engine-track-actions .pl-load").nth(1);
  assert.equal(await secondTrackLoad.isEnabled(), true, "Deck B cannot load from the retained Engine drive session");
  await secondTrackLoad.click();
  await page.waitForFunction(() => /murderer/i.test(globalThis.window.DubnatorEngine?.deckB?.name || ""), null, { timeout: 180_000 });
  await page.locator(".pl-deck-tab").nth(0).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Open expanded deck view" }).click();
  const stemPanel = page.locator(".deck-focus-stems.ready").first();
  await stemPanel.waitFor();
  const stemButtons = stemPanel.locator(".deck-focus-stem-buttons button");
  assert.equal(await stemButtons.count(), 4);
  for (let index = 0; index < 4; index++) assert.equal(await stemButtons.nth(index).getAttribute("aria-pressed"), "true");
  const muted = await page.evaluate(() => {
    const deck = globalThis.window.DubnatorEngine.deckA;
    return {
      state: deck.getStemState(),
      gains: deck.stemGains.map((gain) => gain.gain.value),
    };
  });
  assert.deepEqual(muted.state.muted, [true, true, true, true]);
  assert.ok(muted.gains.every((gain) => gain < 0.001), `all-muted graph is not silent: ${muted.gains}`);
  if (process.env.ENGINE_DJ_SCREENSHOT) {
    const target = process.env.ENGINE_DJ_SCREENSHOT.replace(/(\.\w+)?$/, "-deck$1");
    await page.screenshot({ path: target });
  }
  console.log(`Browser integration OK: ${ready.name}; four stereo stems decoded and real Launchpad input mutes all output.`);
} finally {
  await browser.close();
}
