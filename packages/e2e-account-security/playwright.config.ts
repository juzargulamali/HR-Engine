import { defineConfig, devices } from "@playwright/test";

/**
 * baseURL defaults to a local dev server (`npm run dev -w @enginious-hr/web`).
 * Never points at Production by default — a real Production URL must be
 * passed explicitly via E2E_BASE_URL, and even then tests/mutating/ must not
 * be run against it (see README.md).
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
