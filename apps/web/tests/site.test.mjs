import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(join(ROOT, ".next/server/app/index.html"), "utf8");

test("static page renders its primary sections and metadata", () => {
  for (const id of ["top", "features", "for-the-dance", "live-demo", "download", "faq"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /<title>Dubnator/);
  assert.match(html, /rel="canonical" href="https:\/\/dubnator\.denshi\.io"/);
});

test("every in-page navigation link resolves to an existing section", () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const targets = new Set([...html.matchAll(/\bhref="#([^"]+)"/g)].map((match) => match[1]));
  const missing = [...targets].filter((target) => !ids.has(target));
  assert.deepEqual(missing, []);
});

test("rendered page does not depend on a font CDN", () => {
  assert.doesNotMatch(html, /fonts\.(?:googleapis|gstatic)\.com/);
});
