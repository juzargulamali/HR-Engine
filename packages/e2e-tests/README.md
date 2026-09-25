# @enginious-hr/e2e-tests

Unattended Playwright end-to-end suite that runs directly against the live
**Production** deployment, using dedicated test accounts only. There is no
staging/local target for this suite.

## Status as of the first live run

Read-only tests were run twice against Production from this sandboxed
session (`npm run test:e2e:read-only`, see "Read-only vs mutating" below).
**16 of 30 passed cleanly; 14 failed — every single failure was a
login/navigation-level timeout (`net::ERR_TOO_MANY_RETRIES`, "Test timeout
... while setting up hrAdminPage", or the login form/redirect never
completing), never a wrong-content or wrong-permission assertion.** Failures
were heavily concentrated on the HR Admin/CEO fixtures specifically; no test
that completed a login and reached its actual assertions produced an
incorrect result. This is consistent with this sandbox's outbound proxy path
to Production degrading under a long sustained run (both runs combined ran
~50 minutes), not with an application defect — see
`src/gotoWithRetry.ts` for the underlying evidence and mitigation attempted
(retry-on-navigation, `retries: 1`), which reduced but did not eliminate the
failures. **Recommendation: re-run this suite from a normal CI runner with
direct network egress (not this constrained sandbox) for a trustworthy full
pass**, or re-run here in smaller batches (5-8 tests per invocation) if a
CI runner isn't available yet. Zero mutating actions occurred in these
runs (only `@mutating`-tagged specs, all excluded, ever write anything).

