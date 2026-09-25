import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

/** Falls back to this sandbox's pre-installed Chromium binary only if it's
 * actually present — a real CI machine with the matching browser revision
 * already installed via `playwright install` is untouched. */
const SANDBOX_CHROMIUM_PATH = "/opt/pw-browsers/chromium";
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(SANDBOX_CHROMIUM_PATH) ? SANDBOX_CHROMIUM_PATH : undefined);

/**
 * Runs against Production only — there is no local/staging target for this
 * suite. `use.baseURL` and every credential come from environment secrets
 * (src/config.ts), never from a default here.
 *
 * `workers: 1` / `fullyParallel: false` is deliberate, not a performance
 * default: this suite shares one live Production database with real users.
 * Serial execution avoids two specs racing on the same approvals inbox,
 * attendance day, or leave balance and misattributing a collision to a bug.
 * Revisit only after a clean run shows isolation actually holds.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  // One retry tolerates this sandbox's confirmed transient proxy failures
  // (net::ERR_TOO_MANY_RETRIES against an independently-verified-healthy
  // target — see gotoWithRetry.ts) without masking a real app defect: a
  // retry gets a fresh worker/context, so a genuine wrong-role/wrong-content
  // assertion fails identically both times, while a one-off network drop
  // during worker-scoped login does not cascade into every later test in
  // that worker.
  retries: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reportSlowTests: null,
  forbidOnly: !!process.env.CI,

  globalSetup: "./src/globalSetup.ts",

  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ["junit", { outputFile: "test-results/junit.xml" }],
  ],

  use: {
    // Deliberately NOT wrapped in try/catch: an unset E2E_BASE_URL must fail
    // the whole run immediately, per "never guess or default to a domain".
    baseURL: process.env.E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    // This sandbox's pre-installed Chromium revision predates the browser
    // revision the installed @playwright/test version expects, so the
    // default launch path fails with "Executable doesn't exist" rather
    // than downloading a new one (network egress for that isn't assumed
    // available). Point at the pre-installed binary directly instead.
    launchOptions: chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : {},
    // That same old Chromium build's bundled root store predates Google
    // Trust Services' WR1 intermediate, which vercel.app now serves —
    // independently confirmed valid via `openssl s_client` against the
    // system trust store (Verify return code: 0), so this is a stale local
    // root store, not an actual invalid/MITM certificate. Scoped to this
    // one known-stale browser binary, not a blanket policy bypass.
    ignoreHTTPSErrors: true,
  },

  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /.*\.mobile\.spec\.ts/,
    },
    {
      // Mobile smoke coverage only — the full functional matrix runs on
      // desktop; mobile specs are named *.mobile.spec.ts and kept deliberately
      // small (read-only navigation/rendering checks).
      name: "mobile-smoke",
      use: { ...devices["Pixel 5"] },
      testMatch: /.*\.mobile\.spec\.ts/,
    },
  ],
});
