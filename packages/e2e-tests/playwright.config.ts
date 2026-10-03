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
  // No global default retry: mutating tests must never retry (see the
  // "mutating" project below) — a timed-out submission or approval retried
  // blindly could double-submit against a real Production record. Every
  // other project opts back into a retry explicitly, for resilience against
  // a one-off network hiccup on a read-only navigation.
  retries: 0,
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
      // Read-only (a login), so a transient-network retry is safe here.
      name: "setup",
      testMatch: /.*\.setup\.ts$/,
      retries: 1,
    },
    {
      // Captures the pre-run baseline (account status, leave balance,
      // reimbursement claim state) for the dedicated test accounts, via the
      // app's own UI — no service role, no direct DB read. See
      // tests/baseline/capture.baseline.ts and src/baseline.ts. Read-only.
      name: "baseline",
      testMatch: /.*\.baseline\.ts$/,
      dependencies: ["setup"],
      retries: 1,
    },
    {
      name: "read-only",
      testDir: "./tests/read-only",
      testIgnore: /.*\.mobile\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      retries: 1,
    },
    {
      // Mobile smoke coverage only — the full functional matrix runs on
      // desktop; mobile specs are named *.mobile.spec.ts and kept
      // deliberately small (read-only navigation/rendering checks).
      //
      // Excludes attendance-clock.mobile.spec.ts: that spec checks a
      // feature (self-clock attendance) that isn't deployed to Production
      // yet. This project is invoked (via the "read-only" npm script) by
      // e2e-production-qa-readonly.yml's `pull_request` trigger on every
      // PR touching this package, against Production — so anything matched
      // here must already exist there. The excluded spec instead has its
      // own "preview-attendance-mobile-smoke" project below, run only by
      // e2e-preview-attendance-clock.yml against a Preview deployment.
      name: "mobile-smoke",
      testDir: "./tests/read-only",
      testMatch: /.*\.mobile\.spec\.ts/,
      testIgnore: /attendance-clock\.mobile\.spec\.ts/,
      use: { ...devices["Pixel 5"] },
      dependencies: ["setup"],
      retries: 1,
    },
    {
      // Same rendering checks as "mobile-smoke" above, but scoped to just
      // attendance-clock.mobile.spec.ts and never invoked by the
      // Production-only npm scripts/workflows — only by name
      // (--project=preview-attendance-mobile-smoke) from
      // e2e-preview-attendance-clock.yml, which points E2E_BASE_URL at a
      // Vercel Preview instead of Production.
      name: "preview-attendance-mobile-smoke",
      testDir: "./tests/read-only",
      testMatch: /attendance-clock\.mobile\.spec\.ts/,
      use: { ...devices["Pixel 5"] },
      dependencies: ["setup"],
      retries: 1,
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
      //
      // ZERO retries, explicitly (not just inherited from the global
      // default above) — a Playwright retry re-runs the whole test from
      // scratch, including every action already taken. A leave/reimbursement
      // submission or approval that times out mid-request must never be
      // blindly repeated: that risks a second real submission/approval
      // against Production instead of a clean pass/fail signal.
      //
      // Excludes 25-attendance-clock.spec.ts (see the "preview-attendance-
      // mutating" project below): that spec exercises self-clock attendance,
      // which isn't deployed to Production yet, so a manual dispatch of
      // e2e-production-qa-mutating.yml (`--project=mutating`, no specific
      // file) must never pick it up.
      name: "mutating",
      testDir: "./tests/mutating",
      testIgnore: /25-attendance-clock\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      retries: 0,
    },
    {
      // Same safety rationale as "mutating" above (zero retries), scoped to
      // just 25-attendance-clock.spec.ts and never invoked by the
      // Production-only npm scripts/workflows — only by name
      // (--project=preview-attendance-mutating) from
      // e2e-preview-attendance-clock.yml, which points E2E_BASE_URL at a
      // Vercel Preview instead of Production.
      name: "preview-attendance-mutating",
      testDir: "./tests/mutating",
      testMatch: /25-attendance-clock\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      retries: 0,
    },
    {
      // Recovery Leave windows redesign — dedicated projects for the NEW attendance screens
      // (tests/recovery-windows/). They live in their own directory on purpose: the Production
      // `read-only` project (run on every PR touching this package) only covers
      // tests/read-only, and `mutating` only tests/mutating, so none of these can ever be swept
      // into a Production run. They are invoked only by name from
      // e2e-preview-recovery-windows.yml, against a Preview deployment.
      name: "preview-recovery-windows-read-only",
      testDir: "./tests/recovery-windows",
      testMatch: /10-.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      retries: 1,
    },
    {
      name: "preview-recovery-windows-mobile",
      testDir: "./tests/recovery-windows",
      testMatch: /11-.*\.mobile\.spec\.ts/,
      use: { ...devices["Pixel 5"] },
      dependencies: ["setup"],
      retries: 1,
    },
    {
      // Zero retries, like every mutating project: a timed-out HR save must never be blindly
      // repeated against a real database.
      name: "preview-recovery-windows-mutating",
      testDir: "./tests/recovery-windows",
      testMatch: /20-.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      retries: 0,
    },
    {
      // Compares the final state (same UI-driven reads as baseline) against
      // the captured baseline and writes a reconciliation report. Always
      // run by CI, even if the mutating project failed partway, so the
      // actual final state is always known and reported. See
      // tests/reconcile/verify.reconcile.ts and src/baseline.ts. Read-only.
      name: "reconciliation",
      testMatch: /.*\.reconcile\.ts$/,
      dependencies: ["setup"],
      retries: 1,
    },
  ],
});
