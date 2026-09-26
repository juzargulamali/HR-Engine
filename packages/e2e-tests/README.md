# @enginious-hr/e2e-tests

Playwright end-to-end suite that runs directly against the live
**Production** deployment, using dedicated, fixed test accounts only. There
is no staging/local target for this suite. Designed to run on a normal
GitHub Actions runner (real, unmodified TLS/certificate verification, direct
network egress) — see `.github/workflows/e2e-production-qa-readonly.yml`
and `.github/workflows/e2e-production-qa-mutating.yml`.

## Safety model — read this before running anything

- **No Supabase service-role key, and no direct database client, anywhere
  in this package.** `package.json` has no `@supabase/supabase-js`
  dependency at all — this isn't just a rule, it's structurally true.
  Every mutation this suite makes goes through the real browser UI, using a
  dedicated test account's own permissions. Baseline capture and the final
  reconciliation report (`src/baseline.ts`) are also done through
  authenticated UI reads, never a raw database read.
- **`E2E_BASE_URL` must be set explicitly.** The suite never guesses or
  defaults to a domain.
- **Required role credentials must be set** (Employee, Manager, HR Admin,
  CEO). The suite refuses to start at all if any are missing. Finance and
  Sys Admin are optional — specs needing them skip cleanly if their
  `E2E_*_EMAIL`/`_PASSWORD` are unset. The account-status
  (deactivate/reactivate) spec specifically requires Sys Admin and never
  substitutes another role for it.
- **`E2E_BACKUP_CONFIRMED` gates every mutating spec.** Unless it is exactly
  `"true"`, every spec that creates/modifies a real record skips itself.
  Read-only specs run regardless.
- **Emergency stops, enforced in code** (`src/emergencyStop.ts`): a mutating
  spec refuses to act on any account that isn't one of this run's
  configured `E2E_*` test accounts, and refuses to mutate any pre-existing
  record that doesn't already carry the current run's tag.
- **Never activates, publishes, or deletes a policy.** `PoliciesPage.ts` has
  no method that clicks "Activate"/"Delete" — enforced by code review of
  that file, not a runtime guard.
- **Never finalizes payroll.** `PayrollPage.ts` only checks which controls
  render; nothing in this suite ever clicks export/generate/run/lock.
- **Never sends a real password-reset email.** The forgot-password spec
  only ever submits definitely-nonexistent addresses.
- **Never touches a real employee or the System Administrator account.**
  Every mutating action targets one of the fixed `E2E_*` test accounts by
  email, checked against `src/emergencyStop.ts` before acting.
- **Every record this suite creates is tagged** with the current run's ID
  (`E2E-YYYYMMDD-HHMMSS`, see `src/recordTag.ts`), embedded in whatever
  free-text field the record has (a leave reason, a reimbursement
  description); for tables with no free-text field (attendance,
  recovery-credit), identity comes from a synthetic date in the year 2099+,
  deterministically derived from the run ID, so no real attendance day is
  ever touched.
- **Credentials are never logged, printed, or written to a report/trace
  file.** They live only in environment secrets and are read once per
  process via `process.env`.

## What is and isn't reversible

Some mutations this suite makes have no safe "undo" via the app's own UI —
that is reported, never hidden. See `tests/reconcile/verify.reconcile.ts`
and the reconciliation report it produces (`test-results/reconciliation/
<runId>.md`, and posted to the GitHub Actions job summary):

- An **approved** leave request permanently changes the Employee test
  account's leave balance. There is no "un-approve" — this is reported as
  an expected, tagged, permanent change. If you want the balance restored,
  the exact record (identified by its `[<runId>] ...` tagged reason) needs
  to be reversed directly in Supabase.
- An **approved or rejected** reimbursement claim is a real, permanent
  record. It is never progressed past that state — no export, payment, or
  accounting integration is triggered — but it isn't deleted either. If you
  want it removed rather than left as identified test data, delete the
  specific tagged row(s) directly in Supabase.
- Attendance/recovery-credit rows on the synthetic 2099+ test date are left
  in place — there's no delete UI for them, and there's no real day for
  them to collide with.
- Deactivation of the Employee test account is fully reversed by this suite
  itself, in the same test, before it ends — this is the one mutation this
  suite always undoes.

## Run IDs

