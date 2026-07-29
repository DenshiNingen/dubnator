import { expect, test } from "@playwright/test";

test("renders the complete rack without browser runtime errors", async ({ page }, testInfo) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");

  await expect(page.locator(".chassis")).toBeVisible();
  await expect(page.locator(".brand-mark .word")).toHaveText("DUBNATOR");
  await expect(page.locator(".rack-music")).toBeVisible();
  await expect(page.locator(".rack-reverb")).toBeAttached();
  await expect(page.locator(".rack-echo")).toBeAttached();

  await testInfo.attach("studio-rack", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  expect(pageErrors).toEqual([]);
});

test("protects a playing deck from an accidental track drop", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByTitle("Click to start the audio engine").click();
  await expect(page.getByTitle("Audio engine running")).toContainText("ENGINE ONLINE");

  const deckA = page.locator(".rack-music .input-strip.wide").first();
  await deckA.getByTitle("Play / Pause").click();
  await page.waitForFunction(() => window.DubnatorEngine?.deckA?.playing === true);
  const originalName = await page.evaluate(() => window.DubnatorEngine.deckA.name);

  await deckA.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(
      [new Uint8Array([82, 73, 70, 70])],
      "replacement.wav",
      { type: "audio/wav" },
    ));
    element.dispatchEvent(new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    }));
  });

  const warning = page.getByRole("alert");
  await expect(warning).toContainText("DECK-A IS PLAYING");
  await expect(warning).toContainText("STOP IT BEFORE LOADING ANOTHER TRACK");
  await expect.poll(
    () => page.evaluate(() => window.DubnatorEngine.deckA.name),
  ).toBe(originalName);
  await expect.poll(
    () => page.evaluate(() => window.DubnatorEngine.deckA.playing),
  ).toBe(true);

  await testInfo.attach("deck-load-lock", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});
