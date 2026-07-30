import { expect, test } from "@playwright/test";

async function expectInsideViewport(locator, page) {
  await expect(locator).toBeVisible();
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport) return false;
    return box.x >= -1
      && box.y >= -1
      && box.x + box.width <= viewport.width + 1
      && box.y + box.height <= viewport.height + 1;
  }).toBe(true);
}

test("keeps every rack region inside the page viewport", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.locator(".chassis")).toBeVisible();

  const metrics = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const rackRegions = [...document.querySelectorAll(
      ".grid-top > *, .transport-row > *, .grid-mid > *, .grid-bottom > *, .right-rail > *",
    )]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          name: [...element.classList].find((name) => name.startsWith("rack-")) || element.className,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      });
    const touchTargets = [...document.querySelectorAll(
      "button, select, input, label, [role='button'], [role='slider'], [role='radio'], [role='tab']",
    )]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const verticalHitSlop = element.matches(".fader-track, .vslider-track") ? 20 : 0;
        const horizontalHitSlop = element.matches(".xfader") ? 16 : 0;
        return {
          name: element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent.trim().slice(0, 24),
          width: Math.round(rect.width + verticalHitSlop),
          height: Math.round(rect.height + horizontalHitSlop),
        };
      });

    return {
      viewport: { width: viewportWidth, height: viewportHeight },
      document: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        viewportHeights: +(document.documentElement.scrollHeight / viewportHeight).toFixed(2),
      },
      rackRegions,
      outsideRegions: rackRegions.filter((region) => region.left < -1 || region.right > viewportWidth + 1),
      undersizedTouchTargets: matchMedia("(pointer: coarse)").matches
        ? touchTargets.filter((target) => target.width < 28 || target.height < 28)
        : [],
    };
  });

  await testInfo.attach("responsive-metrics", {
    body: Buffer.from(JSON.stringify(metrics, null, 2)),
    contentType: "application/json",
  });
  console.log(`${testInfo.project.name}: ${JSON.stringify(metrics.document)} · ${metrics.undersizedTouchTargets.length} small touch targets`);
  if (metrics.undersizedTouchTargets.length) {
    console.log(`${testInfo.project.name} small targets: ${JSON.stringify(metrics.undersizedTouchTargets)}`);
  }

  expect(metrics.document.width).toBeLessThanOrEqual(metrics.viewport.width + 1);
  expect(metrics.outsideRegions).toEqual([]);
});

test("compact rack navigation reaches and tracks distant controls", async ({ page }, testInfo) => {
  const compactProject = testInfo.project.name.startsWith("mobile")
    || testInfo.project.name.startsWith("tablet");
  test.skip(!compactProject, "Compact navigation is hidden on fine-pointer desktop layouts");

  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "Rack sections" });
  await expect(navigation).toBeVisible();

  const kills = navigation.getByRole("button", { name: "Kills" });
  await kills.click();

  await expect(kills).toHaveAttribute("aria-current", "location");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  await expect(page.locator("#rack-kills")).toBeInViewport();

  const inputs = navigation.getByRole("button", { name: "Inputs" });
  await inputs.click();
  await expect(inputs).toHaveAttribute("aria-current", "location");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(300);
});

test("focused controls and dialogs isolate global performance shortcuts", async ({ page }) => {
  await page.goto("/");

  const crossfader = page.getByRole("slider", { name: "Crossfader" });
  const filterCutoff = page.getByRole("slider", { name: "CUTOFF" });
  const crossfadeBefore = Number(await crossfader.getAttribute("aria-valuenow"));
  const cutoffBefore = await filterCutoff.getAttribute("aria-valuenow");

  await crossfader.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => Number(await crossfader.getAttribute("aria-valuenow")))
    .toBeGreaterThan(crossfadeBefore);
  await expect(filterCutoff).toHaveAttribute("aria-valuenow", cutoffBefore);

  const lowKill = page.locator(".grid-bottom .rack-kill").nth(1).getByRole("button", { name: "KILL" });
  await page.getByTitle("Keyboard shortcuts (?)").click();
  await expect(page.getByRole("dialog", { name: /Help · Keyboard/ })).toBeVisible();
  await page.keyboard.press("x");
  await expect(lowKill).not.toHaveClass(/active/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: /Help · Keyboard/ })).toBeHidden();
});