**Correction after independent review:** the analysis above understated the
real cause. The `<role>Page` fixtures in `src/fixtures.ts` were declared
with test scope (Playwright's default) while only their `BrowserContext`
was worker-scoped, so — despite a comment claiming otherwise — every one of
those 30 tests re-ran a full UI login. A 30-test run could issue up to 30
real Supabase sign-ins per role used, not one. That repeated authentication
load is a more credible primary cause of the login timeouts than sandbox
network flakiness alone. **Fixed**: authentication now happens through a
dedicated Playwright `setup` project (`tests/auth.setup.ts`), which signs
into each configured role exactly once and saves its `storageState` to a
gitignored `.auth/` directory; `desktop-chromium` and `mobile-smoke` declare
`dependencies: ["setup"]`, and every `<role>Page` fixture now just loads a
fresh `BrowserContext` from that saved state — no per-test UI login. A
complete read-only run now makes **7 real sign-in requests total**: one per
configured role during setup (6: employee, manager, hrAdmin, ceo, finance,
sysAdmin), plus the one intentional wrong-password attempt in
`auth.spec.ts`. This fix has been verified in isolation (one role's setup,
then one smoke test consuming its saved state with zero further sign-ins).

**Latest full read-only run** (after the auth-setup fix above, the browser
version fix, and the TLS bypass described below — see that section, this run
had `E2E_ALLOW_BROWSER_TLS_BYPASS=true`): all 6 auth-setup sign-ins passed
cleanly on the first attempt (13.5s–32.3s each). A separate isolated
per-role check (one small read-only navigation per role, comparing against
the RBAC rules verified from source: employee/manager denied on
`/audit-log`, hrAdmin allowed, ceo allowed on `/alerts`, finance allowed on
`/assets`, sysAdmin allowed on `/ai-suggestions`) matched the expected
result for **all 6 roles, no mismatches**. The full 30-test functional suite
then ran once: **19 of 30 passed** (15 clean + 4 that passed on the
configured retry); **11 failed, every one with the identical, generic "Test
timeout of 60000ms exceeded"** — never a wrong-content or wrong-permission
assertion. This matches the original diagnosis at the top of this section
almost exactly: this sandbox's outbound path to Production still degrades
under a long (here, ~38 minute), sustained, serial Playwright run. Both
causes this session found (the broken auth fixtures, and the browser
TLS-verifier defect) are now fixed; this remaining timeout pattern is a
distinct, third, still-open issue — the same recommendation applies: a
normal CI runner with direct, unproxied network egress should not show it.

## Browser version — resolved

`@playwright/test` 1.63.0 expects Chromium revision 1243 (Chrome for Testing
153.0.8010.12). This sandbox originally only had revision 1194 pre-installed,
and `npx playwright install chromium` initially failed with a 403 (`cdn.playwright.dev`
not allowlisted). Once that domain was allowlisted, `npx playwright install
chromium` succeeded and downloaded revision 1243 correctly.

`playwright.config.ts` detects the actually-required revision dynamically
(via `playwright-core`'s own `browsers.json`) rather than trusting a fixed
path — this sandbox has a stable `/opt/pw-browsers/chromium` symlink left
over from image setup that still points at the old revision 1194 and was
**not** updated by the later install (Playwright installs new revisions as
sibling `chromium-<rev>` directories without touching that symlink). Trusting
the symlink's mere existence would have silently kept using the stale
browser. The fallback to that symlink now only fires if the required
revision genuinely isn't installed anywhere — never when it is.

## Browser TLS validation bypass — this is not a browser-version problem

**Browser TLS validation was bypassed due to a Claude-container Chromium
verifier defect. Independent Node TLS validation passed. This run does not
test browser-side certificate enforcement.**

After fixing the browser-version mismatch above, Chromium (revision 1243,
the correct one) still failed every navigation with
`net::ERR_CERT_AUTHORITY_INVALID`. Before assuming a browser/root-store
problem again, this was checked independently:

- Node's own TLS stack (a raw `tls.connect` through the same proxy tunnel,
  nothing Chromium-related) validates the exact same certificate
  (`hr-engine-web.vercel.app`, issued by Google Trust Services WR1) without
  complaint.
- With the correct, current Chromium build, navigating to a **completely
  unrelated, definitely-valid, non-proxied** domain (`api.anthropic.com`)
  **also** fails with the identical error.
- The old browser (1194) fails the same way against that same unrelated
  domain.

Conclusion: this is not about browser version, root-store staleness, or the
proxy/target certificate at all — Chromium's certificate verifier cannot
validate *any* HTTPS certificate in this specific container, on either
browser revision. This is a container defect, not a real certificate
problem, but it's still a real reduction in what the suite verifies, so:

- **`ignoreHTTPSErrors` is `false` by default**, and **only ever `true`**
  when `E2E_ALLOW_BROWSER_TLS_BYPASS=true` is explicitly set — never
  inferred from browser path, version, or container detection (that was
  tried once already and reached the wrong conclusion).
- When that variable is set, `src/globalSetup.ts` runs an **independent
  strict TLS preflight** (`src/tlsPreflight.ts`) — a raw Node TLS
  connection with `rejectUnauthorized: true`, never relaxed — against
  `E2E_BASE_URL`'s hostname and, if available as a plain (non-secret) env
  var, the Supabase project hostname (`SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL`).
  **The whole run aborts if either check fails.** This is what still catches
  a genuine certificate problem despite the browser-side bypass.
- The preflight logs only hostname, authorized true/false, protocol, and
  issuer/expiry if available — never headers, cookies, tokens, or other
  environment values.
- `src/hostGuard.ts`'s `assertOnAllowedHost()` additionally fails any setup
  test whose sign-in lands on an unexpected external origin (excluding
  Chromium's own internal error-interstitial pseudo-host, which is a failed
  navigation, not a redirect).
- None of this touches application code, other security settings, or any
  assertion the suite makes about the app's own behavior — only Chromium's
  own certificate-verifier bypass in this one confirmed-broken container.

## Safety model — read this before running anything

This suite is built to run against a real production database with real
users in it. Every gate below exists in code (`src/config.ts`,
`src/globalSetup.ts`), not just as a rule someone has to remember:

- **`E2E_BASE_URL` must be set explicitly.** The suite never guesses or
  defaults to a domain.
- **Required role credentials must be set** (Employee, Manager, HR Admin,
  CEO). The suite refuses to start at all if any are missing. Finance is
  optional — specs needing it skip cleanly if `E2E_FINANCE_EMAIL`/`_PASSWORD`
  are unset.
- **`E2E_BACKUP_CONFIRMED` gates every mutating spec.** Unless it is exactly
  `"true"`, every spec that creates/modifies a real record (leave requests,
  attendance, reimbursement claims, recovery credit) skips itself. Read-only
  specs (auth, RBAC, smoke, isolation, audit-log viewing, policies viewing)
  run regardless.
- **Never activates a policy.** `PoliciesPage.ts` has no method that clicks
  "Activate" — enforced by code review of that file, not a runtime guard —
  per the standing instruction not to modify/activate policy records.
- **Never touches a non-test account or an unmarked record.** Every record
  a mutating spec creates is tagged with the current run's ID (see
  "Run IDs and cleanup" below).
- **Credentials are never logged, printed, or written to a report/trace
  file.** They live only in environment secrets and are read once per
  process via `process.env`.

If you can't satisfy one of the required gates above, the suite will tell
you exactly what's missing rather than fail confusingly mid-run.

## Setting credentials — do NOT use plain environment variables in the web UI

This environment's plain "Environment Variables" field is visible to
everyone with access to it, so account passwords and the Supabase
service-role key do not belong there. Use this environment's separate,
encrypted **Secrets** mechanism instead (distinct from environment
variables in the same settings area) — secrets are masked in the UI and
still arrive in the running session as ordinary `process.env` values,
which is exactly what `src/config.ts` reads. See
`.env.example` for the exact variable names to set as secrets.

## Read-only vs mutating

