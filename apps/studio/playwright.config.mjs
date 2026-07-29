import { defineConfig } from "@playwright/test";

const baseURL = process.env.DUBNATOR_E2E_URL || "http://127.0.0.1:1420";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results/playwright",
  // Each page builds a complete Web Audio graph. Run projects serially so the
  // browser does not throttle one of several simultaneous AudioContexts.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ["line"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  use: {
    baseURL,
    headless: true,
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "node build.mjs --serve",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    {
      name: "desktop",
      use: { viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "tablet",
      use: {
        viewport: { width: 1024, height: 1366 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
});
