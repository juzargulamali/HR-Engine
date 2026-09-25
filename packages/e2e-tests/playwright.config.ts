import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

/**
 * Falls back to this sandbox's pre-installed Chromium binary ONLY if
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE isn't set and the sandbox path exists — a
 * real CI machine with the correct browser revision already installed via
 * `playwright install` never takes this branch.
 *
 * Why this fallback exists at all: this installed @playwright/test version
 * (1.63.0) expects Chromium revision 1243 (Chrome for Testing 153.0.8010.12
 * — see node_modules/playwright-core/browsers.json). This sandbox only has
 * revision 1194 (Chromium 141.0.7390.37) pre-installed, and `playwright
 * install chromium` to fetch 1243 fails here with a 403 from this session's
 * network policy: "no rule or allowlist entry allows host
 * cdn.playwright.dev" (confirmed by directly attempting the install, not
 * inferred). That domain — https://cdn.playwright.dev — is Playwright's
 * official browser-download host; allowlisting it (or its documented
 * mirror, https://playwright.download.prss.microsoft.com) is what would let
 * a future session install the matching build and delete this whole
 * fallback block, including `ignoreHTTPSErrors` below.
 */
const SANDBOX_CHROMIUM_PATH = "/opt/pw-browsers/chromium";
const usingSandboxFallbackBrowser = !process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE && existsSync(SANDBOX_CHROMIUM_PATH);
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (usingSandboxFallbackBrowser ? SANDBOX_CHROMIUM_PATH : undefined);

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
    // Only set when actually launching the sandbox's older, unmatched
    // Chromium binary (see the comment above SANDBOX_CHROMIUM_PATH) — never
    // applied when a real, version-matched browser is in use.
    launchOptions: chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : {},
    // That same old Chromium build's bundled root store predates Google
    // Trust Services' WR1 intermediate, which vercel.app now serves —
    // independently confirmed valid via `openssl s_client` against the
    // system trust store (Verify return code: 0), so this is a stale local
    // root store, not an actual invalid/MITM certificate. Scoped narrowly to
    // the exact condition that causes it (`usingSandboxFallbackBrowser`), so
    // a normal CI run with the correct browser installed keeps real
    // certificate verification and would immediately fail on a genuine bad
    // certificate, unlike this sandbox-only workaround.
    ignoreHTTPSErrors: usingSandboxFallbackBrowser,
  },

  projects: [
    {
      // Standard Playwright authenticated-state pattern (tests/auth.setup.ts):
      // signs in as each configured role ONCE, saves storageState per role.
      // Matched by filename, not testDir/testMatch defaults, so it never
      // collides with the *.spec.ts projects below.
      name: "setup",
      testMatch: /.*\.setup\.ts$/,
    },
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /.*\.mobile\.spec\.ts/,
      dependencies: ["setup"],
    },
    {
      // Mobile smoke coverage only — the full functional matrix runs on
      // desktop; mobile specs are named *.mobile.spec.ts and kept deliberately
      // small (read-only navigation/rendering checks).
      name: "mobile-smoke",
      use: { ...devices["Pixel 5"] },
      testMatch: /.*\.mobile\.spec\.ts/,
      dependencies: ["setup"],
    },
  ],
});
