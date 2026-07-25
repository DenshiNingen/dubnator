// Compatibility entry point for Vercel projects whose Root Directory is the
// repository root. The canonical Studio build still lives in apps/studio.

import { spawnSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const studioBuild = join(ROOT, "apps", "studio", "build.mjs");
const studioDist = join(ROOT, "apps", "studio", "dist");
const rootDist = join(ROOT, "dist");
const result = spawnSync(process.execPath, [studioBuild, ...process.argv.slice(2)], {
  cwd: ROOT,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

if (result.signal) {
  throw new Error(`Studio build terminated by signal ${result.signal}`);
}

if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
} else if (!process.argv.includes("--serve")) {
  // Legacy Vercel projects may still run Studio from the repository root with
  // an Output Directory of `dist`. Mirror the canonical app output there
  // without imposing a root vercel.json on the separate Next.js web project.
  rmSync(rootDist, { recursive: true, force: true });
  cpSync(studioDist, rootDist, { recursive: true });
  console.log(`Mirrored Studio build to ${rootDist}/`);
}