test("deck waveforms seek and expose cue and loop markers", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByTitle("Click to start the audio engine").click();
  await page.waitForFunction(() => window.DubnatorEngine?.deckA?.buffer?.duration > 0);

  const deckStrip = page.locator(".rack-music .input-strip.wide").first();
  const waveform = page.getByRole("slider", { name: "Deck A waveform playhead" });
  await expect(waveform).toBeVisible();
  await expect(waveform.locator(".deck-waveform-body")).toHaveAttribute("d", /M/);

  const seekTo = async (fraction) => {
    const box = await waveform.boundingBox();
    expect(box).not.toBeNull();
    await waveform.click({ position: { x: box.width * fraction, y: box.height / 2 } });
  };
  await seekTo(0.25);
  await expect.poll(() => page.evaluate(() => window.DubnatorEngine.deckA.getCurrentTime()))
    .toBeGreaterThan(1.5);

  await deckStrip.getByTitle("Set hot-cue at the playhead").click();
  await expect(waveform.locator(".deck-waveform-cue")).toBeVisible();

  await deckStrip.getByTitle("Show rewind / pan / loop controls").click();
  const analyze = deckStrip.getByTitle("Estimate this track's tempo and musical key");
  await analyze.click();
  await expect(analyze).toHaveText("ANALYZE", { timeout: 10_000 });
  await expect(deckStrip.locator(".deck-analysis-readout")).toContainText("75 BPM");
  await expect(waveform.locator(".deck-waveform-tempo")).toContainText("75 BPM");

  await deckStrip.getByTitle("Set loop start at the playhead").click();
  await seekTo(0.75);
  await deckStrip.getByTitle("Set loop end at the playhead + engage").click();
  await expect(waveform.locator(".deck-waveform-loop")).toBeVisible();

  await testInfo.attach("deck-waveform", {
    body: await page.locator(".transport-panel").screenshot(),
    contentType: "image/png",
  });
  await testInfo.attach("deck-analysis", {
    body: await page.locator(".rack-music").screenshot(),
    contentType: "image/png",
  });
});

