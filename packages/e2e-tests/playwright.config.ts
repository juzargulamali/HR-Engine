import { defineConfig, devices } from "@playwright/test";

/**
 * Runs against Production only — there is no local/staging target for this
 * suite. `use.baseURL` and every credential come from environment secrets
 * (src/config.ts), never from a default here. Designed to run on a normal
 * GitHub Actions runner (real, unmodified TLS/certificate verification;
 * direct network egress) — see .github/workflows/e2e-production-qa-*.yml.
 *
 * `workers: 1` / `fullyParallel: false` is deliberate, not a performance
 * default: this suite shares one live Production database with real users.
 * Serial execution avoids two specs racing on the same approvals inbox,
 * attendance day, or leave balance and misattributing a collision to a bug.
 *
 * Projects are invoked individually and in order by the CI workflows
 * (`--project=<name>`), never all at once, so that "read-only must pass
 * before mutating starts" and "reconciliation always runs, even after a
 * mutating failure" can be enforced as separate CI job steps rather than
 * relied on as an implicit property of one `playwright test` invocation.
 * Running this file locally with no `--project` filter still executes every
 * project in the order listed below, which is safe (skips still apply) but
 * is not how CI drives it.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
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
  },

  projects: [
    {
      // Standard Playwright authenticated-state pattern (tests/auth.setup.ts):
      // signs in as each configured role ONCE, saves storageState per role.
      name: "setup",
      testMatch: /.*\.setup\.ts$/,
    },
    {
      // Captures the pre-run baseline (account status, leave balance,
      // reimbursement claim state) for the dedicated test accounts, via the
      // app's own UI — no service role, no direct DB read. See
      // tests/baseline/capture.baseline.ts and src/baseline.ts.
      name: "baseline",
      testMatch: /.*\.baseline\.ts$/,
      dependencies: ["setup"],
    },
    {
      name: "read-only",
      testDir: "./tests/read-only",
      testIgnore: /.*\.mobile\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
    {
      // Mobile smoke coverage only — the full functional matrix runs on
      // desktop; mobile specs are named *.mobile.spec.ts and kept
      // deliberately small (read-only navigation/rendering checks).
      name: "mobile-smoke",
      testDir: "./tests/read-only",
      testMatch: /.*\.mobile\.spec\.ts/,
      use: { ...devices["Pixel 5"] },
      dependencies: ["setup"],
    },
    {
      // Every file here mutates a real Production record on a dedicated
      // test account. Numeric filename prefixes (10-, 20-, ...) fix the
      // execution order within this project (workers:1 + fullyParallel:
      // false + alphabetical file discovery), matching the required
      // "small ordered batches": leave, then attendance, then
      // reimbursements, then a document upload, then account
      // deactivation/reactivation LAST (deactivating the Employee test
      // account could otherwise disrupt any later mutating test that
      // depends on that account's session), then an audit-log check that
      // everything above actually left a trace.
      name: "mutating",
      testDir: "./tests/mutating",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
    {
      // Compares the final state (same UI-driven reads as baseline) against
      // the captured baseline and writes a reconciliation report. Always
      // run by CI, even if the mutating project failed partway, so the
      // actual final state is always known and reported. See
      // tests/reconcile/verify.reconcile.ts and src/baseline.ts.
      name: "reconciliation",
      testMatch: /.*\.reconcile\.ts$/,
      dependencies: ["setup"],
    },
  ],
});
