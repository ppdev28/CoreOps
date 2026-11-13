import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/dashboard",
  outputDir: "./test-results/dashboard",
  fullyParallel: true,
  workers: 2,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:5176",
    viewport: { width: 1440, height: 1320 },
    launchOptions: process.env.COREOPS_CHROMIUM_PATH
      ? {
          executablePath: process.env.COREOPS_CHROMIUM_PATH,
          args: ["--no-sandbox"],
        }
      : {},
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev --host 127.0.0.1 --port 5176 --strictPort",
    url: "http://127.0.0.1:5176",
    reuseExistingServer: !process.env.CI,
  },
});
