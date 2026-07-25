// Compatibility entry point for Vercel projects whose Root Directory is the
// repository root. The canonical Studio build still lives in apps/studio.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const studioBuild = join(ROOT, "apps", "studio", "build.mjs");
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

process.exitCode = result.status ?? 1;