Every describe block that creates/modifies a real record has `@mutating` in
its title (`leave.spec.ts`, `attendance.spec.ts`, and the "document upload"
block in `assets-documents.spec.ts` — nowhere else). This is enforced two
ways, not just one:

1. **Structurally**, via Playwright's grep tag: `npm run test:e2e:read-only`
   runs `playwright test --grep-invert @mutating`, which never even loads a
   mutating test's steps.
2. **At runtime**, each `@mutating` describe also calls
   `test.skip(!isBackupConfirmed(), ...)`, so even a plain `npm run test:e2e`
   (no grep filter) skips them cleanly without `E2E_BACKUP_CONFIRMED=true`.

## Running

```bash
npm install --workspace @enginious-hr/e2e-tests

# Read-only specs only — the one that's safe to run any time:
npm run test:e2e:read-only

# Full suite (mutating specs only actually run if E2E_BACKUP_CONFIRMED=true):
npm run test:e2e

# Smoke only:
npm run test:e2e:smoke

# Mobile smoke project:
npx playwright test --project=mobile-smoke
```

`playwright.config.ts` runs everything serially (`workers: 1`,
`fullyParallel: false`) on purpose: this suite shares one live production
database with real users, and serial execution avoids two specs racing on
the same approvals inbox or attendance day. `retries: 1` tolerates this
sandbox's observed transient proxy failures (see "Status as of the first
live run" above and `src/gotoWithRetry.ts`) without masking a real app
defect — a retry gets a fresh worker/context, so a genuine wrong-content
assertion still fails identically both times.

## Run IDs and cleanup

Every run gets a run ID of the form `E2E-YYYYMMDD-HHMM` (UTC), generated
once in `src/globalSetup.ts` (or overridden via `E2E_RUN_ID`). Every record
a mutating spec creates is tagged with it:

- Tables with a free-text field (`leave_requests.reason`,
  `reimbursement_claim_lines.description`): the field is prefixed
  `[E2E-...]` via `src/recordTag.ts`'s `tag()`/`tagNote()`.
- Tables with no free-text field (`attendance_records`,
  `recovery_credit_requests`): identified instead by a synthetic date in the
  year 2099+, deterministically derived from the run ID
  (`src/recordTag.ts`'s `testDate()`), so no real attendance day is ever
  touched.

**`npm run cleanup:dry-run -- E2E-YYYYMMDD-HHMM`** lists exactly what a run
created, grouped by test user — it is read-only and never deletes or
mutates anything (`scripts/dry-run-cleanup.ts`). It requires
`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` plus the test accounts' emails,
and refuses to run if no test email resolves to a real employee — there is
no fallback to a bare date range or a "looks like a test" heuristic.

There is deliberately no actual delete/cleanup command in this package yet
— per the standing instruction not to run cleanup and not to build a
general-purpose cleanup RPC/button. Building that (as a second, narrowly
scoped, explicitly-invoked script — never a product feature) is a separate,
later, explicitly authorized step once the dry-run output has been
reviewed.

## Selector confidence

- **Fully verified against source this session**: `LoginPage`,
  `Nav`/RBAC route table (every `apps/web/src/app/(app)/*/page.tsx` was
  read directly), `AttendancePage` (against
  `attendance/bulk-attendance-form.tsx`), `LeavePage`'s request form
  (against `leave/new/leave-request-form.tsx`), `ApprovalsPage` (against
  `approvals/decision-buttons.tsx` — note the native `window.confirm()` on
  Approve), `PoliciesPage` (built earlier this project).
- **Best-effort, pending the first live run**: `EmployeesPage`,
  `HolidaysPage`, `ReimbursementsPage`, `AuditLogPage`, `PayrollPage`,
  `DashboardPage` (all in `src/pages/AppPages.ts`) — routes are confirmed
  real, but exact button/label text is a reasonable guess, kept generic
  (text/role-based rather than DOM-structure-based) so a first run mostly
  needs small text tweaks, not a rewrite. Several specs (attendance's
  Recovery Leave trigger, the reimbursement file-upload field, whether
  Annual Leave has a second HR approval stage beyond the manager) contain
  an explicit `test.skip(...)` fallback with a message naming exactly what
  to confirm, rather than asserting against a guessed selector.

## What this suite has NOT verified (be aware before trusting a green run)

- Whether Annual Leave approval is a single manager step or manager + a
  separate HR stage.
- The exact trigger for Recovery Leave creation from an attendance record
  (a dedicated control vs. an automatic side effect of specific
  status/hours values).
- The reimbursement "new claim" form's exact upload field and other inputs.
- Exact per-country leave balance numbers (UAE per-service-year accrual,
  Saudi's 5-year threshold, Poland's flat 26 days) — those are covered by
  `packages/domain`'s own unit tests; this suite's balance check only
  confirms a number decreases after an approved request, not the specific
  arithmetic.
