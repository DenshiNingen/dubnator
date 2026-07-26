import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const [html, css, app, bootstrap] = await Promise.all([
  readFile(new URL("Dubnator.html", root), "utf8"),
  readFile(new URL("styles.css", root), "utf8"),
  readFile(new URL("app.jsx", root), "utf8"),
  readFile(new URL("bootstrap.js", root), "utf8"),
]);

test("uses the real device viewport without disabling pinch zoom", () => {
  assert.match(
    html,
    /name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/,
  );
  assert.doesNotMatch(html, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i);
});

test("defines distinct tablet, phone, and coarse-pointer layouts", () => {
  assert.match(css, /@media \(max-width: 1280px\)/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /@media \(pointer: coarse\)/);
  assert.match(
    css,
    /\.grid-top,\s*\.grid-mid,\s*\.grid-bottom,\s*\.right-rail,\s*\.transport-row\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/,
  );
});

test("labels every main rack region for stable responsive placement", () => {
  for (const className of [
    "rack-music",
    "rack-mic",
    "rack-setup",
    "rack-geq",
    "rack-parametric",
    "rack-siren",
    "rack-reverb",
    "rack-echo",
    "rack-sample-fx",
    "rack-master",
    "rack-kill",
    "rack-sample-triggers",
    "rack-limiters",
    "rack-recorder",
  ]) {
    assert.match(app, new RegExp(`className=[^\\n]*${className}`), className);
  }
});

test("wide performance surfaces scroll inside their panels on phones", () => {
  assert.match(css, /\.rack-music \.strip-row\s*\{[\s\S]*?overflow-x: auto/);
  assert.match(css, /\.rack-geq \.panel-body\s*\{[\s\S]*?overflow-x: auto/);
  assert.match(css, /\.lp-help-boards,[\s\S]*?scroll-snap-type: x mandatory/);
});

test("legacy viewport scaling cannot shrink the responsive rack", () => {
  assert.match(bootstrap, /chassis\.style\.transform = "none"/);
  assert.doesNotMatch(bootstrap, /Math\.min\(window\.innerWidth/);
});
