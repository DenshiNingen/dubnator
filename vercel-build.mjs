// Root-level Vercel dispatcher for the two projects connected to this
// monorepo. Both currently build from the repository root, so select the app
// using Vercel's project-specific production URL and emit a common dist/.

import { cpSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const ROOT_DIST = join(ROOT, "dist");
const WEB_DIST = join(ROOT, "apps", "web", "out");

const PROJECT_IDS = {
  studio: "prj_ZIbEaOMIdbMzurwRSD0XuPo3DLOX",
  web: "prj_XEDJIBXD778W8kCmMxpANut51nN8",
};

function productionHost(value = "") {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0];
}

export function deploymentTarget(env = process.env) {
  const explicit = env.DUBNATOR_DEPLOY_TARGET?.trim().toLowerCase();
  if (explicit === "studio" || explicit === "web") return explicit;
  if (explicit) {
    throw new Error(`Unknown DUBNATOR_DEPLOY_TARGET: ${explicit}`);
  }

  const projectId = env.VERCEL_PROJECT_ID ?? "";
  if (projectId === PROJECT_IDS.studio) return "studio";
  if (projectId === PROJECT_IDS.web) return "web";

  const host = productionHost(env.VERCEL_PROJECT_PRODUCTION_URL);
  if (host === "play.dubnator.denshi.io" || host.includes("dubnator-studio")) {
    return "studio";
  }
  if (host === "dubnator.denshi.io" || host.includes("dubnator-web")) {
    return "web";
  }

  throw new Error(
    "Cannot identify the Vercel project. Set DUBNATOR_DEPLOY_TARGET to 'web' or 'studio'.",
  );
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${command} terminated by signal ${result.signal}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

export function buildDeployment(env = process.env) {
  const target = deploymentTarget(env);
  console.log(`Building Dubnator ${target} for Vercel...`);

  if (target === "studio") {
    run(process.execPath, [join(ROOT, "build.mjs")], env);
  } else {
    const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    run(pnpm, ["--filter", "@dubnator/web", "build"], {
      ...env,
      DUBNATOR_STATIC_EXPORT: "1",
    });
    rmSync(ROOT_DIST, { recursive: true, force: true });
    cpSync(WEB_DIST, ROOT_DIST, { recursive: true });
    console.log(`Mirrored Web build to ${ROOT_DIST}/`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildDeployment();
}
