import { expect, test } from "@playwright/test";

function synchsafe(value) {
  return Buffer.from([(value >>> 21) & 127, (value >>> 14) & 127, (value >>> 7) & 127, value & 127]);
}

function id3Frame(id, payload) {
  const header = Buffer.alloc(10);
  header.write(id, 0, "ascii");
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

function wavFile(name, title, rgb) {
  const sampleRate = 8000;
  const frames = 800;
  const pcm = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i += 1) {
    pcm.writeInt16LE(Math.round(Math.sin(i / 8) * 3000), i * 2);
  }
  // Tiny valid uncompressed BMP works as embedded image and is enough for the
  // browser to render a visible artwork thumbnail.
  const bmp = Buffer.alloc(58);
  bmp.write("BM", 0, "ascii");
  bmp.writeUInt32LE(58, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(1, 18);
  bmp.writeInt32LE(1, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(4, 34);
  bmp[54] = rgb[2]; bmp[55] = rgb[1]; bmp[56] = rgb[0];
  const titleFrame = id3Frame("TIT2", Buffer.concat([Buffer.from([3]), Buffer.from(title)]));
  const artPayload = Buffer.concat([
    Buffer.from([3]), Buffer.from("image/bmp\0", "ascii"), Buffer.from([3, 0]), bmp,
  ]);
  const artFrame = id3Frame("APIC", artPayload);
  const id3Body = Buffer.concat([titleFrame, artFrame]);
  const id3 = Buffer.concat([Buffer.from("ID3\x03\0\0", "binary"), synchsafe(id3Body.length), id3Body]);
  const id3Chunk = Buffer.concat([
    Buffer.from("ID3 ", "ascii"),
    Buffer.from([id3.length & 255, (id3.length >>> 8) & 255, (id3.length >>> 16) & 255, (id3.length >>> 24) & 255]),
    id3,
    id3.length % 2 ? Buffer.from([0]) : Buffer.alloc(0),
  ]);
  const riffSize = 4 + 8 + 16 + 8 + pcm.length + id3Chunk.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(riffSize, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return { name, mimeType: "audio/wav", buffer: Buffer.concat([header, pcm, id3Chunk]) };
}

test("artwork, shared playlists and Rekordbox ordering work together", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-wide", "one end-to-end pass is sufficient");
  await page.goto("/");
  await page.locator("body").click({ position: { x: 20, y: 20 } });
  await page.keyboard.press("Space");
  await expect(page.locator(".playlist-modal")).toBeVisible();

  const first = wavFile("01 First.wav", "First Dub", [255, 80, 35]);
  const second = wavFile("02 Second.wav", "Second Dub", [40, 160, 255]);
  await page.locator('.playlist-modal input[type="file"][accept="audio/*"][multiple]').first()
    .setInputFiles([second, first]);

  await expect(page.locator(".pl-row .c-art.has-artwork img")).toHaveCount(2);
  await expect(page.locator(".pl-deck-tab").nth(0)).toContainText("2");
  await expect(page.locator(".pl-deck-tab").nth(1)).toContainText("2");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <DJ_PLAYLISTS Version="1.0.0">
      <COLLECTION Entries="2">
        <TRACK TrackID="1" Name="First Dub" Artist="Tester" Location="file://localhost/Music/01%20First.wav" />
        <TRACK TrackID="2" Name="Second Dub" Artist="Tester" Location="file://localhost/Music/02%20Second.wav" />
      </COLLECTION>
      <PLAYLISTS><NODE Type="0" Name="ROOT"><NODE Type="1" Name="Dub Order" Entries="2">
        <TRACK Key="1"/><TRACK Key="2"/>
      </NODE></NODE></PLAYLISTS>
    </DJ_PLAYLISTS>`;
  await page.locator('.playlist-modal input[accept*=".xml"]').first().setInputFiles({
    name: "rekordbox.xml",
    mimeType: "application/xml",
    buffer: Buffer.from(xml),
  });
  await expect(page.locator(".pl-rekordbox")).toBeVisible();
  await expect(page.locator(".rb-match-count")).toContainText("2/2");
  await page.getByRole("button", { name: /APPLY TO LOADED/ }).click();
  await expect(page.locator(".pl-row .c-name b").nth(0)).toHaveText("First Dub");
  await expect(page.locator(".pl-row .c-name b").nth(1)).toHaveText("Second Dub");

  await page.getByRole("button", { name: "LIBRARY…" }).click();
  await expect(page.locator(".engine-browser-tree")).toBeVisible();
  await expect(page.locator(".engine-browser-detail")).toBeVisible();
  await page.locator(".engine-browser-playlist").filter({ hasText: "Dub Order" }).click();
  await expect(page.locator(".engine-browser-title")).toContainText("Dub Order");
  await expect(page.locator(".engine-track-row")).toHaveCount(2);
  await expect(page.locator(".engine-track-name").nth(0)).toContainText("First Dub");
  await testInfo.attach("playlist-master-detail", {
    body: await page.locator(".playlist-modal").screenshot(),
    contentType: "image/png",
  });
  await page.getByRole("button", { name: /BACK TO DECK-A/ }).click();

  await page.locator(".pl-link-toggle").click();
  await expect(page.locator(".pl-link-toggle")).toHaveAttribute("aria-pressed", "false");
  const third = wavFile("03 Third.wav", "Third Dub", [80, 220, 120]);
  await page.locator('.playlist-modal input[type="file"][accept="audio/*"][multiple]').first()
    .setInputFiles(third);
  await expect(page.locator(".pl-deck-tab").nth(0)).toContainText("3");
  await expect(page.locator(".pl-deck-tab").nth(1)).toContainText("2");
});

test("restores a local deck playlist after a reload", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-wide", "one persistence pass is sufficient");
  await page.goto("/");
  await page.locator("body").click({ position: { x: 20, y: 20 } });
  await page.keyboard.press("Space");
  await expect(page.locator(".playlist-modal")).toBeVisible();

  const track = wavFile("Persisted Dub.wav", "Persisted Dub", [180, 80, 220]);
  await page.locator('.playlist-modal input[type="file"][accept="audio/*"][multiple]').first()
    .setInputFiles(track);
  await expect(page.locator(".pl-row .c-name b")).toHaveText("Persisted Dub");

  await page.reload();
  await page.locator("body").click({ position: { x: 20, y: 20 } });
  await page.keyboard.press("Space");
  await expect(page.locator(".playlist-modal")).toBeVisible();
  await expect(page.locator(".pl-row .c-name b")).toHaveText("Persisted Dub");
});

test("playlist master-detail browser stacks cleanly on compact screens", async ({ page }, testInfo) => {
  test.skip(!["tablet-portrait", "mobile-portrait"].includes(testInfo.project.name), "compact layout audit only");
  await page.goto("/");
  await page.locator("body").click({ position: { x: 20, y: 20 } });
  await page.keyboard.press("Space");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <DJ_PLAYLISTS Version="1.0.0">
      <COLLECTION Entries="2">
        <TRACK TrackID="1" Name="Compact One" Artist="Tester" Location="file://localhost/Music/compact-one.wav" />
        <TRACK TrackID="2" Name="Compact Two" Artist="Tester" Location="file://localhost/Music/compact-two.wav" />
      </COLLECTION>
      <PLAYLISTS><NODE Type="0" Name="ROOT"><NODE Type="0" Name="USB"><NODE Type="1" Name="Compact Set" Entries="2">
        <TRACK Key="1"/><TRACK Key="2"/>
      </NODE></NODE></NODE></PLAYLISTS>
    </DJ_PLAYLISTS>`;
  await page.locator('.playlist-modal input[accept*=".xml"]').first().setInputFiles({
    name: "compact.xml",
    mimeType: "application/xml",
    buffer: Buffer.from(xml),
  });
  await page.getByRole("button", { name: /BACK TO DECK-A/ }).click();
  await page.getByRole("button", { name: "LIBRARY…" }).click();
  await page.locator(".engine-browser-playlist").filter({ hasText: "Compact Set" }).click();

  const tree = await page.locator(".engine-browser-tree").boundingBox();
  const detail = await page.locator(".engine-browser-detail").boundingBox();
  const viewport = page.viewportSize();
  expect(tree).not.toBeNull();
  expect(detail).not.toBeNull();
  if (viewport.width <= 760) expect(detail.y).toBeGreaterThan(tree.y);
  else expect(detail.x).toBeGreaterThan(tree.x);
  expect(Math.max(tree.x + tree.width, detail.x + detail.width)).toBeLessThanOrEqual(viewport.width + 1);
  await expect(page.locator(".engine-track-row")).toHaveCount(2);
});
