import { defineConfig, devices } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { isBrowserTlsBypassAllowed } from "./src/config";

/**
 * Whether the ACTUALLY-REQUIRED Chromium revision (per this installed
 * @playwright/test version's own browsers.json) is really present, checked
 * dynamically rather than via a fixed path — a fixed path is exactly how
 * this got it wrong once already: this sandbox has a stable
 * `/opt/pw-browsers/chromium` symlink left over from image setup that
 * pointed at an old revision (1194) and was NOT updated by a later
 * `playwright install chromium`, which fetches new revisions alongside it
 * (installed as a sibling `chromium-<rev>` directory, e.g. `chromium-1243`)
 * without touching that symlink. Trusting the symlink's mere existence
 * would have kept silently using the stale browser and the HTTPS-errors
 * workaround below even after the correct one was installed.
 *
 * "Present" also has to allow for Chrome for Testing's own layout change
 * between these revisions: older revisions unzip to `chrome-linux/chrome`,
 * newer ones (1243 included) to `chrome-linux64/chrome`.
 */
const require = createRequire(import.meta.url);
const PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
// playwright-core's package.json "exports" map doesn't expose
// "./browsers.json" as an importable subpath (require("playwright-core/browsers.json")
// throws ERR_PACKAGE_PATH_NOT_EXPORTED) — resolve its package root instead
// and read the file directly, which isn't subject to that restriction.
const playwrightCoreDir = path.dirname(require.resolve("playwright-core/package.json"));
const browsersManifest = JSON.parse(readFileSync(path.join(playwrightCoreDir, "browsers.json"), "utf8")) as {
  browsers: Array<{ name: string; revision: string }>;
};
const requiredChromiumRevision = browsersManifest.browsers.find((b) => b.name === "chromium")!.revision;
const requiredRevisionPath = ["chrome-linux/chrome", "chrome-linux64/chrome"]
  .map((rel) => `${PLAYWRIGHT_BROWSERS_PATH}/chromium-${requiredChromiumRevision}/${rel}`)
  .find(existsSync);

// Only used as a last resort when the required revision truly isn't
// installed anywhere Playwright would look — never when it is, however this
// sandbox's browsers directory happens to be laid out otherwise.
const SANDBOX_FALLBACK_CHROMIUM_PATH = "/opt/pw-browsers/chromium";
const usingSandboxFallbackBrowser = !process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE && !requiredRevisionPath && existsSync(SANDBOX_FALLBACK_CHROMIUM_PATH);
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (usingSandboxFallbackBrowser ? SANDBOX_FALLBACK_CHROMIUM_PATH : undefined);

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
    // Only set when the required revision genuinely isn't installed and
    // this sandbox's stale fallback binary is being used instead (see the
    // comment above SANDBOX_FALLBACK_CHROMIUM_PATH) — undefined, and
    // Playwright's own default resolution takes over, the moment the
    // correct revision is actually installed.
    launchOptions: chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : {},
    // false by default, and ONLY ever true via this exact, explicit env var
    // — never inferred from browser path/version/container detection (that
    // was tried and was wrong: it blamed a stale root store for a browser
    // version that turned out not to be the real cause — see README.md).
    // The real, confirmed cause is that Chromium's certificate verifier
    // cannot validate ANY certificate in this specific container, on any
    // browser revision, for any host, proxied or direct — a container
    // defect independently confirmed via Node's own TLS stack, which
    // validates the exact same certificates without complaint. Enabling
    // this requires src/globalSetup.ts's independent strict Node TLS
    // preflight (src/tlsPreflight.ts) to have already passed, or the whole
    // run aborts before any browser launches.
    ignoreHTTPSErrors: isBrowserTlsBypassAllowed(),
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
