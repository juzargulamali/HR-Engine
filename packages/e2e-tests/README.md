# @enginious-hr/e2e-tests

Unattended Playwright end-to-end suite that runs directly against the live
**Production** deployment, using dedicated test accounts only. There is no
staging/local target for this suite.

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

## Running

```bash
npm install --workspace @enginious-hr/e2e-tests

# Read-only specs only (safe without backup confirmation):
npx playwright test --project=desktop-chromium \
  tests/auth.spec.ts tests/smoke.spec.ts tests/rbac.spec.ts \
  tests/isolation.spec.ts tests/audit-log.spec.ts tests/payroll.spec.ts \
  tests/policies.spec.ts tests/holidays.spec.ts tests/assets-documents.spec.ts

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
the same approvals inbox or attendance day.

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