Every invocation gets a run ID of the form `E2E-YYYYMMDD-HHMMSS` (UTC),
generated once (`src/config.ts`'s `generateRunId()`), or set explicitly via
`E2E_RUN_ID`. The mutating GitHub Actions workflow computes ONE run ID in
its `guard` job and passes it to every subsequent job (baseline, read-only,
mutating, reconciliation — each a separate `playwright test` process
invocation), so they all tag the same run and the reconciliation step
compares against the right baseline.

## Read-only vs. mutating

Read-only and mutating specs live in separate directories
(`tests/read-only/`, `tests/mutating/`), which are separate Playwright
**projects** (see `playwright.config.ts`), not just a grep tag — the
mutating project is never included when only `--project=read-only` is
requested. Every mutating describe block also calls
`test.skip(!isBackupConfirmed(), ...)` as a second, independent gate.
Filenames under `tests/mutating/` carry a numeric prefix
(`10-leave`, `20-attendance`, `30-reimbursements`, `40-document-upload`,
`50-account-status`, `60-audit-verification`) that fixes their execution
order under this suite's `workers: 1` / `fullyParallel: false` config —
account-status runs deliberately last, since deactivating the Employee
test account could otherwise disrupt any later mutating test that depends
on that account's session.

There are also two extra projects, `baseline` and `reconciliation`
(`tests/baseline/`, `tests/reconcile/`), which capture and compare the
Employee test account's status/leave-balance/reimbursement state via the
same authenticated UI reads the functional specs use — never a service-role
key.

## Running

```bash
npm install --workspace @enginious-hr/e2e-tests

# Safe to run any time:
npm run test:e2e:baseline    # capture pre-run state
npm run test:e2e:read-only   # read-only + mobile-smoke projects

# Only after E2E_BACKUP_CONFIRMED=true and a baseline has been captured:
npm run test:e2e:mutating
npm run test:e2e:reconcile   # always run this after mutating, even if it failed
```

The two GitHub Actions workflows drive this in the right order for CI —
see their own comments for the exact job sequence and gating:

- `.github/workflows/e2e-production-qa-readonly.yml` — read-only only,
  triggerable by a PR touching this package or by manual dispatch.
- `.github/workflows/e2e-production-qa-mutating.yml` — **manual dispatch
  only**, requires typing `RUN_PRODUCTION_E2E` exactly and confirming
  `backup_confirmed`, or the job fails immediately before any secret is
  read or browser launched. Runs baseline → read-only (must pass) →
  mutating → reconciliation (always, and fails the workflow if account
  status or leave balances differ unexpectedly from baseline).

## Evidence policy

`trace.zip`, `.auth/` (storageState), and the HTML reporter (which embeds
full trace data, including live session cookies) are **never** uploaded as
CI artifacts — both workflows only upload JUnit XML, screenshots, videos,
and error-context.md files with test-account emails redacted
(`scripts/redact-error-context.ts`), all with 14-day retention.

## Selector confidence

Page objects verified directly against real component source this round:
`LoginPage`, `Nav`/RBAC route table, `AttendancePage`, `LeavePage` +
`ApprovalsPage`, `PoliciesPage`, `ReimbursementsPage` (against
`new-claim-form.tsx`/`[id]/add-line-form.tsx`/`[id]/claim-actions.tsx`).
Best-effort, kept generic (text/role-based rather than DOM-structure-based)
so a first live run mostly needs small text tweaks: `EmployeesPage`,
`HolidaysPage`, `AuditLogPage`, `PayrollPage`, `DashboardPage`, the
account-menu/sign-out selector in `tests/read-only/auth.spec.ts` (grounded
in `user-menu.tsx`'s known lucide-react icon class, not guessed), and the
Recovery Leave trigger in `20-attendance.spec.ts` — each of these has an
explicit `test.skip(...)` fallback naming exactly what to confirm, rather
than asserting against a guessed selector.

## What this suite has NOT verified

- Whether Annual Leave approval is a single manager step or manager + a
  separate HR stage.
- The exact trigger for Recovery Leave creation from an attendance record.
- Exact per-country leave balance arithmetic (covered by `packages/domain`'s
  own unit tests; this suite's balance check only confirms a number
  decreases after an approved request).
- Genuine cross-company/cross-tenant data isolation — the configured test
  accounts all belong to one company (see
  `tests/read-only/isolation.spec.ts`'s doc comment).
