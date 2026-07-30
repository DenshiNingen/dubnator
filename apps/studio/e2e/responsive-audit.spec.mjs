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
    const touchTargets = [...document.querySelectorAll("button, select, input, label")]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          name: element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent.trim().slice(0, 24),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
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
    || testInfo.project.name === "tablet-portrait";
  test.skip(!compactProject, "Compact navigation is hidden above 900px");

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
});