test("expanded deck view switches between double and single performance layouts", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open expanded deck view" }).click();

  const dialog = page.getByRole("dialog", { name: "Deck performance" });
  await expectInsideViewport(dialog, page);
  await expect(dialog.getByRole("button", { name: "DOUBLE", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.locator(".deck-focus-card")).toHaveCount(2);
  await expect.poll(() => dialog.locator(".deck-focus-card").evaluateAll((cards) => cards.every((card) => {
    const cardBox = card.getBoundingClientRect();
    const controlsBox = card.querySelector(".deck-focus-controls")?.getBoundingClientRect();
    return controlsBox && controlsBox.bottom <= cardBox.bottom + 1;
  }))).toBe(true);
  await testInfo.attach("expanded-deck-double", {
    body: await dialog.screenshot(),
    contentType: "image/png",
  });

  await dialog.getByRole("button", { name: "SINGLE", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "SINGLE", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.locator(".deck-focus-card")).toHaveCount(1);

  await dialog.getByRole("button", { name: "DECK B" }).click();
  await expect(dialog.locator(".deck-focus-card")).toHaveCount(1);
  await expect(dialog.locator("section[aria-label='Deck B']")).toBeVisible();
  await expect(dialog.getByRole("slider", { name: "Deck B detailed waveform playhead" })).toBeVisible();
  await expect(dialog.locator(".deck-focus-zoom output")).toHaveText("16s");
  await dialog.getByRole("button", { name: "Zoom in Deck B waveform" }).click();
  await expect(dialog.locator(".deck-focus-zoom output")).toHaveText("15s");
  await dialog.getByRole("button", { name: "Zoom in Deck B waveform" }).click();
  await expect(dialog.locator(".deck-focus-zoom output")).toHaveText("14s");
  await dialog.getByRole("slider", { name: "Deck B waveform zoom" }).fill("1");
  await expect(dialog.locator(".deck-focus-zoom output")).toHaveText("2.0s");
  const detailedViewBox = await dialog.locator(".deck-focus-detail .deck-waveform-svg").getAttribute("viewBox");
  expect(Number(detailedViewBox.split(/\s+/)[2])).toBeLessThan(1000);

  await expect(dialog.getByRole("button", { name: "Previous track on Deck B" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Next track on Deck B" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Play Deck B" }).click();
  await expect.poll(() => page.evaluate(() => window.DubnatorEngine.deckB.playing)).toBe(true);
  await dialog.getByRole("button", { name: "Pause Deck B" }).click();
  await expect.poll(() => page.evaluate(() => window.DubnatorEngine.deckB.playing)).toBe(false);

  await page.evaluate(() => window.DubnatorEngine.deckB.seek(0.25));
  await dialog.getByRole("button", { name: "Set cue on Deck B" }).click();
  await expect.poll(() => page.evaluate(() => window.DubnatorEngine.deckB.cuePoint)).toBeGreaterThan(1);
  await dialog.getByRole("button", { name: "Jump to cue on Deck B" }).click();

  await dialog.getByRole("button", { name: "2-beat loop on Deck B" }).click();
  const initialLoopLength = await page.evaluate(() => {
    const deck = window.DubnatorEngine.deckB;
    return deck.loopB - deck.loopA;
  });
  await dialog.getByRole("button", { name: "Halve loop on Deck B" }).click();
  await expect.poll(() => page.evaluate(() => {
    const deck = window.DubnatorEngine.deckB;
    return deck.loopB - deck.loopA;
  })).toBeLessThan(initialLoopLength);
  await dialog.getByRole("button", { name: "Double loop on Deck B" }).click();
  await dialog.getByRole("button", { name: "Clear loop on Deck B" }).click();
  await expect.poll(() => page.evaluate(() => window.DubnatorEngine.deckB.loopB)).toBe(0);

  await dialog.getByRole("button", { name: "Set loop in on Deck B" }).click();
  await expect(dialog.getByRole("button", { name: "Set loop out on Deck B" })).toBeEnabled();
  await page.evaluate(() => window.DubnatorEngine.deckB.seek(0.7));
  await dialog.getByRole("button", { name: "Set loop out on Deck B" }).click();
  await expect.poll(() => page.evaluate(() => window.DubnatorEngine.deckB.loopB)).toBeGreaterThan(0);
  await dialog.getByRole("button", { name: "Clear loop on Deck B" }).click();
  await dialog.getByRole("button", { name: "Rewind Deck B" }).click();
  await dialog.getByRole("button", { name: "Stop Deck B" }).click();

  await testInfo.attach("expanded-deck-single", {
    body: await dialog.screenshot(),
    contentType: "image/png",
  });

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("tool windows stay reachable inside every screen", async ({ page }) => {
  await page.goto("/");

  const playlistButton = page.locator(".rack-music .input-strip.wide").first()
    .getByTitle(/Open Playlist/);
  await playlistButton.click();
  const playlist = page.locator(".floating-window.playlist-modal");
  await expectInsideViewport(playlist, page);
  await playlist.getByRole("button", { name: "ESC" }).click();

  await page.locator(".rack-siren").getByRole("button", { name: "SETUP" }).click();
  const sirenSetup = page.locator(".floating-window").filter({ hasText: "Dub Siren — Setup" });
  await expectInsideViewport(sirenSetup, page);
  await sirenSetup.locator(".floating-titlebar .btn").click();

  await page.getByTitle("Keyboard shortcuts (?)").click();
  const help = page.locator(".help-modal");
  await expectInsideViewport(help, page);
  await help.getByRole("button", { name: "ESC" }).click();

  await page.getByTitle("MIDI controller mapping").click();
  const midi = page.locator(".modal-window").filter({ hasText: "MIDI Mapping" });
  await expectInsideViewport(midi, page);
  await midi.getByRole("button", { name: "ESC" }).click();
});

test("custom rack sliders support direct keyboard control", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-wide", "One desktop project covers keyboard semantics");

  await page.goto("/");
  const crossfader = page.getByRole("slider", { name: "Crossfader" });
  await crossfader.focus();
  await page.keyboard.press("End");
  await expect(crossfader).toHaveAttribute("aria-valuenow", "1");
  await expect(crossfader).toHaveAttribute("aria-valuetext", /Deck B 100%/);

  await page.keyboard.press("Home");
  await expect(crossfader).toHaveAttribute("aria-valuenow", "0");
  await expect(crossfader).toHaveAttribute("aria-valuetext", /Deck A 100%/);

  const echoSend = page.locator(".rack-echo").getByRole("slider", { name: "SEND" });
  const initial = Number(await echoSend.getAttribute("aria-valuenow"));
  await echoSend.focus();
  await page.keyboard.press("ArrowUp");
  await expect.poll(async () => Number(await echoSend.getAttribute("aria-valuenow"))).toBeGreaterThan(initial);
});

test("an interrupted touch drag releases its rack control", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "tablet-landscape", "One touch project covers pointer cancellation");

  await page.goto("/");
  const echoSend = page.locator(".rack-echo").getByRole("slider", { name: "SEND" });
  const box = await echoSend.boundingBox();
  expect(box).not.toBeNull();
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const before = Number(await echoSend.getAttribute("aria-valuenow"));

  await echoSend.dispatchEvent("pointerdown", {
    pointerId: 7,
    pointerType: "touch",
    isPrimary: true,
    buttons: 1,
    clientX: point.x,
    clientY: point.y,
  });
  await page.evaluate(({ x, y }) => {
    window.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 7,
      pointerType: "touch",
      isPrimary: true,
      buttons: 1,
      clientX: x,
      clientY: y - 45,
    }));
  }, point);
  await expect.poll(async () => Number(await echoSend.getAttribute("aria-valuenow"))).toBeGreaterThan(before);

  await page.evaluate(({ x, y }) => {
    window.dispatchEvent(new PointerEvent("pointercancel", {
      pointerId: 7,
      pointerType: "touch",
      isPrimary: true,
      clientX: x,
      clientY: y - 45,
    }));
  }, point);
  const releasedAt = Number(await echoSend.getAttribute("aria-valuenow"));
  await page.evaluate(({ x, y }) => {
    window.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 7,
      pointerType: "touch",
      isPrimary: true,
      buttons: 1,
      clientX: x,
      clientY: y - 80,
    }));
  }, point);
  await expect.poll(async () => Number(await echoSend.getAttribute("aria-valuenow"))).toBe(releasedAt);

  const geqFader = page.locator(".rack-geq .vslider-track").first();
  await geqFader.scrollIntoViewIfNeeded();
  const faderBox = await geqFader.boundingBox();
  expect(faderBox).not.toBeNull();
  const hitSlopPoint = {
    x: faderBox.x + faderBox.width + 8,
    y: faderBox.y + faderBox.height * 0.25,
  };
  const hitTarget = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    return element?.classList.contains("vslider-track") || false;
  }, hitSlopPoint);
  expect(hitTarget).toBe(true);
  await page.touchscreen.tap(hitSlopPoint.x, hitSlopPoint.y);
  await expect.poll(async () => Number(await geqFader.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
});
