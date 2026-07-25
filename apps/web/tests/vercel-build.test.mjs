import assert from "node:assert/strict";
import test from "node:test";

import { deploymentTarget } from "../../../vercel-build.mjs";

test("root Vercel dispatcher distinguishes both production domains", () => {
  assert.equal(
    deploymentTarget({ VERCEL_PROJECT_PRODUCTION_URL: "dubnator.denshi.io" }),
    "web",
  );
  assert.equal(
    deploymentTarget({ VERCEL_PROJECT_PRODUCTION_URL: "play.dubnator.denshi.io" }),
    "studio",
  );
});

test("root Vercel dispatcher supports generated project domains and explicit overrides", () => {
  assert.equal(
    deploymentTarget({ VERCEL_PROJECT_PRODUCTION_URL: "dubnator-web.vercel.app" }),
    "web",
  );
  assert.equal(
    deploymentTarget({ VERCEL_PROJECT_PRODUCTION_URL: "dubnator-studio.vercel.app" }),
    "studio",
  );
  assert.equal(deploymentTarget({ DUBNATOR_DEPLOY_TARGET: "studio" }), "studio");
});

test("root Vercel dispatcher fails closed for unknown projects", () => {
  assert.throws(
    () => deploymentTarget({ VERCEL_PROJECT_PRODUCTION_URL: "example.vercel.app" }),
    /Cannot identify the Vercel project/,
  );
});
